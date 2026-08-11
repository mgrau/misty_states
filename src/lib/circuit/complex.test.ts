/**
 * Gaussian integers.
 *
 * The property that makes them the right choice: everything the notation can
 * express keeps them whole, and `|a + bi|²` stays an integer — so the odds,
 * which have always been exact ratios, carry on being exact ratios.
 */

import { describe, expect, it } from 'vitest'
import { render } from '../index'
import { parseState } from '../state/parse'
import { I, ONE, ZERO, abs2, add, commonFactor, cx, eq, isReal, mul, neg, over, show, times, unitToClear } from './complex'

describe('the arithmetic', () => {
  it('adds and multiplies as complex numbers do', () => {
    expect(add(cx(1, 2), cx(3, -5))).toEqual(cx(4, -3))
    expect(mul(cx(1, 2), cx(3, 4))).toEqual(cx(-5, 10))
  })

  it('turns a quarter at a time', () => {
    // i, i², i³, i⁴ — a full turn back to where it started.
    let z = ONE
    const seen = [] as string[]
    for (let n = 0; n < 4; n++) {
      z = mul(z, I)
      seen.push(show(z))
    }
    expect(seen).toEqual(['i', '-1', '-i', '1'])
  })

  it('keeps the squared magnitude a whole number', () => {
    expect(abs2(cx(3, 4))).toBe(25)
    expect(abs2(I)).toBe(1)
    expect(abs2(ZERO)).toBe(0)
    // Which is the whole reason the odds stay exact.
    expect(Number.isInteger(abs2(cx(7, -11)))).toBe(true)
  })

  it('says which have no phase to speak of', () => {
    expect(isReal(cx(-3))).toBe(true)
    expect(isReal(I)).toBe(false)
  })

  it('reduces by a common factor over both parts', () => {
    expect(commonFactor([cx(4, 8), cx(12, 0)])).toBe(4)
    expect(over(cx(4, 8), 4)).toEqual(cx(1, 2))
    // Nothing in common, and nothing divided away.
    expect(commonFactor([cx(3, 0), cx(0, 2)])).toBe(1)
  })

  it('writes the short forms the way anybody would', () => {
    expect([ONE, neg(ONE), I, neg(I), cx(2, -3), cx(0, 5)].map(show))
      .toEqual(['1', '-1', 'i', '-i', '2-3i', '5i'])
  })
})

describe('choosing a phase to stand on', () => {
  const cleared = (a: typeof ONE) => mul(a, unitToClear(a))

  it('turns a first term onto the positive real axis', () => {
    for (const a of [cx(3), cx(-3), cx(0, 3), cx(0, -3)]) {
      expect(cleared(a)).toEqual(cx(3))
    }
  })

  it('leaves one alone that no quarter turn would fix', () => {
    // A phase off the axes is a real difference, not a convention.
    expect(unitToClear(cx(1, 1))).toEqual(ONE)
  })

  it('multiplies through without changing any magnitude', () => {
    const all = [cx(0, -2), cx(4, 0)]
    const u = unitToClear(all[0])
    expect(all.map((a) => abs2(mul(a, u)))).toEqual(all.map(abs2))
  })

  it('is a no-op on zero', () => {
    expect(eq(mul(ZERO, unitToClear(ZERO)), ZERO)).toBe(true)
  })

  it('scales by a whole number', () => {
    expect(times(cx(2, -1), 3)).toEqual(cx(6, -3))
  })
})

/**
 * A turned coefficient, written and drawn.
 *
 * The notation gains one mark: an `i` after the size. A term carries a sign,
 * a size and possibly a turn — never a mixture, because `2+3i` on one basis
 * state is two terms that add, which is what a cloud already means.
 */
describe('writing a phase in the notation', () => {
  const dirac = (src: string) => render(src).dirac?.[0]

  it('reads a turn on its own and with a size', () => {
    expect(dirac('i*0')).toBe('|0⟩')
    expect(dirac('0|i*1')).toBe('(|0⟩ + i|1⟩)/√2')
    expect(dirac('2*00|-3i*11')).toBe('(2|00⟩ − 3i|11⟩)/√13')
  })

  it('does not unwrap a lone turned term back to a plain one', () => {
    // `i*0` is one term with a turn on it; dropping the cloud would drop the i.
    const side = parseState('i*0').rows[0].sides[0]
    expect(side.factors[0].kind).toBe('cloud')
  })

  it('draws a calculated phase as the notation would have written it', () => {
    expect(dirac('in 0\nH 1\nS 1\nout calculate')).toBe('(|0⟩ + i|1⟩)/√2')
    expect(dirac('in 00\nH 1\nS 1\nCNOT 1 2\nout calculate')).toBe('(|00⟩ + i|11⟩)/√2')
  })

  it('splits an amplitude with both parts into two terms', () => {
    // Which is the only honest way: one term has one size and one sign.
    expect(dirac('2*00|3i*00|1*11')).toBe('((2+3i)|00⟩ + |11⟩)/√14')
  })

  it('checks a turned state against itself', () => {
    expect(render('0|i*1 = 0|i*1').check?.ok).toBe(true)
    expect(render('in 0\nH 1\nS 1\nout 0|i*1').check?.ok).toBe(true)
  })
})
