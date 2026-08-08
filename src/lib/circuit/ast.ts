/**
 * AST for vertical circuits. Time runs downward: qubits enter at the top and
 * fall through gates connected by pipes.
 */

import type { StateRow } from '../state/ast'

/** Single-qubit gate drawn as a labelled box on one pipe. */
export interface SingleGate {
  kind: 'single'
  label: string
  qubit: number
  /** Optional CSS colour for the label chip, e.g. Hadamard's red. */
  accent?: string
}

/**
 * Identity: occupies a layer but does nothing to the qubit.
 *
 * Drawn as plain pipe rather than a body, so it reads as a length of pipe
 * connecting the layers above and below — which is exactly what it is. Its only
 * effect on the drawing is to hold a slot in the vertical rhythm.
 */
export interface IdentityGate {
  kind: 'identity'
  qubit: number
}

/** Controlled gate: filled dots on controls, a target glyph on the target. */
export interface ControlledGate {
  kind: 'controlled'
  controls: number[]
  target: number
  /** 'not' draws ⊕, otherwise the label sits in a chip on the target. */
  targetGlyph: 'not' | 'z' | 'label'
  label?: string
}

/** SWAP: an × on each of the two qubits, joined by a bar. */
export interface SwapGate {
  kind: 'swap'
  qubits: [number, number]
}

/** Measurement: a darker box with a meter dial and a basis label. */
export interface MeasureGate {
  kind: 'measure'
  qubit: number
  basis: string
}

/** Custom box spanning a contiguous range, e.g. an oracle. */
export interface BoxGate {
  kind: 'box'
  label: string
  qubits: number[]
  fill?: string
  /** Draw as an empty frame for students to fill in. */
  blank?: boolean
}

/**
 * A window onto the computation: the state of some qubits at this point.
 *
 * Not an operation — nothing happens here — but it occupies a layer of its own,
 * because a snapshot is a moment *between* gates rather than one of them. The
 * pipes it covers stop at it and resume below; qubits outside its span flow
 * straight past, which is what makes "identity here, look there" fall out with
 * no extra syntax.
 */
export interface ViewGate {
  kind: 'view'
  /** The contiguous run of qubits the state describes. */
  qubits: number[]
  /**
   * The states to show — usually one, but a measurement leaves several
   * possible outcomes, each drawn on its own row.
   */
  rows?: StateRow[]
  /** Written `calculate`: work the state out from the input and the gates above. */
  calculate?: boolean
  /** Caption for a state not yet worked out; a written one carries its own. */
  caption?: string
  /**
   * Draw the state inside a framed box plumbed into the circuit, rather than as
   * a break in it. The bare form reads as the computation laid open; the framed
   * form as an instrument fitted into the line.
   */
  boxed?: boolean
  /** Fill for the frame, when it should not be the default paper. */
  fill?: string
}

export type Gate =
  | SingleGate | IdentityGate | ControlledGate | SwapGate | MeasureGate | BoxGate | ViewGate

/** Every qubit a gate touches, used for layer packing and span width. */
export function gateQubits(gate: Gate): number[] {
  switch (gate.kind) {
    case 'single': return [gate.qubit]
    case 'identity': return [gate.qubit]
    case 'controlled': return [...gate.controls, gate.target]
    case 'swap': return [...gate.qubits]
    case 'measure': return [gate.qubit]
    case 'box': return [...gate.qubits]
    case 'view': return [...gate.qubits]
  }
}

/** A gate occupies its full span, so nothing else may sit between its endpoints. */
export function gateSpan(gate: Gate): [number, number] {
  const qs = gateQubits(gate)
  return [Math.min(...qs), Math.max(...qs)]
}

export interface Layer {
  gates: Gate[]
}

export interface CircuitDoc {
  kind: 'circuit'
  qubits: number
  layers: Layer[]
  /** Optional misty state drawn above the circuit. */
  input?: StateRow
  /** Optional misty state drawn below the circuit; several after a measurement. */
  output?: StateRow[]
  /** Written `out calculate`: the output is worked out rather than given. */
  calculateOutput?: boolean
  /** Caption for that output, held until there is a state to hang it on. */
  calculateCaption?: string
  /** Per-qubit shape override; defaults to position order. */
  shapeIndices?: number[]
  /**
   * Draw the bare qubit shapes above the circuit. Off unless asked for, so a
   * circuit shows only what was specified; gates keep short input and output
   * pipe stubs either way, and a lone gate reads as a piece of plumbing.
   */
  header?: boolean
}
