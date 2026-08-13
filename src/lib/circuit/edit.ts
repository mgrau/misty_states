/**
 * Editing a circuit by pointing at it.
 *
 * Dropping a gate onto the drawing has to end up as *text*, because the text is
 * what gets saved, shared, checked and put in the library. So nothing here
 * builds a gate and adds it to a model: a drop works out which line to write and
 * writes it, and the ordinary pipeline redraws from that. There is one
 * representation, so there is nothing to keep in step.
 *
 * The other half of the trick is that the scheduler already does the hard part.
 * `schedule()` drops each group into the earliest layer whose wires are free, so
 * a patch mostly only has to decide *ordering* — which line the new one goes
 * after — rather than working out a position. What is left over is handled by
 * proposing a patch, re-parsing it, and checking the gate landed where it was
 * aimed; parsing is pure and takes microseconds, so that costs nothing.
 */

import type { CircuitDoc, Gate } from './ast'
import { gateSpan } from './ast'
import { liftGateAnnotations, parseCircuit } from './parse'
import type { CircuitGeometry } from './layout'

/** Where on the drawing a pointer is, in the diagram's own coordinates. */
export interface Point {
  x: number
  y: number
}

/**
 * A place a gate could go.
 *
 * `in` shares a layer with what is already there; `before` and `after` make a
 * new one. Which of the three it is decides whether the patch appends to a line
 * or writes a new one.
 */
export interface DropTarget {
  /** 1-based. May be one past the register, which widens it. */
  wire: number
  /** Index into `doc.layers`. Zero when the circuit has none yet. */
  layer: number
  where: 'in' | 'before' | 'after'
}

/**
 * The share of a layer's height that counts as landing *on* it.
 *
 * The rest, split between its top and bottom edges, reads as going between —
 * which is how a gate gets a layer of its own without having to aim at the gap
 * between two of them.
 */
const INSIDE = 0.6

/** What the pointer is over, from the geometry the layout already publishes. */
export function dropTarget(geometry: CircuitGeometry, at: Point): DropTarget {
  const { columns, layers } = geometry

  // Nearest column, and one past the end when the pointer is clear of the last
  // — dropping out there is how the register gets wider.
  const gap = columns.length > 1 ? columns[1] - columns[0] : 60
  let wire = 1
  let best = Infinity
  columns.forEach((x, i) => {
    const d = Math.abs(at.x - x)
    if (d < best) {
      best = d
      wire = i + 1
    }
  })
  if (at.x > columns[columns.length - 1] + gap * 0.6) wire = columns.length + 1

  if (!layers.length) return { wire, layer: 0, where: 'after' }

  for (const [i, layer] of layers.entries()) {
    if (at.y < layer.y) return { wire, layer: i, where: 'before' }
    if (at.y <= layer.y + layer.h) {
      const edge = (layer.h * (1 - INSIDE)) / 2
      if (at.y < layer.y + edge) return { wire, layer: i, where: 'before' }
      if (at.y > layer.y + layer.h - edge) return { wire, layer: i, where: 'after' }
      return { wire, layer: i, where: 'in' }
    }
  }
  return { wire, layer: layers.length - 1, where: 'after' }
}

/** What a palette entry drops as. */
export interface Droppable {
  /** The keyword, e.g. `H` or `CNOT`. */
  head: string
  /** How many consecutive wires it takes. */
  wires: number
  /** Written before the wires, e.g. `"U"` on a box. */
  label?: string
  /** Written after them, e.g. the basis of a measurement. */
  tail?: string
  /** Wires written as a range, `1-2`, which is what a box spans. */
  range?: boolean
  /**
   * Which wire of the span carries the ⊕, counted from the top of it.
   *
   * Only a controlled gate has one, and only a gate already in the drawing
   * knows it: dropping a fresh one from the palette puts the target on the
   * last wire, which is what the arrowless form means. Carried here so that
   * *moving* a gate whose target is not last keeps it there — otherwise a
   * `CNOT 2 -> 1` picked up and put down again quietly becomes `CNOT 1 -> 2`,
   * which is a different gate.
   */
  targetAt?: number
  /** Written with an arrow, because that is how it was written before. */
  arrow?: boolean
}

/**
 * The line that drops this gate onto `wire`.
 *
 * A gate starts on the wire it was dropped on and takes the ones below it. The
 * register grows if it must, by at most one wire — so a two-wire gate dropped
 * off the end lands against the end rather than opening a gap, and one dropped
 * on the last wire reaches one wire further rather than jumping back to the top.
 */
