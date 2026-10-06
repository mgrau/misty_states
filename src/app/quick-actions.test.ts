import { describe, expect, it } from 'vitest'
import { render } from '../core/index'
import { endsCalculated, isAnimated, toggleAnimate, withCalculate } from './quick-actions'

describe('the Calculate button', () => {
  it('adds a calculate on a line of its own at the end', () => {
    expect(withCalculate('in 00\nH 1\nCNOT 1 -> 2')).toBe('in 00\nH 1\nCNOT 1 -> 2\ncalculate')
  })

  it('does not leave a blank line between the circuit and what it adds', () => {
    expect(withCalculate('in 0\nH 1\n\n')).toBe('in 0\nH 1\ncalculate')
  })

  it('fills a blank output with the answer rather than drawing it above the blank', () => {
    expect(withCalculate('in 00\nH 1\nout ??')).toBe('in 00\nH 1\nout calculate')
    expect(withCalculate('in 0\nH 1\nout ?  # for the student')).toBe('in 0\nH 1\nout calculate')
  })

  it('has nothing to add once the circuit already ends worked out', () => {
    for (const end of ['calculate', 'calc', 'out calculate', 'window calculate']) {
      const source = `in 0\nH 1\n${end}`
      expect(endsCalculated(source)).toBe(true)
      expect(withCalculate(source)).toBe(source)
    }
  })

  it('looks past comments and blank lines to find where the circuit ends', () => {
    expect(endsCalculated('in 0\nH 1\ncalculate\n\n# that is the answer\n')).toBe(true)
  })

  it('leaves a calculate earlier in the circuit alone, and still adds one at the end', () => {
    const source = 'in 0\nH 1\ncalculate\nH 1'
    expect(endsCalculated(source)).toBe(false)
    expect(withCalculate(source)).toBe(`${source}\ncalculate`)
  })

  it('always gives a source the renderer accepts', () => {
    for (const source of ['in 00\nH 1\nCNOT 1 -> 2', 'in 00\nH 1\nout ??', 'in 0|1\nmeasure 1 Z']) {
      expect(() => render(withCalculate(source))).not.toThrow()
    }
  })
})

describe('the Animate button', () => {
  it('adds animate at the end, and takes it out again', () => {
    const on = toggleAnimate('in 00\nH 1')
    expect(on).toBe('in 00\nH 1\nanimate')
    expect(isAnimated(on)).toBe(true)
    expect(toggleAnimate(on)).toBe('in 00\nH 1')
  })

  it('finds animate wherever it was written, and only a whole statement counts', () => {
    expect(isAnimated('animate\nin 0\nH 1')).toBe(true)
    expect(toggleAnimate('animate\nin 0\nH 1')).toBe('in 0\nH 1')
    expect(isAnimated('in 0\nH 1 # animate this later')).toBe(false)
  })

  it('animates a circuit the renderer can animate', () => {
    expect(render(toggleAnimate('in 00\nH 1\nCNOT 1 -> 2')).animation).toBeTruthy()
  })
})
