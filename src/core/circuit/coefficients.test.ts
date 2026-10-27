/**
 * Writing a weight as repeated terms: `0|1|1` rather than `0|2*1`.
 *
 * Only how a calculated state is written changes; the arithmetic underneath,
 * and so the odds, are the same either way.
 */

import { describe, expect, it } from 'vitest'
import { parseCircuit } from './parse'
import { resolveCalculations } from './simulate'
import type { Factor } from '../state/ast'

/** The calculated output's terms, as their coefficients (1 where none is written). */
const weights = (src: string, coefficients?: boolean): (number | undefined)[] => {
  const doc = resolveCalculations(parseCircuit(src), { coefficients })
  const cloud = doc.output![0].sides[0].factors.find((f: Factor) => f.kind === 'cloud')
  if (cloud?.kind !== 'cloud') throw new Error('no cloud')
  return cloud.terms.map((t) => t.coeff)
}

// H on 0|1|1 is 3*0 - 1, which is written with a coefficient by default.
const UNEVEN = 'in 0|1|1\nH 1\nout calculate'

describe('coefficients', () => {
  it('are written by default', () => {
    expect(weights(UNEVEN)).toEqual([3, undefined])
  })

  it('can be written as that many terms instead', () => {
    expect(weights(UNEVEN, false)).toEqual([undefined, undefined, undefined, undefined])
  })

  it('follow the source over the setting, either way', () => {
    expect(weights(`coefficients off\n${UNEVEN}`, true)).toHaveLength(4)
    expect(weights(`coefficients on\n${UNEVEN}`, false)).toEqual([3, undefined])
  })

  it('keep their sign on every copy', () => {
    // H on five 1s and a 0 is 6*0 - 4*1, which is 3*0 - 2*1 once the 2 is divided out.
    const doc = resolveCalculations(parseCircuit('in 1|1|1|1|1|0\nH 1\nout calculate'), { coefficients: false })
    const cloud = doc.output![0].sides[0].factors[0]
    if (cloud.kind !== 'cloud') throw new Error()
    expect(cloud.terms.map((t) => t.sign)).toEqual([1, 1, 1, -1, -1])
  })

  it('stay where a weight is not a whole number', () => {
    expect(weights('in 0\nRY(60) 1\nout calculate', false).some((c) => c !== undefined && !Number.isInteger(c))).toBe(true)
  })

  it('says what is wrong rather than guessing', () => {
    expect(() => parseCircuit('coefficients maybe\nH 1')).toThrow(/coefficients takes "on"/)
  })
})
