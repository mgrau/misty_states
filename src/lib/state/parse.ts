/**
 * Recursive-descent parser for the misty-state DSL.
 *
 * Grammar (whitespace insignificant, `#` starts a comment):
 *
 *   doc      := line*
 *   line     := [caption ':'] side ( relation side )* [':' note]
 *   relation := '=' | '!=' | '->'
 *   side     := termlist                     -- >1 term is implicitly one cloud
 *   termlist := term ( ('|' | ',') term )*
 *   term     := ['-' | '+'] [coeff] factor ( ['x'] factor )*
 *   coeff    := digits ( '*' | &'(' )        -- '3*0' or '3(0|1)'
 *   factor   := qubit | cloud | label
 *   qubit    := ('0' | '1' | '?') ['@' digits]
 *   cloud    := '(' termlist ')'
 *   label    := '"' text '"'
 *
 * `0|1` needs no outer parentheses: a bare top-level `|` wraps the line in a
 * cloud. `0(0|1)` is a bare qubit beside a cloud, and `(0|1)(0|1)` is a product
 * of two clouds.
 *
 * Factors juxtapose silently; `x` between them draws an explicit `×`, as in
 * `(0|1) x (0|1)`. `*` is not an alternative — it always introduces a
 * coefficient, so `3*0` stays 3·|0⟩.
 */

import type { CloudNode, Factor, Product, StateDoc, StateRow, Term } from './ast'
import { parseShapeSpec, SHAPE_LINE, SHAPE_SYMBOL_HELP, type ShapePick } from '../shapes'

export class ParseError extends Error {
  constructor(message: string, readonly index: number, readonly line: number) {
    super(message)
    this.name = 'ParseError'
  }
}

const RELATIONS: [string, string][] = [
  ['!=', '≠'],
  ['->', '→'],
  ['=', '='],
]

class Cursor {
  i = 0
  constructor(readonly src: string, readonly line: number) {}

  get done(): boolean {
    this.ws()
    return this.i >= this.src.length
  }

  /**
   * Skip whitespace and `.`.
   *
   * `.` is an optional factor separator, purely for legibility in a long run:
   * `0.0.1.1` reads the same as `0011`.
   */
  ws(): void {
    while (this.i < this.src.length && /[\s.]/.test(this.src[this.i])) this.i++
  }

  peek(): string {
    this.ws()
    return this.src[this.i] ?? ''
  }

  /** Look ahead without skipping whitespace first. */
  raw(offset = 0): string {
    return this.src[this.i + offset] ?? ''
  }

  eat(s: string): boolean {
    this.ws()
    if (this.src.startsWith(s, this.i)) {
      this.i += s.length
      return true
    }
    return false
  }

  fail(msg: string): never {
    throw new ParseError(msg, this.i, this.line)
  }
}

function parseDigits(c: Cursor): string {
  let out = ''
  while (/[0-9]/.test(c.raw())) {
    out += c.raw()
    c.i++
  }
  return out
}

function parseFactor(c: Cursor): Factor | null {
  const ch = c.peek()
  if (ch === '') return null

  if (ch === '(') {
    c.eat('(')
    const terms = parseTermList(c)
    if (!c.eat(')')) c.fail('unclosed "(" — every cloud needs a matching ")"')
    return { kind: 'cloud', terms }
  }

  if (ch === '"') {
    c.eat('"')
    let text = ''
    while (c.i < c.src.length && c.raw() !== '"') {
      text += c.raw()
      c.i++
    }
    if (!c.eat('"')) c.fail('unclosed string literal')
    return { kind: 'label', text }
  }

  // One `?` is one unknown qubit, so `0?1` and `??0` read as you would expect.
  // A cloud of unknown contents is written `("???")` — quoted text in a cloud,
  // which also allows any other caption inside one.
  if (ch === '?') {
    c.ws()
    c.i++
    return withShape(c, { kind: 'qubit', value: 'unknown' })
  }

  if (ch === '0' || ch === '1') {
    c.ws()
    c.i++
    return withShape(c, { kind: 'qubit', value: ch === '0' ? 0 : 1 })
  }

  return null
}

/** Optional `@N` suffix pinning a qubit to the Nth shape (1-based). */
function withShape(c: Cursor, node: Factor): Factor {
  if (node.kind !== 'qubit') return node
  if (c.raw() === '@') {
    c.i++
    const d = parseDigits(c)
    if (!d) c.fail('"@" must be followed by a shape number, e.g. 0@3')
    const idx = parseInt(d, 10)
    if (idx < 1) c.fail('shape numbers start at 1')
    node.shapeIndex = idx - 1
  }
  return node
}

