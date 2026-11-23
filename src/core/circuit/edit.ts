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

import type { CircuitDoc, DefinitionUse, Gate, Switch } from './ast'
import { actedOn, gateSpan } from './ast'
import { liftGateAnnotations, parseCircuit, splitStatements, unglue, wiresLeftOut, withWires } from './parse'
import { resolveCalculations } from './simulate'
import type { CircuitGeometry } from './layout'
import type { QubitValue } from '../state/ast'

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
  /**
   * How many frames the pointer is outside of, beyond the layer it aims at.
   *
   * A drop below a frame's last layer could mean the end of the frame or the
   * space after it, and the layer alone cannot say which; where the pointer is
   * against the frame's edge can.
   */
  outside?: number
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
  const { layers } = geometry
  // The wires where they are at that height: a wire that has bent away is no
  // longer under its starting column.
  const below = layers.findIndex((l) => at.y <= l.y + l.h)
  const columns = geometry.columnsAt[below < 0 ? layers.length : below]

  // Nearest column, and one past the end when the pointer is clear of the last
  // — dropping out there is how the register gets wider.
  const start = geometry.columns
  const gap = start.length > 1 ? start[1] - start[0] : 60
  let wire = 1
  let best = Infinity
  columns.forEach((x, i) => {
    const d = Math.abs(at.x - x)
    if (d < best) {
      best = d
      wire = i + 1
    }
  })
  if (at.x > Math.max(...columns) + gap * 0.6) wire = columns.length + 1

  if (!layers.length) return { wire, layer: 0, where: 'after' }

  const target = (layer: number, where: DropTarget['where']): DropTarget => {
    if (where === 'in') return { wire, layer, where }
    // Frames round this layer that the pointer has gone past the edge of.
    const mid = layers[layer].y + layers[layer].h / 2
    const outside = (geometry.frames ?? []).filter(({ box }) =>
      mid > box.y && mid < box.y + box.h &&
      (where === 'after' ? at.y > box.y + box.h : at.y < box.y),
    ).length
    return outside ? { wire, layer, where, outside } : { wire, layer, where }
  }

  for (const [i, layer] of layers.entries()) {
    if (at.y < layer.y) return target(i, 'before')
    if (at.y <= layer.y + layer.h) {
      const edge = (layer.h * (1 - INSIDE)) / 2
      if (at.y < layer.y + edge) return target(i, 'before')
      if (at.y > layer.y + layer.h - edge) return target(i, 'after')
      return target(i, 'in')
    }
  }
  return target(layers.length - 1, 'after')
}

