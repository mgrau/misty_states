/**
 * A window onto some of the wires: `window 2-3 calculate`.
 *
 * Some wires have a state of their own only when they are not entangled with
 * the rest, so the properties worth holding are that a separable part is shown
 * as itself, that outcomes which leave it differently are listed with their
 * odds, and that an entangled part is refused rather than drawn wrongly.
 */

import { describe, expect, it } from 'vitest'
import { parseCircuit } from './parse'
import { resolveCalculations } from './simulate'
import type { ViewGate } from './ast'

/** The rows a calculated window shows, as the bits of each term, per row. */
const shown = (src: string): string[][] => {
  const doc = resolveCalculations(parseCircuit(src))
  const view = doc.layers.flatMap((l) => l.gates).find((g): g is ViewGate => g.kind === 'view' && !!g.calculate)!
  return view.rows!.map((row) => {
    const bits = (f: any): string[] =>
      f.kind === 'qubit' ? [String(f.value)] : f.terms.map((t: any) => t.factors.flatMap(bits).join(''))
    return row.sides[0].factors.flatMap(bits)
  })
}

describe('writing it', () => {
  it('takes its wires before or after calculate, framed or bare', () => {
    for (const line of ['window 2-3 calculate', 'window calculate 2-3', 'view 2-3 calculate', 'calculate 2-3']) {
      const doc = parseCircuit(`in 000\nH 2\n${line}\nH 1`)
      const view = doc.layers[1].gates[0]
      expect(view, line).toMatchObject({ kind: 'view', qubits: [2, 3], calculate: true })
    }
  })

  it('keeps every wire when given none', () => {
    expect(parseCircuit('in 000\nH 2\nwindow calculate\nH 1').layers[1].gates[0]).toMatchObject({ qubits: [1, 2, 3] })
  })

  it('covers one run of wires', () => {
    expect(() => parseCircuit('in 000\nH 1\nwindow 1 3 calculate')).toThrow(/write them as a range, e\.g\. 1-3/)
    // A state after the wires is still a state.
    expect(() => parseCircuit('in 000\nH 1\nwindow 2 0\nH 1')).not.toThrow()
  })
})

describe('working it out', () => {
  it('shows the wires on their own when they have a state of their own', () => {
    expect(shown('in 000\nH 2\nwindow 2-3 calculate\nH 1')).toEqual([['00', '10']])
    expect(shown('in 000\nH 2\nCNOT 2 3\nwindow 2-3 calculate\nH 1')).toEqual([['00', '11']])
  })

  it('refuses wires entangled with the rest', () => {
    expect(() => resolveCalculations(parseCircuit('in 000\nH 1\nCNOT 1 2\nwindow 2-3 calculate\nH 1')))
      .toThrow(/wires 2-3 are entangled with the other wires/)
    expect(() => resolveCalculations(parseCircuit('in 00\nH 1\nCNOT 1 2\nwindow 2 calculate\nH 1')))
      .toThrow(/wire 2 is entangled/)
  })

  it('lists outcomes that leave the wires differently, and gives one that does not once', () => {
    expect(shown('in 00\nH 1\nCNOT 1 2\nM 1\nwindow 2 calculate\nH 1')).toHaveLength(2)
    expect(shown('in 00\nH 1\nM 1\nwindow 2 calculate\nH 1')).toEqual([['0']])
  })
})
