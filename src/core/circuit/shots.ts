/**
 * Running a circuit one shot at a time.
 *
 * Everything else in the simulator follows every possibility at once: a
 * measurement splits the state into branches, each with its chance. A shot is
 * what an experiment does instead — it goes through once, and at each
 * measurement it comes out one way, picked with the Born rule's odds. Run
 * enough of them and the tally comes to look like those odds, which is the
 * thing worth watching happen.
 *
 * What a shot records is what the circuit reads: the outcome on every wire it
 * measures. A circuit with no measurement in it is read at the end, every wire
 * at once, which is what running it on hardware would mean.
 */

import type { CircuitDoc, Gate } from './ast'
import { gateQubits } from './ast'
import { abs2 } from './complex'
import { SimulationError, applyGate, startOf, type Amplitudes } from './simulate'

/** One measurement's outcome on one shot, and where in the drawing it was read. */
export interface Reading {
  /** The layer the measurement is in. */
  layer: number
  qubit: number
  value: 0 | 1
}

export interface Shot {
  /** The outcome on each wire in `wires`, as `0`s and `1`s in that order. */
  record: string
  /** Every measurement on the way down, top to bottom. */
  readings: Reading[]
}

/** Which wires a shot reads, in order, and whether that is at the end of the circuit. */
export interface ShotPlan {
  wires: number[]
  /** No measurement in the circuit: every wire is read once it has run. */
  atEnd: boolean
}

/** A possible record and how likely it is. */
export interface ShotOutcome {
  record: string
  probability: number
}

/** The measurements in a layer, in the order the simulator takes the layer's gates. */
const inOrder = (gates: Gate[]): Gate[] =>
  [...gates].sort((a, b) => Math.min(...gateQubits(a)) - Math.min(...gateQubits(b)))

/** The wires a shot reads. */
export function shotPlan(doc: CircuitDoc): ShotPlan {
  const measured = new Set<number>()
  for (const layer of doc.layers) {
    for (const gate of layer.gates) if (gate.kind === 'measure' && !gate.off) measured.add(gate.qubit)
  }
  if (!measured.size) {
    return { wires: Array.from({ length: doc.qubits }, (_, i) => i + 1), atEnd: true }
  }
  return { wires: [...measured].sort((a, b) => a - b), atEnd: false }
}

function weight(amps: Amplitudes): number {
  let total = 0
  for (const amp of amps.values()) total += abs2(amp)
  return total
}

/** The terms in which `qubit` holds `value`, and their share of the whole. */
function keep(amps: Amplitudes, qubit: number, value: '0' | '1'): Amplitudes {
  const kept: Amplitudes = new Map()
  for (const [bits, amp] of amps) if (bits[qubit - 1] === value) kept.set(bits, amp)
  return kept
}

/** The circuit as one list of gates, in the order they are applied, each with its layer. */
function steps(doc: CircuitDoc): { gate: Gate; layer: number }[] {
  // Anything switched off is left out: it does nothing, measuring included.
  return doc.layers.flatMap((layer, at) =>
    inOrder(layer.gates.filter((g) => !g.off)).map((gate) => ({ gate, layer: at })),
  )
}

function checkBasis(gate: Gate & { kind: 'measure' }) {
  if (gate.basis !== 'Z') {
    throw new SimulationError(`a ${gate.basis} measurement has no white-or-black outcome to read`)
  }
}

/**
 * Walk the circuit, handing each measurement to `read`, which says which way
 * it comes out.
 */
function walk(
  doc: CircuitDoc,
  read: (amps: Amplitudes, qubit: number, layer: number) => Amplitudes,
): Amplitudes {
  let amps = startOf(doc)
  for (const { gate, layer } of steps(doc)) {
    if (gate.kind === 'measure') {
      checkBasis(gate)
      amps = read(amps, gate.qubit, layer)
    } else {
      amps = applyGate(amps, gate)
    }
    if (!amps.size) throw new SimulationError('the terms all cancel, leaving no state to measure')
  }
  return amps
}

/** Pick a basis state of `amps` with the Born rule's odds. */
function pickTerm(amps: Amplitudes, rand: () => number): string {
  const terms = [...amps].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  let left = rand() * weight(amps)
  for (const [bits, amp] of terms) {
    left -= abs2(amp)
    if (left < 0) return bits
  }
  return terms[terms.length - 1][0]
}

/**
 * One run through the circuit.
 *
 * `rand` gives numbers in [0, 1): `Math.random`, or a seeded generator where
 * the same shots have to come out every time.
 */
export function sampleShot(doc: CircuitDoc, rand: () => number = Math.random): Shot {
  const plan = shotPlan(doc)
  const readings: Reading[] = []
  const last = new Map<number, 0 | 1>()

  const end = walk(doc, (amps, qubit, layer) => {
    const ones = keep(amps, qubit, '1')
    const p = weight(ones) / weight(amps)
    const value: 0 | 1 = rand() < p ? 1 : 0
    readings.push({ layer, qubit, value })
    last.set(qubit, value)
    return value ? ones : keep(amps, qubit, '0')
  })

  if (plan.atEnd) return { record: pickTerm(end, rand), readings }
  return { record: plan.wires.map((w) => String(last.get(w))).join(''), readings }
}

/**
 * Every record a shot can come out with, and how likely each is: what the
 * tally should come to look like.
 *
 * Each measurement is followed both ways rather than the branches being merged
 * as the rest of the simulator does — two routes to the same state are two
 * different records when the measurements along the way differ.
 */
export function shotOdds(doc: CircuitDoc): ShotOutcome[] {
  const plan = shotPlan(doc)
  const odds = new Map<string, number>()
  const add = (record: string, p: number) => {
    if (p > 1e-12) odds.set(record, (odds.get(record) ?? 0) + p)
  }

  const all = steps(doc)
  /** Run from step `from` on, with the readings so far and their chance. */
  const go = (amps: Amplitudes, from: number, last: Map<number, string>, chance: number) => {
    let state = amps
    for (let i = from; i < all.length; i++) {
      const { gate } = all[i]
      if (gate.kind !== 'measure') {
        state = applyGate(state, gate)
        continue
      }
      checkBasis(gate)
      const total = weight(state)
      for (const value of ['0', '1'] as const) {
        const kept = keep(state, gate.qubit, value)
        if (kept.size) go(kept, i + 1, new Map([...last, [gate.qubit, value]]), (chance * weight(kept)) / total)
      }
      return
    }
    if (!state.size) return
    if (plan.atEnd) {
      const total = weight(state)
      for (const [bits, amp] of state) add(bits, (chance * abs2(amp)) / total)
    } else {
      add(plan.wires.map((w) => last.get(w)).join(''), chance)
    }
  }

  go(startOf(doc), 0, new Map(), 1)
  return [...odds]
    .map(([record, probability]) => ({ record, probability }))
    .sort((a, b) => (a.record < b.record ? -1 : 1))
}
