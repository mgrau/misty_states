/**
 * Parser for the vertical-circuit DSL.
 *
 *   qubits 3               -- optional; inferred from the highest index used
 *   in  000                -- optional misty state above the circuit
 *   H 1                    -- single-qubit gate
 *   H 1; H 2               -- ';' forces gates into the same layer
 *   ---                    -- explicit layer break
 *   CNOT 1 -> 3            -- control 1, target 3
 *   TOFFOLI 1 2 -> 3
 *   CZ 1 - 2
 *   SWAP 1 2
 *   BOX "Oracle" 1-2 fill=#e6f0e6
 *   BLANK 1-2              -- empty frame for students to fill in
 *   MEASURE 3 Z
 *   out (000|111)          -- optional misty state below the circuit
 *
 * Layers pack automatically: each gate drops into the earliest layer whose
 * qubit span is still free. `---` and `;` override that when you want a
 * specific vertical rhythm.
 *
 * A line that is a state rather than a gate is a *view* — a window onto the
 * computation at that point:
 *
 *   000                    -- before any gate, this is the input state
 *   H 1
 *   0(0|1)                 -- in the middle, a snapshot; span from its width
 *   view 2-3 00|11         -- an explicit span; qubit 1 flows past
 *   after H: 000|111       -- a caption, drawn in the left gutter
 *   111                    -- after the last gate, this is the output state
 *
 * so `in` and `out` are now sugar for the first and last of those, and are kept
 * because naming them is often clearer than relying on position.
 *
 * After `view`, a leading number or range names the qubits *when something else
 * follows it*: `view 2-3 00|11` is qubits 2–3, while `view 10` is the two-qubit
 * state `10` across the whole register.
 */

import { ParseError } from '../state/parse'
import { parseState } from '../state/parse'
import type { StateRow } from '../state/ast'
import { productWidth } from '../state/ast'
import type { CircuitDoc, Gate, Layer, ViewGate } from './ast'
import { gateSpan } from './ast'

/** Hadamard's label chip is red in the course materials. */
const HADAMARD_ACCENT = '#ef5f5b'

const SINGLE_GATES: Record<string, { label: string; accent?: string }> = {
  H: { label: 'H', accent: HADAMARD_ACCENT },
  PETE: { label: 'H', accent: HADAMARD_ACCENT },
  Y: { label: 'Y' },
  Z: { label: 'Z' },
  S: { label: 'S' },
  T: { label: 'T' },
}

interface Token {
  text: string
  quoted: boolean
}

