import { describe, expect, it } from 'vitest'
import { render } from '../index'
import { parseCircuit } from './parse'

/** The calculated output, as text. */
const out = (src: string, keepSign?: boolean): string => render(src, { keepSign }).dirac!.join(' || ')

// A Z on a lone black qubit: an overall minus sign and nothing else.
const FLIP = 'in 1\nZ 1\nout calculate'

describe('global phase', () => {
  it('is tidied away by default and kept by the setting', () => {
    expect(out(FLIP)).toBe('|1⟩')
    expect(out(FLIP, true)).toBe('−|1⟩')
  })

  it('is kept by a circuit line whatever the setting says', () => {
    expect(out(`global phase on\n${FLIP}`, false)).toBe('−|1⟩')
    expect(out(`global phase on\n${FLIP}`)).toBe('−|1⟩')
    expect(out(`global phase off\n${FLIP}`, true)).toBe('|1⟩')
  })

  it('keeps a factor of i too', () => {
    expect(out('global phase on\nin 1\nS 1\nout calculate')).toBe('i|1⟩')
  })

  it('reaches the chart and the drawing', () => {
    const src = 'in 110\nCZ 1 2 3=0\namplitude'
    expect(render(`global phase on\n${src}`).svg).toBe(render(src, { keepSign: true }).svg)
    expect(render(`global phase on\n${src}`).svg).not.toBe(render(src).svg)
  })

  it('reaches measurement rows', () => {
    expect(out('global phase on\nin 0|1\nZ 1\nX 1\nM 1\nout calculate')).toBe('50%  −|0⟩ || 50%  |1⟩')
  })

  it('does not change what a written output is checked against', () => {
    expect(render('global phase on\nin 1\nZ 1\nout 1').check!.ok).toBe(true)
    expect(render('global phase on\nin 1\nZ 1\nout -1').check!.ok).toBe(true)
  })

  it('is recorded on the circuit and refuses anything but on or off', () => {
    expect(parseCircuit('global phase on\nH 1').keepSign).toBe(true)
    expect(parseCircuit('GLOBAL PHASE OFF\nH 1').keepSign).toBe(false)
    expect(parseCircuit('H 1').keepSign).toBeUndefined()
    expect(() => parseCircuit('global phase maybe\nH 1')).toThrow(/global phase takes "on"/)
    expect(() => parseCircuit('global sign on\nH 1')).toThrow(/global phase takes "on"/)
  })
})
