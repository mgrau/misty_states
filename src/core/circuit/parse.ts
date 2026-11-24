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
import { parseShapeSpec, SHAPE_LINE, SHAPE_SYMBOL_HELP, type ShapePick } from '../shapes'
import type { ChartSpec, CircuitDoc, DefinitionUse, Frame, Gate, GateStyle, Layer, Switch, TableColumn, TableLine, TableSpec, TagGate, ViewGate } from './ast'
import type { AnimationOptions } from './animate'
import { actedOn, gateSpan } from './ast'
import { bendOf, bendTarget, coveredWires, homeOf, planWires, WireError } from './wires'

/** Hadamard's label chip is red in the course materials. */
const SINGLE_GATES: Record<string, { label: string; accent?: string }> = {
  H: { label: 'H' },
  PETE: { label: 'H' },
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

/**
 * Wires that may each say which value they act on: `1=0` acts on white, drawn
 * as an open ring, and `1=1` — the same as `1` — on black.
 *
 * Written the way `if M1=0` already says a measured wire must have come out
 * white, so the notation has one way of saying it. A range takes the mark as a
 * whole: `1-2=0` is both.
 */
function parseMarked(tokens: Token[], line: number, head: string): { qubits: number[]; open: number[] } {
  const qubits: number[] = []
  const open: number[] = []
  for (const t of tokens) {
    const mark = t.quoted ? null : /^(.*?)=(.*)$/.exec(t.text)
    if (mark && mark[2] !== '0' && mark[2] !== '1') {
      throw new ParseError(
        `"${t.text}": a control acts on 0 or 1 — e.g. ${head} 1=0 2, to act when wire 1 is white`,
        0,
        line,
      )
    }
    const qs = parseQubits([mark ? { text: mark[1], quoted: false } : t], line)
    qubits.push(...qs)
    if (mark?.[2] === '0') open.push(...qs)
  }
  return { qubits, open }
}

/** `open`, but left off altogether when nothing is. */
const openOf = (open: number[]): { open?: number[] } => (open.length ? { open } : {})

/**
 * A controlled gate's wires: the controls, then the target, split on `->` —
 * or, without one, the last `count` wires are the target.
 */
function splitControls(rest: Token[], line: number, head: string, count = 1) {
  const arrow = rest.findIndex((t) => t.text === '->')
  const split = arrow < 0 ? rest.length - count : arrow
  const controls = parseMarked(rest.slice(0, Math.max(0, split)), line, head)
  const targets = parseMarked(rest.slice(arrow < 0 ? Math.max(0, split) : arrow + 1), line, head)
  if (targets.open.length) {
    throw new ParseError(
      `only a control can act on 0 — the ${count > 1 ? 'swapped wires are' : 'target is'} not one`,
      0,
      line,
    )
  }
  return { controls: controls.qubits, targets: targets.qubits, open: controls.open }
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

/** `colour=`, or `color=`: both get typed, and neither is wrong. */
function takeColour(tokens: Token[], line: number): string | undefined {
  const colour = takeOption(tokens, 'colour', line)
  const color = takeOption(tokens, 'color', line)
  return colour ?? color
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

/**
 * Read a `shape` argument, failing with what is on offer rather than a bare
 * rejection — the symbols are only memorable once you have seen the list.
 */
export function readShapes(arg: string, lineNo: number): ShapePick[] {
  const spec = parseShapeSpec(arg)
  if (!spec) throw new ParseError('shape needs at least one symbol, e.g. shape os^', 0, lineNo)
  if (spec.bad !== undefined) {
    throw new ParseError(
      `"${spec.bad}" is not a shape — use ${SHAPE_SYMBOL_HELP}`,
      0,
      lineNo,
    )
  }
  return spec.picks
}

/** The keywords that open a statement, so anything else can be tried as a state. */
const KEYWORDS = new Set([
  'qubits', 'wires', 'shape', 'shapes', 'header', 'labels', 'coefficients', 'global', 'in', 'out', 'view', 'show',
  'window', 'animate', 'tag', '_',
  'i', 'id', 'identity', 'x', 'not', 'cnot', 'cx', 'toffoli', 'ccnot', 'ccx',
  'cz', 'ccz', 'swap', 'cswap', 'fredkin', 'measure', 'm', 'box', 'gate', 'cgate', 'blank',
  ...Object.keys(SINGLE_GATES).map((k) => k.toLowerCase()),
])

/**
 * A rotation, keyword and angle in one token: `RZ(45)`, `P(-90)`.
 *
 * Recognised here as well as parsed later, because a line takes its meaning
 * from its first word and nothing splits that word on a bracket.
 *
 * The angle is optional, so `RY` on its own is still a rotation — one that has
 * not been given its angle yet. It reads as a turn by nothing.
 */
const TURN = /^(rx|ry|rz|p)(?:\(\s*-?[\d.]*\s*\))?$/i
const isTurn = (word: string) => TURN.test(word)

/** `2-3`, or a single `2` — the span prefix `view` accepts. */
const RANGE = /^\d+(-\d+)?$/

/**
 * Written where a state would go, to have it worked out instead.
 *
 * A trailing `: note` is captured here rather than left to the state parser,
 * which never sees a `calculate` — the annotation belongs to the state that
 * will stand in its place.
 */
const CALCULATE = /^calc(ulate)?\s*(?::\s*(.*?))?\s*$/i

/** The gate names, as opposed to the directives that also open a line. */
const GATE_KEYWORDS = new Set([
  '_', 'i', 'id', 'identity', 'x', 'not', 'cnot', 'cx', 'toffoli', 'ccnot', 'ccx',
  'cz', 'ccz', 'swap', 'cswap', 'fredkin', 'measure', 'm', 'box', 'gate', 'cgate', 'blank',
  ...Object.keys(SINGLE_GATES).map((k) => k.toLowerCase()),
])

/** Positions of every `:` that is not inside a quoted label. */
function bareColons(line: string): number[] {
  const out: number[] = []
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted
    else if (line[i] === ':' && !quoted) out.push(i)
  }
  return out
}

const opensWithGate = (text: string): boolean => startsGate(text.trim().split(/\s+/)[0] ?? '')

/** One statement of a gate line, and where in that line it was written. */
export interface Statement {
  text: string
  at: number
}

/** A gate name glued to its wires: `H2`, `CNOT1`, `blank1-2`. */
const GLUED = /^([a-z]+)(\d+(?:-\d+)?)$/i

/**
 * The gates that may leave their wires to be worked out, and how many they take.
 *
 * Only those with a fixed number of wires: a box or a blank is as wide as it
 * is written, and there is nothing to work that out from.
 */
const ARITY: Record<string, number> = {
  _: 1, h: 1, pete: 1, x: 1, not: 1, y: 1, z: 1, s: 1, t: 1, i: 1, id: 1, identity: 1, m: 1, measure: 1,
  cnot: 2, cx: 2, cz: 2, swap: 2,
  toffoli: 3, ccnot: 3, ccx: 3, ccz: 3, cswap: 3, fredkin: 3,
}

/**
 * A gate with a C in front of it for each control: `CH`, `CCRZ(90)`,
 * `CCGATE`. Null when the word is not one — or is a gate of its own already,
 * as `CNOT`, `CZ` and `CSWAP` are, which keep the meaning they always had.
 *
 * The fewest C's taken that leave a gate, so `CCCX` is one control on a
 * `CCX` and `CCZ` stays a `CCZ`. Which comes to the same thing: every one of
 * those names already reads as controls on the gate after its C's.
 */
export function controlledName(word: string): { count: number; base: string } | null {
  const w = word.toLowerCase()
  if (GATE_KEYWORDS.has(w)) return null
  for (let k = 1; k < w.length && w[k - 1] === 'c'; k++) {
    const base = w.slice(k)
    if (GATE_KEYWORDS.has(base) || isTurn(base)) return { count: k, base }
  }
  return null
}

/** A gate's name, with or without controls in front of it. */
const isGateName = (word: string): boolean => {
  const w = word.toLowerCase()
  return GATE_KEYWORDS.has(w) || isTurn(w) || !!controlledName(w)
}

/** How many wires a gate of this name takes, or nought where it is written however wide. */
function arityOf(head: string): number {
  const h = head.toLowerCase()
  const own = ARITY[h] ?? (isTurn(h) ? 1 : 0)
  if (own) return own
  const ctl = controlledName(h)
  if (!ctl) return 0
  const base = arityOf(ctl.base)
  return base ? ctl.count + base : 0
}

/** Does this word begin a gate — named, turned, run together, or glued to its wire? */
function startsGate(word: string): boolean {
  const w = word.toLowerCase()
  if (isGateName(w) || isGateRun(w)) return true
  const glued = GLUED.exec(w)
  return !!glued && isGateName(glued[1])
}

/** Split a word glued to its wires back apart: `H2` is `H 2`. */
export function unglue(src: string): string {
  const lead = src.length - src.trimStart().length
  const word = src.slice(lead).split(/\s/)[0]
  const glued = GLUED.exec(word)
  if (!glued || !isGateName(glued[1])) return src
  return src.slice(0, lead) + glued[1] + ' ' + src.slice(lead + glued[1].length)
}

/**
 * Split a gate line into its statements.
 *
 * `;` has always separated them. A gate's name does too, so a row can be
 * written the way it is said — `H H`, `H X Z`, `H1 CNOT2 3` — and a run of
 * letters is a row of one-letter gates, `HH`, each its own statement.
 *
 * Two things keep this from reading into what is already written. A name only
 * ends the statement before it when that statement is itself a gate: a view's
 * state is its own business, whatever letters it holds. And the word after a
 * measurement that names its basis is its basis — `M X` measures in the X
 * basis, as it always has, rather than measuring and then applying a NOT.
 *
 * Every statement comes back as the text it was written as, and where it was:
 * nothing is rewritten here, so a view's qubits still know their place.
 */
export function splitStatements(body: string, lineNo: number): Statement[] {
  const out: Statement[] = []
  // The statement being gathered: where it starts and ends, and what it is.
  let open: {
    at: number; end: number; gate: boolean; measure: boolean; basis: boolean
    /** The last word was `if`, so this one is the wire it reads, not a gate. */
    reading?: boolean
  } | null = null
  const close = () => {
    if (open) out.push({ text: body.slice(open.at, open.end), at: open.at })
    open = null
  }

  let i = 0
  while (i < body.length) {
    const c = body[i]
    if (c === ';') { close(); i++; continue }
    if (/\s/.test(c)) { i++; continue }

    // One word: a quoted label whole, and brackets whole — `RX( 90 )`.
    const at = i
    if (c === '"') {
      i++
      while (i < body.length && body[i] !== '"') i++
      i++
    } else {
      let depth = 0
      while (i < body.length) {
        const d = body[i]
        if (d === '(') depth++
        else if (d === ')') depth = Math.max(0, depth - 1)
        else if (depth === 0 && (/\s/.test(d) || d === ';' || d === '"')) break
        i++
      }
    }
    const word = body.slice(at, Math.min(i, body.length))
    const quoted = word.startsWith('"')

    const current = open as typeof open
    const isBasis =
      !!current?.measure && !current.basis && !quoted && /^[xyz]$/i.test(word)
    // `X 3 if M1`: the M1 is what the X waits on, not a measurement after it.
    const isReading = !!current?.reading
    const begins = !quoted && startsGate(word) && !isBasis && !isReading && (!current || current.gate)

    if (begins && isGateRun(word)) {
      // A run is a row of one-letter gates. Given anything but another gate
      // after it, it is not a run but a misspelling, and is left to say so.
      close()
      const next = body.slice(i).trimStart()
      if (next && !next.startsWith(';') && !startsGate(next.split(/[\s;]/)[0])) {
        throw new ParseError(`unknown gate "${word}"`, 0, lineNo)
      }
      for (let k = 0; k < word.length; k++) out.push({ text: word[k], at: at + k })
      continue
    }

    if (begins || !current) {
      close()
      const head = (GLUED.exec(word)?.[1] ?? word).toLowerCase()
      open = {
        at,
        end: i,
        gate: startsGate(word),
        measure: head === 'm' || head === 'measure',
        basis: false,
      }
      continue
    }
    current.end = i
    if (isBasis) current.basis = true
    current.reading = !quoted && word.toLowerCase() === 'if'
  }
  close()
  return out
}

/**
 * How many wires a gate written without them needs: `H` one, `CNOT` two,
 * `TOFFOLI` three. Nought when it wrote its own, or cannot leave them out.
 *
 * Read off the words rather than from what the gate turns out to be, so the
 * editor can ask the same question of text it is about to rewrite. A gate
 * carrying a quoted name is left to say what it always said: where the name
 * stands relative to the wires is what it means, and with no wires there is
 * no telling which it was.
 */
export function wiresLeftOut(text: string): number {
  const words = withoutSwitch(text.replace(CONDITION, ' ')).trim().split(/\s+/).filter((w) => !/^[a-z]+=/i.test(w))
  if (words.some((w) => w.startsWith('"'))) return 0
  const head = words[0]?.toLowerCase() ?? ''
  const arity = arityOf(head)
  if (!arity) return 0
  if (words.length === 1) return arity
  // A measurement's basis is not a wire: `M X` still leaves its wire out.
  return (head === 'm' || head === 'measure') && words.length === 2 && /^[a-z]+$/i.test(words[1])
    ? arity
    : 0
}

/**
 * Write the wires in, straight after the name, from `first` down: `M X` on
 * wire 3 is `M 3 X`, and `CNOT` from wire 2 is `CNOT 2 3`. Written without an
 * arrow, which puts the target last — exactly what the bare name meant.
 */
export function withWires(text: string, first: number, count = 1): string {
  const lead = text.length - text.trimStart().length
  const head = text.slice(lead).split(/\s/)[0]
  const end = lead + head.length
  const wires = Array.from({ length: count }, (_, i) => first + i).join(' ')
  return `${text.slice(0, end)} ${wires}${text.slice(end)}`
}

/** Would this stand on its own as gates? Then it is not prose. */
function readsAsGates(text: string): boolean {
  let parts: string[]
  try {
    parts = splitStatements(text, 0).map((p) => p.text)
  } catch {
    return false
  }
  if (!parts.length) return false
  try {
    // The line number only ever reaches an error message, and the error is
    // being thrown away here.
    for (const part of parts) parseStatements(part, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Is this text an annotation rather than more of the circuit?
 *
 * Prose is admitted by elimination: anything that would parse as gates in its
 * own right is not prose, which keeps `H 1; encode: H 2` from quietly swallowing
 * the first gate into a caption. A `;` is refused outright — it separates gates,
 * so a candidate holding one is too ambiguous to guess at.
 */
const isProse = (text: string): boolean =>
  text.trim().length > 0 && !text.includes(';') && !readsAsGates(text)

/**
 * Lift annotations off a gate line: `encode: H 1; H 2 : the easy part`.
 *
 * Which side of a colon the text belongs on is settled by looking at what is
 * left, not by the shape of the text — `CNOT 1 -> 2 : note` would otherwise
 * read the whole gate as a leading caption, since nothing about "CNOT 1 -> 2"
 * disqualifies it as prose. Returns null when the line carries none, which
 * includes every state line: a state carries its own through the state parser.
 */
export function liftGateAnnotations(
  line: string,
): { caption?: string; note?: string; body: string } | null {
  if (!bareColons(line).length) return null

  let body = line
  let caption: string | undefined
  let note: string | undefined

  const first = bareColons(line)[0]
  const head = line.slice(0, first)
  if (opensWithGate(line.slice(first + 1)) && isProse(head)) {
    caption = head.trim()
    body = line.slice(first + 1)
  }

  const rest = bareColons(body)
  if (rest.length) {
    const last = rest[rest.length - 1]
    const tail = body.slice(last + 1)
    if (opensWithGate(body.slice(0, last)) && isProse(tail)) {
      note = tail.trim()
      body = body.slice(0, last)
    }
  }

  if (caption === undefined && note === undefined) return null
  return { caption, note, body: body.trim() }
}

/**
 * Read the options on an `animate` line: `animate speed=1.5 loop=off`.
 *
 * Every one has a default that works, so the bare word is the usual form and
 * these are for tuning a figure that reads too fast or too slow.
 */
function readAnimation(arg: string, lineNo: number): AnimationOptions {
  const opts: AnimationOptions = {}
  for (const token of arg.split(/\s+/).filter(Boolean)) {
    const hit = /^([a-z]+)=(.*)$/i.exec(token)
    if (!hit) {
      throw new ParseError(
        `"${token}" is not an animate option — use inside=, speed=, dwell=, hold= or loop=`,
        0,
        lineNo,
      )
    }
    const [, key, raw] = hit
    const name = key.toLowerCase()
    if (name === 'loop' || name === 'inside') {
      const v = raw.toLowerCase()
      if (v !== 'on' && v !== 'off') {
        throw new ParseError(`${name} takes "on" or "off"`, 0, lineNo)
      }
      opts[name] = v === 'on'
      continue
    }
    if (name !== 'speed' && name !== 'dwell' && name !== 'hold') {
      throw new ParseError(
        `"${key}" is not an animate option — use inside=, speed=, dwell=, hold= or loop=`,
        0,
        lineNo,
      )
    }
    const v = Number(raw)
    if (!Number.isFinite(v) || v <= 0) {
      throw new ParseError(`${name}= needs a positive number, e.g. ${name}=1.5`, 0, lineNo)
    }
    opts[name] = v
  }
  return opts
}

const ANSWER = /^answers?\s+(.*\S)\s*$/i

/**
 * Lift `answer` off a line, before or after its caption.
 *
 * `answer 010` and `after the swap: answer 010` both read naturally, and the
 * caption belongs to the state either way — so the word is taken out and what
 * is left is the line as it would have been written without it.
 */
function liftAnswer(line: string): { asked: boolean; line: string } {
  // `answer` on its own asks for the one answer that does not have to be
  // written down: the state worked out from the circuit above it.
  if (/^answers?\s*$/i.test(line)) return { asked: true, line: 'calculate' }

  const direct = ANSWER.exec(line)
  if (direct) return { asked: true, line: direct[1] }

  const { caption, rest } = splitCaption(line)
  const inner = ANSWER.exec(rest.trim())
  if (caption !== undefined && inner) return { asked: true, line: `${caption}: ${inner[1]}` }
  return { asked: false, line }
}

/**
 * `tabulate`, its columns, rows written by hand, and a note.
 *
 * Rows stop at a colon because a colon is where a note begins, as it does on
 * every other line — and nothing a row holds has any use for one.
 */
const TABLE_LINE = /^(?:tabulate|table)\b\s*(?:\(([^)]*)\))?\s*([^:]*?)\s*(?::\s*(.*?))?\s*$/i

/** What a column may be called, beyond its own name. */
const COLUMN_NAMES: Record<string, TableColumn['kind']> = {
  possibility: 'possibility', state: 'possibility', outcome: 'possibility',
  probability: 'probability', prob: 'probability', chance: 'probability', p: 'probability',
  amplitude: 'amplitude', amp: 'amplitude', a: 'amplitude',
}

const DEFAULT_COLUMNS: TableColumn[] = [{ kind: 'possibility' }, { kind: 'probability' }]

/**
 * Read a column list: `possibility, probability` — each optionally renamed.
 *
 * The header is the one piece of English the renderer emits, so `p="Chance"`
 * exists to get it out of the way of a figure that wants its own word.
 */
function parseColumns(list: string, lineNo: number): TableColumn[] {
  const parts = list.split(',').map((s) => s.trim()).filter(Boolean)
  if (!parts.length) {
    throw new ParseError('tabulate() needs at least one column, e.g. tabulate(possibility, probability)', 0, lineNo)
  }
  return parts.map((part) => {
    const named = /^([A-Za-z]+)\s*=\s*(.*)$/.exec(part)
    const name = (named ? named[1] : part).toLowerCase()
    const kind = COLUMN_NAMES[name]
    if (!kind) {
      throw new ParseError(
        `"${named ? named[1] : part}" is not a column — use possibility, probability or amplitude`,
        0,
        lineNo,
      )
    }
    if (!named) return { kind }
    const header = named[2].trim().replace(/^["']|["']$/g, '')
    if (!header) throw new ParseError(`${name}= needs a heading, e.g. ${name}="Chance"`, 0, lineNo)
    return { kind, header }
  })
}

/**
 * Read `tabulate` with its columns and whatever annotations surround it.
 *
 * The bare form is tried first for the same reason `calculate` is: the caption
 * rule cannot know that what follows a colon is a keyword.
 */
function readTable(text: string, lineNo: number): TableSpec | null {
  const trimmed = text.trim()
  const read = (src: string, caption?: string): TableSpec | null => {
    const hit = TABLE_LINE.exec(src)
    if (!hit) return null
    const columns = hit[1] === undefined ? DEFAULT_COLUMNS : parseColumns(hit[1], lineNo)
    return {
      columns,
      caption,
      note: hit[3] || undefined,
      ...(hit[2] ? { lines: parseRows(hit[2], columns, lineNo), given: true } : {}),
    }
  }

  const direct = read(trimmed)
  if (direct) return direct

  const { caption, rest } = splitCaption(trimmed)
  return read(rest, caption)
}

/**
 * Rows written out by hand: `tabulate 00 = 1/2, 11 = 1/2`.
 *
 * Each is an outcome, then — after `=` — one value for each column that is not
 * the outcome itself, in the order the columns were written. The values are
 * drawn exactly as they are written. A table put together by hand is a claim:
 * an exercise, a wrong answer to talk through, a measurement from the lab,
 * cells left for a student. None of those is the arithmetic's to correct, and
 * `1/2`, `50%` and `½` are all ways a person might want it said.
 *
 * `_`, or nothing after the outcome at all, leaves a cell empty — which is how
 * a worksheet lists the possibilities and asks for the chances.
 */
function parseRows(text: string, columns: TableColumn[], lineNo: number): TableLine[] {
  const values = columns.filter((c) => c.kind !== 'possibility')
  return splitTopLevel(text, ',')
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => {
      const eq = row.indexOf('=')
      const outcome = (eq < 0 ? row : row.slice(0, eq)).trim()
      const given = eq < 0 ? [] : row.slice(eq + 1).trim().split(/\s+/).filter(Boolean)
      if (!outcome) {
        throw new ParseError(`"${row}" has no outcome before its "="`, 0, lineNo)
      }
      if (given.length > values.length) {
        throw new ParseError(
          values.length === 1
            ? `${outcome} has ${given.length} values, but the table has one column to put them in`
            : `${outcome} has ${given.length} values, but the table has ${values.length} columns to put them in`,
          0,
          lineNo,
        )
      }
      let state
      try {
        state = parseState(outcome).rows[0]
      } catch (e) {
        throw new ParseError(`"${outcome}" is not an outcome — ${(e as Error).message}`, 0, lineNo)
      }
      const cell = (kind: TableColumn['kind']) => {
        const at = values.findIndex((c) => c.kind === kind)
        const value = at < 0 ? undefined : given[at]
        return value === undefined || value === '_' ? undefined : value
      }
      return { state, probability: cell('probability'), amplitude: cell('amplitude') }
    })
}

/** Split on a separator, except inside brackets — a cloud may hold one. */
function splitTopLevel(text: string, sep: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '(') depth++
    else if (c === ')') depth = Math.max(0, depth - 1)
    else if (c === sep && depth === 0) {
      parts.push(text.slice(start, i))
      start = i + 1
    }
  }
  parts.push(text.slice(start))
  return parts
}

/**
 * `chart`, and the two quantities as keywords in their own right.
 *
 * `amplitude` and `probability` say what they draw without a bracket, which is
 * how a figure most often wants to ask for one — `chart(probability)` is the
 * general form and this is the sentence anybody would write instead.
 */
const CHART_LINE =
  /^(?:chart|plot|(amplitude|amplitudes|probability|probabilities)|)\s*(?:\(([^)]*)\))?\s*(?::\s*(.*?))?\s*$/i

/** What the bars may be asked to stand for. */
const CHART_MODES: Record<string, ChartSpec['mode']> = {
  amplitude: 'amplitude', amplitudes: 'amplitude', amp: 'amplitude', a: 'amplitude',
  probability: 'probability', probabilities: 'probability', prob: 'probability',
  chance: 'probability', p: 'probability',
}

/**
 * Read `chart` with its mode and whatever annotations surround it.
 *
 * Amplitude is the default because it is the one a plot says something the
 * drawn state does not: signs are what interfere, and a probability chart
 * throws them away.
 */
function readChart(text: string, lineNo: number): ChartSpec | null {
  const trimmed = text.trim()
  const read = (src: string, caption?: string): ChartSpec | null => {
    const hit = CHART_LINE.exec(src)
    // The alternation can match nothing at all, which would make every blank
    // line a chart; a bare word or `chart` is required.
    if (!hit || (!hit[1] && !/^(chart|plot)\b/i.test(src.trim()))) return null
    const named = hit[1] && CHART_MODES[hit[1].toLowerCase()]
    const asked = hit[2]?.trim().toLowerCase()
    if (named && asked) {
      throw new ParseError(`${hit[1]} already says what to chart`, 0, lineNo)
    }
    const mode = named || (asked ? CHART_MODES[asked] : 'amplitude')
    if (!mode) {
      throw new ParseError(
        `"${hit[2].trim()}" is not something to chart — use amplitude or probability`,
        0,
        lineNo,
      )
    }
    return { mode, caption, note: hit[3] || undefined }
  }

  const direct = read(trimmed)
  if (direct) return direct

  const { caption, rest } = splitCaption(trimmed)
  return read(rest, caption)
}

/**
 * Read `calculate` with whatever annotations surround it.
 *
 * The bare form is tried before splitting off a leading caption, because
 * `calculate : note` would otherwise have the word itself taken as the caption
 * — the caption rule cannot know that what follows is a keyword.
 */
function readCalculate(text: string): { caption?: string; note?: string } | null {
  const trimmed = text.trim()
  const direct = CALCULATE.exec(trimmed)
  if (direct) return { note: direct[2] || undefined }

  const { caption, rest } = splitCaption(trimmed)
  const hit = CALCULATE.exec(rest)
  return hit ? { caption, note: hit[2] || undefined } : null
}

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
function parseView(
  arg: string,
  lineNo: number,
  boxed = false,
  base?: number,
): ViewGate & GateStyle {
  // Options come off first, blanked rather than cut, so that positions in
  // `text` are still positions in `arg` — the state carries them.
  const { text, found } = takeOptions(arg, ['fill', 'rows', 'width', 'height'])
  const framed = (name: string) => {
    if (!boxed) {
      throw new ParseError(`${name}= needs a frame — use "window" rather than "view"`, 0, lineNo)
    }
  }

  let fill: string | undefined
  if (found.fill !== undefined) {
    framed('fill')
    fill = found.fill
    if (!isColour(fill)) {
      throw new ParseError(
        fill
          ? `"${fill}" is not a colour — use #rrggbb or a colour name`
          : 'fill= needs a colour, e.g. fill=#e3efe3',
        0,
        lineNo,
      )
    }
  }

  // Room, counted in rows of qubits. Only a frame has an inside to be tall;
  // a bare view is the state itself, and is exactly as tall as that.
  let space: number | undefined
  if (found.rows !== undefined) {
    framed('rows')
    const n = Number(found.rows)
    if (!found.rows || !Number.isInteger(n) || n < 1 || n > MAX_ROWS) {
      throw new ParseError(`rows= takes a whole number of rows up to ${MAX_ROWS}, e.g. rows=3`, 0, lineNo)
    }
    space = n
  }

  let width: number | undefined
  let height: number | undefined
  if (found.width !== undefined) {
    framed('width')
    width = readScale('width', found.width, lineNo)
  }
  if (found.height !== undefined) {
    framed('height')
    height = readScale('height', found.height, lineNo)
  }
  const style = { fill, space, width, height }

  const tokens = text.split(/\s+/).filter(Boolean)

  // Nothing to show: an empty frame, for the state at this point to be drawn
  // in by hand. `window` alone says it; `window blank` says it out loud.
  const empty = (qubits: number[]): ViewGate & GateStyle => {
    if (!boxed) {
      throw new ParseError(
        'an empty view would only break the circuit open — use "window blank" for an empty frame',
        0,
        lineNo,
      )
    }
    return { kind: 'view', qubits, blank: true, boxed: true, ...style }
  }
  if (!tokens.length) {
    if (boxed) return empty([])
    throw new ParseError('view needs a state, e.g. view 00|11', 0, lineNo)
  }
  if (tokens.length === 1 && /^blank$/i.test(tokens[0])) return empty([])

  // The wires can come after a `calculate` or a `blank` as well as before it,
  // there being no state written for them to be mistaken for.
  const last = tokens[tokens.length - 1]
  if (tokens.length === 2 && /^(calculate|calc|blank)$/i.test(tokens[0]) && RANGE.test(last)) {
    const qubits = parseQubits([{ text: last, quoted: false }], lineNo)
    if (/^blank$/i.test(tokens[0])) return empty(qubits)
    return { ...viewOf(tokens[0], qubits, lineNo), boxed: boxed || undefined, ...style }
  }

  let qubits: number[] = []
  let from = 0
  if (tokens.length > 1 && RANGE.test(tokens[0])) {
    // A state is written in 0s, 1s and ?s, so another number after the wires
    // is a second set of wires — and a window covers one run of them.
    if (/^\d+(-\d+)?$/.test(tokens[1]) && /[2-9-]/.test(tokens[1])) {
      throw new ParseError(
        `a window covers wires side by side — write them as a range, e.g. ${tokens[0]}-${tokens[1].split('-').pop()}`,
        0,
        lineNo,
      )
    }
    qubits = parseQubits([{ text: tokens[0], quoted: false }], lineNo)
    from = text.indexOf(tokens[0]) + tokens[0].length
    if (/^\s*blank\s*$/i.test(text.slice(from))) return empty(qubits)
  }

  // Where the state starts is counted, not inferred from what is left over:
  // an option after it would otherwise shift every qubit onto the wrong
  // character, and a click on one would edit the option instead.
  const rest = text.slice(from)
  const lead = rest.length - rest.trimStart().length
  return {
    ...viewOf(rest.trim(), qubits, lineNo, base === undefined ? undefined : base + from + lead),
    boxed: boxed || undefined,
    ...style,
  }
}

/**
 * Take `name=value` options off a line, leaving spaces where they were.
 *
 * Blanked rather than cut, so everything after them stays exactly where it
 * was. A window's qubits carry their place in the source — it is how one is
 * clicked and changed — and cutting a word out of the middle of the line
 * moved every qubit after it onto the wrong character.
 */
function takeOptions(
  text: string,
  names: string[],
): { text: string; found: Record<string, string> } {
  const found: Record<string, string> = {}
  const option = new RegExp(`(^|\\s)(${names.join('|')})=(\\S*)`, 'gi')
  const blanked = text.replace(option, (whole, lead: string, name: string, value: string) => {
    found[name.toLowerCase()] = value
    return lead + ' '.repeat(whole.length - lead.length)
  })
  return { text: blanked, found }
}

/** The smallest and largest multiple a gate may be drawn at. */
const MIN_SCALE = 0.25
const MAX_SCALE = 10

/**
 * Read `width=` or `height=`: a multiple of the size the gate would take.
 *
 * Bounded, because `width=100` is far likelier a slip than a figure anyone
 * wants, and a gate a hundred times its size swallows the drawing whole.
 */
function readScale(name: string, value: string, lineNo: number): number {
  const n = Number(value)
  if (!value || !Number.isFinite(n) || n < MIN_SCALE || n > MAX_SCALE) {
    throw new ParseError(
      `${name}= takes a multiple of the gate's own size, from ${MIN_SCALE} to ${MAX_SCALE} — e.g. ${name}=2`,
      0,
      lineNo,
    )
  }
  return n
}

/** Past this, `rows=` is far likelier a typo than a figure anyone wants. */
const MAX_ROWS = 20

/** Build a view, checking that the state is as wide as the span it claims. */
/**
 * Where a slice starts, given where the string it came out of starts.
 *
 * The slices this parser takes are always a suffix with some of the front
 * trimmed off, so the difference in length is the distance moved. Anything
 * rebuilt rather than sliced has no base to give and says so.
 */
const offsetOf = (whole: string, part: string, base?: number): number | undefined =>
  base === undefined ? undefined : base + whole.length - part.length

function viewOf(
  stateText: string,
  qubits: number[],
  lineNo: number,
  base?: number,
): ViewGate {
  // `calculate` with no wires covers the register, whatever the register turns
  // out to be, so the span is filled in once that is known. Given wires, it
  // works out the state of those alone. Its caption is held here too, there
  // being no state yet to hang it on.
  const calc = readCalculate(stateText)
  if (calc) {
    return { kind: 'view', qubits, calculate: true, caption: calc.caption, note: calc.note }
  }

  const row = parseState(stateText, base).rows[0]
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
  const colour = takeColour(tokens, line)
  const head = tokens[0].text.toUpperCase()
  const rest = tokens.slice(1)

  /**
   * Only what is drawn in the accent takes a colour of its own.
   *
   * A letter, a box and a measurement each have a face, and `fill=` already
   * paints it; two words for one colour would leave nobody sure which to use.
   */
  const noColour = () => {
    if (colour !== undefined) {
      throw new ParseError(
        `${head} is coloured with \`fill=\` — \`colour=\` is for a controlled gate, a swap or a GATE`,
        0,
        line,
      )
    }
  }

  /**
   * A colour needs something to paint.
   *
   * A controlled gate is dots and a bar with nothing between them, and a plain
   * pipe is a pipe — neither has a face to take a fill. Saying so beats drawing
   * the line exactly as it would have been drawn without the colour, which
   * looks for all the world like the colour was wrong.
   */
  const noBox = () => {
    if (fill !== undefined) {
      throw new ParseError(
        `${head} has no box to fill — \`fill=\` belongs on a box, a blank, a gate letter or a measurement`,
        0,
        line,
      )
    }
  }

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

  // `_ 2`: wire 2 is blank space here — an identity that is not drawn.
  if (head === '_') {
    noBox()
    noColour()
    return { kind: 'identity', qubit: oneQubit(), gap: true }
  }

  if (head === 'I' || head === 'ID' || head === 'IDENTITY') {
    noBox()
    noColour()
    // `I 2 0` is an identity that shows what the qubit holds — the same window
    // a view opens, on a wire where nothing is happening. That is what makes
    // "look at these, hold those" expressible alongside a partial view.
    // `I 3 -> 5`: the wire bends across to position 5.
    if (rest.length === 3 && !rest[2].quoted && rest[1].text === '->') {
      const to = Number(rest[2].text)
      if (!rest[2].text || !Number.isFinite(to)) {
        throw new ParseError(`"${rest[2].text}" is not a position — e.g. I 3 -> 5`, 0, line)
      }
      return { kind: 'identity', qubit: parseQubits([rest[0]], line)[0], move: { to } }
    }
    if (rest.length > 1) {
      const qs = parseQubits([rest[0]], line)
      // Rebuilt from tokens rather than sliced, so there is no offset to report.
      return viewOf(rest.slice(1).map((t) => t.text).join(' '), qs, line)
    }
    return { kind: 'identity', qubit: oneQubit() }
  }

  // `tag` alone is every wire, settled once the register's width is known.
  if (head === 'TAG') {
    noBox()
    noColour()
    return { kind: 'tag', qubits: rest.length ? parseQubits(rest, line) : [] }
  }

  // NOT is drawn as a bare ⊕ throughout the course materials, never as a
  // lettered box — so it is a controlled gate that happens to have no controls.
  if (head === 'X' || head === 'NOT') {
    return { kind: 'controlled', controls: [], target: oneQubit(), targetGlyph: 'not', accent: colour }
  }

  /*
   * A gate known only by its name: `CGATE "U" 1 2` is a control, a link and
   * the name on a box where the ⊕ would be; `GATE "U" 2` is the name alone, as
   * `X` is the ⊕ alone. Neither says what it does, so neither can be
   * calculated through — which is the difference from `CNOT "U" 1 2`, still a
   * CNOT under its name.
   */
  if (head === 'CGATE' || head === 'GATE') {
    const example = head === 'GATE' ? 'GATE "U" 1' : 'CGATE "U" 1 2'
    if (fill !== undefined) {
      throw new ParseError(
        `${head} is coloured with \`colour=\`, which takes its dot, its line and its box together`,
        0,
        line,
      )
    }
    const name = rest[0]?.quoted ? rest.shift() : undefined
    if (!name?.text) {
      throw new ParseError(`${head} needs a name before its wires, e.g. ${example}`, 0, line)
    }
    if (rest.some((t) => t.quoted)) {
      throw new ParseError(`${head} takes one name, written before its wires`, 0, line)
    }
    const custom = {
      kind: 'controlled' as const,
      targetGlyph: 'label',
      label: name.text,
      custom: true,
      accent: colour,
    }
    if (head === 'GATE') {
      const qs = rest.length ? parseQubits(rest, line) : [1]
      if (qs.length !== 1) {
        throw new ParseError('GATE stands on one wire — a box across several is BOX, a controlled one CGATE', 0, line)
      }
      return { ...custom, controls: [], target: qs[0] }
    }
    // Read as a CNOT's wires are: the last is the target unless an arrow says.
    const { controls, targets, open } = splitControls(rest, line, head)
    if (!controls.length) {
      throw new ParseError(`CGATE needs at least one control — with none it is GATE`, 0, line)
    }
    if (targets.length !== 1) throw new ParseError('CGATE needs exactly one target', 0, line)
    return { ...custom, controls, target: targets[0], ...openOf(open) }
  }

  // `RZ(45)` arrives as one token — nothing splits on a bracket — so the angle
  // comes off before the plain-letter gates are looked up.
  //
  // The brackets are optional, and a bare `RY` turns by nothing. A rotation
  // with no angle is a rotation that has not been set yet rather than a typing
  // mistake, and answering it with "unknown gate" helps nobody — least of all
  // someone who has just dragged one and is looking at a drawing that has
  // vanished. Written out, it draws `R_Y(0°)`, which says plainly what it is.
  const turn = /^(RX|RY|RZ|P)(?:\(\s*(-?[\d.]*)\s*\))?$/i.exec(head)
  if (turn) {
    const angle = turn[2] === undefined || turn[2] === '' ? 0 : Number(turn[2])
    if (!Number.isFinite(angle)) {
      throw new ParseError(`${turn[1]} needs an angle in degrees, e.g. ${turn[1]}(90)`, 0, line)
    }
    noColour()
    return { kind: 'single', label: turn[1].toUpperCase(), qubit: oneQubit(), angle, accent: fill }
  }

  if (head in SINGLE_GATES) {
    const spec = SINGLE_GATES[head]
    noColour()
    return { kind: 'single', label: spec.label, qubit: oneQubit(), accent: fill ?? spec.accent }
  }

  if (head === 'CNOT' || head === 'CX' || head === 'TOFFOLI' || head === 'CCNOT' || head === 'CCX') {
    noBox()
    // A quoted name may sit at either end, and where it sits is what it means:
    // before the wires it stands on the target in place of the ⊕; after them it
    // labels the link, naming the gate as a whole.
    const front = rest[0]?.quoted ? rest.shift() : undefined
    const back = rest[rest.length - 1]?.quoted ? rest.pop() : undefined

    // The arrow says which wire is the target, and is worth writing where a
    // reader might wonder. Without one the last wire is the target — the same
    // reading `CZ 1 2` and `SWAP 1 2` already take, so `CNOT 1 2` means what
    // anyone would expect it to rather than being an error about punctuation.
    const { controls, targets, open } = splitControls(rest, line, head)
    if (!controls.length) throw new ParseError(`${head} needs at least one control`, 0, line)
    if (targets.length !== 1) throw new ParseError(`${head} needs exactly one target`, 0, line)
    return {
      kind: 'controlled',
      controls,
      target: targets[0],
      ...openOf(open),
      targetGlyph: front ? 'label' : 'not',
      label: front?.text ?? back?.text,
      labelOnLink: back && !front ? true : undefined,
      accent: colour,
    }
  }

  /*
   * A controlled-Z on any number of wires: `CZ 1 2 3`, or `CCZ`, flips the sign
   * where every one of them is black. Which is the target makes no difference
   * to what it does, so there is no arrow to write, and every dot — the last
   * included — may be told to act on white instead.
   */
  if (head === 'CZ' || head === 'CCZ') {
    noBox()
    const front = rest[0]?.quoted ? rest.shift() : undefined
    const back = rest[rest.length - 1]?.quoted ? rest.pop() : undefined
    if (rest.some((t) => t.text === '->')) {
      throw new ParseError(`${head} has no target to point at — every wire of it is a control, e.g. CZ 1 2 3`, 0, line)
    }
    const { qubits: qs, open } = parseMarked(rest, line, head)
    if (head === 'CCZ' && qs.length !== 3) throw new ParseError('CCZ takes three qubits', 0, line)
    if (qs.length < 2) throw new ParseError('CZ takes two qubits or more', 0, line)
    const target = qs[qs.length - 1]
    // A name before the wires stands on the last of them, in place of its dot —
    // so there is no ring there to say it acts on white.
    if (front && open.includes(target)) {
      throw new ParseError(
        `the name "${front.text}" stands on wire ${target}, so it has no dot to act on 0 — mark another wire, or put the name after the wires`,
        0,
        line,
      )
    }
    return {
      kind: 'controlled',
      controls: qs.slice(0, -1),
      target,
      ...openOf(open),
      phase: true,
      targetGlyph: front ? 'label' : 'z',
      label: front?.text ?? back?.text,
      labelOnLink: back && !front ? true : undefined,
      accent: colour,
    }
  }

  if (head === 'SWAP') {
    noBox()
    const qs = parseQubits(rest, line)
    if (qs.length !== 2) throw new ParseError('SWAP takes two qubits', 0, line)
    return { kind: 'swap', qubits: [qs[0], qs[1]], accent: colour }
  }

  // Controlled SWAP — the Fredkin gate at one control. The two swapped wires
  // are the targets and everything before is a control, split on `->` the same
  // way CNOT is; without an arrow the last two wires are the pair, matching how
  // `SWAP 1 2` and `CNOT 1 2` already read their trailing wire.
  if (head === 'CSWAP' || head === 'FREDKIN') {
    noBox()
    const { controls, targets, open } = splitControls(rest, line, head, 2)
    if (!controls.length) throw new ParseError(`${head} needs at least one control`, 0, line)
    if (targets.length !== 2) throw new ParseError(`${head} swaps exactly two qubits`, 0, line)
    return { kind: 'swap', qubits: [targets[0], targets[1]], controls, ...openOf(open), accent: colour }
  }

  if (head === 'MEASURE' || head === 'M') {
    noColour()
    // Trailing non-numeric token is the basis label, e.g. `measure 2 X`.
    let basis = 'Z'
    const last = rest[rest.length - 1]
    if (last && !last.quoted && /^[A-Za-z]+$/.test(last.text)) {
      basis = last.text.toUpperCase()
      rest.pop()
    }
    return { kind: 'measure', qubit: oneQubit(), basis, fill }
  }

  if (head === 'BOX' || head === 'BLANK') {
    noColour()
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

  // `CH 1 2`, `CCRZ(90) 1 2 3`, `CSWAP`'s cousins: a C for every control,
  // whose wires are written first. What is left is the gate itself.
  const ctl = controlledName(head)
  if (ctl) {
    const name = head.slice(0, ctl.count)
    const { controls, open, rest: left } = takeControls(rest, ctl.count, line, head)
    if (!left.some((t) => !t.quoted)) {
      const example = `${name}${ctl.base.toUpperCase()} ${Array.from({ length: ctl.count + 1 }, (_, i) => i + 1).join(' ')}`
      throw new ParseError(`${head} needs the wire${arityOf(ctl.base) > 1 ? 's' : ''} it acts on after its controls — e.g. ${example}`, 0, line)
    }
    const options = [fill !== undefined ? `fill=${fill}` : '', colour !== undefined ? `colour=${colour}` : '']
    const text = [ctl.base, ...left.map((t) => (t.quoted ? `"${t.text}"` : t.text)), ...options]
      .filter(Boolean)
      .join(' ')
    return withControls(parseGate(text, line), controls, open, line, `${name}${ctl.base.toUpperCase()}`)
  }

  throw new ParseError(`unknown gate "${tokens[0].text}"`, 0, line)
}

/**
 * The first `count` wires of a gate written with a C for each control.
 *
 * A range is taken apart, so `CCH 1-3` is controls on 1 and 2 and the H on 3;
 * an arrow straight after them only says where the controls end. Everything
 * else — a quoted name, the wires the gate itself is on — is left for it.
 */
function takeControls(
  tokens: Token[], count: number, line: number, head: string,
): { controls: number[]; open: number[]; rest: Token[] } {
  const controls: number[] = []
  const open: number[] = []
  const rest: Token[] = []
  let arrowed = false
  for (const t of tokens) {
    if (controls.length === count || t.quoted) {
      // An arrow after the controls, and only there, is theirs.
      if (!arrowed && controls.length === count && !t.quoted && t.text === '->' && !rest.some((r) => !r.quoted)) {
        arrowed = true
        continue
      }
      rest.push(t)
      continue
    }
    if (t.text === '->') {
      throw new ParseError(
        `${head} has ${count} control${count === 1 ? '' : 's'} — one C for each — so the arrow goes after ${count === 1 ? 'it' : 'them'}`,
        0,
        line,
      )
    }
    const marked = parseMarked([t], line, head)
    for (const q of marked.qubits) {
      if (controls.length < count) {
        controls.push(q)
        if (marked.open.includes(q)) open.push(q)
      } else {
        rest.push({ text: marked.open.includes(q) ? `${q}=0` : String(q), quoted: false })
      }
    }
  }
  if (controls.length < count) {
    const example = `${'C'.repeat(count)}H ${Array.from({ length: count + 1 }, (_, i) => i + 1).join(' ')}`
    throw new ParseError(
      `${head} needs ${count === 1 ? 'its control' : `its ${count} controls`} written first, then the gate's own wires — e.g. ${example}`,
      0,
      line,
    )
  }
  return { controls, open, rest }
}

/**
 * A gate given controls: `CH` is an H given one.
 *
 * One that has controls already takes these as more of them, so `CCNOT` and
 * `CCX` come out as the Toffoli they always were. Anything else carries them
 * for itself. A measurement, a pipe or a view is not something that happens,
 * so there is nothing for a control to switch.
 */
function withControls(gate: Gate, controls: number[], open: number[], line: number, head: string): Gate {
  if (gate.kind === 'measure') {
    throw new ParseError(`${head}: a measurement cannot be controlled — it reads the wire whatever the others hold`, 0, line)
  }
  if (gate.kind === 'identity' || gate.kind === 'tag' || gate.kind === 'view') {
    throw new ParseError(`${head}: this does nothing to the qubits, so there is nothing to control`, 0, line)
  }
  if (new Set(controls).size !== controls.length) {
    throw new ParseError(`${head} has the same control twice`, 0, line)
  }
  const own = actedOn(gate)
  const clash = controls.find((c) => own.includes(c))
  if (clash !== undefined) {
    throw new ParseError(`${head}: wire ${clash} cannot be a control and part of the gate it controls`, 0, line)
  }
  if (gate.kind === 'box') {
    const [q0, q1] = [Math.min(...gate.qubits), Math.max(...gate.qubits)]
    const inside = controls.find((c) => c > q0 && c < q1)
    if (inside !== undefined) {
      throw new ParseError(`${head}: the control on wire ${inside} is inside the box, which covers ${q0}-${q1}`, 0, line)
    }
  }
  const all = [...open, ...(gate.open ?? [])]
  return { ...gate, controls: [...controls, ...(gate.controls ?? [])], ...(all.length ? { open: all } : {}) }
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
function parseStatements(src: string, line: number, base?: number): Gate[] {
  const token = src.trim()
  // Tagged in one place rather than at every `return` inside `parseGate`: what
  // a gate is stays that function's business, and where it was written is not.
  const from = (gates: Gate[]): Gate[] => gates.map((gate) => ({ ...gate, line }))

  if (/^[A-Za-z]+$/.test(token) && isGateRun(token)) {
    return from([...token.toUpperCase()].map((letter, i) => parseGate(`${letter} ${i + 1}`, line)))
  }
  // `_ 2-3` is a blank on each: space is per wire, like the pipe it replaces.
  if (/^_\s/.test(token)) {
    const words = token.slice(1).trim().split(/\s+/)
    const options = words.filter((w) => w.includes('=')).join(' ')
    const wires = words.filter((w) => !w.includes('='))
    const qs = wires.length ? parseQubits(tokenize(wires.join(' '), line), line) : []
    if (qs.length > 1) return from(qs.map((q) => parseStatement(`_ ${q} ${options}`, line)))
  }
  return from([parseStatement(src, line, base)])
}

/**
 * Read a line's statements, giving each gate that left its wire out one.
 *
 * Those written with wires keep them, and claim them first. The rest take the
 * lowest wires nobody on the line is using, in the order they are written —
 * so `H H` is `H 1; H 2`, `CNOT` is `CNOT 1 2`, and `CNOT 1 2 H` puts the H
 * on wire 3 rather than on top of the CNOT. A lone `H` is still `H 1`, and a line that was already
 * valid means what it always meant: before, a gate with no wire took wire 1,
 * and that was only valid when nothing else on the line had it.
 */
function placeGates(
  parts: string[],
  lineNo: number,
  placeOf: (text: string) => number | undefined,
): Gate[] {
  const open = parts.map((text) => wiresLeftOut(text))
  const read = parts.map((text, i) => (open[i] ? null : parseStatements(text, lineNo, placeOf(text))))
  const taken = new Set<number>()
  for (const gates of read) {
    for (const gate of gates ?? []) {
      if (gate.kind === 'view' && !gate.qubits.length) continue
      const [q0, q1] = gateSpan(gate)
      for (let q = q0; q <= q1; q++) taken.add(q)
    }
  }
  // Which statement of the line a switch is written in, so a click flips that
  // one word and no other.
  const stamp = (gates: Gate[], part: number): Gate[] =>
    gates.map((g) => (g.switch ? { ...g, switch: { ...g.switch, part } } : g))
  return parts.flatMap((text, i) => stamp(placed(text, i), i))

  function placed(text: string, i: number): Gate[] {
    const count = open[i]
    if (!count) return read[i]!
    // A gate over several wires is drawn across a run of them, so it wants
    // that many free in a row — the lowest such run.
    // Nor on a wire it only reads: `X if M1` is an X somewhere other than 1.
    const reads = Number(CONDITION.exec(text)?.[2] ?? 0)
    const busy = (q: number) => taken.has(q) || q === reads
    let first = 1
    while (Array.from({ length: count }, (_, k) => first + k).some(busy)) first++
    for (let k = 0; k < count; k++) taken.add(first + k)
    return parseStatements(withWires(text, first, count), lineNo, undefined)
  }
}

/** One statement: a gate, a view, or a bare state that is therefore a view. */
function parseStatement(src: string, line: number, base?: number): Gate {
  // `H2` is `H 2`. Only a gate is ever glued: nothing else takes a wire, and
  // a view's state keeps its place in the line untouched.
  if (startsGate(src.trim().split(/\s+/)[0] ?? '')) src = unglue(src)
  const kw = src.split(/\s+/)[0].toLowerCase()
  if (kw === 'view' || kw === 'show' || kw === 'window') {
    if (takeSwitch(src, line).on !== undefined) {
      throw new ParseError('a view only looks, so there is nothing to switch — switch the gates instead', 0, line)
    }
    const arg = src.slice(kw.length).trim()
    return parseView(arg, line, kw === 'window', offsetOf(src, arg, base))
  }
  if (KEYWORDS.has(kw) || isTurn(kw) || controlledName(kw)) return parseSizedGate(src, line)
  if (looksLikeGateName(src)) {
    throw new ParseError(`unknown gate "${src.split(/\s+/)[0]}"`, 0, line)
  }
  refuseFrameOptions(src, line)
  return viewOf(src, [], line, base)
}

/**
 * A state on a line of its own is drawn as exactly what it is: it has no
 * frame to size or paint. Said in so many words, since otherwise the state
 * parser gets the line and can only complain about the letter `w`.
 */
function refuseFrameOptions(src: string, line: number): void {
  const option = /(^|\s)(width|height|rows|fill)=/i.exec(src)
  if (!option) return
  const name = option[2].toLowerCase()
  throw new ParseError(
    `${name}= needs a frame — write it as a window, e.g. "window ${src.slice(0, option.index).trim()} ${name}=…"`,
    0,
    line,
  )
}

/**
 * A gate, with any `width=` and `height=` written on it.
 *
 * Taken off before the gate is read, so no gate has to know about them, and
 * put back on the result — which is the same thing whatever kind it is.
 */
function parseSizedGate(src: string, line: number): Gate {
  const { text, on } = takeSwitch(src, line)
  const gate = sizedGate(text, line)
  return on === undefined ? gate : switched(gate, on, line)
}

function sizedGate(src: string, line: number): Gate {
  const { text: plain, given } = takeCondition(src, line)
  const { text, found } = takeOptions(plain, ['width', 'height', 'shift'])
  const parsed = parseGate(text, line)
  const moved = found.shift === undefined ? parsed : shifted(parsed, found.shift, line)
  const gate = given ? conditioned(moved, given, line) : moved
  if (found.width === undefined && found.height === undefined) return gate
  const width = found.width === undefined ? undefined : readScale('width', found.width, line)
  const height = found.height === undefined ? undefined : readScale('height', found.height, line)
  // `I 2 0` is a view of its qubit, drawn bare — the state itself, unframed.
  if (gate.kind === 'view' && !gate.boxed) {
    throw new ParseError(
      `${width !== undefined ? 'width' : 'height'}= needs a frame — use "window" to show a state that can be sized`,
      0,
      line,
    )
  }
  // A pipe is as wide as a pipe. Height is another matter: a taller pipe is
  // how a layer is given room without anything being put in it.
  if (width !== undefined && gate.kind === 'tag') {
    throw new ParseError('a tag is a shape on its pipe, with no box to widen — height= gives it more room', 0, line)
  }
  if (width !== undefined && gate.kind === 'identity') {
    throw new ParseError(
      gate.gap
        ? 'a blank is empty space, with no box to widen — height= gives it more room'
        : 'I is a plain pipe, with no box to widen — height= gives it more room',
      0,
      line,
    )
  }
  return { ...gate, ...(width !== undefined ? { width } : {}), ...(height !== undefined ? { height } : {}) }
}

/* ------------------------------------------------------------ switches --- */

/** `on` or `off` as a word of its own, outside any quoted label. */
const SWITCH_WORD = /(^|\s)(on|off)(?=\s|;|\{|$)/gi

/** Quoted labels blanked out, keeping every position, so a word in one is not read. */
const unquoted = (src: string): string => src.replace(/"[^"]*"/g, (q) => '"' + ' '.repeat(q.length - 2) + '"')

/** The text with any switch word taken out, for whatever only needs to count wires. */
function withoutSwitch(src: string): string {
  const masked = unquoted(src)
  let out = src
  for (const hit of masked.matchAll(SWITCH_WORD)) {
    const from = hit.index! + hit[1].length
    out = out.slice(0, from) + ' '.repeat(hit[2].length) + out.slice(from + hit[2].length)
  }
  return out
}

/**
 * Take `on` or `off` off a gate's statement, leaving spaces where it was —
 * the same as a condition, so nothing after it moves.
 */
function takeSwitch(src: string, line: number): { text: string; on?: boolean } {
  const hits = [...unquoted(src).matchAll(SWITCH_WORD)]
  if (!hits.length) return { text: src }
  if (hits.length > 1) throw new ParseError('a gate has one switch — write on or off once', 0, line)
  return { text: withoutSwitch(src), on: hits[0][2].toLowerCase() === 'on' }
}

/** The same from a line's tokens, for a frame or a use, which are read that way. */
function takeSwitchToken(tokens: { text: string; quoted?: boolean }[], line: number): boolean | undefined {
  const at = tokens
    .map((t, i) => (!t.quoted && /^(on|off)$/i.test(t.text) ? i : -1))
    .filter((i) => i >= 0)
  if (!at.length) return undefined
  if (at.length > 1) throw new ParseError('a frame has one switch — write on or off once', 0, line)
  const on = tokens[at[0]].text.toLowerCase() === 'on'
  tokens.splice(at[0], 1)
  return on
}

/** Does this gate do something, so that switching it off means something? */
const acts = (gate: Gate): boolean =>
  gate.kind !== 'view' && gate.kind !== 'identity' && gate.kind !== 'tag'

/** Inside something switched off: drawn faded, and doing nothing. */
const darkened = (gate: Gate): Gate => (acts(gate) ? { ...gate, off: true } : gate)

/** Put a switch on a gate. */
function switched(gate: Gate, on: boolean, line: number): Gate {
  if (gate.kind === 'view') {
    throw new ParseError('a view only looks, so there is nothing to switch — switch the gates instead', 0, line)
  }
  if (!acts(gate)) {
    throw new ParseError('this does nothing to the qubits, so there is nothing to switch off', 0, line)
  }
  const sw: Switch = { on, line }
  return on ? { ...gate, switch: sw } : { ...gate, switch: sw, off: true }
}

/** What a frame's or a use's own switch does to the box it folds into. */
const switchOf = (sw: Switch | undefined): { switch?: Switch; off?: boolean } =>
  sw ? { switch: sw, ...(sw.on ? {} : { off: true }) } : {}

/** `if M1`, `if M1=0`: the condition a gate waits on, wherever it is written on the line. */
const CONDITION = /(^|\s)if\s+M(\d+)(?:=([01]))?(?=\s|;|$)/i

/**
 * Take a condition off a statement, leaving spaces where it was — the same as
 * an option, so nothing after it moves.
 */
function takeCondition(src: string, line: number): { text: string; given?: Gate['given'] } {
  const hit = CONDITION.exec(src)
  if (!hit) {
    if (/(^|\s)if(\s|$)/i.test(src)) {
      throw new ParseError('if takes a measured wire, e.g. X 3 if M1 — or if M1=0 to act on white', 0, line)
    }
    return { text: src }
  }
  const qubit = Number(hit[2])
  if (qubit < 1) throw new ParseError(`"M${hit[2]}" is not a wire (they start at 1)`, 0, line)
  const lead = hit[1].length
  const text = src.slice(0, hit.index + lead) + ' '.repeat(hit[0].length - lead) + src.slice(hit.index + hit[0].length)
  return { text, given: { qubit, value: hit[3] === '0' ? 0 : 1 } }
}

/**
 * Put a condition on a gate.
 *
 * Any gate on one wire can wait on a measurement — X, Z, a letter, a rotation,
 * a GATE. One with controls already has its condition, written as dots, and a
 * measurement or a box has nothing to switch on and off that reads clearly.
 */
function conditioned(gate: Gate, given: NonNullable<Gate['given']>, line: number): Gate {
  const oneWire =
    (gate.kind === 'single' && !gate.controls?.length) || (gate.kind === 'controlled' && !gate.controls.length)
  if (!oneWire) {
    throw new ParseError('only a gate on one wire can wait on a measurement — e.g. X 3 if M1', 0, line)
  }
  if (actedOn(gate).includes(given.qubit)) {
    throw new ParseError(`a gate cannot wait on its own wire — M${given.qubit} is the wire it is on`, 0, line)
  }
  return { ...gate, given }
}

/**
 * Every condition reads a wire measured in Z further up, and left alone since:
 * a wire that has been acted on again no longer holds what was read.
 */
function checkConditions(layers: Layer[]): void {
  /** Wires holding a Z measurement's result, nothing having touched them since. */
  const read = new Set<number>()
  for (const layer of layers) {
    for (const gate of layer.gates) {
      if (!gate.given) continue
      const q = gate.given.qubit
      if (!read.has(q)) {
        throw new ParseError(
          `wire ${q} has to be measured, in Z and above this, before anything can wait on it — e.g. M ${q}`,
          0,
          gate.line ?? 0,
        )
      }
    }
    for (const gate of layer.gates) {
      if (gate.kind === 'measure') {
        if (gate.basis === 'Z') read.add(gate.qubit)
        else read.delete(gate.qubit)
        continue
      }
      if (gate.kind === 'identity' || gate.kind === 'tag' || gate.kind === 'view') continue
      for (const q of actedOn(gate)) read.delete(q)
    }
  }
}

/**
 * Read `shift=`: how many columns a wire bends over, rightward if positive.
 *
 * Only a plain pipe can bend. Anything with a body would have to be drawn
 * somewhere along the turn, and there is no good place for it.
 */
function shifted(gate: Gate, value: string, line: number): Gate {
  if (gate.kind === 'identity' && gate.gap) {
    throw new ParseError('a blank is not drawn, so it cannot bend — write the bend as an I, e.g. I 3 shift=2', 0, line)
  }
  if (gate.kind !== 'identity') {
    throw new ParseError('only I bends a wire — write the bend as its own I, e.g. I 3 shift=2', 0, line)
  }
  if (gate.move?.to !== undefined) {
    throw new ParseError('a bend is either shift= or -> a position, not both', 0, line)
  }
  const by = Number(value)
  if (!value || !Number.isFinite(by)) {
    throw new ParseError('shift= takes a number of columns, e.g. shift=2 or shift=-1.5', 0, line)
  }
  return { ...gate, move: { by } }
}

/** True when two gates would overlap if placed in the same layer. */
/**
 * A view waiting to be calculated has no wires yet.
 *
 * It is given the whole register further down, once the width is known, so at
 * this point its span is empty and comparing it against anything says they do
 * not overlap — when in truth it is about to cover everything. Nothing may sit
 * beside it.
 */
const takesEveryWire = (gate: Gate): boolean =>
  (gate.kind === 'view' && !gate.qubits.length && (!!gate.calculate || !!gate.blank)) ||
  (gate.kind === 'tag' && !gate.qubits.length)

/**
 * A gate drawn wider than its own wires.
 *
 * It reaches over its neighbours' columns, so whatever stood on them in the
 * same layer would be drawn underneath it. A layer of its own is the one
 * arrangement where that cannot happen — the same rule a window keeps.
 */
const widened = (gate: Gate): boolean => (gate.width ?? 1) > 1

/** Gates on one line share a layer, so they must stay off each other's wires. */
function refuseOverlaps(
  gates: Gate[],
  lineNo: number,
  place: ReadonlyMap<number, number>,
  home?: (q: number) => number,
): void {
  for (let a = 0; a < gates.length; a++) {
    for (let b = a + 1; b < gates.length; b++) {
      if (conflicts(gates[a], gates[b], place, home)) {
        throw new ParseError(
          widened(gates[a]) || widened(gates[b])
            ? 'a gate made wider takes a layer to itself, so it cannot share one with ";"'
            : 'gates joined by ";" overlap and cannot share a layer',
          0,
          lineNo,
        )
      }
    }
  }
}

function conflicts(
  a: Gate,
  b: Gate,
  place: ReadonlyMap<number, number>,
  home?: (q: number) => number,
): boolean {
  if (takesEveryWire(a) || takesEveryWire(b) || widened(a) || widened(b)) return true
  // A wire on the move has a layer of its own to turn in — a snapshot there
  // would be taken halfway round the corner.
  if ((bendOf(a) && b.kind === 'view') || (bendOf(b) && a.kind === 'view')) return true
  const bs = new Set(coveredWires(b, place, home))
  return coveredWires(a, place, home).some((q) => bs.has(q))
}

interface Group {
  gates: Gate[]
  breakBefore: boolean
  /** Where the wires that have moved stood when this was written. */
  place?: ReadonlyMap<number, number>
  /** Where the rest stand: where they started. */
  home?: (q: number) => number
  caption?: string
  note?: string
  /** The source line it was written on, so a layer can say where it came from. */
  line: number
  /** The frames it was written inside, outermost first. */
  frames?: number[]
}

/**
 * Schedule groups into layers.
 *
 * A gate drops to the earliest layer at or after the last layer that touched
 * any qubit in its span — so gates pack tightly sideways but never float above
 * something they depend on. `---` pushes the floor down to the next free layer.
 */
function schedule(groups: Group[]): { layers: Layer[]; at: number[] } {
  const layers: Layer[] = []
  /** Which layer each group went into, before the empty ones are dropped. */
  const placed: number[] = []
  const frontier = new Map<number, number>()
  let floor = 0

  for (const group of groups) {
    if (group.breakBefore) floor = layers.length

    // Covered where the wires stand, not by number: after a bend, the wire
    // between two others may be one from the far side of the register.
    const place = group.place ?? new Map<number, number>()
    let target = floor
    for (const gate of group.gates) {
      for (const q of coveredWires(gate, place, group.home)) {
        target = Math.max(target, frontier.get(q) ?? floor)
      }
    }

    while (layers.length <= target) layers.push({ gates: [], lines: [] })
    placed.push(target)
    layers[target].gates.push(...group.gates)
    layers[target].lines.push(group.line)
    // Two groups can land in the same layer — `;` merges them and the packer
    // can too. The first to claim a side keeps it.
    if (group.caption && !layers[target].caption) layers[target].caption = group.caption
    if (group.note && !layers[target].note) layers[target].note = group.note

    for (const gate of group.gates) {
      for (const q of coveredWires(gate, place, group.home)) frontier.set(q, target + 1)
    }
  }

  // Every layer a group went into has its gates, so only layers nothing went
  // into are dropped — and the count of those below a group is how far it moves.
  const renumber: number[] = []
  let kept = 0
  for (const layer of layers) {
    renumber.push(kept)
    if (layer.gates.length) kept++
  }
  return { layers: layers.filter((l) => l.gates.length), at: placed.map((t) => renumber[t]) }
}


/* ------------------------------------------------------------- frames --- */

/** How a frame is drawn: what it says, and in what colours. */
interface FrameStyle {
  label?: string
  fill?: string
  border?: string
  /** Written `locked`; see `Frame.locked`. */
  locked?: boolean
  /** Written `on` or `off`; see `Frame.switch`. */
  switch?: Switch
}

/** Take the word `locked` out of a line's tokens, saying whether it was there. */
function takeLocked(tokens: { text: string; quoted?: boolean }[]): boolean {
  const at = tokens.findIndex((t) => !t.quoted && t.text.toLowerCase() === 'locked')
  if (at < 0) return false
  tokens.splice(at, 1)
  return true
}

/** A line that opens a frame ends with `{`; one that closes it is `}` alone. */
const OPENS = /\{\s*$/
const CLOSES = /^\}$/

/**
 * Read the line that opens a frame: `"Prep" 1-3 fill=#fef3c7 border=none {`.
 *
 * Everything is optional. The wires are only for taking in wires the gates
 * inside never touch, so a definition — written on its own wires — has none.
 */
function readFrameOpen(
  text: string,
  lineNo: number,
  allowWires: boolean,
): FrameStyle & { qubits?: [number, number]; collapsed: boolean } {
  const tokens = tokenize(text.replace(OPENS, ''), lineNo)
  const word = tokens.findIndex((t) => !t.quoted && t.text.toLowerCase() === 'collapsed')
  const collapsed = word >= 0
  if (collapsed) {
    if (!allowWires) {
      throw new ParseError('a definition is folded where it is used — write "collapsed" there', 0, lineNo)
    }
    tokens.splice(word, 1)
  }
  const locked = takeLocked(tokens)
  const on = takeSwitchToken(tokens, lineNo)
  if (on !== undefined && !allowWires) {
    throw new ParseError(
      `a definition is switched where it is used — write "${on ? 'on' : 'off'}" there`,
      0,
      lineNo,
    )
  }
  const fill = takeOption(tokens, 'fill', lineNo)
  const border = takeOption(tokens, 'border', lineNo)
  let label: string | undefined
  if (tokens[0]?.quoted) label = tokens.shift()!.text
  if (tokens.some((t) => t.quoted)) {
    throw new ParseError('a frame takes one label, written first', 0, lineNo)
  }
  let qubits: [number, number] | undefined
  if (tokens.length) {
    if (!allowWires) {
      throw new ParseError(
        `unexpected "${tokens[0].text}" — a definition is written on its own wires, 1 and up`,
        0,
        lineNo,
      )
    }
    const qs = parseQubits(tokens, lineNo)
    qubits = [Math.min(...qs), Math.max(...qs)]
  }
  return {
    label, fill, border, qubits, collapsed,
    ...(locked ? { locked } : {}),
    ...(on !== undefined ? { switch: { on, line: lineNo } } : {}),
  }
}

/**
 * Gates folded into one box: a definition used `collapsed`, or a frame written
 * that way. It does what they do, in order, so it can still be calculated
 * through; what it cannot do is measure, which would leave it no one result.
 */
function foldedBox(
  label: string,
  fill: string | undefined,
  body: Gate[],
  wires: [number, number] | undefined,
  at: number,
  where: string,
): Gate {
  if (!body.length) throw new ParseError(`${where} has nothing in it`, 0, at)
  if (body.some(bendOf)) {
    throw new ParseError(
      `${where} moves a wire, so it cannot be one box — leave out "collapsed" to draw its gates`,
      0,
      at,
    )
  }
  if (body.some((g) => g.kind === 'measure' || g.kind === 'view')) {
    throw new ParseError(
      `${where} measures or shows a state, so it cannot be one box — leave out "collapsed" to draw its gates`,
      0,
      at,
    )
  }
  const spans = body.map(gateSpan)
  const q0 = Math.min(...spans.map((sp) => sp[0]), wires?.[0] ?? Infinity)
  const q1 = Math.max(...spans.map((sp) => sp[1]), wires?.[1] ?? -Infinity)
  return {
    kind: 'box',
    label,
    qubits: Array.from({ length: q1 - q0 + 1 }, (_, i) => q0 + i),
    ...(fill !== undefined ? { fill } : {}),
    body,
    bound: true,
  }
}

/** A body written once with `def` and used by name. */
interface Definition {
  name: string
  style: FrameStyle
  /** The lines between the braces, with the line each was written on. */
  body: { text: string; line: number }[]
  line: number
}

const DEF = /^def\s+([A-Za-z_][\w]*)\b(.*)$/i

/**
 * Lift every `def name { … }` out of the source.
 *
 * Read before anything else, so a definition can be used above the place it
 * is written — where it goes in the text is about reading order, not about
 * time, which is what the circuit's own lines are about.
 */
function readDefinitions(lines: string[]): { defs: Map<string, Definition>; skip: Set<number> } {
  const defs = new Map<string, Definition>()
  const skip = new Set<number>()
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i].replace(/(^|\s)#.*$/, '').trim()
    const found = DEF.exec(head)
    if (!found) continue
    const lineNo = i + 1
    const name = found[1].toLowerCase()
    if (!OPENS.test(head)) {
      throw new ParseError(`def ${found[1]} needs a "{" to open its body`, 0, lineNo)
    }
    if (KEYWORDS.has(name) || isTurn(name) || isGateRun(name) || name === 'def') {
      throw new ParseError(`"${found[1]}" already means something — pick another name`, 0, lineNo)
    }
    if (defs.has(name)) {
      throw new ParseError(`${found[1]} is already defined on line ${defs.get(name)!.line}`, 0, lineNo)
    }
    const style = readFrameOpen(found[2], lineNo, false)
    style.label ??= found[1]
    skip.add(i)

    const body: Definition['body'] = []
    let depth = 1
    let j = i + 1
    for (; j < lines.length; j++) {
      const text = lines[j].replace(/(^|\s)#.*$/, '').trim()
      skip.add(j)
      if (DEF.test(text)) {
        throw new ParseError('a definition cannot hold another — write it outside', 0, j + 1)
      }
      if (CLOSES.test(text) && --depth === 0) break
      if (OPENS.test(text)) depth++
      if (text) body.push({ text, line: j + 1 })
    }
    if (j >= lines.length) throw new ParseError(`def ${found[1]} is never closed with "}"`, 0, lineNo)
    if (!body.length) throw new ParseError(`def ${found[1]} has nothing in it`, 0, lineNo)
    defs.set(name, { name: found[1], style, body, line: lineNo })
  }
  return { defs, skip }
}

/** A definition as something to pick up: what it is called and how wide it is. */
export interface DefinitionEntry {
  /** As written in the `def`. */
  name: string
  /** How many wires a use of it takes. */
  wires: number
  /** Every `def` block in the source, which is what drawing a use of it needs. */
  defs: string
}

/**
 * The definitions a source writes, each with the number of wires it takes.
 *
 * Read from the `def` blocks alone, so a mistake elsewhere — the circuit
 * half-typed — does not take them away. A definition that cannot be used on
 * its own (it uses itself, or holds a state) is left out.
 */
export function definitionsOf(source: string): DefinitionEntry[] {
  const lines = source.split('\n')
  let found: ReturnType<typeof readDefinitions>
  try {
    found = readDefinitions(lines)
  } catch {
    return []
  }
  const defs = lines.filter((_, i) => found.skip.has(i)).join('\n')
  const out: DefinitionEntry[] = []
  for (const def of found.defs.values()) {
    try {
      const use = parseCircuit(`${defs}\n${def.name}`).uses?.[0]
      if (use?.wires.length) out.push({ name: def.name, wires: use.wires.length, defs })
    } catch {
      // Not usable as it stands; nothing to offer.
    }
  }
  return out
}

/** A gate moved onto other wires: local wire `q` goes to `to(q)`. */
function mapGate(gate: Gate, to: (q: number) => number): Gate {
  if (gate.given) {
    const { given, ...rest } = gate
    return { ...mapGate(rest as Gate, to), given: { ...given, qubit: to(given.qubit) } }
  }
  switch (gate.kind) {
    case 'tag':
      return { ...gate, qubits: gate.qubits.map(to) }
    case 'identity': {
      // A position is not a wire, but it moves with one: written on wire 1 and
      // used on wire 3, `-> 2` is two columns along from where it was written.
      const qubit = to(gate.qubit)
      const at = gate.move?.to
      return at === undefined
        ? { ...gate, qubit }
        : { ...gate, qubit, move: { to: at + qubit - gate.qubit } }
    }
    case 'single':
      return {
        ...gate,
        qubit: to(gate.qubit),
        ...(gate.controls ? { controls: gate.controls.map(to) } : {}),
        ...(gate.open ? { open: gate.open.map(to) } : {}),
      }
    case 'measure':
      return { ...gate, qubit: to(gate.qubit) }
    // What a control acts on goes with its wire: left behind, an open ring
    // written on the definition's wire 3 would land on whichever of the
    // circuit's wires happens to be numbered 3.
    case 'controlled':
      return {
        ...gate,
        controls: gate.controls.map(to),
        target: to(gate.target),
        ...(gate.open ? { open: gate.open.map(to) } : {}),
      }
    case 'swap':
      return {
        ...gate,
        qubits: [to(gate.qubits[0]), to(gate.qubits[1])],
        ...(gate.controls ? { controls: gate.controls.map(to) } : {}),
        ...(gate.open ? { open: gate.open.map(to) } : {}),
      }
    case 'box':
      return {
        ...gate,
        qubits: gate.qubits.map(to),
        ...(gate.body ? { body: gate.body.map((g) => mapGate(g, to)) } : {}),
        ...(gate.controls ? { controls: gate.controls.map(to) } : {}),
        ...(gate.open ? { open: gate.open.map(to) } : {}),
      }
    case 'view':
      return { ...gate, qubits: gate.qubits.map(to) }
  }
}

export function parseCircuit(text: string): CircuitDoc {
  let declared = 0
  // Off by default: a circuit draws only what you ask for. Use `in <state>` for
  // a misty state above it, or `header on` for the bare qubit shapes.
  let header = false
  let coefficients: boolean | undefined
  let keepSign: boolean | undefined
  let shapePicks: ShapePick[] | undefined
  let input: StateRow | undefined
  let output: StateRow[] | undefined
  let animate: AnimationOptions | undefined
  let calculateInput = false
  let calculateInputCaption: string | undefined
  let calculateInputNote: string | undefined
  let answerInput = false
  let answerOutput = false
  /** Which line the input state was written on, for anything editing the text. */
  let inputLine: number | undefined
  /** The same for the output, worked out or written. */
  let outputLine: number | undefined
  let table: TableSpec | undefined
  let chart: ChartSpec | undefined
  let calculateOutput = false
  let calculateCaption: string | undefined
  let calculateNote: string | undefined
  const groups: Group[] = []
  let pendingBreak = false
  /**
   * Where the wires that have been bent stand now. Kept as the lines go by so
   * the packer can tell what a gate's box would cover; a new map for every
   * bend, so a group can hold on to the one it was written under.
   */
  let place: ReadonlyMap<number, number> = new Map()
  /** Written `wires`: where each wire starts, and so where an unmoved one is. */
  let wiresAt: number[] | undefined
  let wiresLine: number | undefined
  let home = homeOf()
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
  /** The line that pending view was written on, held with it. */
  let pendingTailLine = 0

  /** Frames opened so far, in the order they were opened; and those still open. */
  const drafts: (FrameStyle & {
    qubits?: [number, number]
    line: number
    parent?: number
    used: boolean
    fold?: number
    /** Written `collapsed`: what goes in is gathered into one box when it closes. */
    collapsed?: boolean
    /** How many groups there were when it opened, so a fold knows which are its own. */
    start: number
    /** Folded away, along with everything inside it. */
    dropped?: boolean
  })[] = []
  const frameStack: number[] = []

  /** Every group goes in through here, so it knows which frames it is inside. */
  const pushGroup = (group: Group) => {
    for (const id of frameStack) drafts[id].used = true
    if (frameStack.some((id) => drafts[id].switch?.on === false)) group = { ...group, gates: group.gates.map(darkened) }
    const placed = place.size || wiresAt ? { ...group, place, home } : group
    groups.push(frameStack.length ? { ...placed, frames: [...frameStack] } : placed)
  }

  /** A view takes a layer to itself: a snapshot sits between gates, not among them. */
  const pushView = (view: ViewGate, line: number) => {
    // Carrying the line it was written on, like every other gate does: that is
    // how one pointed at in the drawing is traced back to its text, and a view
    // written bare — a state line, or `calculate` by itself — is no different.
    // Without it such a view can be drawn but never moved or taken away again.
    pushGroup({ gates: [{ ...view, line }], breakBefore: true, line })
    pendingBreak = true
  }

  const pushGates = (gates: Gate[], line: number, caption?: string, note?: string) => {
    // A snapshot is a moment between gates, so a layer holding one is fenced
    // off at both ends: nothing packs into it, and nothing packs past it. A
    // gate made wider is fenced the same way — it reaches over its neighbours'
    // wires, and whatever packed in beside it would be drawn underneath.
    // A bend is fenced too: wires are moving, and a gate written after it is
    // meant for where they end up.
    const snapshot = gates.some((g) => g.kind === 'view' || widened(g) || bendOf(g))
    pushGroup({ gates, breakBefore: pendingBreak || snapshot, caption, note, line })
    pendingBreak = snapshot
    const bends = gates.map(bendOf).filter((g) => g !== null)
    if (bends.length) {
      const moved = new Map(place)
      for (const b of bends) moved.set(b.qubit, bendTarget(b, place.get(b.qubit) ?? home(b.qubit)))
      place = moved
    }
    if (gates.some((g) => g.kind !== 'view')) sawGate = true
  }

  /**
   * A frame is fenced like a snapshot: nothing outside packs into its layers,
   * and nothing inside floats up out of them. Otherwise a gate written after
   * the frame on another wire would slide up beside the gates in it, and be
   * drawn inside a box it was never written in.
   */
  const openFrame = (
    style: FrameStyle,
    qubits: [number, number] | undefined,
    line: number,
    fold?: number,
    collapsed?: boolean,
  ) => {
    flushTail()
    drafts.push({
      ...style, qubits, line, fold, collapsed,
      parent: frameStack[frameStack.length - 1], used: false, start: groups.length,
    })
    frameStack.push(drafts.length - 1)
    pendingBreak = true
  }

  const closeFrame = (line: number) => {
    flushTail()
    const open = frameStack[frameStack.length - 1]
    // Empty, but saying which wires it covers: a slot kept for something to be
    // put in — the error in an error-correcting code, dragged from wire to wire.
    // It holds its place with plain pipe, so the circuit round it does not close
    // up when it is emptied, and there is a layer there to drop into.
    if (open !== undefined && !drafts[open].used && drafts[open].qubits && !drafts[open].collapsed) {
      const [q0, q1] = drafts[open].qubits!
      const at = drafts[open].line
      const pipe: Gate[] = []
      for (let q = q0; q <= q1; q++) pipe.push({ kind: 'identity', qubit: q, line: at, bound: true })
      pushGates(pipe, at)
    }
    const id = frameStack.pop()
    if (id === undefined) throw new ParseError('this "}" closes nothing', 0, line)
    const d = drafts[id]
    if (!d.used) {
      throw new ParseError('this frame has nothing in it — name its wires, e.g. "Error" 1-3 {, to keep it as an empty slot', 0, d.line)
    }
    pendingBreak = true
    if (!d.collapsed) return

    // Everything written since it opened is its own — frames inside it too,
    // which were opened after it and so are later in the list.
    const taken = groups.splice(d.start)
    for (let k = id; k < drafts.length; k++) drafts[k].dropped = true
    const box = foldedBox(
      d.label ?? '', d.fill, taken.flatMap((g) => g.gates), d.qubits, d.line, 'this frame',
    )
    pushGates([{
      ...box, line: d.line,
      ...(d.fold !== undefined ? { fold: d.fold } : {}),
      ...(d.locked ? { locked: true } : {}),
      ...switchOf(d.switch),
    }], d.line)
    pendingBreak = true
  }

  /** Where a definition's gates go, so one walk serves drawing them and boxing them. */
  interface Sink {
    gates(gates: Gate[]): void
    /** `fold` is the line that would fold it, where there is one. */
    open(style: FrameStyle, qubits: [number, number] | undefined, fold?: number, collapsed?: boolean): void
    close(): void
    brk(): void
  }

  /** Uses written in the circuit itself, in the order they are read. */
  const uses: DefinitionUse[] = []

  /** The wires a definition is written on, worked out the first time it is used. */
  const widths = new Map<string, number>()
  const widthOf = (def: Definition, chain: string[]): number => {
    const key = def.name.toLowerCase()
    const known = widths.get(key)
    if (known !== undefined) return known
    let n = 0
    walk(def, (q) => q, 0, {
      gates: (gs) => { for (const g of gs) n = Math.max(n, gateSpan(g)[1]) },
      open: (_, qs) => { if (qs) n = Math.max(n, qs[1]) },
      close: () => {},
      brk: () => {},
    }, chain)
    widths.set(key, n)
    return n
  }

  /**
   * Read a definition's body onto the circuit's wires.
   *
   * Every gate is stamped with the line of the use rather than its own: that
   * is the line that put it in this circuit, and the one to point back at.
   */
  const walk = (def: Definition, to: (q: number) => number, line: number, sink: Sink, chain: string[]) => {
    const key = def.name.toLowerCase()
    if (chain.includes(key)) {
      throw new ParseError(`${def.name} uses itself, so it never ends`, 0, def.line)
    }
    const inside = [...chain, key]
    for (const { text, line: at } of def.body) {
      if (/^-{3,}$/.test(text)) { sink.brk(); continue }
      if (CLOSES.test(text)) { sink.close(); continue }
      if (OPENS.test(text)) {
        const f = readFrameOpen(text, at, true)
        const ends = f.qubits?.map(to)
        // Folded or not as written in the definition, for every use alike — so
        // no line here that a click could fold for this use alone.
        sink.open(f, ends && [Math.min(...ends), Math.max(...ends)] as [number, number], undefined, f.collapsed)
        continue
      }
      const word = text.split(/\s+/)[0]
      const inner = defOf(word)
      if (inner) {
        use(inner.def, text.slice(word.length), at, line, to, sink, inside, inner.count)
        continue
      }
      const gates = placeGates(splitStatements(text, at).map((p) => p.text), at, () => undefined)
      if (gates.some((g) => g.kind === 'view')) {
        throw new ParseError('a definition holds gates — a state goes outside it', 0, at)
      }
      refuseOverlaps(gates, at, new Map())
      sink.gates(gates.map((g) => ({ ...mapGate(g, to), line, bound: true })))
    }
  }

  /**
   * `oracle 2-3`, or `oracle 2-3 collapsed`.
   *
   * Its wires, in order, are where the definition's own 1, 2, … go; none at
   * all leaves them where they were written. Collapsed it is a single box that
   * still does what its gates do, so it can be calculated through.
   */
  const use = (
    def: Definition,
    arg: string,
    at: number,
    line: number,
    outer: (q: number) => number,
    sink: Sink,
    chain: string[],
    /** How many C's it was written with: `Coracle` is one control. */
    count = 0,
  ) => {
    const tokens = tokenize(arg, at)
    const word = tokens.findIndex((t) => !t.quoted && t.text.toLowerCase() === 'collapsed')
    const collapsed = word >= 0
    if (collapsed) tokens.splice(word, 1)
    // On the use, or on the definition for every use of it.
    const locked = takeLocked(tokens) || !!def.style.locked
    // Only ever on the use: each use is switched apart from the others.
    const on = takeSwitchToken(tokens, at)
    // A quoted name says what this use is for, in place of the definition's.
    const named = tokens.filter((t) => t.quoted)
    if (named.length > 1) throw new ParseError(`${def.name} takes one label`, 0, at)
    const style = {
      ...def.style,
      ...(named.length ? { label: named[0].text } : {}),
      ...(locked && !chain.length ? { locked } : {}),
      ...(on !== undefined ? { switch: { on, line: at } } : {}),
    }
    tokens.splice(0, tokens.length, ...tokens.filter((t) => !t.quoted))
    const n = widthOf(def, chain)
    const head = `${'C'.repeat(count)}${def.name}`
    // Its controls come first, on the circuit's wires as the rest are.
    let controls: number[] = []
    let open: number[] = []
    if (count) {
      if (!tokens.length) {
        throw new ParseError(
          `${head} needs ${count === 1 ? 'its control' : `its ${count} controls`} written first — e.g. ${head} ${Array.from({ length: count }, (_, i) => n + i + 1).join(' ')}`,
          0,
          at,
        )
      }
      const taken = takeControls(tokens, count, at, head)
      tokens.splice(0, tokens.length, ...taken.rest)
      controls = taken.controls.map(outer)
      open = taken.open.map(outer)
      if (new Set(controls).size !== controls.length) throw new ParseError(`${head} has the same control twice`, 0, at)
    }
    const written = tokens.length ? parseQubits(tokens, at) : null
    if (written && written.length !== n) {
      throw new ParseError(
        `${def.name} is written on ${n} wire${n === 1 ? '' : 's'}, so it needs ${n} here, not ${written.length}`,
        0,
        at,
      )
    }
    if (written && new Set(written).size !== written.length) {
      throw new ParseError(`${def.name} needs ${n} different wires`, 0, at)
    }
    const to = (q: number) => outer(written ? written[q - 1] : q)
    const wires = Array.from({ length: n }, (_, i) => to(i + 1))
    const clash = controls.find((c) => wires.includes(c))
    if (clash !== undefined) {
      throw new ParseError(`${head}: wire ${clash} cannot be a control and one of ${def.name}'s own`, 0, at)
    }
    // Only a use written in the circuit itself has a line of its own to fold;
    // one inside another definition is written once for all its uses.
    const fold = chain.length ? undefined : line
    if (!chain.length) {
      uses.push({
        line,
        name: def.name,
        wires,
        collapsed,
        ...(named.length ? { label: named[0].text } : {}),
        ...(locked ? { locked } : {}),
        ...(controls.length ? { controls } : {}),
        ...(open.length ? { open } : {}),
      })
      // Everything it draws answers to it, so any of it picks the use up.
      const inner = sink
      sink = { ...inner, gates: (gs) => inner.gates(gs.map((g) => ({ ...g, use: def.name }))) }
    }

    // Controlled, every gate it draws is controlled: a controlled U is its
    // gates each with the same controls. Each goes in on its own, since they
    // now share the control wires and no two of them can stand in one layer.
    if (controls.length && !collapsed) {
      const inner = sink
      sink = {
        ...inner,
        gates: (gs) => {
          const acting = gs.filter(acts)
          if (!acting.length) return inner.gates(gs)
          const still = gs.filter((g) => !acts(g))
          acting.forEach((g, i) => {
            const ruled = withControls(g, controls, open, at, head)
            inner.gates(i ? [ruled] : [ruled, ...still])
          })
        },
      }
    }

    if (!collapsed) {
      sink.open(style, undefined, fold)
      walk(def, to, line, sink, chain)
      sink.close()
      return
    }

    const body: Gate[] = []
    // Frames inside are not drawn in a box, but one switched off still turns
    // off what it holds.
    const dark: boolean[] = []
    walk(def, to, line, {
      gates: (gs) => body.push(...(dark.some(Boolean) ? gs.map(darkened) : gs)),
      open: (inner) => { dark.push(inner.switch?.on === false) },
      close: () => { dark.pop() },
      brk: () => {},
    }, chain)
    const folded = foldedBox(
      style.label ?? def.name, style.fill, body,
      [Math.min(...wires), Math.max(...wires)], at, def.name,
    )
    // Folded, it is one box across the wires it covers, so a control cannot
    // stand among them — drawn open, each gate keeps clear of it on its own.
    const [lo, hi] = [Math.min(...wires), Math.max(...wires)]
    const among = controls.find((c) => c > lo && c < hi)
    if (among !== undefined) {
      throw new ParseError(
        `${head}: folded, ${def.name} is one box across ${lo}-${hi}, so its control on wire ${among} would be inside it — leave out "collapsed", or move the control`,
        0,
        at,
      )
    }
    const box = controls.length ? withControls(folded, controls, open, at, head) : folded
    sink.gates([{
      ...box, line,
      ...(fold !== undefined ? { fold } : {}),
      ...(locked && !chain.length ? { locked } : {}),
      ...switchOf(style.switch),
    }])
  }

  /** The circuit itself, as somewhere a definition can be used. */
  const top: Sink = {
    gates: (gates) => pushGates(gates, gates[0]?.line ?? 0),
    open: (style, qubits, fold, collapsed) => openFrame(style, qubits, lastLine, fold, collapsed),
    close: () => closeFrame(lastLine),
    brk: () => { flushTail(); pendingBreak = true },
  }
  /** The line being read, for a frame a definition opens on the circuit's behalf. */
  let lastLine = 0

  const flushTail = () => {
    if (!pendingTail) return
    pushView(pendingTail, pendingTailLine)
    pendingTail = null
  }

  const lines = text.split('\n')
  const { defs, skip } = readDefinitions(lines)
  /** The definition a word uses, and how many controls it was written with. */
  const defOf = (word: string): { def: Definition; count: number } | undefined => {
    const w = word.toLowerCase()
    const exact = defs.get(w)
    if (exact) return { def: exact, count: 0 }
    for (let k = 1; k < w.length && w[k - 1] === 'c'; k++) {
      const found = defs.get(w.slice(k))
      if (found) return { def: found, count: k }
    }
    return undefined
  }
  // Where each line begins in `text`, so that a state written on one can say
  // where each of its qubits was — which is what lets one be clicked and
  // changed rather than only read.
  let lineStart = 0
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1
    const start = lineStart
    lineStart += lines[i].length + 1
    if (skip.has(i)) continue
    lastLine = lineNo

    const bare = lines[i].replace(/(^|\s)#.*$/, '')
    let line = bare.trim()
    if (!line) continue

    /**
     * Where a piece of this line sits in the whole document.
     *
     * By looking for it rather than by counting: a line is trimmed, stripped of
     * comments and stripped again of the annotations either side of it before
     * anything gets to read it, and arithmetic across all of that is arithmetic
     * nobody can check. The text itself survives every one of those steps, so
     * it is found. Scanning forward from the last hit keeps two identical
     * statements on one line apart.
     *
     * Undefined where it is not found — a statement rebuilt from tokens is not
     * in the line verbatim — and then nothing records a position at all, which
     * is the safe answer.
     */
    let scan = 0
    const placeOf = (part: string): number | undefined => {
      const found = part ? lines[i].indexOf(part, scan) : -1
      if (found < 0) return undefined
      scan = found + part.length
      return start + found
    }

    // A table or a chart is worked out from the whole circuit, so there is no
    // position after it for anything to occupy.
    if (table || chart) {
      const word = table ? 'tabulate' : 'chart'
      throw new ParseError(`${word} draws the finished circuit, so nothing can follow it`, 0, lineNo)
    }

    // `shape os^` says which shape each wire draws with, for figures whose
    // register is not in the default order.
    const shapeLine = SHAPE_LINE.exec(line)
    if (shapeLine) {
      shapePicks = readShapes(shapeLine[1], lineNo)
      continue
    }

    if (/^-{3,}$/.test(line)) { flushTail(); pendingBreak = true; continue }

    if (CLOSES.test(line)) { closeFrame(lineNo); continue }
    if (OPENS.test(line)) {
      const f = readFrameOpen(line, lineNo, true)
      openFrame(f, f.qubits, lineNo, lineNo, f.collapsed)
      continue
    }

    // `answer` marks what the question asks for. It is stripped before
    // anything else looks at the line, so what follows is read exactly as it
    // would be without it — and position still decides whether that is the
    // input, a view, or the output.
    const lifted = liftAnswer(line)
    const asked = lifted.asked
    line = lifted.line

    // A gate line may be annotated either side; a state line carries its own.
    const annotated = liftGateAnnotations(line)
    const body = annotated ? annotated.body : line

    const kw = body.split(/\s+/)[0].toLowerCase()
    const arg = body.slice(kw.length).trim()
    const parts = splitStatements(body, lineNo).map((p) => p.text)

    const named = parts.map((part) => defOf(part.trim().split(/\s+/)[0]))
    if (parts.length > 1 && named.some(Boolean)) {
      throw new ParseError(`${named.find(Boolean)!.def.name} takes a line of its own`, 0, lineNo)
    }
    const def = named[0]
    if (def) {
      flushTail()
      use(def.def, arg, lineNo, lineNo, (q) => q, top, [], def.count)
      continue
    }

    // A whole line that is nothing but a state takes its meaning from position.
    // Anything joined by ';' is a statement among others, so it skips this and
    // becomes a view like any other.
    if (parts.length === 1 && !KEYWORDS.has(kw) && !startsGate(kw)) {
      // A table is the finished thing rather than a state among states, so it
      // is read here but does not become a view.
      const bareTable = readTable(line, lineNo)
      if (bareTable) {
        // Only a table that is worked out needs something to work it out from.
        // One written by hand stands on its own — with no circuit above it at
        // all, if that is the whole figure.
        if (!bareTable.given && !sawGate && !input) {
          throw new ParseError(
            'tabulate is worked out from the input, so it cannot be the input',
            0,
            lineNo,
          )
        }
        flushTail()
        table = bareTable
        continue
      }

      const bareChart = readChart(line, lineNo)
      if (bareChart) {
        if (!sawGate && !input) {
          throw new ParseError(
            'chart is worked out from the input, so it cannot be the input',
            0,
            lineNo,
          )
        }
        flushTail()
        chart = bareChart
        continue
      }

      // `calculate 2-3` is `view 2-3 calculate`: the state of those wires,
      // bare. Never the input or the output — those are every wire.
      if (/^calc(ulate)?\s+\d+(-\d+)?\s*$/i.test(line)) {
        flushTail()
        pushView(parseView(line, lineNo, false), lineNo)
        continue
      }

      // A bare `calculate` is a state like any other — position says whether it
      // is a snapshot in the middle or the circuit's output.
      const bareCalc = readCalculate(line)
      if (bareCalc) {
        if (!sawGate && !input) {
          // Before any gate, a bare `calculate` is the input being asked for.
          calculateInput = true
          calculateInputCaption = bareCalc.caption
          calculateInputNote = bareCalc.note
          if (asked) answerInput = true
          continue
        }
        flushTail()
        pendingTailLine = lineNo
        pendingTail = {
          kind: 'view', qubits: [], calculate: true,
          caption: bareCalc.caption, note: bareCalc.note,
          answer: asked ? true : undefined,
        }
        continue
      }
      if (looksLikeGateName(line)) {
        throw new ParseError(`unknown gate "${line.split(/\s+/)[0]}"`, 0, lineNo)
      }
      refuseFrameOptions(line, lineNo)
      if (!sawGate && !input && !pendingTail) {
        input = parseState(line, placeOf(line)).rows[0]
        inputLine = lineNo
        if (asked) answerInput = true
      } else {
        flushTail()
        pendingTailLine = lineNo
        pendingTail = viewOf(line, [], lineNo, placeOf(line))
        if (asked) pendingTail.answer = true
      }
      continue
    }

    flushTail()

    if (kw === 'wires') {
      // Read before any gate, since where a gate's box reaches is worked out
      // as the lines go by, from where the wires are by then.
      if (groups.length) {
        throw new ParseError('wires says where the wires start, so it goes above the gates', 0, lineNo)
      }
      const at = arg.split(/[\s,]+/).filter(Boolean).map(Number)
      if (!at.length || at.some((p) => !Number.isFinite(p))) {
        throw new ParseError('wires takes where each wire starts, in columns — e.g. wires 1 4 5', 0, lineNo)
      }
      wiresAt = at
      wiresLine = lineNo
      home = homeOf(at)
      continue
    }
    if (kw === 'qubits') {
      const v = Number(arg)
      if (!Number.isInteger(v) || v < 1) throw new ParseError('qubits needs a positive integer', 0, lineNo)
      declared = v
      continue
    }
    if (kw === 'animate') {
      animate = readAnimation(arg, lineNo)
      continue
    }
    if (kw === 'coefficients') {
      const v = arg.toLowerCase()
      if (v !== 'on' && v !== 'off') {
        throw new ParseError('coefficients takes "on" (0|2*1) or "off" (0|1|1)', 0, lineNo)
      }
      coefficients = v === 'on'
      continue
    }
    if (kw === 'global') {
      const v = /^phase\s+(on|off)$/i.exec(arg)
      if (!v) {
        throw new ParseError(
          'global phase takes "on" (keep an overall minus sign or i) or "off" (tidy it away)',
          0,
          lineNo,
        )
      }
      keepSign = v[1].toLowerCase() === 'on'
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
      const outTable = readTable(arg, lineNo)
      if (outTable) {
        if (kw === 'in') {
          throw new ParseError(
            'tabulate is worked out from the input, so it cannot be the input',
            0,
            lineNo,
          )
        }
        table = outTable
        continue
      }
      const outChart = readChart(arg, lineNo)
      if (outChart) {
        if (kw === 'in') {
          throw new ParseError(
            'chart is worked out from the input, so it cannot be the input',
            0,
            lineNo,
          )
        }
        chart = outChart
        continue
      }
      const outCalc = readCalculate(arg)
      if (outCalc) {
        if (kw === 'in') {
          // Worked out from a state written further down: every gate here is
          // its own inverse, so a circuit reads backwards as well as forwards.
          calculateInput = true
          calculateInputCaption = outCalc.caption
          calculateInputNote = outCalc.note
          if (asked) answerInput = true
        } else {
          calculateOutput = true
          outputLine = lineNo
          calculateCaption = outCalc.caption
          calculateNote = outCalc.note
          if (asked) answerOutput = true
        }
        continue
      }
      const doc = parseState(arg, placeOf(arg))
      if (kw === 'in') {
        input = doc.rows[0]
        inputLine = lineNo
        if (asked) answerInput = true
      } else {
        output = [doc.rows[0]]
        outputLine = lineNo
        if (asked) answerOutput = true
      }
      continue
    }

    // Everything else is one or more statements; ';' pins them to a single
    // layer — which is how a view of some qubits sits beside a held identity,
    // or beside a view of the others.
    const gates = placeGates(parts, lineNo, placeOf)
    refuseOverlaps(gates, lineNo, place, home)
    pushGates(gates, lineNo, annotated?.caption, annotated?.note)
  }

  if (frameStack.length) {
    const open = drafts[frameStack[frameStack.length - 1]]
    throw new ParseError('this "{" is never closed with "}"', 0, open.line)
  }

  // Nothing followed the last bare state line, so it is the output.
  if (pendingTail) {
    if (output || calculateOutput) flushTail()
    else if (pendingTail.calculate) {
      calculateOutput = true
      outputLine = pendingTailLine
      calculateCaption = pendingTail.caption
      calculateNote = pendingTail.note
      if (pendingTail.answer) answerOutput = true
    }
    else {
      output = pendingTail.rows
      outputLine = pendingTailLine
      if (pendingTail.answer) answerOutput = true
    }
    pendingTail = null
  }

  const gates = groups.flatMap((g) => g.gates)
  // A view waiting to be calculated claims no wires of its own — it covers
  // whatever the register turns out to be, so it is filled in below rather than
  // counted here. Everything else sets the width, states included: `in 000`
  // over a single gate on wire 1 is still a three-qubit circuit.
  // An empty frame given no span is the same: it is room for the whole
  // register, whatever width that turns out to be.
  const pending = gates.filter(
    (g): g is ViewGate =>
      g.kind === 'view' && !g.qubits.length && (!!g.calculate || !!g.blank),
  )
  // A bare `tag` is the same: every wire, however many that is.
  const everyWire = gates.filter((g): g is TagGate => g.kind === 'tag' && !g.qubits.length)
  const used = gates
    .filter((g) => !pending.includes(g as ViewGate) && !everyWire.includes(g as TagGate))
    .flatMap((g) => gateSpan(g))
  const qubits = Math.max(
    declared,
    used.length ? Math.max(...used) : 0,
    stateWidth(input),
    wiresAt?.length ?? 0,
    rowsWidth(output),
    // A frame asked to take in wires nothing else touches still has them.
    ...drafts.map((d) => d.qubits?.[1] ?? 0),
    1,
  )
  for (const view of pending) {
    view.qubits = Array.from({ length: qubits }, (_, i) => i + 1)
  }
  for (const tag of everyWire) {
    tag.qubits = Array.from({ length: qubits }, (_, i) => i + 1)
  }

  const { layers, at } = schedule(groups)
  checkConditions(layers)
  try {
    planWires(qubits, layers, wiresAt, wiresLine)
  } catch (e) {
    if (e instanceof WireError) throw new ParseError(e.message, 0, e.line ?? 0)
    throw e
  }

  /*
   * What each frame covers, worked out now that the gates have layers. Inner
   * frames are later in the list, so going backwards settles every frame
   * before the one round it — which then takes in its wires as well, since an
   * inner frame given extra wires has to fit inside the outer one.
   */
  const frames: (Frame | undefined)[] = []
  const live = (k: number) => !drafts[k].dropped
  for (let id = drafts.length - 1; id >= 0; id--) {
    const d = drafts[id]
    if (d.dropped) continue
    const mine = groups.flatMap((g, i) => (g.frames?.includes(id) ? [i] : []))
    const spans = mine.flatMap((i) => groups[i].gates.map(gateSpan))
    for (let c = id + 1; c < drafts.length; c++) {
      if (drafts[c].parent === id && live(c)) spans.push(frames[c]!.qubits)
    }
    let q0 = Math.min(...spans.map((sp) => sp[0]))
    let q1 = Math.max(...spans.map((sp) => sp[1]))
    if (d.qubits) {
      if (q0 < d.qubits[0] || q1 > d.qubits[1]) {
        throw new ParseError(
          `something inside this frame is on a wire outside ${d.qubits[0]}-${d.qubits[1]}`,
          0,
          d.line,
        )
      }
      ;[q0, q1] = d.qubits
    }
    const inner = drafts.reduce(
      (most, c, k) => (c.parent === id && live(k) ? Math.max(most, frames[k]!.inner + 1) : most),
      0,
    )
    const ls = mine.map((i) => at[i])
    frames[id] = {
      ...(d.label !== undefined ? { label: d.label } : {}),
      ...(d.fill !== undefined ? { fill: d.fill } : {}),
      ...(d.border !== undefined ? { border: d.border } : {}),
      qubits: [q0, q1],
      layers: [Math.min(...ls), Math.max(...ls)],
      inner,
      ...(d.fold !== undefined ? { fold: d.fold } : {}),
      ...(d.locked ? { locked: true } : {}),
      ...(d.switch ? { switch: d.switch } : {}),
    }
  }
  const drawn = frames.filter((f): f is Frame => !!f)

  return {
    kind: 'circuit', qubits, layers, input, inputLine, output, outputLine,
    ...(drawn.length ? { frames: drawn } : {}),
    ...(wiresAt ? { start: wiresAt, startLine: wiresLine } : {}),
    ...(coefficients !== undefined ? { coefficients } : {}),
    ...(keepSign !== undefined ? { keepSign } : {}),
    calculateOutput, calculateCaption, calculateNote, table, chart, animate, header, shapePicks,
    calculateInput: calculateInput || undefined,
    calculateInputCaption,
    calculateInputNote,
    answerInput: answerInput || undefined,
    answerOutput: answerOutput || undefined,
    ...(uses.length ? { uses } : {}),
  }
}
