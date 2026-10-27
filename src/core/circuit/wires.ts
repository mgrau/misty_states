/**
 * Where each wire is, layer by layer.
 *
 * A wire starts at its own number — wire 3 at position 3 — unless a `wires`
 * line says otherwise, and an `I` written
 * with `shift=` or `->` bends it across to somewhere else, where it stays until
 * it is moved again. Nothing else moves a wire, so the positions are a walk
 * down the layers, and this is the one place that walk is taken: the parser
 * checks it, the layout draws it, and the animation follows it.
 *
 * Wires may cross on the way, passing in front of one another, but may not run
 * into each other: two wires closer than a column, two turns at the same height
 * over the same stretch, or a turn through a gate.
 */

import type { Gate, IdentityGate, Layer } from './ast'
import { gateQubits } from './ast'

/** How close two wires may stand: a column, the room a gate on either takes. */
export const MIN_APART = 1
/** The least a wire can bend by and still have room to turn the corner twice. */
export const MIN_BEND = 0.5
/**
 * Half the room a gate takes, in columns, either side of its wire.
 *
 * A turn passing nearer than this would go through the gate's box.
 */
const GATE_REACH = 0.5

/** Raised for a bend that cannot be drawn; the parser turns it into a ParseError. */
export class WireError extends Error {
  constructor(message: string, readonly line?: number) {
    super(message)
  }
}

/** A wire turning from one position to another, within one layer. */
export interface Bend {
  qubit: number
  from: number
  to: number
}

export interface WirePlan {
  /**
   * The position of every wire going into each layer, and once more after the
   * last — wire 1 first. A layer with no bends in it leaves them as they were.
   */
  at: number[][]
  /** The bends in each layer, in the order they were written. */
  bends: Bend[][]
}

/**
 * Where each wire starts.
 *
 * `wires 1 4 5` puts them at 1, 4 and 5. A wire it leaves out starts a column
 * past the one before it, so `wires 1 4` still has wire 3 at 5, and a wire
 * added to the register later lands beside the last rather than on top of it.
 * With no `wires` line, every wire is at its own number.
 */
export function homeOf(start?: readonly number[]): (q: number) => number {
  if (!start?.length) return (q) => q
  const last = start[start.length - 1]
  return (q) => (q <= start.length ? start[q - 1] : last + q - start.length)
}

/** The `I` that bends a wire, or null for any other gate. */
export function bendOf(gate: Gate): (IdentityGate & { move: NonNullable<IdentityGate['move']> }) | null {
  return gate.kind === 'identity' && gate.move ? (gate as ReturnType<typeof bendOf>) : null
}

/** Where a bend takes its wire, given where the wire is now. */
export function bendTarget(gate: IdentityGate, from: number): number {
  const move = gate.move
  if (!move) return from
  return move.to ?? from + (move.by ?? 0)
}

/** Read a position for showing: whole numbers bare, the rest to two places. */
const pos = (p: number): string => (Number.isInteger(p) ? `${p}` : `${Math.round(p * 100) / 100}`)

/**
 * Walk the layers, moving wires as the bends say, and refuse any collision.
 *
 * Collisions are checked here rather than where the bends are read because a
 * wire nobody has mentioned yet still stands in its place — `I 3 -> 4` runs
 * into wire 4 even when wire 4 is only used further down.
 */
export function planWires(
  qubits: number,
  layers: Layer[],
  start?: readonly number[],
  startLine?: number,
): WirePlan {
  const home = homeOf(start)
  let now = Array.from({ length: qubits }, (_, i) => home(i + 1))
  for (let a = 0; a < qubits; a++) {
    for (let b = a + 1; b < qubits; b++) {
      if (Math.abs(now[a] - now[b]) < MIN_APART - 1e-9) {
        throw new WireError(
          `wires ${a + 1} and ${b + 1} start on top of each other, at ${pos(now[a])} and ${pos(now[b])} — wires stay a column apart`,
          startLine,
        )
      }
    }
  }
  const at: number[][] = []
  const bends: Bend[][] = []

  for (const layer of layers) {
    at.push(now)
    const here: Bend[] = []
    const next = [...now]
    for (const gate of layer.gates) {
      const bend = bendOf(gate)
      if (!bend) continue
      const from = now[bend.qubit - 1]
      const to = bendTarget(bend, from)
      if (to === from) continue
      if (Math.abs(to - from) < MIN_BEND) {
        throw new WireError(
          `wire ${bend.qubit} has no room to turn — a bend goes at least ${MIN_BEND} of a column`,
          gate.line,
        )
      }
      here.push({ qubit: bend.qubit, from, to })
      next[bend.qubit - 1] = to
    }
    bends.push(here)
    if (here.length) {
      checkTurns(here, layer, now)
      checkApart(next, here, layer)
    }
    now = next
  }
  at.push(now)
  return { at, bends }
}

