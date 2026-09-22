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
import type { ChartSpec, CircuitDoc, Gate, GateStyle, Layer, TableColumn, TableLine, TableSpec, ViewGate } from './ast'
import type { AnimationOptions } from './animate'
import { gateSpan } from './ast'

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
  'qubits', 'shape', 'shapes', 'header', 'labels', 'in', 'out', 'view', 'show', 'window',
  'animate',
  'i', 'id', 'identity', 'x', 'not', 'cnot', 'cx', 'toffoli', 'ccnot', 'ccx',
  'cz', 'swap', 'cswap', 'fredkin', 'measure', 'm', 'box', 'gate', 'blank',
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
  'i', 'id', 'identity', 'x', 'not', 'cnot', 'cx', 'toffoli', 'ccnot', 'ccx',
  'cz', 'swap', 'cswap', 'fredkin', 'measure', 'm', 'box', 'gate', 'blank',
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
  h: 1, pete: 1, x: 1, not: 1, y: 1, z: 1, s: 1, t: 1, i: 1, id: 1, identity: 1, m: 1, measure: 1,
  cnot: 2, cx: 2, cz: 2, swap: 2,
  toffoli: 3, ccnot: 3, ccx: 3, cswap: 3, fredkin: 3,
}

/** Does this word begin a gate — named, turned, run together, or glued to its wire? */
function startsGate(word: string): boolean {
  const w = word.toLowerCase()
  if (GATE_KEYWORDS.has(w) || isTurn(w) || isGateRun(w)) return true
  const glued = GLUED.exec(w)
  return !!glued && GATE_KEYWORDS.has(glued[1])
}

