/**
 * Where a single qubit points, and how it gets there.
 *
 * One qubit's state is a point on (or inside) a sphere: white at the top,
 * black at the bottom, the even superpositions round the equator. Every gate
 * this notation can follow on one wire is a turn of that sphere about some
 * axis, so a circuit is a path — and the path between two layers is the turn
 * itself, not a straight line between its ends, which would cut through the
 * middle and look like the state losing its way.
 *
 * A measurement is the one thing that is not a turn. Its outcomes are averaged
 * by their chances, which puts the point *inside* the sphere — a coin that has
 * been tossed but not looked at — and the way there is a straight drop onto the
 * vertical axis.
 *
 * Pure, like the rest of `core`: the editor asks for the path once and reads it
 * at whatever moment it is showing.
 */

import type { CircuitDoc, Gate } from './circuit/ast'
import type { Palette } from './render/theme'
import { parseCircuit } from './circuit/parse'
import { detectMode } from './mode'
import { SimulationError, branchesByLayer, traceGate, type Amplitudes, type Branch } from './circuit/simulate'
import { ONE } from './circuit/complex'

export type Vec3 = [number, number, number]

/** What a layer does to the point. */
export type BlochMove =
  | { kind: 'still' }
  | { kind: 'turn'; axis: Vec3; angle: number }
  | { kind: 'collapse' }

export interface BlochPath {
  /** The point after each number of layers: `points[0]` is the input. */
  points: Vec3[]
  /** How layer `k` takes `points[k]` to `points[k + 1]`. */
  moves: BlochMove[]
  /**
   * The colour layer `k` is drawn in, as a key: one of the palette's gate
   * chips (`H`, `RY`, …), else `accent` for the X target or `measure`, or the
   * colour a gate was given with `fill=`. Null for a layer that does nothing.
   * `tintColour` turns one into a colour.
   */
  tints: (string | null)[]
}

/** The palette key a gate is drawn in, so the sphere's trail can match it. */
function tintOf(gate: Gate | undefined): string | null {
  if (!gate) return null
  switch (gate.kind) {
    case 'single':
      // A colour written on the gate wins, as it does on the drawing.
      return gate.accent ?? gate.label
    case 'measure':
      return 'measure'
    case 'controlled':
      return gate.accent ?? (gate.targetGlyph === 'z' ? 'Z' : 'accent')
    default:
      return null
  }
}

/** The point for one pure state, from its two amplitudes. */
function pointOf(amps: Amplitudes): Vec3 {
  const a = amps.get('0') ?? { re: 0, im: 0 }
  const b = amps.get('1') ?? { re: 0, im: 0 }
  const n = a.re * a.re + a.im * a.im + b.re * b.re + b.im * b.im
  // ā·b, whose real and imaginary parts are the two equatorial directions.
  const re = a.re * b.re + a.im * b.im
  const im = a.re * b.im - a.im * b.re
  return [(2 * re) / n, (2 * im) / n, (a.re * a.re + a.im * a.im - b.re * b.re - b.im * b.im) / n]
}

/**
 * The colour a tint is drawn in, by the rule the drawing's chips follow: a
 * colour given outright, else the palette's chip for that gate, else its
 * accent or its measurement grey. A layer that does nothing is drawn faint.
 */
