/**
 * AST for vertical circuits. Time runs downward: qubits enter at the top and
 * fall through gates connected by pipes.
 */

import type { StateRow } from '../state/ast'
import type { ShapePick } from '../shapes'
import type { AnimationOptions } from './animate'

/** Single-qubit gate drawn as a labelled box on one pipe. */
export interface SingleGate {
  kind: 'single'
  label: string
  qubit: number
  /** Optional CSS colour for the label chip, e.g. Hadamard's red. */
  accent?: string
  /**
   * Degrees, for a rotation. `RZ(45)` is `label: 'RZ'`, `angle: 45`.
   *
   * Kept on the gate rather than folded into the label so the arithmetic can
   * read it and the drawing can set it apart from the letters.
   */
  angle?: number
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
  /**
   * Where the wire goes: the position it bends across to, in columns.
   *
   * Every wire starts at its own number — wire 3 at 3 — and stays wherever it
   * is last moved. Written `shift=2`, two columns over from where it is now,
   * or `-> 5`, to position 5. Where that leaves every wire is `wirePositions`'
   * business, so the two spellings are told apart in one place only.
   *
   * A bend is where it happens, not what happens: the qubit is untouched, it
   * just goes somewhere else. Which is why it is an identity.
   */
  move?: { by?: number; to?: number }
}

/**
 * Written `tag 2`, or `tag` for every wire: the wire's shape, in outline, on
 * its pipe — saying which physical qubit this pipe is, without saying what it
 * holds. Neither white nor black, because it is not a value.
 *
 * Like an identity it does nothing to the state; unlike one it draws
 * something, in a layer shorter than a gate, since there is no box to hold.
 */
export interface TagGate {
  kind: 'tag'
  /** Empty for a bare `tag` until the register's width is known. */
  qubits: number[]
}

/** Controlled gate: filled dots on controls, a target glyph on the target. */
export interface ControlledGate {
  kind: 'controlled'
  controls: number[]
  target: number
  /** 'not' draws ⊕, otherwise the label sits in a chip on the target. */
  /**
   * `not` is the ⊕, `z` the filled dot, `label` puts the gate's name there —
   * and anything else is a mark of its own, drawn in a ring.
   */
  targetGlyph: 'not' | 'z' | 'label' | (string & {})
  /**
   * A name for what the gate does.
   *
   * Two placements, because the course uses two. On the target it replaces the
   * glyph, which is what a "Parity" gate wants; beside the link it names the
   * whole thing, which is what "Tiger?" wants. Which one is chosen by where the
   * quoted name is written, not by a second field.
   */
  label?: string
  /** True when the label names the link rather than standing on the target. */
  labelOnLink?: boolean
  /**
   * Written `colour=`: what its dots, its link and its target are drawn in, in
   * place of the drawing's accent. A name on the target takes it as its box.
   */
  accent?: string
  /**
   * Written `CGATE` or `GATE`: a gate known only by its name.
   *
   * Drawn exactly as a controlled gate with that name on its target — or, with
   * no controls, the name alone — but it does not stand for any operation, so
   * the circuit cannot be calculated through it. A `CNOT "Oracle"` is still a
   * CNOT with a name on it; this is the mark for a gate that is not.
   */
  custom?: boolean
}

/** SWAP: an × on each of the two qubits, joined by a bar. */
export interface SwapGate {
  kind: 'swap'
  qubits: [number, number]
  /**
   * Control wires, where the swap only happens when they are all `1`.
   *
   * Empty for a plain SWAP; a single control is the Fredkin gate. Drawn as
   * filled dots on the same bar the × glyphs sit on, exactly as a controlled
   * gate draws its controls.
   */
  controls?: number[]
  /** Written `colour=`: what its crosses, bar and dots are drawn in. */
  accent?: string
}

/** Measurement: a darker box with a meter dial and a basis label. */
export interface MeasureGate {
  kind: 'measure'
  qubit: number
  basis: string
  /** Overrides the palette's measurement colour, like any other box. */
  fill?: string
}