function parseTerm(c: Cursor): Term {
  let sign: 1 | -1 = 1
  if (c.eat('-')) sign = -1
  else c.eat('+')

  let coeff: number | undefined
  c.ws()
  if (/[0-9]/.test(c.raw())) {
    // A digit run is a coefficient only when followed by `*` or `(`; otherwise
    // it is a sequence of qubits, so `00` stays two qubits and `3*0` is 3·|0⟩.
    const save = c.i
    const digits = parseDigits(c)
    if (c.raw() === '*') {
      c.i++
      coeff = parseInt(digits, 10)
    } else if (c.peek() === '(' && /[2-9]/.test(digits)) {
      // `3(0|1)` is 3·(|0⟩+|1⟩), but `0(0|1)` is a qubit beside a cloud — so a
      // digit run that could be qubits stays qubits. Use `1*(...)` to force it.
      coeff = parseInt(digits, 10)
    } else {
      c.i = save
    }
  }

  const factors: Factor[] = []
  for (;;) {
    const f = parseFactor(c)
    if (f) {
      factors.push(f)
      continue
    }
    // `x` between two factors is multiplication, drawn as `×`. Only *between*
    // them, so a trailing or doubled operator is caught below.
    const last = factors[factors.length - 1]
    if (last && last.kind !== 'op' && /[xX]/.test(c.peek())) {
      c.ws()
      c.i++
      factors.push({ kind: 'op', symbol: '×' })
      continue
    }
    // `*` belongs to a coefficient, and one was not found above.
    if (c.peek() === '*') {
      c.fail('"*" follows a number, as in 3*0 — write "x" to multiply two states')
    }
    break
  }

  if (!factors.length) {
    const ch = c.peek()
    if (ch) c.fail(`unexpected "${ch}" — expected a qubit (0, 1, ?) or a cloud "(...)"`)
    c.fail('expected a qubit or cloud here')
  }

  if (factors[factors.length - 1].kind === 'op') {
    c.fail('"×" needs something on both sides — e.g. (0|1) x (0|1)')
  }

  return { sign, coeff, factors }
}

/** `|` and `,` both separate terms; which one is *drawn* is a render setting. */
function parseTermList(c: Cursor): Term[] {
  const terms: Term[] = [parseTerm(c)]
  while (c.eat('|') || c.eat(',')) terms.push(parseTerm(c))
  return terms
}

/** A side is a term list; more than one term means the line is itself a cloud. */
function parseSide(c: Cursor): Product {
  const terms = parseTermList(c)
  if (terms.length === 1 && terms[0].sign === 1 && terms[0].coeff === undefined) {
    return { factors: terms[0].factors }
  }
  const cloud: CloudNode = { kind: 'cloud', terms }
  return { factors: [cloud] }
}

/**
 * Split a caption prefix like `50%:` from the state expression. Only treated as
 * a caption when the text before `:` contains something that cannot be state
 * syntax, so a stray colon never silently eats a real expression.
 */
function splitCaption(src: string): { caption?: string; rest: string } {
  const at = src.indexOf(':')
  if (at < 0) return { rest: src }
  const head = src.slice(0, at)
  if (/[(|,=]/.test(head)) return { rest: src }
  if (!/[^01?\s]/.test(head)) return { rest: src }
  return { caption: head.trim(), rest: src.slice(at + 1) }
}

function parseRow(src: string, lineNo: number): StateRow {
  const { caption, rest } = splitCaption(src)
  const c = new Cursor(rest, lineNo)

  const sides: Product[] = []
  const relations: string[] = []

  for (;;) {
    sides.push(parseSide(c))
    c.ws()
    const rel = RELATIONS.find(([tok]) => c.src.startsWith(tok, c.i))
    if (!rel) break
    c.i += rel[0].length
    relations.push(rel[1])
  }

  // A colon *after* the state is an annotation on the right, mirroring the one
  // before it. Unambiguous because nothing else in the grammar reaches here
  // with a colon pending — this used to be a parse error.
  let note: string | undefined
  if (c.peek() === ':') {
    c.i++
    note = c.src.slice(c.i).trim() || undefined
    c.i = c.src.length
  }

  if (!c.done) c.fail(`unexpected "${c.peek()}"`)
  if (caption) sides[0].caption = caption
  if (note) sides[0].note = note
  return { sides, relations }
}

export function parseState(text: string): StateDoc {
  const rows: StateRow[] = []
  let shapePicks: ShapePick[] | undefined
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/(^|\s)#.*$/, '').trim()
    if (!line) continue

    // The one thing in a state document that is not a state: which shape each
    // position draws with. It reads the same here as it does in a circuit.
    const shapeLine = SHAPE_LINE.exec(line)
    if (shapeLine) {
      const spec = parseShapeSpec(shapeLine[1])
      if (!spec) throw new ParseError('shape needs at least one symbol, e.g. shape os^', 0, i + 1)
      if (spec.bad !== undefined) {
        throw new ParseError(`"${spec.bad}" is not a shape — use ${SHAPE_SYMBOL_HELP}`, 0, i + 1)
      }
      shapePicks = spec.picks
      continue
    }

    // `answer` marks a row as what the question asks for; what follows reads
    // exactly as it would without it, caption and all.
    const ANSWER = /^answers?\s+(.*\S)\s*$/i
    const direct = ANSWER.exec(line)
    let asked = !!direct
    let text = direct ? direct[1] : line

    if (!direct) {
      const colon = line.indexOf(':')
      const inner = colon > 0 ? ANSWER.exec(line.slice(colon + 1).trim()) : null
      if (inner) {
        asked = true
        text = `${line.slice(0, colon)}: ${inner[1]}`
      }
    }

    const row = parseRow(text, i + 1)
    if (asked) row.answer = true
    rows.push(row)
  }
  if (!rows.length) throw new ParseError('nothing to draw', 0, 1)
  return { kind: 'state', rows, shapePicks }
}
