/**
 * The two buttons in the corner of the drawing: Calculate and Animate.
 *
 * Both are edits to the source, written the way a person would type them, so
 * what the button did is there to read afterwards and ⌘Z takes it back like
 * any other change. Nothing here draws; the drawing follows the source.
 */

import { parseCircuit } from '../core/circuit/parse'
import type { CircuitDoc } from '../core/circuit/ast'

/** The circuit, as the renderer reads it — or null where it does not read. */
function readDoc(source: string): CircuitDoc | null {
  try {
    return parseCircuit(source)
  } catch {
    return null
  }
}

/** The statement a line holds, without its comment or surrounding space. */
function statement(line: string): string {
  // As the parser has it: a `#` starts a comment only after a space, so a
  // colour written `fill=#fef3c7` is not one.
  return line.replace(/(^|\s)#.*$/, '').trim()
}

/** Where the last line that says anything is, or -1 if none does. */
function lastStatementIndex(lines: string[]): number {
  for (let i = lines.length - 1; i >= 0; i--) if (statement(lines[i])) return i
  return -1
}

const CALCULATED = /^(?:(?:out|window)\s+)?calc(?:ulate)?$/

type Ending = { at: number; kind: 'calculated' | 'blank' | 'written' | 'none' }

/**
 * How the circuit ends: worked out already, a blank left for a student
 * (`out ??`), an output written in by hand (`out 01`), or nothing at all.
 *
 * Read the way the renderer reads it, since which line is the output is
 * decided by what follows it: `calculate` with `animate` after it, or a note
 * on it, still works out the end, and a bare state on the last line is the
 * output. Only a source that will not parse is read off its last line.
 */
function ending(lines: string[], doc: CircuitDoc | null): Ending {
  const last = lastStatementIndex(lines)
  if (!doc) {
    const text = last === -1 ? '' : statement(lines[last])
    if (CALCULATED.test(text)) return { at: last, kind: 'calculated' }
    if (/^out\b/.test(text)) return { at: last, kind: text.includes('?') ? 'blank' : 'written' }
    return { at: last, kind: 'none' }
  }
  if (doc.outputLine) {
    const at = doc.outputLine - 1
    if (doc.calculateOutput) return { at, kind: 'calculated' }
    return { at, kind: statement(lines[at]).includes('?') ? 'blank' : 'written' }
  }
  // A `calculate` with something after it is drawn as a last view rather than
  // the output, and works out the end all the same.
  const final = doc.layers[doc.layers.length - 1]
  const view = final?.gates.length === 1 ? final.gates[0] : undefined
  if (view?.kind === 'view' && view.calculate && view.line) {
    return { at: view.line - 1, kind: 'calculated' }
  }
  return { at: last, kind: 'none' }
}

/**
 * The circuit's input: given (which includes `in calculate`), partly or
 * wholly unknown (`in ??`, `in ?1`), or not written at all.
 *
 * With no input the renderer quietly starts every qubit white, so the circuit
 * calculates, but the drawing never shows what it started from. An unknown
 * qubit has nothing to calculate from at all. A state on the first line is the
 * input as surely as one written `in`.
 */
function input(lines: string[], doc: CircuitDoc | null): { at: number; kind: 'given' | 'unknown' | 'none' } {
  const written = lines.findIndex((line) => /^in\b/.test(statement(line)))
  const at = doc?.inputLine ? doc.inputLine - 1 : written
  if (doc?.calculateInput) return { at, kind: 'given' }
  if (at === -1) return { at, kind: 'none' }
  return { at, kind: statement(lines[at]).includes('?') ? 'unknown' : 'given' }
}

/** Lines that set the circuit up rather than say anything about it. */
const PREAMBLE = /^(?:shape|qubits|header)\b/

/**
 * How the circuit ends, as far as Calculate is concerned: worked out already
 * (pressing it again takes that away), written in by hand with the input
 * given (nothing for it to do), or neither.
 */
export function calculateDone(source: string): 'calculated' | 'written' | null {
  const lines = source.split('\n')
  const doc = readDoc(source)
  const end = ending(lines, doc).kind
  if (end === 'calculated') return end
  return end === 'written' && input(lines, doc).kind === 'given' ? end : null
}

/**
 * The source with its final state worked out, starting from an input that
 * says what it is.
 *
 * The input first. Where none is written, `in 00…0` goes in at the top,
 * after any lines that set the circuit up: the renderer was starting from
 * white anyway, and now the drawing says so. Where the input has unknown
 * qubits, each `?` becomes a white `0` and every qubit that was given keeps
 * its colour. The exception is a circuit whose output is written in by hand
 * — a "what input gives this?" question. Starting that from white would draw
 * an answer the written output contradicts, so its input becomes
 * `in calculate` instead, which runs the circuit backwards from the output.
 *
 * Then the end. Ordinarily that is a `calculate` on a line of its own. A
 * blank output (`out ??`) becomes `out calculate`, since a `calculate` after
 * it would draw the answer above the question marks. An output written in by
 * hand is left as it is.
 *
 * Pressed when the end is already worked out, it takes that `calculate` away
 * again — wherever it is, so long as it is what works out the end — and
 * leaves the input as it is.
 */
export function withCalculate(source: string, qubits = 1): string {
  const lines = source.split('\n')
  const doc = readDoc(source)
  const end = ending(lines, doc)

  // Already worked out: the button is a toggle, and this takes it away. An
  // `out calculate` goes back to the blank it was made from.
  if (end.kind === 'calculated') {
    if (/^out\b/.test(statement(lines[end.at]))) {
      lines[end.at] = `${indentOf(lines[end.at])}out ${'?'.repeat(Math.max(1, qubits))}`
      return lines.join('\n')
    }
    lines.splice(end.at, 1)
    return lines.join('\n').replace(/\s+$/, '')
  }

  const given = input(lines, doc)

  if (given.kind !== 'given') {
    if (end.kind === 'written') {
      const line = 'in calculate'
      if (given.kind === 'none') lines.splice(firstAfterPreamble(lines), 0, line)
      else lines[given.at] = indentOf(lines[given.at]) + line
      return lines.join('\n')
    }
    if (given.kind === 'none') {
      lines.splice(firstAfterPreamble(lines), 0, `in ${'0'.repeat(Math.max(1, qubits))}`)
    } else {
      // Only the statement: a `?` in a trailing comment is not a qubit.
      const line = lines[given.at]
      const hash = line.search(/(^|\s)#/)
      const body = hash === -1 ? line : line.slice(0, hash)
      lines[given.at] = body.replace(/\?/g, '0') + (hash === -1 ? '' : line.slice(hash))
    }
  }

  // The input may have moved the ending down a line; find it again.
  const after = ending(lines, given.kind === 'given' ? doc : readDoc(lines.join('\n')))
  if (after.kind === 'blank') {
    // Written `out`, so that pressing again puts the blank back.
    lines[after.at] = `${indentOf(lines[after.at])}out calculate`
    return lines.join('\n')
  }
  if (after.kind === 'none') return `${lines.join('\n').replace(/\s+$/, '')}\ncalculate`
  return lines.join('\n')
}

function indentOf(line: string): string {
  return line.match(/^\s*/)![0]
}

/** Where a new first statement goes: after comments and set-up lines. */
function firstAfterPreamble(lines: string[]): number {
  let i = 0
  while (i < lines.length && (!statement(lines[i]) || PREAMBLE.test(statement(lines[i])))) i++
  return i
}

const ANIMATE = /^animate$/

/** Whether the source asks to be animated. */
export function isAnimated(source: string): boolean {
  return source.split('\n').some((line) => ANIMATE.test(statement(line)))
}

/** The source with `animate` added at the end, or taken out if it is there. */
export function toggleAnimate(source: string): string {
  if (!isAnimated(source)) return `${source.replace(/\s+$/, '')}\nanimate`
  return source
    .split('\n')
    .filter((line) => !ANIMATE.test(statement(line)))
    .join('\n')
    .replace(/\s+$/, '')
}