export function tintColour(tint: string | null, pal: Palette): string {
  if (!tint) return pal.gateEdge
  const chips = pal.gateChip as Record<string, string>
  if (chips[tint]) return chips[tint]
  if (tint === 'measure') return pal.muted
  if (tint === 'accent') return pal.accent
  if (/^#|^[a-z]+$/.test(tint)) return tint
  return pal.ink
}

/** Each branch's point, weighed by how likely it is. */
function pointOfBranches(branches: Branch[]): Vec3 {
  const sum: Vec3 = [0, 0, 0]
  for (const branch of branches) {
    const p = branch.odds.n / branch.odds.d
    const v = pointOf(branch.amps)
    for (let i = 0; i < 3; i++) sum[i] += p * v[i]
  }
  return sum
}

const AXES: Record<string, Vec3> = { RX: [1, 0, 0], RY: [0, 1, 0], RZ: [0, 0, 1], P: [0, 0, 1] }

/**
 * The turn a gate makes, as an axis and an angle.
 *
 * A written angle is taken as written, so `RY(270)` goes three quarters of the
 * way round rather than a quarter back. Anything else is read off the gate's
 * own matrix: with its overall phase divided out it is
 * `cos(θ/2) − i·sin(θ/2)·(n·σ)`, and the axis and angle are its entries.
 */
function moveOf(gate: Gate): BlochMove {
  if (gate.kind === 'measure') return { kind: 'collapse' }
  if (gate.kind === 'view' || gate.kind === 'identity') return { kind: 'still' }
  if (gate.kind === 'single' && gate.angle !== undefined && AXES[gate.label]) {
    return { kind: 'turn', axis: AXES[gate.label], angle: (gate.angle * Math.PI) / 180 }
  }

  // Columns of the matrix, by sending white and black through it.
  const column = (bit: string) => {
    const col = { '0': { re: 0, im: 0 }, '1': { re: 0, im: 0 } } as Record<string, { re: number; im: number }>
    for (const c of traceGate(new Map([[bit, ONE]]), gate)) {
      col[c.to].re += c.amp.re
      col[c.to].im += c.amp.im
    }
    return col
  }
  const c0 = column('0')
  const c1 = column('1')
  const [u00, u10, u01, u11] = [c0['0'], c0['1'], c1['0'], c1['1']]

  // The determinant's square root is the phase (and scale) to divide out.
  const det = {
    re: u00.re * u11.re - u00.im * u11.im - (u01.re * u10.re - u01.im * u10.im),
    im: u00.re * u11.im + u00.im * u11.re - (u01.re * u10.im + u01.im * u10.re),
  }
  const r = Math.sqrt(Math.hypot(det.re, det.im))
  if (!r) return { kind: 'still' }
  const phi = Math.atan2(det.im, det.re) / 2
  // Multiplying by e^{-iφ}/r.
  const over = (z: { re: number; im: number }) => ({
    re: (z.re * Math.cos(phi) + z.im * Math.sin(phi)) / r,
    im: (z.im * Math.cos(phi) - z.re * Math.sin(phi)) / r,
  })
  let a = over(u00)
  let b = over(u01)
  // ±V are the same turn; the one with cos(θ/2) ≥ 0 is the short way round.
  if (a.re < 0) {
    a = { re: -a.re, im: -a.im }
    b = { re: -b.re, im: -b.im }
  }
  const axis: Vec3 = [-b.im, -b.re, -a.im]
  const s = Math.hypot(...axis)
  if (s < 1e-12) return { kind: 'still' }
  return {
    kind: 'turn',
    axis: axis.map((x) => x / s) as Vec3,
    angle: 2 * Math.atan2(s, Math.min(1, a.re)),
  }
}

/**
 * The whole path of a one-qubit circuit.
 *
 * Throws for anything with more than one wire: two qubits are not two points
 * on two spheres unless they happen not to be entangled, and drawing them that
 * way would be wrong exactly when it is interesting.
 */
export function blochPath(doc: CircuitDoc): BlochPath {
  if (doc.qubits !== 1) {
    throw new SimulationError('a Bloch sphere shows one qubit, and this circuit has ' + doc.qubits)
  }
  const points = branchesByLayer(doc).map(pointOfBranches)
  const gates = doc.layers.map((layer) => layer.gates.find((g) => g.kind !== 'view'))
  const moves = gates.map((gate) => (gate ? moveOf(gate) : ({ kind: 'still' } as const)))
  return { points, moves, tints: gates.map(tintOf) }
}

/**
 * The path for a source as typed.
 *
 * Throws, with a reason fit to show, for a state rather than a circuit, for
 * more than one wire, and for anything the arithmetic cannot follow.
 */
export function blochOf(source: string): BlochPath {
  if (detectMode(source) !== 'circuit') {
    throw new SimulationError('a Bloch sphere follows a circuit, and this is a state')
  }
  return blochPath(parseCircuit(source))
}

/** `v` turned by `angle` about the unit vector `n` (Rodrigues). */
function rotate(v: Vec3, n: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const dot = n[0] * v[0] + n[1] * v[1] + n[2] * v[2]
  const cross: Vec3 = [n[1] * v[2] - n[2] * v[1], n[2] * v[0] - n[0] * v[2], n[0] * v[1] - n[1] * v[0]]
  return [0, 1, 2].map((i) => v[i] * c + cross[i] * s + n[i] * dot * (1 - c)) as Vec3
}

/**
 * The point part-way along: `s` layers in, where a fraction is part of a gate.
 *
 * A turn is read as a turn, so at the end of a layer it lands on exactly the
 * point the arithmetic gives — checked by the tests rather than assumed.
 */
export function blochAt(path: BlochPath, s: number): Vec3 {
  const last = path.moves.length
  if (s <= 0 || !last) return path.points[0]
  if (s >= last) return path.points[last]
  const k = Math.floor(s)
  const u = s - k
  const from = path.points[k]
  const move = path.moves[k]
  if (u === 0 || move.kind === 'still') return from
  if (move.kind === 'turn') return rotate(from, move.axis, move.angle * u)
  const to = path.points[k + 1]
  return [0, 1, 2].map((i) => from[i] + (to[i] - from[i]) * u) as Vec3
}

/**
 * How far through the circuit an animation is at `t`, in layers.
 *
 * `spans[k]` is when layer `k` is being worked; a layer with no span (a view,
 * say) is passed in an instant at the end of the one before it.
 */
export function layersAt(spans: ({ from: number; to: number } | undefined)[], t: number): number {
  let s = 0
  for (let k = 0; k < spans.length; k++) {
    const span = spans[k]
    if (!span) {
      s = k + 1
      continue
    }
    if (t <= span.from) return k
    if (t >= span.to) {
      s = k + 1
      continue
    }
    const u = (t - span.from) / (span.to - span.from)
    // Eased, so the arrow starts and stops gently the way the qubits do.
    return k + u * u * (3 - 2 * u)
  }
  return s
}