/** Custom box spanning a contiguous range, e.g. an oracle. */
export interface BoxGate {
  kind: 'box'
  label: string
  qubits: number[]
  fill?: string
  /** Draw as an empty frame for students to fill in. */
  blank?: boolean
  /**
   * What it does, when it is a definition used collapsed: `oracle 1-2 collapsed`.
   *
   * Drawn as one box, worked out from these — already on the circuit's wires,
   * in the order they are applied. A box without them is only a drawing.
   */
  body?: Gate[]
  /**
   * The line whose `collapsed` folds this, where clicking it should open it
   * out again. Absent for one folded inside a definition: that line is the
   * definition's, and every use of it would open.
   */
  fold?: number
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
  /**
   * Written `answer`: this is what the question asks for.
   *
   * The source holds the worked answer, so it can be checked; the drawing
   * hides it behind unknowns until the answer is asked for.
   */
  answer?: boolean
  /** Annotations for a state not yet worked out; a written one carries its own. */
  caption?: string
  note?: string
  /**
   * Draw the state inside a framed box plumbed into the circuit, rather than as
   * a break in it. The bare form reads as the computation laid open; the framed
   * form as an instrument fitted into the line.
   */
  boxed?: boolean
  /** Fill for the frame, when it should not be the default paper. */
  fill?: string
  /**
   * Written `window blank`, or `window` alone: a frame with nothing in it, for
   * the state at that point to be drawn in by hand.
   */
  blank?: boolean
  /**
   * Written `rows=N`: at least this many rows of room, whatever the frame holds.
   *
   * A row is the height a plain row of qubits draws at, and rows are stacked
   * with the gap a list of outcomes leaves between them — so an empty frame
   * asked for two has exactly the room two outcomes would have taken.
   */
  space?: number
}

/**
 * How big a gate is drawn, as a multiple of the size it would otherwise take.
 *
 * Any gate can be given either. A multiple rather than a length because what a
 * gate is naturally sized by — its wires, its label, what a window holds —
 * differs from one kind to the next, and "twice as wide" means the same thing
 * for all of them.
 */
export interface GateStyle {
  /** Written `width=`. A gate made wider takes a layer to itself. */
  width?: number
  /** Written `height=`. On a plain pipe, it is how a layer is given more room. */
  height?: number
}

export type Gate = (
  | SingleGate | IdentityGate | TagGate | ControlledGate | SwapGate | MeasureGate | BoxGate | ViewGate
) & GateStyle & {
  /**
   * The source line this was written on.
   *
   * Carried on the union rather than on each member because it means the same
   * thing for all of them. Nothing about drawing a circuit needs it; pointing
   * at one does — it is how a gate on the page is traced back to the text that
   * put it there.
   */
  line?: number
  /**
   * Put there by a definition or a collapsed frame, not written on a line of
   * its own.
   *
   * Its `line` is the line that used the definition, which holds more than
   * this gate — so it cannot be picked up and moved alone without taking the
   * rest with it.
   */
  bound?: boolean
  /**
   * Written `if M1`: done only when wire 1 was measured black — or white, for
   * `if M1=0`.
   *
   * Carried on the union because what it conditions is any one-wire gate, and
   * it is drawn the same whichever: a double line across from the measured
   * wire, which is what holds the result once it has been read.
   */
  given?: { qubit: number; value: 0 | 1 }
}

/**
 * Every qubit a gate touches, used for layer packing and span width — the
 * measured wire a condition reads included, since the line to it is drawn.
 */
export function gateQubits(gate: Gate): number[] {
  const own = actedOn(gate)
  return gate.given ? [...own, gate.given.qubit] : own
}

