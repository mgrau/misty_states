/**
 * The notation, as the source box reads it: colour, indentation, folding,
 * comments.
 *
 * A stream tokenizer rather than a grammar. The real parser lives in
 * `src/core` and is the only authority on what a line means; this one only has
 * to be right about how a line *looks*, line by line and as you type, including
 * while it is half-written and the real parser would refuse it.
 *
 * The one rule taken from the parser exactly is the one it takes too: a line
 * means what its first word says. So a gate is coloured where it heads a line,
 * and `x` in `(0|1) x (0|1)` is left alone.
 */

import { StreamLanguage, foldService, type StringStream } from '@codemirror/language'
import { Tag, tags as t, tagHighlighter } from '@lezer/highlight'
import type { Palette } from '../../core/render/theme'

/**
 * Every gate word, by the colour it is drawn in.
 *
 * The keys name a slot in the palette rather than a colour, so the editor and
 * the drawing are painted from the same place — change the accent and the
 * `CNOT` in the text changes with the one in the picture.
 */
export type GateColour = 'H' | 'Z' | 'S' | 'T' | 'Y' | 'P' | 'RX' | 'RY' | 'RZ' | 'accent' | 'measure' | 'plain'

const GATE_WORDS: Record<string, GateColour> = {
  H: 'H', PETE: 'H',
  Z: 'Z', S: 'S', T: 'T', Y: 'Y',
  // Everything tied together by a link is drawn in the accent: the dots, the
  // ⊕, the crosses of a swap, a named gate's chip.
  X: 'accent', NOT: 'accent',
  CNOT: 'accent', CX: 'accent', TOFFOLI: 'accent', CCNOT: 'accent', CCX: 'accent',
  CZ: 'accent', CCZ: 'accent',
  SWAP: 'accent', CSWAP: 'accent', FREDKIN: 'accent',
  GATE: 'accent', CGATE: 'accent',
  M: 'measure', MEASURE: 'measure',
  I: 'plain', ID: 'plain', IDENTITY: 'plain', _: 'plain', BOX: 'plain', BLANK: 'plain',
}

/** `RZ(45)`, `P(-90)` — the keyword and its angle are one word. */
const TURN = /^(rx|ry|rz|p)(\(\s*-?[\d.]*\s*\)?)?/i

/** The letters a run like `HZT` is made of — one gate per wire. */
const RUN_LETTERS = /^[hxyzsti]{2,}(?![\w(])/i

/** Words that head a line without being a gate. */
const DIRECTIVES = new Set([
  'qubits', 'wires', 'shape', 'shapes', 'header', 'labels', 'coefficients', 'global', 'in', 'out',
  'view', 'show', 'window', 'animate', 'tag', 'def', 'calculate', 'answer', 'answers',
  'tabulate', 'chart', 'rule',
])

/** Words that mean something part-way along a line. */
const MODIFIERS = new Set(['if', 'collapsed', 'on', 'off'])

/** The colour a line-heading word is drawn in, if it is a gate. */
export function gateColour(word: string): GateColour | undefined {
  const turn = TURN.exec(word)
  if (turn && turn[0].length === word.length) {
    const k = turn[1].toUpperCase()
    return k as GateColour
  }
  return GATE_WORDS[word.toUpperCase()]
}

/* -- Tags ------------------------------------------------------------------ */

const GATE_COLOURS: GateColour[] = ['H', 'Z', 'S', 'T', 'Y', 'P', 'RX', 'RY', 'RZ', 'accent', 'measure', 'plain']

/** One tag per gate colour, so the highlighter can tell an H from a T. */
const gateTags = Object.fromEntries(GATE_COLOURS.map((c) => [c, Tag.define()])) as Record<GateColour, Tag>

const caption = Tag.define()
const defName = Tag.define()
const defUse = Tag.define()

const tokenTable: Record<string, Tag> = {
  caption,
  'def-name': defName,
  'def-use': defUse,
  ...Object.fromEntries(GATE_COLOURS.map((c) => [`gate-${c}`, gateTags[c]])),
}

/**
 * Class names rather than inline styles: the colours are CSS variables set from
 * the palette by the editor, so a change of accent repaints without rebuilding
 * the editor's extensions.
 */
export const mistyHighlighter = tagHighlighter([
  ...GATE_COLOURS.map((c) => ({ tag: gateTags[c], class: `ms-gate ms-gate-${c}` })),
  { tag: t.keyword, class: 'ms-keyword' },
  { tag: t.modifier, class: 'ms-modifier' },
  { tag: defName, class: 'ms-def' },
  { tag: defUse, class: 'ms-def-use' },
  { tag: t.string, class: 'ms-string' },
  { tag: t.number, class: 'ms-number' },
  { tag: t.lineComment, class: 'ms-comment' },
  { tag: caption, class: 'ms-caption' },
  { tag: t.attributeName, class: 'ms-attr' },
  { tag: t.attributeValue, class: 'ms-value' },
  { tag: t.operator, class: 'ms-op' },
  { tag: [t.brace, t.paren], class: 'ms-bracket' },
])

/** The CSS variables `mistyHighlighter`'s classes read, from a palette. */
export function gateColourVars(pal: Palette): string {
  const chip = (k: string, fallback: string) => pal.gateChip[k] ?? fallback
  const vars: Record<GateColour, string> = {
    H: chip('H', pal.hadamard),
    Z: chip('Z', pal.accent),
    S: chip('S', pal.accent),
    T: chip('T', pal.accent),
    Y: chip('Y', pal.accent),
    P: chip('P', pal.accent),
    RX: chip('RX', pal.accent),
    RY: chip('RY', pal.accent),
    RZ: chip('RZ', pal.accent),
    accent: pal.accent,
    // The measure box's own grey is too pale to read as text on white.
    measure: pal.muted,
    plain: pal.pipeEdge,
  }
  return GATE_COLOURS.map((c) => `--ms-gate-${c}: ${vars[c]}`).join('; ')
}

/* -- The tokenizer --------------------------------------------------------- */

interface LineState {
  /** Nothing but indentation read yet on this line: the next word heads it. */
  head: boolean
  /** The word after `def` is the name it defines. */
  naming: boolean
  /** Letters left in a run like `HZT`, each coloured as its own gate. */
  run: number
  /** Columns up to which the line is a caption (`after H: 000|111`). */
  captionTo: number
  /** Column from which the line is a caption (`000|111 : note`). */
  captionFrom: number
  /** How many `{` are open, for indentation. */
  depth: number
  /** The `=` of an option was just read: what follows is its value. */
  value: boolean
  /** Names given by `def`, so a use of one reads as more than a stray word. */
  defs: Set<string>
}

/** Where a colon falls on the line outside quotes and comments, or -1. */
function colonAt(line: string): number {
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') quoted = !quoted
    else if (quoted) continue
    else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return -1
    else if (c === ':') return i
  }
  return -1
}