export function gateLine(gate: Droppable, wire: number, qubits: number): string {
  const room = qubits + 1
  let start = Math.max(1, Math.min(wire, room))
  if (start + gate.wires - 1 > room) start = Math.max(1, room - gate.wires + 1)
  const wires = Array.from({ length: gate.wires }, (_, i) => start + i)
  if (gate.range) {
    return [gate.head, gate.label, `${wires[0]}-${wires[wires.length - 1]}`, gate.tail]
      .filter(Boolean)
      .join(' ')
  }

  // The bare form means "the last wire is the target", so a target anywhere
  // else has to be pointed at. Where it *is* last, the arrow is written only if
  // it was written before.
  const at = gate.targetAt ?? gate.wires - 1
  const target = wires[Math.max(0, Math.min(at, gate.wires - 1))]
  const controls = wires.filter((w) => w !== target)
  const arrow = gate.arrow || (controls.length > 0 && at !== gate.wires - 1)
  const span = arrow ? [...controls, '->', target].join(' ') : wires.join(' ')
  return [gate.head, gate.label, span, gate.tail].filter(Boolean).join(' ')
}

/** Lines that only set something up, and that a gate belongs after rather than before. */
const PREAMBLE = /^\s*(qubits|shape|header|labels|in)\b/i

/** Put `text` in as its own line, `at` being a 1-based line number to sit before. */
const spliceLine = (lines: string[], at: number, text: string): string =>
  [...lines.slice(0, at - 1), text, ...lines.slice(at - 1)].join('\n')

/**
 * Append to a gate line without disturbing what surrounds it.
 *
 * `step: H 1 : note` has to become `step: H 1; H 2 : note`, so the annotations
 * are lifted off, the body extended, and the whole put back together.
 */
function appendToLine(line: string, text: string): string {
  const lifted = liftGateAnnotations(line)
  if (!lifted) return `${line.trimEnd()}; ${text}`
  const body = `${lifted.body.trim()}; ${text}`
  return [lifted.caption && `${lifted.caption}: `, body, lifted.note && ` : ${lifted.note}`]
    .filter(Boolean)
    .join('')
}

/**
 * Where a gate goes in a circuit that has none yet: after whatever sets it up.
 *
 * The input counts as setting it up whether or not it was written with `in` —
 * a bare state line at the top of a document *is* the input, and a gate dropped
 * onto one belongs below it. That is what lets a plain state become a circuit
 * by having a gate dragged onto it.
 */
function afterPreamble(lines: string[], doc: CircuitDoc): number {
  let at = doc.inputLine ? doc.inputLine + 1 : 1
  lines.forEach((line, i) => {
    if (PREAMBLE.test(line)) at = Math.max(at, i + 2)
  })
  return at
}

/**
 * One way of writing the drop: the whole source, and the line the gate is on.
 *
 * The line number is what makes the check exact. Asking "is there a gate on
 * that wire in that layer" would be answered by a gate that was already there —
 * a two-wire gate covering the drop wire says yes without anything having
 * moved. Asking whether *this line* landed in that layer cannot be fooled.
 */
interface Candidate {
  source: string
  line: number
}

/** Every way this drop could be written, best first. */
function candidates(
  source: string,
  doc: CircuitDoc,
  target: DropTarget,
  text: string,
): Candidate[] {
  const lines = source.split('\n')
  const layer = doc.layers[target.layer]

  if (!layer?.lines.length) {
    const at = afterPreamble(lines, doc)
    return [{ source: spliceLine(lines, at, text), line: at }]
  }

  const first = Math.min(...layer.lines)
  const last = Math.max(...layer.lines)

  if (target.where === 'in') {
    const joined = [...lines]
    joined[last - 1] = appendToLine(joined[last - 1], text)
    // If the wires clash, `;` is refused outright — a new line is the answer.
    return [
      { source: joined.join('\n'), line: last },
      { source: spliceLine(lines, last + 1, text), line: last + 1 },
    ]
  }

  const at = target.where === 'before' ? first : last + 1
  // A break is the fallback: it forces a layer of its own when the packer would
  // otherwise float the gate up past where it was dropped.
  return [
    { source: spliceLine(lines, at, text), line: at },
    { source: spliceLine(lines, at, `---\n${text}`), line: at + 1 },
  ]
}

/** Which layer a drop is aiming at, once it has been made. */
const aimedAt = (target: DropTarget) =>
  target.where === 'after' ? target.layer + 1 : target.layer

/** A patched source, and the line the gate ended up on. */
export interface Edit {
  source: string
  /** 1-based, so the drawing can mark what is being placed. */
  line: number
}

/**
 * The source with `gate` dropped in at `target`.
 *
 * Every candidate is tried in turn and the first that actually places the gate
 * on the intended wire and layer wins. Failing that the first is used anyway:
 * the drawing is rendered from this same string, so whatever the packer decides
 * is on screen before anything is committed.
 */