/** Split a word glued to its wires back apart: `H2` is `H 2`. */
export function unglue(src: string): string {
  const lead = src.length - src.trimStart().length
  const word = src.slice(lead).split(/\s/)[0]
  const glued = GLUED.exec(word)
  if (!glued || !GATE_KEYWORDS.has(glued[1].toLowerCase())) return src
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
  let open: { at: number; end: number; gate: boolean; measure: boolean; basis: boolean } | null = null
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
    const begins = !quoted && startsGate(word) && !isBasis && (!current || current.gate)

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
  const words = text.trim().split(/\s+/).filter((w) => !w.includes('='))
  if (words.some((w) => w.startsWith('"'))) return 0
  const head = words[0]?.toLowerCase() ?? ''
  const arity = ARITY[head] ?? (isTurn(head) ? 1 : 0)
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

  let qubits: number[] = []
  let from = 0
  if (tokens.length > 1 && RANGE.test(tokens[0])) {
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
  // `calculate` has no width of its own: it covers the register, whatever the
  // register turns out to be, so the span is filled in once that is known. Its
  // caption is held here too, there being no state yet to hang it on.
  const calc = readCalculate(stateText)
  if (calc) {
    if (qubits.length) {
      throw new ParseError(
        'calculate works out the whole register, so it takes no qubit range',
        0,
        lineNo,
      )
    }
    return { kind: 'view', qubits: [], calculate: true, caption: calc.caption, note: calc.note }
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
  const head = tokens[0].text.toUpperCase()
  const rest = tokens.slice(1)

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

  if (head === 'I' || head === 'ID' || head === 'IDENTITY') {
    noBox()
    // `I 2 0` is an identity that shows what the qubit holds — the same window
    // a view opens, on a wire where nothing is happening. That is what makes
    // "look at these, hold those" expressible alongside a partial view.
    if (rest.length > 1) {
      const qs = parseQubits([rest[0]], line)
      // Rebuilt from tokens rather than sliced, so there is no offset to report.
      return viewOf(rest.slice(1).map((t) => t.text).join(' '), qs, line)
    }
    return { kind: 'identity', qubit: oneQubit() }
  }

  // NOT is drawn as a bare ⊕ throughout the course materials, never as a
  // lettered box — so it is a controlled gate that happens to have no controls.
  if (head === 'X' || head === 'NOT') {
    return { kind: 'controlled', controls: [], target: oneQubit(), targetGlyph: 'not' }
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
    return { kind: 'single', label: turn[1].toUpperCase(), qubit: oneQubit(), angle, accent: fill }
  }

  if (head in SINGLE_GATES) {
    const spec = SINGLE_GATES[head]
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
    const arrow = rest.findIndex((t) => t.text === '->')
    const split = arrow < 0 ? rest.length - 1 : arrow
    const controls = parseQubits(rest.slice(0, Math.max(0, split)), line)
    const targets = parseQubits(rest.slice(arrow < 0 ? split : arrow + 1), line)
    if (!controls.length) throw new ParseError(`${head} needs at least one control`, 0, line)
    if (targets.length !== 1) throw new ParseError(`${head} needs exactly one target`, 0, line)
    return {
      kind: 'controlled',
      controls,
      target: targets[0],
      targetGlyph: front ? 'label' : 'not',
      label: front?.text ?? back?.text,
      labelOnLink: back && !front ? true : undefined,
    }
  }

  if (head === 'CZ') {
    noBox()
    const front = rest[0]?.quoted ? rest.shift() : undefined
    const back = rest[rest.length - 1]?.quoted ? rest.pop() : undefined
    const qs = parseQubits(rest, line)
    if (qs.length !== 2) throw new ParseError('CZ takes two qubits', 0, line)
    return {
      kind: 'controlled',
      controls: [qs[0]],
      target: qs[1],
      targetGlyph: front ? 'label' : 'z',
      label: front?.text ?? back?.text,
      labelOnLink: back && !front ? true : undefined,
    }
  }

  if (head === 'SWAP') {
    noBox()
    const qs = parseQubits(rest, line)
    if (qs.length !== 2) throw new ParseError('SWAP takes two qubits', 0, line)
    return { kind: 'swap', qubits: [qs[0], qs[1]] }
  }

  // Controlled SWAP — the Fredkin gate at one control. The two swapped wires
  // are the targets and everything before is a control, split on `->` the same
  // way CNOT is; without an arrow the last two wires are the pair, matching how
  // `SWAP 1 2` and `CNOT 1 2` already read their trailing wire.
  if (head === 'CSWAP' || head === 'FREDKIN') {
    noBox()
    const arrow = rest.findIndex((t) => t.text === '->')
    const split = arrow < 0 ? rest.length - 2 : arrow
    const controls = parseQubits(rest.slice(0, Math.max(0, split)), line)
    const targets = parseQubits(rest.slice(arrow < 0 ? split : arrow + 1), line)
    if (!controls.length) throw new ParseError(`${head} needs at least one control`, 0, line)
    if (targets.length !== 2) throw new ParseError(`${head} swaps exactly two qubits`, 0, line)
    return { kind: 'swap', qubits: [targets[0], targets[1]], controls }
  }

  if (head === 'MEASURE' || head === 'M') {
    // Trailing non-numeric token is the basis label, e.g. `measure 2 X`.
    let basis = 'Z'
    const last = rest[rest.length - 1]
    if (last && !last.quoted && /^[A-Za-z]+$/.test(last.text)) {
      basis = last.text.toUpperCase()
      rest.pop()
    }
    return { kind: 'measure', qubit: oneQubit(), basis, fill }
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
function parseStatements(src: string, line: number, base?: number): Gate[] {
  const token = src.trim()
  // Tagged in one place rather than at every `return` inside `parseGate`: what
  // a gate is stays that function's business, and where it was written is not.
  const from = (gates: Gate[]): Gate[] => gates.map((gate) => ({ ...gate, line }))

  if (/^[A-Za-z]+$/.test(token) && isGateRun(token)) {
    return from([...token.toUpperCase()].map((letter, i) => parseGate(`${letter} ${i + 1}`, line)))
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
  return parts.flatMap((text, i) => {
    const count = open[i]
    if (!count) return read[i]!
    // A gate over several wires is drawn across a run of them, so it wants
    // that many free in a row — the lowest such run.
    let first = 1
    while (Array.from({ length: count }, (_, k) => first + k).some((q) => taken.has(q))) first++
    for (let k = 0; k < count; k++) taken.add(first + k)
    return parseStatements(withWires(text, first, count), lineNo, undefined)
  })
}

/** One statement: a gate, a view, or a bare state that is therefore a view. */
function parseStatement(src: string, line: number, base?: number): Gate {
  // `H2` is `H 2`. Only a gate is ever glued: nothing else takes a wire, and
  // a view's state keeps its place in the line untouched.
  if (startsGate(src.trim().split(/\s+/)[0] ?? '')) src = unglue(src)
  const kw = src.split(/\s+/)[0].toLowerCase()
  if (kw === 'view' || kw === 'show' || kw === 'window') {
    const arg = src.slice(kw.length).trim()
    return parseView(arg, line, kw === 'window', offsetOf(src, arg, base))
  }
  if (KEYWORDS.has(kw) || isTurn(kw)) return parseSizedGate(src, line)
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
  const { text, found } = takeOptions(src, ['width', 'height'])
  const gate = parseGate(text, line)
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
  if (width !== undefined && gate.kind === 'identity') {
    throw new ParseError('I is a plain pipe, with no box to widen — height= gives it more room', 0, line)
  }
  return { ...gate, ...(width !== undefined ? { width } : {}), ...(height !== undefined ? { height } : {}) }
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
  gate.kind === 'view' && (!!gate.calculate || (!!gate.blank && !gate.qubits.length))

/**
 * A gate drawn wider than its own wires.
 *
 * It reaches over its neighbours' columns, so whatever stood on them in the
 * same layer would be drawn underneath it. A layer of its own is the one
 * arrangement where that cannot happen — the same rule a window keeps.
 */
const widened = (gate: Gate): boolean => (gate.width ?? 1) > 1

function conflicts(a: Gate, b: Gate): boolean {
  if (takesEveryWire(a) || takesEveryWire(b) || widened(a) || widened(b)) return true
  const [a0, a1] = gateSpan(a)
  const [b0, b1] = gateSpan(b)
  return a0 <= b1 && b0 <= a1
}

interface Group {
  gates: Gate[]
  breakBefore: boolean
  caption?: string
  note?: string
  /** The source line it was written on, so a layer can say where it came from. */
  line: number
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

    while (layers.length <= target) layers.push({ gates: [], lines: [] })
    layers[target].gates.push(...group.gates)
    layers[target].lines.push(group.line)
    // Two groups can land in the same layer — `;` merges them and the packer
    // can too. The first to claim a side keeps it.
    if (group.caption && !layers[target].caption) layers[target].caption = group.caption
    if (group.note && !layers[target].note) layers[target].note = group.note

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
  let table: TableSpec | undefined
  let chart: ChartSpec | undefined
  let calculateOutput = false
  let calculateCaption: string | undefined
  let calculateNote: string | undefined
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
  /** The line that pending view was written on, held with it. */
  let pendingTailLine = 0

  /** A view takes a layer to itself: a snapshot sits between gates, not among them. */
  const pushView = (view: ViewGate, line: number) => {
    // Carrying the line it was written on, like every other gate does: that is
    // how one pointed at in the drawing is traced back to its text, and a view
    // written bare — a state line, or `calculate` by itself — is no different.
    // Without it such a view can be drawn but never moved or taken away again.
    groups.push({ gates: [{ ...view, line }], breakBefore: true, line })
    pendingBreak = true
  }

  const flushTail = () => {
    if (!pendingTail) return
    pushView(pendingTail, pendingTailLine)
    pendingTail = null
  }

  const lines = text.split('\n')
  // Where each line begins in `text`, so that a state written on one can say
  // where each of its qubits was — which is what lets one be clicked and
  // changed rather than only read.
  let lineStart = 0
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1
    const start = lineStart
    lineStart += lines[i].length + 1

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
        if (asked) answerOutput = true
      }
      continue
    }

    // Everything else is one or more statements; ';' pins them to a single
    // layer — which is how a view of some qubits sits beside a held identity,
    // or beside a view of the others.
    const gates = placeGates(parts, lineNo, placeOf)
    for (let a = 0; a < gates.length; a++) {
      for (let b = a + 1; b < gates.length; b++) {
        if (conflicts(gates[a], gates[b])) {
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

    // A snapshot is a moment between gates, so a layer holding one is fenced
    // off at both ends: nothing packs into it, and nothing packs past it. A
    // gate made wider is fenced the same way — it reaches over its neighbours'
    // wires, and whatever packed in beside it would be drawn underneath.
    const snapshot = gates.some((g) => g.kind === 'view' || widened(g))
    groups.push({
      gates,
      breakBefore: pendingBreak || snapshot,
      caption: annotated?.caption,
      note: annotated?.note,
      line: lineNo,
    })
    pendingBreak = snapshot
    if (gates.some((g) => g.kind !== 'view')) sawGate = true
  }

  // Nothing followed the last bare state line, so it is the output.
  if (pendingTail) {
    if (output || calculateOutput) flushTail()
    else if (pendingTail.calculate) {
      calculateOutput = true
      calculateCaption = pendingTail.caption
      calculateNote = pendingTail.note
      if (pendingTail.answer) answerOutput = true
    }
    else {
      output = pendingTail.rows
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
      g.kind === 'view' && (!!g.calculate || (!!g.blank && !g.qubits.length)),
  )
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
    kind: 'circuit', qubits, layers, input, inputLine, output,
    calculateOutput, calculateCaption, calculateNote, table, chart, animate, header, shapePicks,
    calculateInput: calculateInput || undefined,
    calculateInputCaption,
    calculateInputNote,
    answerInput: answerInput || undefined,
    answerOutput: answerOutput || undefined,
  }
}