/** The qubits a gate does something to, leaving out a wire it only reads. */
export function actedOn(gate: Gate): number[] {
  switch (gate.kind) {
    case 'single': return [gate.qubit]
    case 'identity': return [gate.qubit]
    case 'tag': return [...gate.qubits]
    case 'controlled': return [...gate.controls, gate.target]
    case 'swap': return [...(gate.controls ?? []), ...gate.qubits]
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
  /** Annotations for the layer as a whole, drawn either side of it. */
  caption?: string
  note?: string
  /**
   * The source lines whose gates ended up here, in the order they arrived.
   *
   * A list, not a number, because a layer is not a line: `;` puts several gates
   * on one line and the packer puts several lines in one layer. Editing the
   * source from a position on the drawing needs the way back, and this is it.
   */
  lines: number[]
}

/**
 * A column of a table.
 *
 * `possibility` is the state itself, drawn; the other two are text worked out
 * from it. The header is English, which nothing else the renderer emits is, so
 * it can be overridden per column.
 */
export interface TableColumn {
  kind: 'possibility' | 'probability' | 'amplitude'
  header?: string
}

/**
 * One line of a table, worked out and ready to draw.
 *
 * The numbers arrive as text: how a likelihood is written is a presentation
 * choice made where the arithmetic is, alongside the one `calculate` already
 * makes, rather than something the layout has to know about.
 */
export interface TableLine {
  state: StateRow
  probability?: string
  /** Always there once worked out; a table written by hand may leave it out. */
  amplitude?: string
}

/** Written `tabulate`: the outcomes as a table rather than a stack of states. */
export interface TableSpec {
  columns: TableColumn[]
  caption?: string
  note?: string
  /**
   * Filled in by `resolveCalculations`; absent until the circuit is run —
   * unless the rows were written out by hand, in which case they are here from
   * the start and nothing is worked out at all.
   */
  lines?: TableLine[]
  /** The rows were written, not calculated: `tabulate 00 = 1/2, 11 = 1/2`. */
  given?: boolean
}

/**
 * One bar of a chart.
 *
 * The numbers are normalised — a bar's height is a share of the whole state, so
 * it has to be on the scale where that means something, unlike the table's
 * amplitude column which shows the notation's own integers. The chance arrives
 * as text for the same reason a table's does: how a likelihood is written is
 * settled where the arithmetic is.
 */
export interface ChartBar {
  /** The basis state this bar stands over, drawn. */
  state: StateRow
  /** Signed, between -1 and 1. Absent after a measurement, which leaves none. */
  amplitude?: number
  /** Between 0 and 1. */
  probability: number
  /** That chance written out, for the bar's label. */
  label: string
}

/** Written `chart`: the state as a bar per basis state. */
export interface ChartSpec {
  /** Which quantity the bars stand for. */
  mode: 'amplitude' | 'probability'
  caption?: string
  note?: string
  /** Filled in by `resolveCalculations`; absent until the circuit is run. */
  bars?: ChartBar[]
  /** True once a measurement has left outcomes rather than a statevector. */
  measured?: boolean
  /** False when empty bars were dropped to keep the plot readable. */
  complete?: boolean
}

/**
 * A labelled frame drawn round a run of gates: `"Prep" { … }`, or a definition
 * used expanded.
 *
 * Only a drawing — the gates inside are gates like any others. It is laid out
 * from the layers and wires it covers rather than carried on the gates, since a
 * frame is a region of the drawing and not a thing that happens.
 */
export interface Frame {
  label?: string
  fill?: string
  /** A colour, or `none` for no outline. */
  border?: string
  /** The wires it covers, first and last. */
  qubits: [number, number]
  /** The layers it covers, first and last. */
  layers: [number, number]
  /** How many frames deep the deepest one inside it goes; 0 for none. */
  inner: number
  /** The line to write `collapsed` on to fold it; see `BoxGate.fold`. */
  fold?: number
}

export interface CircuitDoc {
  kind: 'circuit'
  qubits: number
  layers: Layer[]
  /** Optional misty state drawn above the circuit. */
  input?: StateRow
  /**
   * The source line the input was written on.
   *
   * A gate dropped onto a circuit that has none yet has to go *after* the
   * state, not before it — and a bare state line looks like nothing in
   * particular until the parser has decided it is the input.
   */
  inputLine?: number
  /** Optional misty state drawn below the circuit; several after a measurement. */
  output?: StateRow[]
  /**
   * The source line the output was written on, given or `calculate`.
   *
   * What anything editing the end of a circuit needs: which line *is* the
   * output is decided by what follows it, so it cannot be told from the line.
   */
  outputLine?: number
  /** Written `out calculate`: the output is worked out rather than given. */
  calculateOutput?: boolean
  /** Written `in calculate`: the input is worked out from a state written later. */
  calculateInput?: boolean
  calculateInputCaption?: string
  calculateInputNote?: string
  /** Annotations for that output, held until there is a state to hang them on. */
  calculateCaption?: string
  calculateNote?: string
  /** Written `tabulate`: drawn in place of an output state, below the circuit. */
  table?: TableSpec
  /** Written `chart`: a bar chart of the state, drawn below the circuit. */
  chart?: ChartSpec
  /** Written `animate`: the state travels through the circuit rather than being drawn at each end. */
  animate?: AnimationOptions
  /** Written `answer` on the input or the output line. */
  answerInput?: boolean
  answerOutput?: boolean
  /** Frames drawn round runs of gates, outermost first. */
  frames?: Frame[]
  /** Per-wire shape override; defaults to position order. */
  shapePicks?: ShapePick[]
  /**
   * Written `coefficients on` or `off`: whether a calculated state writes a
   * whole-number weight as a number or as that many copies of its term. Absent
   * leaves it to the reader's setting.
   */
  coefficients?: boolean
  /**
   * Written `wires 1 4 5`: where each wire starts, in columns, so they need
   * not start side by side. See `homeOf` for the ones it leaves out.
   */
  start?: number[]
  /** The line it was written on, for pointing at when they start too close. */
  startLine?: number
  /**
   * Draw the bare qubit shapes above the circuit. Off unless asked for, so a
   * circuit shows only what was specified; gates keep short input and output
   * pipe stubs either way, and a lone gate reads as a piece of plumbing.
   */
  header?: boolean
}