export function insertGate(
  source: string,
  doc: CircuitDoc,
  target: DropTarget,
  gate: Droppable,
): Edit {
  const text = gateLine(gate, target.wire, doc.qubits)
  const tries = candidates(source, doc, target, text)
  const want = aimedAt(target)

  for (const candidate of tries) {
    try {
      const parsed = parseCircuit(candidate.source)
      if (parsed.layers[want]?.lines.includes(candidate.line)) return candidate
    } catch {
      // A candidate that will not parse is simply not the one.
    }
  }
  // Nothing aimed true, so the first that parses at all: the drawing is
  // rendered from this same string, so whatever the packer decided is on
  // screen before anything is committed.
  for (const candidate of tries) {
    try {
      parseCircuit(candidate.source)
      return candidate
    } catch {
      // Keep looking.
    }
  }
  return tries[0]
}

/* -- Picking a gate back up ---------------------------------------------- */

/**
 * The gate drawn at this point, if any.
 *
 * The same grid the drop uses, read the other way: which layer is under the
 * pointer, and which of its gates covers that wire.
 */
export function gateAt(doc: CircuitDoc, geometry: CircuitGeometry, at: Point): Gate | undefined {
  const target = dropTarget(geometry, at)
  const layer = geometry.layers[target.layer]
  // Only a gate actually under the pointer, not the nearest one: picking up
  // something you were not pointing at is worse than picking up nothing.
  if (!layer || at.y < layer.y || at.y > layer.y + layer.h) return undefined
  return doc.layers[target.layer]?.gates.find((gate) => {
    if (gate.kind === 'view') return false
    const [q0, q1] = gateSpan(gate)
    return target.wire >= q0 && target.wire <= q1
  })
}

/** Splitting a gate line into the statements written on it. */
const statements = (body: string) => body.split(';').map((part) => part.trim()).filter(Boolean)

/**
 * Find a gate's own statement within the line it was written on.
 *
 * A line can hold several gates joined by `;`, and they come off it in the
 * order they are written — so a gate's place among its line-mates is its place
 * in the text. Both editing a gate and removing one need this, and neither
 * should be re-deriving it.
 */
function locate(
  source: string,
  doc: CircuitDoc,
  gate: Gate,
): { lines: string[]; at: number; parts: string[]; which: number; layer: number } | null {
  if (gate.line === undefined) return null
  const lines = source.split('\n')
  const at = gate.line - 1
  if (at < 0 || at >= lines.length) return null

  const layer = doc.layers.findIndex((l) => l.gates.includes(gate))
  if (layer < 0) return null
  const lifted = liftGateAnnotations(lines[at])
  const parts = statements(lifted ? lifted.body : lines[at])
  const mates = doc.layers[layer].gates.filter((g) => g.line === gate.line)
  const which = mates.indexOf(gate)
  if (which < 0 || which >= parts.length) return null
  return { lines, at, parts, which, layer }
}

/**
 * Move the target of a controlled gate onto the next wire it covers.
 *
 * The wires stay the same and only the ⊕ moves, wrapping round — which is the
 * edit anybody makes after dropping one of these in, because the wires are
 * obvious from where it was dropped and which of them takes the ⊕ is not.
 *
 * A controlled-Z is symmetric and has no target to move; a bare NOT has no
 * controls to swap with.
 */
export function cycleTarget(source: string, doc: CircuitDoc, gate: Gate): Edit | null {
  if (gate.kind !== 'controlled' || !gate.controls.length || gate.targetGlyph === 'z') return null
  const found = locate(source, doc, gate)
  if (!found) return null

  const wires = [...gate.controls, gate.target].sort((a, b) => a - b)
  const target = wires[(wires.indexOf(gate.target) + 1) % wires.length]
  const controls = wires.filter((w) => w !== target)

  // The keyword as it was written — `CX` should not silently become `CNOT` —
  // and the arrow only where there already was one.
  const was = found.parts[found.which]
  const head = was.trim().split(/\s+/)[0]
  const arrow = was.includes('->')
  const name = gate.label ? `"${gate.label}"` : ''
  const text = [
    head,
    !gate.labelOnLink ? name : '',
    controls.join(' '),
    arrow ? '->' : '',
    String(target),
    gate.labelOnLink ? name : '',
  ]
    .filter(Boolean)
    .join(' ')

  const parts = [...found.parts]
  parts[found.which] = text
  const lines = [...found.lines]
  lines[found.at] = rewrite(lines[found.at], parts.join('; '))
  return { source: lines.join('\n'), line: gate.line! }
}

