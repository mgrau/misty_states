/**
 * Decimals that are whole numbers in disguise.
 *
 * A rotation followed by a measurement leaves each outcome scaled by its own
 * cosine, so one state can come out as 6.88 : 13.75 in one branch and 3.21 :
 * 6.41 in the next. They are the same state, and must be drawn as one.
 */

import { describe, expect, it } from 'vitest'
import { cx, wholeRatio } from './complex'
import { render } from '../index'

describe('scaling to the smallest term', () => {
  it('finds the whole numbers a scaled state is', () => {
    expect(wholeRatio([cx(6.875), cx(13.75)])).toEqual([cx(1), cx(2)])
    expect(wholeRatio([cx(0.3), cx(-0.9)])).toEqual([cx(1), cx(-3)])
    expect(wholeRatio([cx(0, 0.5), cx(1)])).toEqual([cx(0, 1), cx(2)])
  })

  it('leaves a ratio that is not whole alone, and whole numbers to the usual rule', () => {
    expect(wholeRatio([cx(Math.cos(0.3)), cx(Math.sin(0.3))])).toBeNull()
    expect(wholeRatio([cx(2), cx(4)])).toBeNull()
  })
})

describe('one state measured several ways', () => {
  it('reads as the same state in every outcome', () => {
    // The circle is put in 0|1|1 beside a second qubit that is rotated and then
    // measured: whichever way it comes out, the circle has not changed.
    const lines = render('in (0|1|1)0\nRY(37) 2\nRX(50) 2\nM 2\nout calculate').dirac!
    expect(lines).toHaveLength(2)
    for (const line of lines) expect(line).toMatch(/\(\|0.⟩ \+ 2\|1.⟩\)\/√5$/)
  })

  it('writes the norm of a ratio that is not whole without floating-point noise', () => {
    const lines = render('in 000\nH 1\nRY(60) 3\nCSWAP 1 2 3\nH 1\nM 1\nout calculate').dirac!
    expect(lines.join(' ')).not.toMatch(/\d{12}/)
  })
})
