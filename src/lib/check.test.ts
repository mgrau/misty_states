/**
 * Checking a diagram against itself.
 *
 * The three rules that matter are as much about restraint as correctness: an
 * unevaluable claim is not a failure, nothing throws, and anything the
 * simulator produced is not a claim at all. Most of these tests are about the
 * cases that must stay *quiet*.
 */

import { describe, expect, it } from 'vitest'
import { render } from './index'
import { EXAMPLES } from './examples'

const check = (src: string) => render(src).check
const verdict = (src: string) => {
  const c = check(src)
  return c ? (c.ok ? 'ok' : 'wrong') : 'nothing to check'
}

describe('equations', () => {
  it('settles the six rules as true', () => {
    for (const src of [
      '00|01 = 01|00',
      '0|1|-1 = 0',
      '0|1|0|1 = 0|1',
      '(0|1)|(0|1) = 0|1|0|1',
      '00|01 = 0(0|1)',
      '(0|1)(0|-1) = 00|-01|10|-11',
    ]) {
      expect(verdict(src), src).toBe('ok')
    }
  })

  it('catches an equation that does not hold', () => {
    const c = check('00|01 = 0(0|-1)')!
    expect(c.ok).toBe(false)
    expect(c.problems).toEqual(['the two sides of "=" are not the same state'])
  })

  it('ignores overall scale and overall sign, which are unobservable', () => {
    expect(verdict('00|11 = 2*00|2*11')).toBe('ok')
    expect(verdict('-00|01 = 00|-01')).toBe('ok')
  })

  it('checks "≠" the other way round', () => {
    expect(verdict('00|01 != 00|-01')).toBe('ok')
    const c = check('00|01 != 0(0|1)')!
    expect(c.problems).toEqual(['the two sides of "≠" are the same state'])
  })

  it('will not widen one side into agreeing with the other', () => {
    // Unlike a state entering a circuit, an equation's sides are not padded:
    // describing different registers is a mistake worth naming.
    const c = check('00 = 0')!
    expect(c.ok).toBe(false)
    expect(c.problems[0]).toMatch(/different numbers of qubits/)
  })

  it('names the row when there is more than one', () => {
    const c = check('00|11\n00|01 = 0(0|-1)')!
    expect(c.problems[0]).toMatch(/^Row 2: /)
  })

  it('checks every relation in a chain', () => {
    expect(check('0|1|-1 = 0 = 0')!.checked).toBe(2)
    expect(verdict('0|1|-1 = 0 = 1')).toBe('wrong')
  })

  it('leaves "→" alone, which claims becoming rather than being', () => {
    expect(verdict('0 -> 1')).toBe('nothing to check')
  })
})

describe('circuits', () => {
  it('settles a written output against what the circuit produces', () => {
    expect(verdict('in 00\nH 1\nCNOT 1 -> 2\nout 00|11')).toBe('ok')
    expect(verdict('in 00\nH 1\nCNOT 1 -> 2\nout 00|01')).toBe('wrong')
  })

  it('checks a state shown part-way through as well', () => {
    const good = 'in 001\nSWAP 2 3\n010\nCNOT 2 -> 1; X 3\nout 111'
    expect(check(good)!.checked).toBe(2)
    expect(verdict(good)).toBe('ok')

    const bad = check('in 001\nSWAP 2 3\n011\nCNOT 2 -> 1; X 3\nout 111')!
    expect(bad.ok).toBe(false)
    expect(bad.problems).toEqual(['the state after layer 1 drawn is not what the circuit produces'])
  })

  it('starts from every wire white when no input is written', () => {
    expect(verdict('H 1\nCNOT 1 -> 2\nout 00|11')).toBe('ok')
  })

  it('settles a measurement that only has one outcome', () => {
    // Both terms carry a black square, so measuring it tells you nothing and
    // leaves one branch — a claim there is exactly one way to read.
    expect(verdict('in 01|11\nI 1; measure 2 Z\nout (0|1)1')).toBe('ok')
    expect(verdict('in 01|11\nI 1; measure 2 Z\nout 01')).toBe('wrong')
  })
})

describe('what it stays quiet about', () => {
  const quiet = (src: string) => expect(verdict(src), src).toBe('nothing to check')

  it('says nothing when the diagram claims nothing', () => {
    quiet('00|11')
    quiet('in 00\nH 1')
    quiet('CNOT 1 -> 2')
  })

  it('says nothing about an unknown — that is a question, not an error', () => {
    quiet('0?1 = ?1')
    quiet('in 001\nSWAP 2 3\nout ???')
    quiet('in ??\nSWAP 1 2\nout 11')
  })

  it('says nothing about a drawing it cannot follow', () => {
    quiet('in 00\nblank 1-2\nout 00|11')
    quiet('in 00\nbox "Oracle" 1-2\nout 00|11')
    quiet('in 0\nT 1\nout 0')
    quiet('("???") = 0')
  })

  it('does not confirm the simulator against itself', () => {
    // `calculate` came from the arithmetic; checking it proves nothing.
    quiet('in 00\nH 1\nCNOT 1 -> 2\nout calculate')
    quiet('in 001\nSWAP 2 3\ncalculate\nCNOT 2 -> 1; X 3')
  })

  it('leaves a partial view alone, which describes a different thing', () => {
    // A view of two of three wires is a marginal state, only meaningful where
    // the register separates.
    quiet('in 000\nH 1\nview 2-3 00\nCNOT 1 -> 2')
  })

  it('says nothing when a measurement leaves more outcomes than were drawn', () => {
    // `out` is a single row, so there is nothing to line two branches up
    // against. Drawing one of two outcomes is incomplete, not wrong.
    quiet('in 00\nH 1\nCNOT 1 -> 2\nmeasure 1 Z; measure 2 Z\nout 00')
    quiet('in 00\nH 1\nmeasure 1 Z\nout 00')
  })
})

describe('it never gets in the way', () => {
  it('draws a wrong diagram exactly as it draws a right one', () => {
    const wrong = render('00|01 = 0(0|-1)')
    expect(wrong.check!.ok).toBe(false)
    expect(wrong.svg.startsWith('<svg')).toBe(true)
    expect(wrong.svg).not.toContain('NaN')
  })

  it('can be turned off', () => {
    expect(render('00|01 = 0(0|-1)', { check: false }).check).toBeUndefined()
  })

  it('leaves the drawing byte-identical either way', () => {
    const src = 'in 001\nSWAP 2 3\n011\nCNOT 2 -> 1; X 3\nout 111'
    expect(render(src, { check: true }).svg).toBe(render(src, { check: false }).svg)
  })

  it('passes every curated example', () => {
    for (const ex of EXAMPLES) {
      const c = render(ex.source).check
      if (c) expect(c.ok, `${ex.id}: ${c.problems.join(' / ')}`).toBe(true)
    }
  })
})
