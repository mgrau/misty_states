/**
 * Telling a circuit from a bare state, by reading the source.
 *
 * On its own so that anything needing only this — the Bloch sphere's path,
 * say — does not pull in the renderer with it.
 */

import { isGateRun } from './circuit/parse'

const CIRCUIT_KEYWORDS = new Set([
  'qubits', 'in', 'out', 'view', 'show', 'window', 'header', 'labels',
  'h', 'x', 'y', 'z', 's', 't', 'i', 'id', 'identity', 'pete', 'not',
  'cnot', 'cx', 'cz', 'toffoli', 'ccnot', 'ccx', 'swap',
  'measure', 'm', 'box', 'gate', 'blank', 'tabulate', 'table', 'chart', 'plot', 'amplitude', 'amplitudes',
  'probability', 'probabilities', 'animate', 'answer', 'def',
])

/**
 * A word that only a circuit would begin a line with.
 *
 * It can carry its brackets with it — `tabulate(p, a)`, `chart(p)` — and no
 * state begins with a letter, so the word before one is enough.
 */
const isKeyword = (word: string): boolean =>
  CIRCUIT_KEYWORDS.has(word) ||
  CIRCUIT_KEYWORDS.has(word.split('(')[0]) ||
  // And glued to its wire — `H2`, `CNOT1`. A state's digits have no letters
  // in front of them to be a keyword.
  CIRCUIT_KEYWORDS.has(word.replace(/\d+(-\d+)?$/, ''))

/**
 * Guess whether the source describes a circuit or a bare state.
 *
 * A cheap first pass: a captioned state like `measure : 00|11` will be guessed
 * wrong, which `render` then corrects by falling back to the other parser.
 */
export function detectMode(source: string): 'state' | 'circuit' {
  for (const raw of source.split('\n')) {
    const line = raw.replace(/(^|\s)#.*$/, '').trim()
    if (!line) continue
    if (/^-{3,}$/.test(line)) return 'circuit'
    // A frame round some gates: a state never opens or closes a brace.
    if (/\{$/.test(line) || line === '}') return 'circuit'
    const first = line.split(/[\s;]+/)[0].toLowerCase()
    if (isKeyword(first)) return 'circuit'
    // A caption can stand in front of anything — `Lab data: tabulate 0 = 48%`
    // — so the word after one counts as much as the first. A state's caption
    // is followed by a state, and no state begins with a letter.
    const colon = line.indexOf(':')
    if (colon > 0 && isKeyword(line.slice(colon + 1).trim().split(/[\s;]+/)[0].toLowerCase())) {
      return 'circuit'
    }
    // `RZ(45)` is one word, and a bracket is the last thing a state can start with.
    if (/^(rx|ry|rz|p)\(\s*-?[\d.]+\s*\)$/.test(first)) return 'circuit'
    // `HH` is a row of gates, not a keyword and not anything a state could be.
    if (/^[a-z]+$/.test(first) && isGateRun(first)) return 'circuit'
  }
  return 'state'
}
