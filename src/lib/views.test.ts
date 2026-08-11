/**
 * Two ways of reading a circuit that are not part of the figure.
 *
 * Stepping shows the state after *n* gates; Dirac notation writes whatever is
 * shown as text. Both are viewer's choices rather than things the source says,
 * which is the property worth holding on to: the same source has to draw the
 * same figure whether or not anyone is stepping through it.
 */

import { describe, expect, it } from 'vitest'
import { parseCircuit } from './circuit/parse'
import {
  diracLines, diracOf, resolveCalculations, sideAmplitudes,
} from './circuit/simulate'
import { parseState } from './state/parse'
import { render } from './index'

/** Three gates in two layers: the last two act on wires nothing else touches. */
const CIRCUIT = 'in 001\nSWAP 2 3\nCNOT 2 -> 1; X 3'

describe('stepping through a circuit', () => {
  it('reports how many layers there are to step through', () => {
    expect(render(CIRCUIT).layers).toBe(2)
    expect(render('in 00').layers).toBe(0)
  })

  it('counts the circuit\'s own layers, not the one stepping adds', () => {
    expect(render(CIRCUIT, { step: 1 }).layers).toBe(2)
  })

  it('says nothing about layers for a document that is only states', () => {
    expect(render('00|11').layers).toBeUndefined()
  })

  it('works the state out at the step it is asked for', () => {
    const at = (step: number) => render(CIRCUIT, { step }).dirac
    expect(at(0)).toEqual(['|001⟩'])
    expect(at(1)).toEqual(['|010⟩'])
    expect(at(2)).toEqual(['|111⟩'])
  })

  it('draws something different at each step', () => {
    const svgs = [0, 1, 2].map((step) => render(CIRCUIT, { step }).svg)
    expect(new Set(svgs).size).toBe(3)
  })

  it('leaves the drawing alone when nothing is asked for', () => {
    expect(render(CIRCUIT, { step: undefined }).svg).toBe(render(CIRCUIT).svg)
  })

  it('holds a step past the end at the end, rather than refusing', () => {
    expect(render(CIRCUIT, { step: 9 }).dirac).toEqual(['|111⟩'])
    expect(render(CIRCUIT, { step: -3 }).dirac).toEqual(['|001⟩'])
  })

  it('is a view of the same document, so the check still settles', () => {
    const claimed = 'in 001\nSWAP 2 3\n010'
    expect(render(claimed, { step: 1 }).check?.ok).toBe(true)
  })
})

describe('writing a state in Dirac notation', () => {
  const of = (src: string) => diracOf(sideAmplitudes(parseState(src).rows[0].sides[0]))

  it('writes a basis state as itself', () => {
    expect(of('010')).toBe('|010⟩')
  })

  it('divides by the root that makes it length one', () => {
    expect(of('00|11')).toBe('(|00⟩ + |11⟩)/√2')
  })

  it('writes the root out when it is a whole number', () => {
    expect(of('00|01|10|11')).toBe('(|00⟩ + |01⟩ + |10⟩ + |11⟩)/2')
  })

  it('keeps the relative amplitudes and their signs', () => {
    expect(of('3*00|-2*11')).toBe('(3|00⟩ − 2|11⟩)/√13')
  })

  it('takes the common factor out first', () => {
    expect(of('2*00|2*11')).toBe('(|00⟩ + |11⟩)/√2')
  })

  it('drops an overall sign, which is not observable', () => {
    expect(of('-00|-11')).toBe('(|00⟩ + |11⟩)/√2')
  })

  it('refuses a state that has cancelled to nothing', () => {
    expect(() => of('00|-00')).toThrow(/cancel/)
  })

  it('gives an outcome and its chance per line after a measurement', () => {
    const doc = parseCircuit('in 00\nH 1\nCNOT 1 -> 2\nM 1')
    expect(diracLines(doc, doc.layers.length)).toEqual(['50%  |00⟩', '50%  |11⟩'])
  })
})

describe('offering it beside the drawing', () => {
  it('writes out what a circuit ends on', () => {
    expect(render('in 00\nH 1\nCNOT 1 -> 2').dirac).toEqual(['(|00⟩ + |11⟩)/√2'])
  })

  it('writes out a document that is nothing but states', () => {
    expect(render('00|11').dirac).toEqual(['(|00⟩ + |11⟩)/√2'])
  })

  it('says nothing rather than failing when the arithmetic cannot be followed', () => {
    const drawn = render('???')
    expect(drawn.svg).toContain('<svg')
    expect(drawn.dirac).toBeUndefined()
  })

  it('does not disturb the drawing', () => {
    const doc = resolveCalculations(parseCircuit('in 00\nH 1'))
    expect(doc.chart).toBeUndefined()
    expect(render('in 00\nH 1').svg).toContain('<svg')
  })
})
