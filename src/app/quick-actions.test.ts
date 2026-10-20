import { describe, expect, it } from 'vitest'
import { render } from '../core/index'
import { calculateDone, isAnimated, toggleAnimate, withCalculate } from './quick-actions'

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

  it('takes the worked-out end away again when it is already there', () => {
    for (const end of ['calculate', 'calc', 'window calculate']) {
      const source = `in 0\nH 1\n${end}`
      expect(calculateDone(source)).toBe('calculated')
      expect(withCalculate(source)).toBe('in 0\nH 1')
    }
  })

  it('puts a blank output back where it had filled one in', () => {
    expect(withCalculate('in 00\nH 1\nout calculate', 2)).toBe('in 00\nH 1\nout ??')
    for (const blank of ['in 00\nH 1\nout ??', '00\nH 1\n??']) {
      const once = withCalculate(blank, 2)
      expect(once).toMatch(/out calculate$/)
      expect(withCalculate(withCalculate(once, 2), 2)).toBe(once)
    }
  })

  it('finds the output by where the parser found it, not by the last line', () => {
    const source = 'in 0\nH 1\nout ??\ndef f {\n  X 1\n}'
    expect(calculateDone(source)).toBe(null)
    expect(withCalculate(source)).toBe('in 0\nH 1\nout calculate\ndef f {\n  X 1\n}')
  })

  it('reads a colour on the input line as a colour, not a comment', () => {
    expect(withCalculate('in ?1\nH 1 fill=#ffe9c7', 2)).toBe('in 01\nH 1 fill=#ffe9c7\ncalculate')
  })

  it('is a toggle: pressed twice, the source is back where it was', () => {
    for (const source of ['in 00\nH 1\nCNOT 1 -> 2', '0\nH\nCNOT', 'in 0\nH 1\nanimate']) {
      expect(withCalculate(withCalculate(source, 2), 2)).toBe(source)
    }
  })

  it('finds the end worked out with something after it, or a note on it', () => {
    expect(withCalculate('in 0\nH 1\ncalculate\nanimate')).toBe('in 0\nH 1\nanimate')
    expect(withCalculate('in 0\nH 1\ncalculate : the answer')).toBe('in 0\nH 1')
    expect(calculateDone('in 0\nH 1\ncalculate\nanimate')).toBe('calculated')
  })

  it('looks past comments and blank lines to find where the circuit ends', () => {
    expect(calculateDone('in 0\nH 1\ncalculate\n\n# that is the answer\n')).toBe('calculated')
  })

  it('leaves a calculate earlier in the circuit alone, and still adds one at the end', () => {
    const source = 'in 0\nH 1\ncalculate\nH 1'
    expect(calculateDone(source)).toBe(null)
    expect(withCalculate(source)).toBe(`${source}\ncalculate`)
  })

  it('always gives a source the renderer accepts', () => {
    for (const source of ['in 00\nH 1\nCNOT 1 -> 2', 'in 00\nH 1\nout ??', 'in 0|1\nmeasure 1 Z']) {
      expect(() => render(withCalculate(source))).not.toThrow()
    }
  })
})

describe('Calculate with no input to start from', () => {
  it('starts every qubit white, at the top, when no input is written', () => {
    expect(withCalculate('H 1\nCNOT 1 -> 2', 2)).toBe('in 00\nH 1\nCNOT 1 -> 2\ncalculate')
    expect(withCalculate('H 1', 3)).toBe('in 000\nH 1\ncalculate')
  })

  it('puts the input after the lines that set the circuit up', () => {
    expect(withCalculate('# a Bell pair\nqubits 2\nshape os\nH 1\nCNOT 1 -> 2', 2)).toBe(
      '# a Bell pair\nqubits 2\nshape os\nin 00\nH 1\nCNOT 1 -> 2\ncalculate',
    )
  })

  it('makes unknown qubits white and keeps the ones that were given', () => {
    expect(withCalculate('in ??\nH 1\nCNOT 1 -> 2', 2)).toBe('in 00\nH 1\nCNOT 1 -> 2\ncalculate')
    expect(withCalculate('in ?1\nH 1', 2)).toBe('in 01\nH 1\ncalculate')
    expect(withCalculate('in ??  # what goes in?\nH 1', 2)).toBe('in 00  # what goes in?\nH 1\ncalculate')
  })

  it('fills both blanks of a question at once', () => {
    expect(withCalculate('in ??\nH 1\nout ??', 2)).toBe('in 00\nH 1\nout calculate')
  })

  it('works backwards when the output is written in and the input is not', () => {
    expect(withCalculate('in ??\nCNOT 1 -> 2\nSWAP 1 2\nout 01', 2)).toBe(
      'in calculate\nCNOT 1 -> 2\nSWAP 1 2\nout 01',
    )
    expect(withCalculate('CNOT 1 -> 2\nout 11', 2)).toBe('in calculate\nCNOT 1 -> 2\nout 11')
  })

  it('leaves an output written in by hand alone', () => {
    const source = 'in 10\nCNOT 1 -> 2\nout 11'
    expect(calculateDone(source)).toBe('written')
    expect(withCalculate(source, 2)).toBe(source)
  })

  it('takes the worked-out end away even where the input is not written', () => {
    expect(calculateDone('H 1\ncalculate')).toBe('calculated')
    expect(withCalculate('H 1\ncalculate', 1)).toBe('H 1')
  })

  it('counts a state on the first line as the input, written `in` or not', () => {
    expect(withCalculate('0\nH\nCNOT', 2)).toBe('0\nH\nCNOT\ncalculate')
    expect(withCalculate('00|11\nCNOT 1 2', 2)).toBe('00|11\nCNOT 1 2\ncalculate')
    expect(withCalculate('??\nH 1', 2)).toBe('00\nH 1\ncalculate')
  })

  it('reads a bare state at the end as the output', () => {
    expect(calculateDone('0\nH 1\n0|1')).toBe('written')
    expect(withCalculate('0\nH 1\n0|1')).toBe('0\nH 1\n0|1')
    expect(withCalculate('0\nH 1\n?')).toBe('0\nH 1\nout calculate')
  })

  it('always gives a source the renderer can calculate', () => {
    const sources: [string, number][] = [
      ['H 1\nCNOT 1 -> 2', 2], ['in ??\nH 1\nCNOT 1 -> 2', 2], ['in ?1\nH 1', 2],
      ['in ??\nCNOT 1 -> 2\nSWAP 1 2\nout 01', 2], ['qubits 3\nH 1', 3],
    ]
    for (const [source, n] of sources) {
      const after = render(withCalculate(source, n))
      expect(after.dirac?.length).toBeGreaterThan(0)
    }
    // Worked backwards, the input is the one that gives the written output:
    // undo the SWAP (10), then the CNOT (11). Running 11 forwards gives 01 again.
    expect(render('in 11\nCNOT 1 -> 2\nSWAP 1 2\nout calculate').dirac).toEqual(['|01⟩'])
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