/** The line a bend of this wire was written on, for pointing at. */
const lineOf = (layer: Layer, qubit: number): number | undefined =>
  layer.gates.find((g) => bendOf(g)?.qubit === qubit)?.line

const span = (b: Bend): [number, number] => [Math.min(b.from, b.to), Math.max(b.from, b.to)]

/**
 * Turns in one layer run across at the same height, so two over the same
 * stretch would be one pipe drawn on another. And a turn may cross a plain
 * wire — it passes in front — but not a gate, which has a box in the way.
 */
function checkTurns(here: Bend[], layer: Layer, now: number[]): void {
  for (let i = 0; i < here.length; i++) {
    const [a0, a1] = span(here[i])
    for (let j = i + 1; j < here.length; j++) {
      const [b0, b1] = span(here[j])
      if (a0 < b1 + MIN_APART && b0 < a1 + MIN_APART) {
        throw new WireError(
          `wires ${here[i].qubit} and ${here[j].qubit} would turn into each other — bend them on separate lines`,
          lineOf(layer, here[j].qubit),
        )
      }
    }
    for (const gate of layer.gates) {
      if (gate.kind === 'identity') continue
      const qs = gateQubits(gate)
      if (!qs.length) continue
      const xs = qs.map((q) => now[q - 1])
      const g0 = Math.min(...xs) - GATE_REACH
      const g1 = Math.max(...xs) + GATE_REACH
      if (a0 < g1 && g0 < a1) {
        throw new WireError(
          `wire ${here[i].qubit} would turn through the gate on wire ${qs[0]} — bend it on a line of its own`,
          lineOf(layer, here[i].qubit),
        )
      }
    }
  }
}

/** Where the wires come to rest, none may stand on another. */
function checkApart(next: number[], here: Bend[], layer: Layer): void {
  for (const b of here) {
    for (let q = 1; q <= next.length; q++) {
      if (q === b.qubit) continue
      if (Math.abs(next[q - 1] - b.to) < MIN_APART - 1e-9) {
        throw new WireError(
          `wire ${b.qubit} would land on wire ${q}, at ${pos(next[q - 1])} — wires stay a column apart`,
          lineOf(layer, b.qubit),
        )
      }
    }
  }
}

/**
 * The wires a gate covers where they stand: its own, and every other wire that
 * is between them at the time.
 *
 * Without bends this is just the run from its first wire to its last. With
 * them, a wire that has moved in between is covered and one that has moved out
 * is not — which is what keeps a gate from being packed in under another one's
 * box. `place` gives each wire's position; any it has not heard of is where it
 * started.
 */
export function coveredWires(
  gate: Gate,
  place: ReadonlyMap<number, number>,
  home: (q: number) => number = (q) => q,
): number[] {
  const own = gateQubits(gate)
  if (!own.length) return []
  const p = (q: number) => place.get(q) ?? home(q)
  const xs = own.map(p)
  const lo = Math.min(...xs)
  const hi = Math.max(...xs)
  // Every wire that could be standing in there: the moved ones wherever they
  // went, and the rest up to where their starting places pass the far end —
  // past the wires a `wires` line lists, those are a column apart and rising.
  let last = Math.max(...own, ...place.keys(), 1)
  while (home(last) <= hi) last++
  const out = new Set(own)
  for (let q = 1; q <= last; q++) if (p(q) >= lo && p(q) <= hi) out.add(q)
  return [...out].sort((a, b) => a - b)
}