/**
 * The source with one gate taken out of it.
 *
 * A line holding nothing else goes entirely; a line sharing gates with `;`
 * loses one statement and keeps its annotations. Which layer disappeared, if
 * one did, is reported back — a drop worked out against the old drawing has to
 * be renumbered against the new one before it can be used.
 */
export function removeGate(
  source: string,
  doc: CircuitDoc,
  gate: Gate,
): { source: string; line: number; layerRemoved?: number } | null {
  const found = locate(source, doc, gate)
  if (!found) return null
  const { lines, at, parts, which, layer: layerOf } = found

  const kept = parts.filter((_, i) => i !== which)
  const alone = doc.layers[layerOf]?.lines.filter((l) => l === gate.line).length === 1

  const next = kept.length
    ? [...lines.slice(0, at), rewrite(lines[at], kept.join('; ')), ...lines.slice(at + 1)]
    : [...lines.slice(0, at), ...lines.slice(at + 1)]

  return {
    source: next.join('\n'),
    line: gate.line!,
    // The layer goes only when this line was the whole of it.
    layerRemoved: !kept.length && alone && (doc.layers[layerOf]?.lines.length ?? 0) === 1
      ? layerOf
      : undefined,
  }
}

/** Put a new body back between whatever annotations the line carried. */
function rewrite(line: string, body: string): string {
  const lifted = liftGateAnnotations(line)
  if (!lifted) return body
  return [lifted.caption && `${lifted.caption}: `, body, lifted.note && ` : ${lifted.note}`]
    .filter(Boolean)
    .join('')
}

/**
 * `target`, read against the document before a gate was taken out of it, as it
 * applies to the document after.
 *
 * Only the layer index needs it: pulling a gate out can collapse the layer it
 * was in, and everything below then shifts up one.
 */
export function afterRemoval(target: DropTarget, layerRemoved: number | undefined): DropTarget {
  if (layerRemoved === undefined) return target
  if (target.layer > layerRemoved) return { ...target, layer: target.layer - 1 }
  if (target.layer < layerRemoved) return target
  // The layer it was dropped on is the one that has just gone. Put it back
  // where that layer stood, which is between its neighbours.
  return layerRemoved > 0
    ? { ...target, layer: layerRemoved - 1, where: 'after' }
    : { ...target, layer: 0, where: 'before' }
}

/**
 * The source with `gate` picked up and put down at `target`.
 *
 * Taken out first and dropped into what is left, because the two edits overlap:
 * a gate cannot be inserted beside itself, and a layer that only held it is not
 * there to be inserted into.
 */
export function moveGate(
  source: string,
  doc: CircuitDoc,
  gate: Gate,
  target: DropTarget,
): Edit | null {
  // Read before the cut, while the line it was written on still exists: a gate
  // put down again should read the way it read before, arrow and all.
  const written = locate(source, doc, gate)?.parts[locate(source, doc, gate)!.which]
  const cut = removeGate(source, doc, gate)
  if (!cut) return null
  let reduced: CircuitDoc
  try {
    reduced = parseCircuit(cut.source)
  } catch {
    return null
  }
  const moved = asDroppable(gate)
  return insertGate(cut.source, reduced, afterRemoval(target, cut.layerRemoved), {
    ...moved,
    arrow: written?.includes('->') || undefined,
  })
}

/** How to write a gate that is already in the document back out again. */
export function asDroppable(gate: Gate): Droppable {
  const [q0, q1] = gateSpan(gate)
  const wires = q1 - q0 + 1
  switch (gate.kind) {
    case 'single':
      return { head: gate.label, wires: 1 }
    case 'identity':
      return { head: 'I', wires: 1 }
    case 'swap':
      return { head: 'SWAP', wires: 2 }
    case 'measure':
      return { head: 'measure', wires: 1, tail: gate.basis }
    case 'box':
      return {
        head: gate.blank ? 'blank' : 'box',
        wires,
        label: gate.blank ? undefined : `"${gate.label}"`,
        range: true,
      }
    case 'controlled': {
      if (!gate.controls.length) return { head: 'X', wires: 1 }
      const head =
        gate.targetGlyph === 'z' ? 'CZ' : gate.controls.length > 1 ? 'TOFFOLI' : 'CNOT'
      // Which side the name goes on is which name it is: before the wires it
      // stands on the target, after them it labels the link. Writing it back on
      // the wrong side would silently make it the other kind.
      const name = gate.label ? `"${gate.label}"` : undefined
      return {
        head,
        wires,
        label: gate.labelOnLink ? undefined : name,
        tail: gate.labelOnLink ? name : undefined,
        // Where the ⊕ sits within the span, so a move carries it along.
        targetAt: gate.target - q0,
      }
    }
    default:
      return { head: 'I', wires: 1 }
  }
}