/** Split a statement into tokens, keeping quoted strings intact. */
function tokenize(src: string, line: number): Token[] {
  const out: Token[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (/\s/.test(ch) || ch === ',') { i++; continue }
    if (ch === '"') {
      let text = ''
      i++
      while (i < src.length && src[i] !== '"') text += src[i++]
      if (i >= src.length) throw new ParseError('unclosed quoted label', i, line)
      i++
      out.push({ text, quoted: true })
      continue
    }
    if (src.startsWith('->', i)) { out.push({ text: '->', quoted: false }); i += 2; continue }
    let text = ''
    while (i < src.length && !/[\s,"]/.test(src[i]) && !src.startsWith('->', i)) text += src[i++]
    out.push({ text, quoted: false })
  }
  return out
}

/** Expand qubit references, supporting `1`, `1-3` ranges and bare `-` joins. */
function parseQubits(tokens: Token[], line: number): number[] {
  const out: number[] = []
  const flat: string[] = []
  for (const t of tokens) {
    if (t.quoted) throw new ParseError(`unexpected label "${t.text}"`, 0, line)
    // Split "1-3" into 1, -, 3 so ranges and bare dashes take the same path.
    for (const part of t.text.split(/(-)/)) if (part) flat.push(part)
  }
  for (let i = 0; i < flat.length; i++) {
    const tok = flat[i]
    if (tok === '-') {
      const prev = out[out.length - 1]
      const next = flat[i + 1]
      if (prev === undefined || next === undefined) {
        throw new ParseError('"-" must sit between two qubit numbers', 0, line)
      }
      const to = toQubit(next, line)
      const step = to >= prev ? 1 : -1
      for (let q = prev + step; ; q += step) {
        out.push(q)
        if (q === to) break
      }
      i++
      continue
    }
    out.push(toQubit(tok, line))
  }
  return out
}

function toQubit(tok: string, line: number): number {
  const v = Number(tok)
  if (!Number.isInteger(v) || v < 1) {
    throw new ParseError(`"${tok}" is not a qubit number (they start at 1)`, 0, line)
  }
  return v
}

const HEX_COLOUR = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

/**
 * The CSS named colours.
 *
 * Checked in full rather than accepting any word: SVG ignores an unrecognised
 * `fill` and falls back to black, so a typo would silently produce the same
 * black box this validation exists to prevent.
 */
const NAMED_COLOURS = new Set(
  `aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue
   blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk
   crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki
   darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen
   darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue
   dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite
   gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki
   lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan
   lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen
   lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen
   magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen
   mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream
   mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid
   palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum
   powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown
   seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen
   steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow
   yellowgreen transparent none`.split(/\s+/),
)

function isColour(value: string): boolean {
  return HEX_COLOUR.test(value) || NAMED_COLOURS.has(value.toLowerCase())
}

function takeOption(tokens: Token[], name: string, line: number): string | undefined {
  const at = tokens.findIndex((t) => !t.quoted && t.text.toLowerCase().startsWith(`${name}=`))
  if (at < 0) return undefined
  const [tok] = tokens.splice(at, 1)
  const value = tok.text.slice(name.length + 1)
  // An empty or malformed colour would reach the SVG as fill="" and paint the
  // box black, so say so rather than drawing something obviously wrong.
  if (!isColour(value)) {
    throw new ParseError(
      value
        ? `"${value}" is not a colour — use #rrggbb or a colour name`
        : `${name}= needs a colour, e.g. ${name}=#e3efe3`,
      0,
      line,
    )
  }
  return value
}

/** Widest side of a state, in qubits. */
function stateWidth(row: StateRow | undefined): number {
  if (!row) return 0
  return row.sides.reduce((max, side) => Math.max(max, productWidth(side)), 0)
}

/** Widest of several stacked states — an output can be a list of outcomes. */
function rowsWidth(rows: StateRow[] | undefined): number {
  return (rows ?? []).reduce((max, row) => Math.max(max, stateWidth(row)), 0)
}

/** The keywords that open a statement, so anything else can be tried as a state. */
const KEYWORDS = new Set([
  'qubits', 'shapes', 'header', 'labels', 'in', 'out', 'view', 'show', 'window',
  'i', 'id', 'identity', 'x', 'not', 'cnot', 'cx', 'toffoli', 'ccnot', 'ccx',
  'cz', 'swap', 'measure', 'm', 'box', 'gate', 'blank',
  ...Object.keys(SINGLE_GATES).map((k) => k.toLowerCase()),
])

/** `2-3`, or a single `2` — the span prefix `view` accepts. */
const RANGE = /^\d+(-\d+)?$/

/** Written where a state would go, to have it worked out instead. */
const CALCULATE = /^calc(ulate)?$/i

/**
 * Split `caption: rest`, by the same rule the state parser uses — the text
 * before the colon must contain something that could not be state syntax, so a
 * stray colon never eats an expression.
 */
function splitCaption(src: string): { caption?: string; rest: string } {
  const at = src.indexOf(':')
  if (at < 0) return { rest: src }
  const head = src.slice(0, at)
  if (/[(|,=]/.test(head) || !/[^01?\s]/.test(head)) return { rest: src }
  return { caption: head.trim(), rest: src.slice(at + 1).trim() }
}

/**
 * The one-letter gates, which can be written as a run: `HH` is `H 1; H 2`.
 *
 * `M` is deliberately absent. A measurement's basis is a trailing letter, so
 * `MZ` would read as "measure wire 1, Z on wire 2" when it plainly means a
 * measurement in the Z basis. `M` alone still defaults to wire 1 like the rest.
 */
const GATE_LETTERS = new Set(['H', 'X', 'Y', 'Z', 'S', 'T', 'I'])

/**
 * True for a bare run of one-letter gates, one per wire — `HH`, `XZ`, `HIH`.
 *
 * Single letters are gate keywords already, so a run starts at two. No keyword
 * of two or more letters is built only from these, which is what keeps `CZ`,
 * `ID` and `SWAP` out of it.
 */
export function isGateRun(token: string): boolean {
  const t = token.toUpperCase()
  return t.length >= 2 && [...t].every((c) => GATE_LETTERS.has(c))
}

/**
 * Read a view statement: an optional qubit range, then the state.
 *
 * The range is only taken as a range when something follows it, which is what
 * keeps `view 10` (the state `10`) apart from `view 1 0` (qubit 1, state `0`).
 */
function parseView(arg: string, lineNo: number, boxed = false): ViewGate {
  // Pulled out by hand rather than through `tokenize`, which drops commas and
  // eats quotes — both of which are state syntax the rest of this line needs.
  let text = arg
  let fill: string | undefined
  const option = /(^|\s)fill=(\S*)/.exec(text)
  if (option) {
    if (!boxed) {
      throw new ParseError('fill= needs a frame — use "window" rather than "view"', 0, lineNo)
    }
    fill = option[2]
    if (!isColour(fill)) {
      throw new ParseError(
        fill
          ? `"${fill}" is not a colour — use #rrggbb or a colour name`
          : 'fill= needs a colour, e.g. fill=#e3efe3',
        0,
        lineNo,
      )
    }
    text = (text.slice(0, option.index) + ' ' + text.slice(option.index + option[0].length)).trim()
  }

  const tokens = text.split(/\s+/).filter(Boolean)
  if (!tokens.length) throw new ParseError('view needs a state, e.g. view 00|11', 0, lineNo)

  let qubits: number[] = []
  let stateText = text
  if (tokens.length > 1 && RANGE.test(tokens[0])) {
    qubits = parseQubits([{ text: tokens[0], quoted: false }], lineNo)
    stateText = text.slice(text.indexOf(tokens[0]) + tokens[0].length)
  }

  return { ...viewOf(stateText, qubits, lineNo), boxed: boxed || undefined, fill }
}

/** Build a view, checking that the state is as wide as the span it claims. */
function viewOf(stateText: string, qubits: number[], lineNo: number): ViewGate {
  // `calculate` has no width of its own: it covers the register, whatever the
  // register turns out to be, so the span is filled in once that is known. Its
  // caption is held here too, there being no state yet to hang it on.
  const { caption, rest } = splitCaption(stateText.trim())
  if (CALCULATE.test(rest)) {
    if (qubits.length) {
      throw new ParseError(
        'calculate works out the whole register, so it takes no qubit range',
        0,
        lineNo,
      )
    }
    return { kind: 'view', qubits: [], calculate: true, caption }
  }

  const row = parseState(stateText).rows[0]
  const width = stateWidth(row)
  if (!qubits.length) {
    // No span given: the state covers as many qubits as it is wide, starting at
    // the first. Anything past that flows by untouched.
    qubits = Array.from({ length: Math.max(1, width) }, (_, i) => i + 1)
  } else if (width !== qubits.length) {
    throw new ParseError(
      `this view names ${qubits.length} qubit${qubits.length === 1 ? '' : 's'} ` +
        `but its state is ${width} wide`,
      0,
      lineNo,
    )
  }
  return { kind: 'view', qubits, rows: [row] }
}

function parseGate(src: string, line: number): Gate {
  const tokens = tokenize(src, line)
  if (!tokens.length) throw new ParseError('empty statement', 0, line)

  const fill = takeOption(tokens, 'fill', line)
  const head = tokens[0].text.toUpperCase()
  const rest = tokens.slice(1)

  /**
   * The wire a one-wire gate acts on. Told nothing, it takes the first: most
   * circuits start there, and `H` reads better than `H 1`.
   */
  const oneQubit = (): number => {
    if (!rest.length) return 1
    const qs = parseQubits(rest, line)
    if (qs.length !== 1) throw new ParseError(`${head} takes exactly one qubit`, 0, line)
    return qs[0]
  }

  if (head === 'I' || head === 'ID' || head === 'IDENTITY') {
    // `I 2 0` is an identity that shows what the qubit holds — the same window
    // a view opens, on a wire where nothing is happening. That is what makes
    // "look at these, hold those" expressible alongside a partial view.
    if (rest.length > 1) {
      const qs = parseQubits([rest[0]], line)
      return viewOf(rest.slice(1).map((t) => t.text).join(' '), qs, line)
    }
    return { kind: 'identity', qubit: oneQubit() }
  }

  // NOT is drawn as a bare ⊕ throughout the course materials, never as a
  // lettered box — so it is a controlled gate that happens to have no controls.
  if (head === 'X' || head === 'NOT') {
    return { kind: 'controlled', controls: [], target: oneQubit(), targetGlyph: 'not' }
  }

  if (head in SINGLE_GATES) {
    const spec = SINGLE_GATES[head]
    return { kind: 'single', label: spec.label, qubit: oneQubit(), accent: fill ?? spec.accent }
  }

  if (head === 'CNOT' || head === 'CX' || head === 'TOFFOLI' || head === 'CCNOT' || head === 'CCX') {
    const arrow = rest.findIndex((t) => t.text === '->')
    if (arrow < 0) throw new ParseError(`${head} needs "->" between controls and target`, 0, line)
    const controls = parseQubits(rest.slice(0, arrow), line)
    const targets = parseQubits(rest.slice(arrow + 1), line)
    if (!controls.length) throw new ParseError(`${head} needs at least one control`, 0, line)
    if (targets.length !== 1) throw new ParseError(`${head} needs exactly one target`, 0, line)
    return { kind: 'controlled', controls, target: targets[0], targetGlyph: 'not' }
  }

  if (head === 'CZ') {
    const qs = parseQubits(rest, line)
    if (qs.length !== 2) throw new ParseError('CZ takes two qubits', 0, line)
    return { kind: 'controlled', controls: [qs[0]], target: qs[1], targetGlyph: 'z' }
  }

  if (head === 'SWAP') {
    const qs = parseQubits(rest, line)
    if (qs.length !== 2) throw new ParseError('SWAP takes two qubits', 0, line)
    return { kind: 'swap', qubits: [qs[0], qs[1]] }
  }

  if (head === 'MEASURE' || head === 'M') {
    // Trailing non-numeric token is the basis label, e.g. `measure 2 X`.
    let basis = 'Z'
    const last = rest[rest.length - 1]
    if (last && !last.quoted && /^[A-Za-z]+$/.test(last.text)) {
      basis = last.text.toUpperCase()
      rest.pop()
    }
    return { kind: 'measure', qubit: oneQubit(), basis }
  }

  if (head === 'BOX' || head === 'GATE' || head === 'BLANK') {
    const blank = head === 'BLANK'
    let label = ''
    let qubitTokens = rest
    if (rest[0]?.quoted) {
      label = rest[0].text
      qubitTokens = rest.slice(1)
    }
    const qs = parseQubits(qubitTokens, line)
    if (!qs.length) throw new ParseError(`${head} needs at least one qubit`, 0, line)
    return { kind: 'box', label, qubits: qs, fill, blank }
  }

  throw new ParseError(`unknown gate "${tokens[0].text}"`, 0, line)
}

/**
 * A state never opens with a letter — except a captioned one, whose caption runs
 * up to a `:`. So anything else starting with a word was reaching for a gate,
 * and saying so beats a puzzled report about qubits.
 */
function looksLikeGateName(src: string): boolean {
  return /^[A-Za-z]/.test(src) && !/^[^:(|,=]*:/.test(src)
}

/**
 * One statement, which may stand for several: `HH` is `H 1; H 2`.
 *
 * A run reads down the wires from the first, so it says what a row of gates
 * looks like rather than which wires they are on — which is how these circuits
 * are usually described out loud.
 */
function parseStatements(src: string, line: number): Gate[] {
  const token = src.trim()
  if (/^[A-Za-z]+$/.test(token) && isGateRun(token)) {
    return [...token.toUpperCase()].map((letter, i) => parseGate(`${letter} ${i + 1}`, line))
  }
  return [parseStatement(src, line)]
}

/** One statement: a gate, a view, or a bare state that is therefore a view. */
function parseStatement(src: string, line: number): Gate {
  const kw = src.split(/\s+/)[0].toLowerCase()
  if (kw === 'view' || kw === 'show' || kw === 'window') {
    return parseView(src.slice(kw.length).trim(), line, kw === 'window')
  }
  if (KEYWORDS.has(kw)) return parseGate(src, line)
  if (looksLikeGateName(src)) {
    throw new ParseError(`unknown gate "${src.split(/\s+/)[0]}"`, 0, line)
  }
  return viewOf(src, [], line)
}

/** True when two gates would overlap if placed in the same layer. */
function conflicts(a: Gate, b: Gate): boolean {
  const [a0, a1] = gateSpan(a)
  const [b0, b1] = gateSpan(b)
  return a0 <= b1 && b0 <= a1
}

interface Group {
  gates: Gate[]
  breakBefore: boolean
}

/**
 * Schedule groups into layers.
 *
 * A gate drops to the earliest layer at or after the last layer that touched
 * any qubit in its span — so gates pack tightly sideways but never float above
 * something they depend on. `---` pushes the floor down to the next free layer.
 */
function schedule(groups: Group[]): Layer[] {
  const layers: Layer[] = []
  const frontier = new Map<number, number>()
  let floor = 0

  for (const group of groups) {
    if (group.breakBefore) floor = layers.length

    let target = floor
    for (const gate of group.gates) {
      const [q0, q1] = gateSpan(gate)
      for (let q = q0; q <= q1; q++) {
        target = Math.max(target, frontier.get(q) ?? floor)
      }
    }

    while (layers.length <= target) layers.push({ gates: [] })
    layers[target].gates.push(...group.gates)

    for (const gate of group.gates) {
      const [q0, q1] = gateSpan(gate)
      for (let q = q0; q <= q1; q++) frontier.set(q, target + 1)
    }
  }

  return layers.filter((l) => l.gates.length)
}

export function parseCircuit(text: string): CircuitDoc {
  let declared = 0
  // Off by default: a circuit draws only what you ask for. Use `in <state>` for
  // a misty state above it, or `header on` for the bare qubit shapes.
  let header = false
  let shapeIndices: number[] | undefined
  let input: StateRow | undefined
  let output: StateRow[] | undefined
  let calculateOutput = false
  let calculateCaption: string | undefined
  const groups: Group[] = []
  let pendingBreak = false
  let sawGate = false

  /**
   * A bare state line with nothing after it yet.
   *
   * Whether it is the output or a view in the middle depends on what comes
   * next, which is not known until it does — so it waits here until either
   * another statement arrives (making it a view) or the input ends (making it
   * the output).
   */
  let pendingTail: ViewGate | null = null

  /** A view takes a layer to itself: a snapshot sits between gates, not among them. */
  const pushView = (view: ViewGate) => {
    groups.push({ gates: [view], breakBefore: true })
    pendingBreak = true
  }

  const flushTail = () => {
    if (!pendingTail) return
    pushView(pendingTail)
    pendingTail = null
  }

  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1
    const line = lines[i].replace(/(^|\s)#.*$/, '').trim()
    if (!line) continue

    if (/^-{3,}$/.test(line)) { flushTail(); pendingBreak = true; continue }

    const kw = line.split(/\s+/)[0].toLowerCase()
    const arg = line.slice(kw.length).trim()
    const parts = line.split(';').map((s) => s.trim()).filter(Boolean)

    // A whole line that is nothing but a state takes its meaning from position.
    // Anything joined by ';' is a statement among others, so it skips this and
    // becomes a view like any other.
    if (parts.length === 1 && !KEYWORDS.has(kw) && !isGateRun(kw)) {
      // A bare `calculate` is a state like any other — position says whether it
      // is a snapshot in the middle or the circuit's output.
      if (CALCULATE.test(splitCaption(line).rest)) {
        if (!sawGate && !input) {
          throw new ParseError(
            'calculate is worked out from the input, so it cannot be the input',
            0,
            lineNo,
          )
        }
        flushTail()
        pendingTail = { kind: 'view', qubits: [], calculate: true, caption: splitCaption(line).caption }
        continue
      }
      if (looksLikeGateName(line)) {
        throw new ParseError(`unknown gate "${line.split(/\s+/)[0]}"`, 0, lineNo)
      }
      if (!sawGate && !input && !pendingTail) {
        input = parseState(line).rows[0]
      } else {
        flushTail()
        pendingTail = viewOf(line, [], lineNo)
      }
      continue
    }

    flushTail()

    if (kw === 'qubits') {
      const v = Number(arg)
      if (!Number.isInteger(v) || v < 1) throw new ParseError('qubits needs a positive integer', 0, lineNo)
      declared = v
      continue
    }
    if (kw === 'shapes') {
      // `shapes 2 1` puts a square on the first wire and a circle on the second,
      // for figures whose register is not in the default order.
      const nums = arg.split(/[\s,]+/).filter(Boolean)
      if (!nums.length) throw new ParseError('shapes needs at least one number', 0, lineNo)
      shapeIndices = nums.map((tok) => {
        const v = Number(tok)
        if (!Number.isInteger(v) || v < 1) {
          throw new ParseError(`"${tok}" is not a shape number (they start at 1)`, 0, lineNo)
        }
        return v - 1
      })
      continue
    }
    if (kw === 'header' || kw === 'labels') {
      const v = arg.toLowerCase()
      if (v !== 'on' && v !== 'off') {
        throw new ParseError(`${kw} takes "on" or "off"`, 0, lineNo)
      }
      header = v === 'on'
      continue
    }
    if (kw === 'in' || kw === 'out') {
      const outCaption = splitCaption(arg)
      if (CALCULATE.test(outCaption.rest)) {
        if (kw === 'in') {
          throw new ParseError(
            'calculate is worked out from the input, so it cannot be the input',
            0,
            lineNo,
          )
        }
        calculateOutput = true
        calculateCaption = outCaption.caption
        continue
      }
      const doc = parseState(arg)
      if (kw === 'in') input = doc.rows[0]
      else output = [doc.rows[0]]
      continue
    }

    // Everything else is one or more statements; ';' pins them to a single
    // layer — which is how a view of some qubits sits beside a held identity,
    // or beside a view of the others.
    const gates = parts.flatMap((s) => parseStatements(s, lineNo))
    for (let a = 0; a < gates.length; a++) {
      for (let b = a + 1; b < gates.length; b++) {
        if (conflicts(gates[a], gates[b])) {
          throw new ParseError('gates joined by ";" overlap and cannot share a layer', 0, lineNo)
        }
      }
    }

    // A snapshot is a moment between gates, so a layer holding one is fenced
    // off at both ends: nothing packs into it, and nothing packs past it.
    const snapshot = gates.some((g) => g.kind === 'view')
    groups.push({ gates, breakBefore: pendingBreak || snapshot })
    pendingBreak = snapshot
    if (gates.some((g) => g.kind !== 'view')) sawGate = true
  }

  // Nothing followed the last bare state line, so it is the output.
  if (pendingTail) {
    if (output || calculateOutput) flushTail()
    else if (pendingTail.calculate) {
      calculateOutput = true
      calculateCaption = pendingTail.caption
    }
    else output = pendingTail.rows
    pendingTail = null
  }

  const gates = groups.flatMap((g) => g.gates)
  // A view waiting to be calculated claims no wires of its own — it covers
  // whatever the register turns out to be, so it is filled in below rather than
  // counted here. Everything else sets the width, states included: `in 000`
  // over a single gate on wire 1 is still a three-qubit circuit.
  const pending = gates.filter((g): g is ViewGate => g.kind === 'view' && !!g.calculate)
  const used = gates.filter((g) => !pending.includes(g as ViewGate)).flatMap((g) => gateSpan(g))
  const qubits = Math.max(
    declared,
    used.length ? Math.max(...used) : 0,
    stateWidth(input),
    rowsWidth(output),
    1,
  )
  for (const view of pending) {
    view.qubits = Array.from({ length: qubits }, (_, i) => i + 1)
  }

  const layers = schedule(groups)
  return {
    kind: 'circuit', qubits, layers, input, output,
    calculateOutput, calculateCaption, header, shapeIndices,
  }
}