const isHeadWord = (word: string) =>
  !!gateColour(word) || RUN_LETTERS.test(word) || DIRECTIVES.has(word.toLowerCase())

function startLine(stream: StringStream, state: LineState) {
  state.head = true
  state.naming = false
  state.value = false
  state.run = 0
  state.captionTo = -1
  state.captionFrom = -1
  const line = stream.string
  const colon = colonAt(line)
  if (colon < 0) return
  const first = /^\s*([^\s:"]+)/.exec(line)?.[1] ?? ''
  // A caption leads unless the line opens with something that would make
  // it a gate or a directive; then whatever follows the colon is the note.
  if (first && !isHeadWord(first)) state.captionTo = colon
  else state.captionFrom = colon + 1
}

function token(stream: StringStream, state: LineState): string | null {
  if (stream.sol()) startLine(stream, state)
  if (stream.eatSpace()) return null

  // A comment: `#` at the start of a word. `fill=#e6f0e6` is a colour, and is
  // read as a whole below before its `#` could be mistaken for one.
  if (state.value) {
    state.value = false
    if (stream.match(/^[^\s{}]+/)) return 'attributeValue'
  }

  if (stream.peek() === '#') {
    stream.skipToEnd()
    return 'lineComment'
  }

  if (state.captionTo >= 0 && stream.pos < state.captionTo) {
    stream.pos = state.captionTo
    return 'caption'
  }
  if (state.captionTo >= 0 && stream.pos === state.captionTo) {
    stream.next()
    state.captionTo = -1
    // What follows the caption heads the line as if the caption were not there.
    state.head = true
    return 'operator'
  }
  if (state.captionFrom >= 0 && stream.pos >= state.captionFrom - 1) {
    if (stream.pos === state.captionFrom - 1) {
      stream.next()
      return 'operator'
    }
    // Up to a comment, if there is one.
    const rest = stream.string.slice(stream.pos)
    const hash = rest.search(/\s#/)
    stream.pos = hash < 0 ? stream.string.length : stream.pos + hash
    return 'caption'
  }

  // Only the very first token can head the line: after `(0|1)`, an `x` is a
  // product sign, not a NOT gate.
  const atHead = state.head
  state.head = false

  if (state.run > 0) {
    const letter = stream.next()!
    state.run--
    return `gate-${gateColour(letter)}`
  }

  if (stream.match(/^"[^"]*"?/)) return 'string'

  if (stream.eat('{')) {
    state.depth++
    return 'brace'
  }
  if (stream.eat('}')) {
    state.depth = Math.max(0, state.depth - 1)
    return 'brace'
  }

  if (atHead) {
    const run = stream.match(RUN_LETTERS, false) as RegExpMatchArray | null
    if (run && !GATE_WORDS[run[0].toUpperCase()] && !DIRECTIVES.has(run[0].toLowerCase())) {
      state.run = run[0].length - 1
      return `gate-${gateColour(stream.next()!)}`
    }
    const word = stream.match(/^(?:[A-Za-z_][\w]*(?:\([^)\s]*\)?)?)/) as RegExpMatchArray | null
    if (word) {
      const w = word[0]
      const colour = gateColour(w)
      if (colour) return `gate-${colour}`
      const lower = w.toLowerCase()
      if (lower === 'def') {
        state.naming = true
        return 'keyword'
      }
      if (DIRECTIVES.has(lower)) return 'keyword'
      if (state.defs.has(w)) return 'def-use'
      return null
    }
  }

  if (state.naming) {
    state.naming = false
    const name = stream.match(/^[^\s{"#]+/) as RegExpMatchArray | null
    if (name) {
      state.defs.add(name[0])
      return 'def-name'
    }
  }

  // `fill=#e6f0e6`, `shift=2`, `loop=on`.
  if (stream.match(/^[A-Za-z]+(?==)/)) return 'attributeName'
  if (stream.eat('=')) {
    state.value = true
    return 'operator'
  }

  if (stream.match('->') || stream.match('---')) return 'operator'
  if (stream.match(/^\d+(\.\d+)?%?/)) return 'number'

  const word = stream.match(/^[A-Za-z_]\w*/) as RegExpMatchArray | null
  if (word) {
    const w = word[0]
    if (MODIFIERS.has(w.toLowerCase())) return 'modifier'
    // `X 3 if M1`: the measurement being waited on.
    if (/^m\d+$/i.test(w)) return 'gate-measure'
    if (state.defs.has(w)) return 'def-use'
    return null
  }

  const c = stream.next()!
  if (c === '(' || c === ')') return 'paren'
  // `H 1; H 2`: two gates in one layer, and the second heads its own.
  if (c === ';') {
    state.head = true
    return 'operator'
  }
  if ('|,*-@?x'.includes(c)) return 'operator'
  return null
}

export const mistyLanguage = StreamLanguage.define<LineState>({
  name: 'misty',
  startState: () => ({
    head: true, naming: false, value: false, run: 0, captionTo: -1, captionFrom: -1, depth: 0, defs: new Set(),
  }),
  copyState: (s) => ({ ...s, defs: new Set(s.defs) }),
  token,
  indent(state, textAfter, cx) {
    const depth = state.depth - (/^\s*\}/.test(textAfter) ? 1 : 0)
    return Math.max(0, depth) * cx.unit
  },
  languageData: {
    commentTokens: { line: '#' },
    indentOnInput: /^\s*\}$/,
    closeBrackets: { brackets: ['(', '{', '"'] },
  },
  tokenTable,
})

/* -- Folding --------------------------------------------------------------- */

/** A line with its comment taken off, quotes left whole. */
function code(line: string): string {
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') quoted = !quoted
    else if (!quoted && c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i)
  }
  return line
}

/** How far a line moves the brace count: `{` up, `}` down, outside quotes. */
function braces(line: string): { open: number; close: number } {
  let open = 0
  let close = 0
  let quoted = false
  for (const c of code(line)) {
    if (c === '"') quoted = !quoted
    else if (quoted) continue
    else if (c === '{') open++
    else if (c === '}') {
      if (open) open--
      else close++
    }
  }
  return { open, close }
}

/**
 * A frame or a definition folds from its `{` to its `}`.
 *
 * Found by counting rather than by the tokenizer, so it works the same on a
 * block the highlighter has not reached yet.
 */
export const braceFolding = foldService.of((state, lineStart, lineEnd) => {
  const text = state.doc.sliceString(lineStart, lineEnd)
  const head = code(text).trimEnd()
  if (!head.endsWith('{') || braces(text).open === 0) return null
  const from = lineStart + head.length
  let depth = braces(text).open
  for (let n = state.doc.lineAt(lineEnd).number + 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n)
    const { open, close } = braces(line.text)
    // A closing brace on its own line ends the block at the brace itself,
    // so the fold reads `{…}` with the `}` still in place.
    if (close >= depth) {
      const brace = line.from + line.text.indexOf('}')
      return brace > from + 1 ? { from, to: brace } : null
    }
    depth += open - close
  }
  return null
})