/** The statement on a line, without its comment or the space round it. */
const statementOf = (line: string): string => line.replace(/(^|\s)#.*$/, '').trim()

/**
 * Each `{` line's matching `}`, both 0-based.
 *
 * Definitions are paired too, harmlessly: no layer is ever written inside one,
 * since a use stands on its own line in the circuit.
 */
function braces(lines: string[]): Map<number, number> {
  const pairs = new Map<number, number>()
  const open: number[] = []
  lines.forEach((line, i) => {
    const text = statementOf(line)
    if (text === '}') {
      const from = open.pop()
      if (from !== undefined) pairs.set(from, i)
    } else if (text.endsWith('{')) open.push(i)
  })
  return pairs
}

/* -- Locks --------------------------------------------------------------- */

/** Does this statement say `word`, outside any quoted label? */
function says(statement: string, word: string): boolean {
  const masked = statement.replace(/"[^"]*"/g, (q) => '"' + ' '.repeat(q.length - 2) + '"')
  return new RegExp(`(^|\\s)${word}(?=\\s|\\{|$)`, 'i').test(masked)
}

const DEF_HEAD = /^def\s+([A-Za-z_]\w*)\b/i

/**
 * Does this line open a slot — a frame that names its own wires, `"Error" 1-9 {`?
 *
 * Such a frame is kept when it is emptied, holding its place with plain pipe,
 * so it is never taken away with its last gate nor carried off with it.
 */
function opensSlot(line: string): boolean {
  const head = statementOf(line)
  if (!head.endsWith('{') || DEF_HEAD.test(head)) return false
  const rest = head
    .replace(/"[^"]*"/g, ' ')
    .replace(/\{$/, ' ')
    .replace(/\b\w+=\S+/g, ' ')
    .replace(/(^|\s)(collapsed|locked)(?=\s|$)/gi, ' ')
    .trim()
  return /\d/.test(rest)
}

/**
 * Every run of lines a drag may not touch, 0-based and inclusive.
 *
 * A frame written `locked` is its whole block, braces and all; a use written
 * `locked`, or of a definition written that way, is its own line. Read from the
 * text alone, so it can be asked of a source that does not parse — and so that
 * it means the same to anything holding the text, whatever it parsed it with.
 */
function lockedRuns(source: string): [number, number][] {
  const lines = source.split('\n')
  const runs: [number, number][] = []
  const lockedDefs = new Set<string>()
  const defs = new Set<string>()
  for (const [open, close] of braces(lines)) {
    const head = statementOf(lines[open])
    const def = DEF_HEAD.exec(head)
    if (def) {
      defs.add(def[1].toLowerCase())
      if (says(head, 'locked')) lockedDefs.add(def[1].toLowerCase())
      continue
    }
    if (says(head, 'locked')) runs.push([open, close])
  }
  lines.forEach((line, i) => {
    const text = statementOf(line)
    const word = text.split(/\s+/)[0]?.toLowerCase()
    if (!word || !defs.has(word) || DEF_HEAD.test(text)) return
    if (lockedDefs.has(word) || says(text, 'locked')) runs.push([i, i])
  })
  return runs.sort((a, b) => a[0] - b[0])
}

/** What the locked parts of a source say, in order — the thing a drag must leave alone. */
const lockedText = (source: string): string[] => {
  const lines = source.split('\n')
  return lockedRuns(source).map(([a, b]) => lines.slice(a, b + 1).join('\n'))
}

/**
 * Does `after` leave every locked part of `before` exactly as it was?
 *
 * Nothing taken out of one, nothing put into one, none of them moved past
 * another. Comparing the text rather than the gates is what makes it strict:
 * a gate appended to a locked line with `;`, or a line slipped in between a
 * locked frame's braces, changes what it says, and that is the whole test.
 */
export function respectsLocks(before: string, after: string): boolean {
  const was = lockedText(before)
  const now = lockedText(after)
  return was.length === now.length && was.every((text, i) => text === now[i])
}

/**
 * Is this gate one a drag may not pick up?
 *
 * Inside a locked frame, part of a locked use, or a box folded from either.
 */
export function isLocked(source: string, gate: Gate): boolean {
  if (gate.kind === 'box' && gate.locked) return true
  if (gate.line === undefined) return false
  const at = gate.line - 1
  return lockedRuns(source).some(([a, b]) => at >= a && at <= b)
}

/**
 * Lock a frame or a use, or unlock it: the one word `locked` on the line that
 * made it, the same line `collapsed` goes on.
 */
export function toggleLock(source: string, line: number): Edit | null {
  return toggleWord(source, line, 'locked')
}

/* -- Switches ------------------------------------------------------------ */

/** `on` or `off` as a word of its own, outside any quoted label. */
const SWITCH_WORD = /(^|\s)(on|off)(?=\s|;|\{|$)/i

/** One statement with its switch flipped, or null where it has none. */
function flipSwitch(statement: string): string | null {
  const masked = statement.replace(/"[^"]*"/g, (q) => '"' + ' '.repeat(q.length - 2) + '"')
  const hit = SWITCH_WORD.exec(masked)
  if (!hit) return null
  const from = hit.index + hit[1].length
  const word = hit[2]
  // In the case it was written in: `OFF` becomes `ON`.
  const next = word.toLowerCase() === 'on' ? 'off' : 'on'
  const cased = word === word.toUpperCase() ? next.toUpperCase() : next
  return statement.slice(0, from) + cased + statement.slice(from + word.length)
}

/**
 * Flip a switch: `on` becomes `off`, and back.
 *
 * The one word, where it was written. On a line of several statements, only
 * the one the switch is in — and where that line has a single switch on it,
 * the word is changed in place, so the rest of the line stays exactly as it
 * was typed.
 */
export function toggleSwitch(source: string, sw: Switch): Edit | null {
  const lines = source.split('\n')
  const at = sw.line - 1
  const text = lines[at]
  if (text === undefined) return null
  const hash = text.search(/(^|\s)#/)
  const code = hash < 0 ? text : text.slice(0, hash)
  const comment = hash < 0 ? '' : text.slice(hash)
  const masked = code.replace(/"[^"]*"/g, (q) => '"' + ' '.repeat(q.length - 2) + '"')
  const count = (masked.match(new RegExp(SWITCH_WORD.source, 'gi')) ?? []).length
  if (!count) return null
  if (count === 1 || sw.part === undefined) {
    const flipped = flipSwitch(code)
    if (flipped === null) return null
    lines[at] = flipped + comment
    return { source: lines.join('\n'), line: sw.line }
  }
  const lifted = liftGateAnnotations(code)
  const parts = statements(lifted ? lifted.body : code.trim())
  const flipped = parts[sw.part] === undefined ? null : flipSwitch(parts[sw.part])
  if (flipped === null) return null
  parts[sw.part] = flipped
  const indent = /^\s*/.exec(code)![0]
  lines[at] = indent + rewrite(code.trim(), parts.join('; ')) + (comment ? ` ${comment.trim()}` : '')
  return { source: lines.join('\n'), line: sw.line }
}

/**
 * Where a new line goes, 1-based, to land just past `from` with `outside`
 * frames stepped out of — downwards over closing braces, or upwards over
 * opening ones. Blank lines and comments on the way are stepped over too, so
 * a frame's brace is found wherever the author left it.
 */
function stepOut(lines: string[], from: number, outside: number, down: boolean): number {
  let at = from
  let left = outside
  while (left > 0) {
    let k = down ? at - 1 : at - 2
    while (k >= 0 && k < lines.length && !statementOf(lines[k])) k += down ? 1 : -1
    const text = k >= 0 && k < lines.length ? statementOf(lines[k]) : ''
    if (down ? text !== '}' : !text.endsWith('{')) break
    at = down ? k + 2 : k + 1
    left--
  }
  return at
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
  /**
   * Which wires of the span are controls, counted from the top of it.
   *
   * Absent, every wire but the target is. A gate already in the drawing says,
   * because its controls need not be side by side: a `CNOT 1 -> 3` put down
   * again with the wire between them made a control as well is a Toffoli.
   */
  controlsAt?: number[]
  /** A swap's two crossed wires, counted from the top of the span. */
  pairAt?: [number, number]
  /**
   * A box's own wires, first and last, counted from the top of the span —
   * where it has controls, which the span takes in as well.
   */
  targetsAt?: [number, number]
  /**
   * Not a gate but a control: dropped on a wire beside a gate, it gives that
   * gate a control there. `H` becomes `CH`, a definition's use `Coracle`.
   */
  control?: boolean
  /** The wires written `=0`, acting on white, counted from the top of the span. */
  openAt?: number[]
  /**
   * Written controls first and target last, never with an arrow: a CZ cannot
   * take one, so where its named wire is not the last there is no other way.
   */
  inOrder?: boolean
  /** Written with an arrow, because that is how it was written before. */
  arrow?: boolean
  /**
   * What a view shows, written in place of the wires.
   *
   * A gate is named and then told which wires it sits on; a view is named and
   * then told what to display. `calculate` is the useful default — dropping a
   * window into a circuit to see what the state is there is the whole reason to
   * drop one — and it takes the register as a whole, so there is no span to
   * write either.
   */
  shows?: string
  /**
   * Options written on the gate — `fill=`, `colour=`, `width=`, `height=` —
   * put back on the end of the line as they were.
   *
   * Only a gate already in the drawing has any. Nothing about them is visible
   * in where the gate sits, so without carrying them a gate picked up and put
   * down again came back plain: a coloured box moved and lost its colour.
   */
  options?: string
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
  // A view is not on a wire; it is a break across all of them.
  // A view is named and then told what to show — except for the one everybody
  // wants, which the notation lets you write as the word alone. `calculate` is
  // what the block is called and what the line says; `view calculate` would be
  // the same drawing spelled the long way.
  if (gate.shows) {
    return gate.head === 'view' && gate.shows === 'calculate'
      ? 'calculate'
      : `${gate.head} ${gate.shows}`
  }

  const room = qubits + 1
  let start = Math.max(1, Math.min(wire, room))
  if (start + gate.wires - 1 > room) start = Math.max(1, room - gate.wires + 1)
  const wires = Array.from({ length: gate.wires }, (_, i) => start + i)
  if (gate.range) {
    // A box or a use given controls writes them first, its own wires after.
    const controls = (gate.controlsAt ?? []).map((o) => wires[o]).filter((w) => w !== undefined)
    const own = gate.targetsAt
      ? [wires[gate.targetsAt[0]], wires[gate.targetsAt[1]]].filter((w) => w !== undefined)
      : [wires[0], wires[wires.length - 1]]
    const span = own[0] === own[own.length - 1] ? String(own[0]) : `${own[0]}-${own[own.length - 1]}`
    const mark = marked(gate.openAt?.map((o) => start + o))
    return [gate.head, gate.label, ...controls.map(mark), span, gate.tail, gate.options]
      .filter(Boolean)
      .join(' ')
  }

  // The bare form means "the last wire is the target", so a target anywhere
  // else has to be pointed at. Where it *is* last, the arrow is written only if
  // it was written before.
  const at = gate.targetAt ?? gate.wires - 1
  const target = wires[Math.max(0, Math.min(at, gate.wires - 1))]
  const mark = marked(gate.openAt?.map((o) => start + o))
  const pair = gate.pairAt?.map((o) => wires[o]).filter((w) => w !== undefined)
  const controls = gate.controlsAt
    ? gate.controlsAt.map((o) => wires[o]).filter((w) => w !== undefined)
    : wires.filter((w) => w !== target && !pair?.includes(w))
  let span: string
  if (pair?.length === 2) {
    span = [...controls.map(mark), gate.arrow && controls.length ? '->' : '', ...pair].filter(Boolean).join(' ')
  } else {
    const arrow = !gate.inOrder && (gate.arrow || (controls.length > 0 && controls.some((c) => c > target)))
    span = arrow
      ? [...controls.map(mark), '->', mark(target)].join(' ')
      : [...controls, target].map(mark).join(' ')
  }
  return [gate.head, gate.label, span, gate.tail, gate.options].filter(Boolean).join(' ')
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
  // A folded frame is one box drawn from a block of lines: anything after it
  // goes after the whole block, or it would be folded in with the rest.
  const closes = braces(lines).get(last - 1)
  const end = closes === undefined ? last + 1 : closes + 2

  // An empty slot is a layer of pipe drawn from the line that opens it, and
  // what is dropped on it goes between its braces.
  if (target.where === 'in' && first === last && closes !== undefined &&
      opensSlot(lines[last - 1]) && !lines.slice(last, closes).some((l) => statementOf(l))) {
    return [{ source: spliceLine(lines, last + 1, text), line: last + 1 }]
  }

  if (target.where === 'in') {
    // If the wires clash, `;` is refused outright — a new line is the answer.
    // Nor can anything join the line that opens a block.
    const fresh = { source: spliceLine(lines, end, text), line: end }
    if (closes !== undefined) return [fresh]
    const joined = [...lines]
    joined[last - 1] = appendToLine(joined[last - 1], text)
    return [{ source: joined.join('\n'), line: last }, fresh]
  }

  const down = target.where !== 'before'
  const at = stepOut(lines, down ? end : first, target.outside ?? 0, down)
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
/**
 * What this drop could be written as, best first.
 *
 * Usually one thing. A view that calculates is the exception: the arithmetic
 * cannot follow every circuit — a custom box does not say what it does — so a
 * window dropped into one of those falls back to
 * showing unknowns, which is a question rather than a failure.
 */
function bodies(gate: Droppable, target: DropTarget, qubits: number): string[] {
  const first = gateLine(gate, target.wire, qubits)
  if (gate.shows !== 'calculate') return [first]
  return [first, `${gate.head} ${'?'.repeat(Math.max(1, qubits))}`]
}

/** Whether the arithmetic can follow this document, which `calculate` needs. */
function resolves(doc: CircuitDoc): boolean {
  try {
    resolveCalculations(doc)
    return true
  } catch {
    return false
  }
}

export function insertGate(
  source: string,
  doc: CircuitDoc,
  target: DropTarget,
  gate: Droppable,
): Edit {
  // A view takes a layer to itself, so there is no sharing one with a gate.
  const where = gate.shows && target.where === 'in' ? 'after' : target.where
  let aim = { ...target, where } as DropTarget
  // An empty slot is a single line of pipe and nothing else, so anywhere on
  // it — its edges included, which would otherwise read as between layers —
  // is a drop into it.
  {
    const lines = source.split('\n')
    const only = doc.layers[aim.layer]?.lines
    const open = only?.length === 1 ? only[0] - 1 : -1
    const close = open >= 0 ? braces(lines).get(open) : undefined
    if (close !== undefined && opensSlot(lines[open]) && !lines.slice(open + 1, close).some((l) => statementOf(l))) {
      aim = { ...aim, where: 'in', outside: 0 }
    }
  }
  const writes = (to: DropTarget) =>
    bodies(gate, to, doc.qubits).flatMap((text) => candidates(source, doc, to, text))
  let tries = writes(aim)

  // Aimed into a locked frame, the nearest place outside it instead: a layer
  // of its own between two layers, as close to the aim as can be found,
  // stepping out of as many frames as it takes — the way it would land if the
  // pointer were held against the locked frame's edge.
  // Aimed at a layer that is nothing but locked lines — a row of locked uses
  // one under the other, say — counts as aimed into a lock, even where a line
  // could be slipped in between them without changing either.
  const runs = lockedRuns(source)
  const aimedLocked = (doc.layers[aim.layer]?.lines ?? []).length > 0 &&
    doc.layers[aim.layer].lines.every((l) => runs.some(([a, b]) => l - 1 >= a && l - 1 <= b))
  if (aimedLocked || !tries.some((c) => respectsLocks(source, c.source))) {
    // A slot first, the nearest: it is there to be dropped into, and filling
    // it leaves everything round it where it was.
    const lines = source.split('\n')
    const pairs = [...braces(lines)].filter(([open]) => opensSlot(lines[open]))
    const inSlot = (line: number) => pairs.some(([open, close]) => line - 1 >= open && line - 1 < close)
    const slots = doc.layers
      .map((l, i) => (l.lines.length && l.lines.every(inSlot) ? i : -1))
      .filter((i) => i >= 0)
      .sort((a, b) => Math.abs(a - aim.layer) - Math.abs(b - aim.layer))
    for (const layer of slots) {
      const into = { ...aim, layer, where: 'in' as const, outside: 0 }
      const found = writes(into)
      if (found.some((c) => respectsLocks(source, c.source))) {
        aim = into
        tries = found
        break
      }
    }
  }
  if (!tries.some((c) => respectsLocks(source, c.source))) {
    search: for (let d = 0; d <= doc.layers.length; d++) {
      const near: DropTarget[] = [
        { ...aim, layer: aim.layer + d, where: 'after' },
        { ...aim, layer: aim.layer - d, where: 'before' },
      ]
      for (const base of near) {
        if (base.layer < 0 || base.layer >= Math.max(1, doc.layers.length)) continue
        for (let more = 0; more <= 4; more++) {
          const out = { ...base, outside: (target.outside ?? 0) + more }
          const found = writes(out)
          if (found.some((c) => respectsLocks(source, c.source))) {
            aim = out
            tries = found
            break search
          }
        }
      }
    }
  }
  const want = aimedAt(aim)

  /**
   * Did this candidate put the gate where it was aimed?
   *
   * Usually that means the line ended up in the layer aimed at. A calculated
   * view dropped below the last gate is the exception: past the end there is no
   * layer to land in, and what the line becomes is the circuit's *output*,
   * worked out — which is exactly where it was aimed and what it says.
   */
  const landed = (parsed: CircuitDoc, candidate: Candidate) =>
    parsed.layers[want]?.lines.includes(candidate.line) ||
    (gate.shows === 'calculate' && want >= parsed.layers.length && !!parsed.calculateOutput)

  // A locked frame is left as it was where any way of writing the drop can
  // manage that: the line goes just outside it rather than in. Only once no
  // candidate can does the lock stop mattering here — it is the caller's to
  // refuse, with `respectsLocks`, since a host that knows nothing of locks
  // still expects somewhere to put the gate.
  const kept = tries.filter((c) => respectsLocks(source, c.source))
  for (const pool of kept.length && kept.length < tries.length ? [kept, tries] : [tries]) {
    for (const candidate of pool) {
      try {
        const parsed = parseCircuit(candidate.source)
        if (landed(parsed, candidate) && resolves(parsed)) {
          return candidate
        }
      } catch {
        // A candidate that will not parse is simply not the one.
      }
    }
    // Nothing aimed true, so the first that parses at all: the drawing is
    // rendered from this same string, so whatever the packer decided is on
    // screen before anything is committed.
    for (const candidate of pool) {
      try {
        parseCircuit(candidate.source)
        return candidate
      } catch {
        // Keep looking.
      }
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
    const [q0, q1] = gateSpan(gate)
    return target.wire >= q0 && target.wire <= q1
  })
}

/** Splitting a gate line into the statements written on it. */
/**
 * A line's statements, split exactly as the parser splits them.
 *
 * Not on `;` alone: `HH`, `H H` and `H1 X2` are each two statements with no
 * `;` between them, and a gate's place among its line-mates has to be its
 * place in *this* list. Split any other way, the two disagree — and removing
 * the first H of `HH` took the whole line with it.
 */
const statements = (body: string): string[] => {
  try {
    return splitStatements(body, 0).map((part) => part.text)
  } catch {
    return body.split(';').map((part) => part.trim()).filter(Boolean)
  }
}

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
 * Could this gate take a control? Anything that does something to the qubits
 * and is not already waiting on a measurement — a condition and a control
 * say the same kind of thing, and a gate has one or the other.
 */
function controllable(gate: Gate): boolean {
  if (gate.given) return false
  if (gate.bound && !gate.use) return false
  if (gate.kind === 'box') return !gate.blank
  return gate.kind === 'single' || gate.kind === 'controlled' || gate.kind === 'swap'
}

/**
 * The same statement with a control in front of it: a C on its name, and the
 * control's wire written first. `H 2` on wire 1 is `CH 1 2`; `oracle 2-3` is
 * `Coracle 1 2-3`; `CNOT 1 2` is `CCNOT 3 1 2`.
 */
function prefixControl(was: string, wire: number): string {
  const text = unglue(was.trim())
  const found = /^(\S+)(\s+"[^"]*")?/.exec(text)!
  return `C${found[1]}${found[2] ?? ''} ${wire}${text.slice(found[0].length)}`
}

/**
 * Give a gate one more control, on the wire aimed at: what dropping a control
 * off the palette does.
 *
 * The gate is the one in the layer aimed at nearest the wire — between its
 * wires counts as nearest of all, so a dot dropped across a CNOT's middle wire
 * makes it a Toffoli. A gate already on that wire cannot be controlled by it,
 * and a definition's use takes the control on its own line, for every gate it
 * draws. Null where there is nothing for a control to go on.
 */
export function addControl(source: string, doc: CircuitDoc, target: DropTarget): Edit | null {
  const layer = doc.layers[target.layer]
  if (!layer || target.wire < 1 || target.wire > doc.qubits + 1) return null
  const wire = target.wire
  const distance = (gate: Gate) => {
    const [q0, q1] = gateSpan(gate)
    return wire < q0 ? q0 - wire : wire > q1 ? wire - q1 : 0
  }
  const gate = layer.gates
    .filter((g) => controllable(g) && !actedOn(g).includes(wire) && !isLocked(source, g))
    .sort((a, b) => distance(a) - distance(b))[0]
  if (!gate) return null

  const use = useOf(doc, gate)
  if (use) {
    if (use.wires.includes(wire) || use.controls?.includes(wire)) return null
    const lines = source.split('\n')
    const text = lines[use.line - 1]
    if (text === undefined) return null
    const hash = text.search(/(^|\s)#/)
    const code = hash < 0 ? text : text.slice(0, hash)
    const comment = hash < 0 ? '' : ` ${text.slice(hash).trim()}`
    const indent = /^\s*/.exec(code)![0]
    const lifted = liftGateAnnotations(code.trim())
    const body = lifted ? lifted.body : code.trim()
    lines[use.line - 1] = indent + rewrite(code.trim(), prefixControl(body, wire)) + comment
    const next = lines.join('\n')
    return parses(next) ? { source: next, line: use.line } : null
  }

  const found = locate(source, doc, gate)
  if (!found) return null
  // Every statement keeps the wires it was given, written in: a control can
  // free or take a wire a neighbour left out and was given.
  const mates = doc.layers[found.layer].gates.filter((g) => g.line === gate.line)
  const parts = found.parts.map((part, i) => {
    const count = wiresLeftOut(part)
    return count && mates[i] ? withWires(part, gateSpan(mates[i])[0], count) : part
  })
  const was = parts[found.which]
  // Most gates take the C. A controlled-Z across more than three wires has no
  // name with enough C's in it, so it takes the wire as one more dot instead.
  const ways = [prefixControl(was, wire)]
  if (gate.kind === 'controlled' && gate.controls.length) {
    ways.push(controlledText(was, gate, [...gate.controls, wire], gate.target, gate.open))
  } else if (gate.kind === 'swap' && gate.controls?.length) {
    ways.push(swapText(was, [...gate.controls, wire], gate.qubits, gate.open))
  }
  for (const written of ways) {
    const lines = [...found.lines]
    const kept = parts.map((p, i) => (i === found.which ? written : p))
    lines[found.at] = rewrite(lines[found.at], kept.join('; '))
    let next = lines.join('\n')
    if (parses(next)) return { source: next, line: gate.line! }
    // Grown over a neighbour on its line: it takes a line of its own, next.
    if (parts.length > 1) {
      const others = parts.filter((_, i) => i !== found.which)
      const split = [...found.lines]
      split.splice(found.at, 1, rewrite(found.lines[found.at], others.join('; ')), written)
      next = split.join('\n')
      if (parses(next)) return { source: next, line: gate.line! + 1 }
    }
  }
  return null
}

/** Does this source still read as a circuit? */
function parses(source: string): boolean {
  try {
    parseCircuit(source)
    return true
  } catch {
    return false
  }
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
  // A controlled swap has a control to move rather than a target, and moving it
  // is the same edit: the wires stay, the dot walks to the next one they cover.
  if (gate.kind === 'swap') return cycleSwapControl(source, doc, gate)
  if (gate.kind === 'single' || gate.kind === 'box') return cycleLetterTarget(source, doc, gate)
  if (gate.kind !== 'controlled' || !gate.controls.length || gate.targetGlyph === 'z') return null

  const wires = [...gate.controls, gate.target].sort((a, b) => a - b)
  const target = wires[(wires.indexOf(gate.target) + 1) % wires.length]
  const controls = wires.filter((w) => w !== target)
  // Each control keeps what it acts on. The wire the ⊕ moves onto has no say
  // any more, and the one it leaves starts out acting on black.
  const open = gate.open?.filter((w) => controls.includes(w))
  return restate(source, doc, gate, (was) => controlledText(was, gate, controls, target, open))
}

/**
 * Move a letter or a box given controls onto the next wires the gate covers,
 * the wires it leaves becoming controls: `CH 1 2` becomes `CH 2 1`, and
 * `Cbox "U" 1 2-3` becomes `Cbox "U" 3 1-2`.
 *
 * A box keeps its own wires side by side, so it goes only where enough of the
 * covered wires are next to each other; where nowhere else is, null.
 */
function cycleLetterTarget(source: string, doc: CircuitDoc, gate: Gate & { kind: 'single' | 'box' }): Edit | null {
  const controls = gate.controls ?? []
  if (!controls.length) return null
  const own = gate.kind === 'single' ? [gate.qubit] : [...gate.qubits].sort((a, b) => a - b)
  const wires = [...controls, ...own].sort((a, b) => a - b)
  const n = own.length
  const fits = (i: number) => i + n <= wires.length && wires[i + n - 1] - wires[i] === n - 1
  const from = wires.indexOf(own[0])
  let to = -1
  for (let step = 1; step < wires.length; step++) {
    const i = (from + step) % wires.length
    if (fits(i)) {
      to = i
      break
    }
  }
  if (to < 0) return null
  const target = wires.slice(to, to + n)
  const left = wires.filter((w) => !target.includes(w))
  // As a CNOT's: each control keeps what it acts on, and a wire the gate
  // leaves starts out acting on black.
  const open = gate.open?.filter((w) => left.includes(w))
  return restate(source, doc, gate, (was) => letterText(was, gate, open, left, target))
}

/**
 * Turn one dot of a controlled gate between acting on black and acting on
 * white — a filled dot and an open ring, `1` and `1=0`.
 *
 * Null when `wire` is not one of its controls, so a click elsewhere on the
 * gate can go on meaning what it meant. Every dot of a controlled-Z is a
 * control, its last one too.
 */
export function toggleControl(source: string, doc: CircuitDoc, gate: Gate, wire: number): Edit | null {
  if (gate.kind === 'swap') {
    const controls = gate.controls ?? []
    if (!controls.includes(wire)) return null
    const open = flipped(gate.open, wire)
    return restate(source, doc, gate, (was) => swapText(was, controls, gate.qubits, open))
  }
  if ((gate.kind === 'single' || gate.kind === 'box') && gate.controls?.length) {
    if (!gate.controls.includes(wire)) return null
    const open = flipped(gate.open, wire)
    return restate(source, doc, gate, (was) => letterText(was, gate, open))
  }
  if (gate.kind !== 'controlled' || !gate.controls.length) return null
  const dots = gate.targetGlyph === 'z' ? [...gate.controls, gate.target] : gate.controls
  if (!dots.includes(wire)) return null
  const open = flipped(gate.open, wire)
  return restate(source, doc, gate, (was) => controlledText(was, gate, gate.controls, gate.target, open))
}

/** `open` with `wire` added if it was not there, taken out if it was. */
const flipped = (open: number[] | undefined, wire: number): number[] =>
  open?.includes(wire) ? open.filter((w) => w !== wire) : [...(open ?? []), wire]

/** A wire as it is written: `2`, or `2=0` where it acts on white. */
const marked = (open: number[] | undefined) => (w: number): string =>
  open?.includes(w) ? `${w}=0` : String(w)

/**
 * A controlled gate written afresh on the wires given.
 *
 * The keyword as it was written — `CX` should not silently become `CNOT` —
 * and the arrow only where there already was one.
 */
function controlledText(
  was: string, gate: Gate & { kind: 'controlled' }, controls: number[], target: number, open?: number[],
): string {
  const head = was.trim().split(/\s+/)[0]
  const arrow = was.includes('->')
  const name = gate.label ? `"${gate.label}"` : ''
  const mark = marked(open)
  return [
    head,
    !gate.labelOnLink ? name : '',
    controls.map(mark).join(' '),
    arrow ? '->' : '',
    mark(target),
    gate.labelOnLink ? name : '',
    writtenOptions(was),
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * A letter or a box with controls written afresh: its name as written, its
 * controls, then its own wires.
 */
function letterText(
  was: string,
  gate: Gate & { kind: 'single' | 'box' },
  open?: number[],
  controls: number[] = gate.controls ?? [],
  own: number[] = gate.kind === 'single' ? [gate.qubit] : gate.qubits,
): string {
  const text = unglue(was.trim())
  const head = text.split(/\s+/)[0]
  const label = /^\S+\s+("[^"]*")/.exec(text)?.[1] ?? ''
  const lo = Math.min(...own)
  const hi = Math.max(...own)
  const wires = lo === hi ? String(lo) : `${lo}-${hi}`
  return [head, label, controls.map(marked(open)).join(' '), text.includes('->') ? '->' : '', wires, writtenOptions(was)]
    .filter(Boolean)
    .join(' ')
}

/** A controlled swap written afresh: its controls, then the pair. */
function swapText(was: string, controls: number[], pair: number[], open?: number[]): string {
  const head = was.trim().split(/\s+/)[0] // CSWAP, as it was written
  const arrow = was.includes('->')
  return [head, controls.map(marked(open)).join(' '), arrow ? '->' : '', pair.join(' '), writtenOptions(was)]
    .filter(Boolean)
    .join(' ')
}

/** Write one gate's statement again, leaving the rest of its line as it was. */
function restate(source: string, doc: CircuitDoc, gate: Gate, write: (was: string) => string): Edit | null {
  const found = locate(source, doc, gate)
  if (!found) return null
  const parts = [...found.parts]
  parts[found.which] = write(found.parts[found.which])
  const lines = [...found.lines]
  lines[found.at] = rewrite(lines[found.at], parts.join('; '))
  return { source: lines.join('\n'), line: gate.line! }
}

/**
 * Walk a controlled swap's control onto the next wire the gate covers.
 *
 * A Fredkin is a control and a pair to exchange; clicking it cycles which of its
 * three wires holds the control, the other two becoming the pair — the swap
 * counterpart of moving a CNOT's ⊕. A plain SWAP has no control to move, and a
 * multi-control swap is left alone.
 */
function cycleSwapControl(source: string, doc: CircuitDoc, gate: Gate): Edit | null {
  if (gate.kind !== 'swap' || (gate.controls?.length ?? 0) !== 1) return null

  const cur = gate.controls![0]
  const wires = [cur, ...gate.qubits].sort((a, b) => a - b)
  const control = wires[(wires.indexOf(cur) + 1) % wires.length]
  const pair = wires.filter((w) => w !== control)
  // What the control acts on goes with it.
  const open = gate.open?.length ? [control] : undefined
  return restate(source, doc, gate, (was) => swapText(was, [control], pair, open))
}

/**
 * The options written on a gate, as they were written.
 *
 * Nothing about where a gate sits says what colour or size it is, so every
 * edit that writes a gate's line afresh has to carry these across by hand — or
 * a coloured gate clicked or moved comes back in the drawing's own colours.
 */
const writtenOptions = (written: string): string =>
  // Read with quoted labels blanked, so a label saying "on" is not a switch.
  (written.replace(/"[^"]*"/g, (q) => '"' + ' '.repeat(q.length - 2) + '"').match(/(?:^|\s)(?:(?:fill|colou?r|width|height)=\S+|if\s+M\d+(?:=[01])?|(?:on|off)(?=\s|;|$))/gi) ?? [])
    .map((o) => o.trim())
    .join(' ')

/**
 * The same rotation, turned by a different angle.
 *
 * The angle is the one thing about a rotation that is not visible in its shape,
 * and typing it is the one edit dragging cannot do — so it wants a way in that
 * does not mean finding the line. Everything else about the line is left
 * exactly as written, keyword and wires and annotations alike.
 */
export function setAngle(
  source: string,
  doc: CircuitDoc,
  gate: Gate,
  angle: number,
): Edit | null {
  if (gate.kind !== 'single' || gate.angle === undefined) return null
  const found = locate(source, doc, gate)
  if (!found) return null

  const was = found.parts[found.which]
  // The brackets are optional in the source, so a rotation that has never been
  // given an angle has none to replace — the head alone is matched, and gains
  // them.
  const turned = was.replace(/^(\s*[A-Za-z]+)(?:\([^)]*\))?/, `$1(${angle})`)
  if (turned === was) return null

  const parts = [...found.parts]
  parts[found.which] = turned
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
  if (gate.use) return removeUse(source, doc, gate)
  const found = locate(source, doc, gate)
  if (!found) return null
  const { lines, at, parts, which, layer: layerOf } = found

  // A gate that left its wire out was given the lowest one free on its line,
  // so taking a gate away can free a lower one and slide it across. Each keeps
  // the wire it had by having it written in before anything is taken away.
  const mates = doc.layers[layerOf].gates.filter((g) => g.line === gate.line)
  const kept = parts
    .map((part, i) => {
      const count = wiresLeftOut(part)
      return count && mates[i] ? withWires(part, gateSpan(mates[i])[0], count) : part
    })
    .filter((_, i) => i !== which)
  const alone = doc.layers[layerOf]?.lines.filter((l) => l === gate.line).length === 1

  let next = kept.length
    ? [...lines.slice(0, at), rewrite(lines[at], kept.join('; ')), ...lines.slice(at + 1)]
    : [...lines.slice(0, at), ...lines.slice(at + 1)]
  if (!kept.length) next = withoutEmptyFrames(next)

  // Nor when it was the last thing in a slot, which keeps its layer as pipe.
  const leftSlot = !kept.length && [...braces(lines)].some(
    ([open, close]) =>
      open < at && close > at && opensSlot(lines[open]) &&
      lines.slice(open + 1, close).filter((l) => statementOf(l)).length === 1,
  )
  return {
    source: next.join('\n'),
    line: gate.line!,
    // The layer goes only when this line was the whole of it.
    layerRemoved: !kept.length && !leftSlot && alone && (doc.layers[layerOf]?.lines.length ?? 0) === 1
      ? layerOf
      : undefined,
  }
}

/** The use of a definition a gate was drawn by, where it was written in the circuit itself. */
export function useOf(doc: CircuitDoc, gate: Gate): DefinitionUse | undefined {
  return gate.use ? doc.uses?.find((u) => u.line === gate.line) : undefined
}

/** The layers that hold nothing but what this line put there, last first. */
function layersOnlyOf(doc: CircuitDoc, line: number): number[] {
  return doc.layers
    .map((l, i) => (l.lines.length && l.lines.every((x) => x === line) ? i : -1))
    .filter((i) => i >= 0)
    .reverse()
}

/**
 * Take a definition's use out: the whole line, since every gate it draws
 * stands for it.
 */
function removeUse(
  source: string,
  doc: CircuitDoc,
  gate: Gate,
): { source: string; line: number; layerRemoved?: number } | null {
  const use = useOf(doc, gate)
  if (!use) return null
  const lines = source.split('\n')
  if (use.line < 1 || use.line > lines.length) return null
  const next = withoutEmptyFrames(lines.filter((_, i) => i !== use.line - 1))
  const gone = layersOnlyOf(doc, use.line)
  return {
    source: next.join('\n'),
    line: use.line,
    ...(gone.length === 1 ? { layerRemoved: gone[0] } : {}),
  }
}

/** How to write a use of a definition again, somewhere else. */
export function useDroppable(use: DefinitionUse): Droppable {
  const n = use.wires.length
  const named = {
    ...(use.label !== undefined ? { label: `"${use.label}"` } : {}),
    ...(use.collapsed ? { tail: 'collapsed' } : {}),
  }
  if (!use.controls?.length) return { head: use.name, wires: n, range: n > 1, ...named }
  // Its controls keep their places beside it; its own wires go back side by
  // side, as an uncontrolled use's do.
  const all = [...use.controls, ...use.wires]
  const q0 = Math.min(...all)
  const own = use.wires.map((w) => w - q0)
  return {
    head: `${'C'.repeat(use.controls.length)}${use.name}`,
    wires: Math.max(...all) - q0 + 1,
    range: true,
    controlsAt: use.controls.map((c) => c - q0),
    targetsAt: [Math.min(...own), Math.min(...own) + n - 1],
    ...openAt(use.open, q0),
    ...named,
  }
}

/**
 * The source without any frame left holding nothing.
 *
 * A frame needs something in it, so taking out its last gate takes the frame
 * with it — and then perhaps the frame round that one, which is why it goes
 * round until nothing changes.
 */
function withoutEmptyFrames(lines: string[]): string[] {
  for (;;) {
    // A definition is not a frame, and an empty one is the author's to mend.
    const empty = [...braces(lines)].find(
      ([open, close]) =>
        !/^def\b/i.test(statementOf(lines[open])) &&
        !opensSlot(lines[open]) &&
        !lines.slice(open + 1, close).some((l) => statementOf(l)),
    )
    if (!empty) return lines
    lines = lines.filter((_, i) => i !== empty[0] && i !== empty[1])
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
 * Fold a frame into one box, or open a box back out into its frame.
 *
 * Both are the one word `collapsed` on the line that made it: before the
 * brace of a frame written inline, or after the wires of a definition's use.
 * Found outside any quoted label, so a frame called "collapsed" stays one.
 */
export function toggleFold(source: string, line: number): Edit | null {
  return toggleWord(source, line, 'collapsed')
}

/** Add `word` to the line that opens a frame or uses a definition, or take it off. */
function toggleWord(source: string, line: number, word: string): Edit | null {
  const lines = source.split('\n')
  const text = lines[line - 1]
  if (text === undefined) return null
  const hash = text.search(/(^|\s)#/)
  const code = hash < 0 ? text : text.slice(0, hash)
  const comment = hash < 0 ? '' : text.slice(hash)
  const indent = /^\s*/.exec(code)![0]
  const body = code.trim()
  if (!body) return null
  // Quoted labels blanked out, so only the word itself is found.
  const masked = body.replace(/"[^"]*"/g, (q) => '"' + ' '.repeat(q.length - 2) + '"')
  const found = new RegExp(`(^|\\s)${word}(?=\\s|\\{|$)`, 'i').exec(masked)
  let next: string
  if (found) {
    const from = found.index + found[1].length
    next = (body.slice(0, from) + body.slice(from + word.length)).replace(/\s{2,}/g, ' ').trim()
  } else if (/\{$/.test(body)) {
    next = body.replace(/\s*\{$/, '').trim()
    next = next ? `${next} ${word} {` : `${word} {`
  } else {
    next = `${body} ${word}`
  }
  lines[line - 1] = indent + next + (comment ? ` ${comment.trim()}` : '')
  return { source: lines.join('\n'), line }
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
  const use = useOf(doc, gate)
  if (use) {
    const cut = removeUse(source, doc, gate)
    if (!cut) return null
    let reduced: CircuitDoc
    try {
      reduced = parseCircuit(cut.source)
    } catch {
      return null
    }
    // A use can take several layers with it, each shifting the aim in turn.
    const aim = layersOnlyOf(doc, use.line).reduce(afterRemoval, target)
    return insertGate(cut.source, reduced, aim, useDroppable(use))
  }
  // A frame round nothing but this gate is the gate's own — "Error" round the
  // one error being tried — and goes where it goes rather than being left
  // behind empty and taken away.
  const carried = carryFrame(source, doc, gate, target)
  if (carried) return carried
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
  // A window is put back exactly as it was written. Everything it shows lives
  // in its text — rows spelled out, `answer`, a range of wires — and none of
  // that survives a round trip through the drawing, so the statement travels
  // rather than being composed again from what it drew.
  // Only where there is something after the keyword: the shorthand `calculate`
  // is the whole statement, and blanking `shows` for it would put the view back
  // as a bare `view` with no state to show.
  const rest = gate.kind === 'view' && written ? written.replace(/^\s*\S+\s*/, '').trim() : ''
  // A gate's options travel the same way: read off what was written, since
  // nothing about where it sits says what colour or size it was.
  const options = gate.kind !== 'view' && written ? writtenOptions(written) : ''
  return insertGate(cut.source, reduced, afterRemoval(target, cut.layerRemoved), {
    ...moved,
    ...(rest ? { shows: rest } : {}),
    ...(options ? { options } : {}),
    arrow: written?.includes('->') || undefined,
  })
}

/**
 * The frame this gate is alone in, 0-based open and close lines, or null.
 *
 * Alone means the only statement between the braces, and the only gate on its
 * line. A locked frame is never one: nothing comes out of it.
 */
function soleFrame(source: string, doc: CircuitDoc, gate: Gate): [number, number] | null {
  const found = locate(source, doc, gate)
  if (!found || found.parts.length !== 1) return null
  const { lines, at } = found
  let best: [number, number] | null = null
  for (const [open, close] of braces(lines)) {
    if (open >= at || close <= at) continue
    if (!best || open > best[0]) best = [open, close]
  }
  if (!best) return null
  const head = statementOf(lines[best[0]])
  if (DEF_HEAD.test(head) || says(head, 'locked') || says(head, 'collapsed') || opensSlot(head)) return null
  const inside = lines.slice(best[0] + 1, best[1]).map(statementOf).filter(Boolean)
  return inside.length === 1 ? best : null
}

/**
 * Move a gate that is alone in its frame, frame and all.
 *
 * Cut as a block, dropped as a gate on its own line, and the frame's braces
 * put back round that line. A frame fences its layer, so the gate never shares
 * one: aimed into a layer of other gates, it goes just after it instead.
 */
function carryFrame(source: string, doc: CircuitDoc, gate: Gate, target: DropTarget): Edit | null {
  const frame = soleFrame(source, doc, gate)
  if (!frame) return null
  const [open, close] = frame
  const lines = source.split('\n')
  const head = lines[open]
  const tail = lines[close]
  const written = lines[open + 1 + lines.slice(open + 1, close).findIndex((l) => statementOf(l))]
  const cutSource = [...lines.slice(0, open), ...lines.slice(close + 1)].join('\n')
  let reduced: CircuitDoc
  try {
    reduced = parseCircuit(cutSource)
  } catch {
    return null
  }
  const layerOf = doc.layers.findIndex((l) => l.gates.includes(gate))
  const alone = layerOf >= 0 && doc.layers[layerOf].lines.every((l) => l === gate.line)
  let aim = afterRemoval(target, alone ? layerOf : undefined)
  if (aim.where === 'in') aim = { ...aim, where: 'after' }
  const options = writtenOptions(statementOf(written ?? ''))
  const placed = insertGate(cutSource, reduced, aim, {
    ...asDroppable(gate),
    ...(options ? { options } : {}),
    arrow: written?.includes('->') || undefined,
  })
  const out = placed.source.split('\n')
  const at = placed.line - 1
  // Shared with another gate after all: there is no line of its own to frame.
  if (at < 0 || at >= out.length || statements(statementOf(out[at])).length !== 1) return null
  const framed = [...out.slice(0, at), head, out[at], tail, ...out.slice(at + 1)].join('\n')
  try {
    parseCircuit(framed)
  } catch {
    return null
  }
  return { source: framed, line: placed.line + 1 }
}

/** The wires acting on white, counted from the top of the span. */
const openAt = (open: number[] | undefined, q0: number): { openAt?: number[] } =>
  open?.length ? { openAt: open.map((w) => w - q0) } : {}

/** How to write a gate that is already in the document back out again. */
export function asDroppable(gate: Gate): Droppable {
  const [q0, q1] = gateSpan(gate)
  const wires = q1 - q0 + 1
  switch (gate.kind) {
    case 'single': {
      // A rotation's angle is the gate, not a decoration on it. Left off, the
      // line says `RY 1`, which used to mean nothing at all and now means a
      // turn by nothing — either way not the gate that was picked up.
      const head = gate.angle === undefined ? gate.label : `${gate.label}(${gate.angle})`
      if (!gate.controls?.length) return { head, wires: 1 }
      return {
        head: `${'C'.repeat(gate.controls.length)}${head}`,
        wires,
        targetAt: gate.qubit - q0,
        controlsAt: gate.controls.map((c) => c - q0),
        ...openAt(gate.open, q0),
      }
    }
    case 'identity':
      return { head: 'I', wires: 1 }
    case 'tag':
      return { head: 'tag', wires }
    case 'swap':
      // A controlled swap writes `CSWAP <controls> <pair>`, so the pair is the
      // last two wires — which is how the bare form reads them back. This round
      // trips whenever the controls come before the pair, as a Fredkin's does.
      return {
        head: gate.controls?.length ? 'CSWAP' : 'SWAP',
        wires,
        controlsAt: (gate.controls ?? []).map((c) => c - q0),
        pairAt: [gate.qubits[0] - q0, gate.qubits[1] - q0],
        ...openAt(gate.open, q0),
      }
    case 'measure':
      return { head: 'measure', wires: 1, tail: gate.basis }
    case 'view':
      // What a window shows cannot be rebuilt from the drawing — written-out
      // rows, an answer, a range of wires are all in the text and nowhere else.
      // This is the label and the fallback; a move takes the statement itself.
      // Framed or laid open, as it was drawn: picking a view up and putting it
      // down must not quietly fit it with a frame it never had.
      return {
        head: gate.boxed ? 'window' : 'view',
        wires,
        shows: gate.calculate ? 'calculate' : gate.blank ? 'blank' : undefined,
      }
    case 'box': {
      const head = gate.blank ? 'blank' : 'box'
      const label = gate.blank ? undefined : `"${gate.label}"`
      if (!gate.controls?.length) return { head, wires, label, range: true }
      const own = gate.qubits.map((q) => q - q0)
      return {
        head: `${'C'.repeat(gate.controls.length)}${head}`,
        wires,
        label,
        range: true,
        controlsAt: gate.controls.map((c) => c - q0),
        targetsAt: [Math.min(...own), Math.max(...own)],
        ...openAt(gate.open, q0),
      }
    }
    case 'controlled': {
      // Known by its name alone, so the name is the gate: it is always written
      // before the wires, where it stands on the target.
      if (gate.custom) {
        return gate.controls.length
          ? {
              head: 'CGATE', wires, label: `"${gate.label}"`, targetAt: gate.target - q0,
              controlsAt: gate.controls.map((c) => c - q0), ...openAt(gate.open, q0),
            }
          : { head: 'GATE', wires: 1, label: `"${gate.label}"` }
      }
      if (!gate.controls.length) return { head: 'X', wires: 1 }
      const head = gate.phase ? 'CZ' : gate.controls.length > 1 ? 'TOFFOLI' : 'CNOT'
      // A name on a controlled-Z stands on its last wire, which is the one
      // thing setting that wire apart — so it is kept last, and written there
      // without an arrow, the only way a CZ can be.
      if (gate.phase && !gate.labelOnLink && gate.label) {
        return {
          head,
          wires,
          label: `"${gate.label}"`,
          targetAt: gate.target - q0,
          controlsAt: gate.controls.map((c) => c - q0),
          ...openAt(gate.open, q0),
          inOrder: true,
        }
      }
      // Otherwise a controlled-Z has no target to keep track of — nothing tells
      // its wires apart but what each acts on — so it is written in order.
      if (gate.phase) {
        const all = [...gate.controls, gate.target].sort((a, b) => a - b)
        return {
          head,
          wires,
          tail: gate.label ? `"${gate.label}"` : undefined,
          targetAt: all[all.length - 1] - q0,
          controlsAt: all.slice(0, -1).map((c) => c - q0),
          ...openAt(gate.open, q0),
        }
      }
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
        controlsAt: gate.controls.map((c) => c - q0),
        ...openAt(gate.open, q0),
      }
    }
    default:
      return { head: 'I', wires: 1 }
  }
}

/* -- Changing a qubit ----------------------------------------------------- */

/** One qubit in the drawing, and the character of the source it came from. */
export interface QubitSpot {
  /** The index in the source of the `0`, `1` or `?` that drew it. */
  at: number
  value: QubitValue
  /** Where it sits in the diagram's own coordinates. */
  cx: number
  cy: number
  /** Across, which for every shape in use is also how tall it is drawn. */
  size: number
}

/**
 * The qubit drawn at this point, if any.
 *
 * Boxed rather than shaped to the glyph: the shapes differ — a circle, a
 * square, a diamond — and a target that changed with the drawing would mean a
 * click near the corner of one working and near the corner of another not.
 */
export function qubitAt(spots: QubitSpot[], at: Point): QubitSpot | undefined {
  return spots.find(
    (spot) =>
      Math.abs(at.x - spot.cx) <= spot.size / 2 && Math.abs(at.y - spot.cy) <= spot.size / 2,
  )
}

/**
 * What clicking a qubit turns it into.
 *
 * 0 and 1 swap, which keeps the edit anyone actually makes to one click in
 * either direction. An unknown joins that pair rather than sitting in a cycle
 * with it: a three-way rotation would put `?` between 1 and 0 and make going
 * back a two-click job, for the sake of a value written once in a hundred
 * figures and easily typed.
 */
export const nextQubit = (value: QubitValue): QubitValue => (value === 0 ? 1 : 0)

const QUBIT_CHAR: Record<QubitValue, string> = { 0: '0', 1: '1', unknown: '?' }

/**
 * Write a qubit as something else, in place.
 *
 * One character for one character, which is why this needs no parsing to be
 * safe: the parser is what said this offset holds a qubit, and every value a
 * qubit can take is a single character of the same kind. Swapping one for
 * another cannot change how anything around it reads.
 *
 * What is checked is that the source really does still say what the drawing
 * said it did. A stale offset — text edited since the diagram was drawn — lands
 * on some other character, and then nothing is written at all.
 */
export function setQubit(source: string, at: number, value: QubitValue): Edit | null {
  const was = source[at]
  if (was === undefined || !'01?'.includes(was)) return null
  const now = QUBIT_CHAR[value]
  if (now === was) return null
  return {
    source: source.slice(0, at) + now + source.slice(at + 1),
    line: source.slice(0, at).split('\n').length,
  }
}
