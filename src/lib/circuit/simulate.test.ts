/**
 * Calculating what a circuit does.
 *
 * A simulator that is subtly wrong produces plausible diagrams rather than
 * obvious errors, so this leans on three independent kinds of evidence:
 *
 * 1. **Hand-worked answers.** Every entry in the project's own library with
 *    both an input and a written output is a case where a person did the
 *    algebra. Those run in `library-calculate.test.ts`, which skips itself on
 *    a clone that has no `library.yaml`.
 * 2. **Algebraic identities.** `H·H = 2I`, `X·X = I`, `CNOT·CNOT = I` and so
 *    on must hold for every input, which catches sign and ordering errors that
 *    single examples miss.
 * 3. **An independent implementation.** `reference.ts` builds dense matrices
 *    and multiplies them in floating point — a different algorithm reaching
 *    the same answer. Random circuits are run through both.
 */

import { describe, expect, it } from 'vitest'
import { parseCircuit } from './parse'
import { amplitudesOf, resolveCalculations, simulate, stateFrom, SimulationError } from './simulate'
import { parseState } from '../state/parse'
import { render } from '../index'

/** The calculated output of a circuit, as the source text that would draw it. */
function outputOf(src: string, factor = false): string {
  const doc = parseCircuit(src)
  return write(stateFrom(simulate(doc, doc.layers.length), doc.qubits, { factor }))
}

/** Render a state row back to source text, so expectations read as syntax. */
function write(row: { sides: { factors: unknown[] }[] }): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const factor = (f: any): string => {
    if (f.kind === 'qubit') return f.value === 'unknown' ? '?' : String(f.value)
    if (f.kind === 'label') return `"${f.text}"`
    if (f.kind === 'op') return ' x '
    const terms = f.terms.map((t: any) => {
      const sign = t.sign < 0 ? '-' : ''
      const coeff = t.coeff === undefined ? '' : `${t.coeff}*`
      return sign + coeff + t.factors.map(factor).join('')
    })
    return `(${terms.join('|')})`
  }
  const text = row.sides[0].factors.map(factor).join('')
  // A single outer cloud needs no parentheses, matching how it is written.
  return text.startsWith('(') && text.endsWith(')') && text.indexOf('(', 1) === -1
    ? text.slice(1, -1)
    : text
}

describe('reading a written state', () => {
  const amps = (src: string, n: number) =>
    [...amplitudesOf(parseState(src).rows[0], n)].sort(([a], [b]) => (a < b ? -1 : 1))

  it('reads a classical string', () => {
    expect(amps('010', 3)).toEqual([['010', 1]])
  })

  it('reads a superposition', () => {
    expect(amps('00|11', 2)).toEqual([
      ['00', 1],
      ['11', 1],
    ])
  })

  it('reads signs and coefficients', () => {
    expect(amps('3*0|-2*1', 1)).toEqual([
      ['0', 3],
      ['1', -2],
    ])
  })

  it('distributes a product of clouds, which is rule 6', () => {
    expect(amps('(0|1)(0|-1)', 2)).toEqual([
      ['00', 1],
      ['01', -1],
      ['10', 1],
      ['11', -1],
    ])
  })

  it('cancels opposite amplitudes, which is rule 2', () => {
    expect(amps('0|1|-1', 1)).toEqual([['0', 1]])
  })

  it('leaves unnamed wires in |0>', () => {
    expect(amps('1', 3)).toEqual([['100', 1]])
  })

  it('refuses what it cannot read', () => {
    expect(() => amps('0?1', 3)).toThrow(/has no value/)
    expect(() => amps('0|1 = 0', 1)).toThrow(/equation/)
    expect(() => amps('("mystery")', 1)).toThrow(/label/)
  })
})

describe('the gates', () => {
  it('flips with X', () => {
    expect(outputOf('in 00\nX 1')).toBe('10')
    expect(outputOf('in 11\nX 2')).toBe('10')
  })

  it('makes a superposition with H', () => {
    expect(outputOf('in 0\nH 1')).toBe('0|1')
    expect(outputOf('in 1\nH 1')).toBe('0|-1')
  })

  it('flips the sign of a black qubit with Z', () => {
    expect(outputOf('in 0\nZ 1')).toBe('0')
    expect(outputOf('in 1\nZ 1')).toBe('1')
    expect(outputOf('in 0\nH 1\nZ 1')).toBe('0|-1')
  })

  it('flips the target of a CNOT only when the control is black', () => {
    expect(outputOf('in 00\nCNOT 1 -> 2')).toBe('00')
    expect(outputOf('in 10\nCNOT 1 -> 2')).toBe('11')
  })

  it('needs both controls for a Toffoli', () => {
    expect(outputOf('in 110\nTOFFOLI 1 2 -> 3')).toBe('111')
    expect(outputOf('in 100\nTOFFOLI 1 2 -> 3')).toBe('100')
  })

  it('negates on CZ only when both are black', () => {
    expect(outputOf('in 11\nCZ 1 2')).toBe('11')
    expect(outputOf('in 00\nHH\nCZ 1 2')).toBe('00|01|10|-11')
  })

  it('swaps', () => {
    expect(outputOf('in 01\nSWAP 1 2')).toBe('10')
  })

  it('does nothing on an identity', () => {
    expect(outputOf('in 01\nI 1')).toBe('01')
  })
})

describe('the interesting circuits', () => {
  it('makes a Bell pair', () => {
    expect(outputOf('in 00\nH 1\nCNOT 1 -> 2')).toBe('00|11')
  })

  it('makes GHZ', () => {
    expect(outputOf('in 000\nH 3\nCNOT 3 -> 2\nCNOT 2 -> 1')).toBe('000|111')
  })

  it('reproduces PS2 §1 by hand', () => {
    // 001 -swap 2,3-> 010 -CNOT 2->1, X 3-> 111
    expect(outputOf('in 001\nSWAP 2 3\nCNOT 2 -> 1; X 3')).toBe('111')
  })

  it('keeps amplitudes whole through repeated Hadamards', () => {
    // H·H = 2I, and the factor of two divides straight back out.
    expect(outputOf('in 0\nH 1\nH 1')).toBe('0')
    expect(outputOf('in 1\nH 1\nH 1')).toBe('1')
  })

  it('builds an uneven superposition that stays exact', () => {
    expect(outputOf('in 3*0|2*1\nX 1')).toBe('2*0|3*1')
  })
})

describe('writing the answer out', () => {
  it('draws the flat sum by default', () => {
    expect(outputOf('in 00\nH 1')).toBe('00|10')
  })

  it('factors into a product when asked, where it separates', () => {
    expect(outputOf('in 00\nH 1', true)).toBe('(0|1)0')
    expect(outputOf('in 000\nH 1\nH 2', true)).toBe('(0|1)(0|1)0')
  })

  it('leaves an entangled state as one cloud, because it does not separate', () => {
    expect(outputOf('in 00\nH 1\nCNOT 1 -> 2', true)).toBe('00|11')
  })

  it('splits off only the wires that really are independent', () => {
    // Wires 1–2 are entangled with each other but not with wire 3.
    expect(outputOf('in 000\nH 1\nCNOT 1 -> 2\nX 3', true)).toBe('(00|11)1')
  })

  it('divides out the common factor', () => {
    // Two Hadamards on the same wire leave an amplitude of 2.
    expect(outputOf('in 00\nH 1\nH 1\nH 2\nH 2')).toBe('00')
  })

  it('settles the overall sign, which is unobservable', () => {
    expect(outputOf('in 1\nH 1\nX 1')).toBe('0|-1')
  })
})

describe('what it will not do, it says', () => {
  const fails = (src: string) => () => outputOf(src)

  it('refuses gates whose amplitudes are complex', () => {
    for (const gate of ['S 1', 'T 1', 'Y 1']) {
      expect(fails(`in 0\n${gate}`), gate).toThrow(/complex amplitudes/)
    }
  })

  it('refuses a measurement, for now', () => {
    expect(fails('in 0\nH 1\nmeasure 1 Z')).toThrow(/cannot pass the measurement on wire 1/)
  })

  it('refuses a box, which is a drawing rather than an operation', () => {
    expect(fails('in 00\nbox "Oracle" 1-2')).toThrow(/“Oracle” is a drawing/)
    expect(fails('in 00\nblank 1-2')).toThrow(/blank box/)
  })

  it('refuses an unknown input', () => {
    expect(fails('in 0?\nH 1')).toThrow(/has no value/)
  })

  it('starts from every wire white when no input is written', () => {
    expect(outputOf('H 1')).toBe('0|1')
    expect(outputOf('H 1\nCNOT 1 -> 2')).toBe('00|11')
    // Same answer as writing the input out in full.
    expect(outputOf('qubits 3\nH 1\nCNOT 1 -> 2')).toBe(
      outputOf('in 000\nH 1\nCNOT 1 -> 2'),
    )
  })

  it('sizes that default input to the register', () => {
    expect(outputOf('qubits 3\nX 1')).toBe('100')
  })

  it('reports a state that cancels away entirely', () => {
    expect(() => stateFrom(new Map(), 1)).toThrow(SimulationError)
  })
})

describe('where calculate can go', () => {
  const doc = (src: string) => resolveCalculations(parseCircuit(src), { factor: false })
  const views = (src: string) =>
    doc(src).layers.flatMap((l) => l.gates).filter((g) => g.kind === 'view')

  it('takes the place of an output state', () => {
    expect(write(doc('in 00\nH 1\nCNOT 1 -> 2\nout calculate').output!)).toBe('00|11')
  })

  it('accepts the short spelling', () => {
    expect(write(doc('in 00\nH 1\nout calc').output!)).toBe('00|10')
  })

  it('works as a bare line after the last gate', () => {
    expect(write(doc('in 00\nH 1\nCNOT 1 -> 2\ncalculate').output!)).toBe('00|11')
  })

  it('shows the state part-way through as a view', () => {
    const [first] = views('in 001\nSWAP 2 3\ncalculate\nCNOT 2 -> 1; X 3')
    expect(first.kind === 'view' && write(first.row!)).toBe('010')
  })

  it('gives the state entering its own layer, not leaving it', () => {
    // The snapshot sits between the gates above and below, so the CNOT under
    // it has not happened yet.
    const [first] = views('in 00\nH 1\ncalculate\nCNOT 1 -> 2')
    expect(first.kind === 'view' && write(first.row!)).toBe('00|10')
  })

  it('works inside a window', () => {
    const [first] = views('in 00\nH 1\nwindow calculate\nCNOT 1 -> 2')
    expect(first.kind === 'view' && first.boxed).toBe(true)
    expect(first.kind === 'view' && write(first.row!)).toBe('00|10')
  })

  it('calculates several points in one circuit', () => {
    const all = views('in 001\nSWAP 2 3\ncalculate\nX 3\ncalculate\nCNOT 2 -> 1')
    expect(all.map((v) => (v.kind === 'view' ? write(v.row!) : ''))).toEqual(['010', '011'])
  })

  it('takes a caption, like any other state', () => {
    const [first] = views('in 001\nSWAP 2 3\nafter the swap: calculate\nX 3')
    expect(first.kind === 'view' && first.row!.sides[0].caption).toBe('after the swap')
    expect(first.kind === 'view' && write(first.row!)).toBe('010')
  })

  it('takes a caption on a bare trailing line too', () => {
    const out = doc('in 00\nH 1\nresult: calculate').output!
    expect(out.sides[0].caption).toBe('result')
  })

  it('cannot be the input, which is what it starts from', () => {
    expect(() => parseCircuit('in calculate\nH 1')).toThrow(/cannot be the input/)
    expect(() => parseCircuit('calculate\nH 1')).toThrow(/cannot be the input/)
  })

  it('takes no qubit range, since it works out the whole register', () => {
    expect(() => parseCircuit('in 00\nH 1\nview 1-2 calculate')).toThrow(/takes no qubit range/)
  })

  it('draws, end to end, in every theme', () => {
    for (const theme of ['solid', 'flat', 'isometric'] as const) {
      const out = render('in 000\nH 1\ncalculate\nCNOT 1 -> 2\nout calculate', { theme })
      expect(out.kind, theme).toBe('circuit')
      expect(out.svg, theme).not.toContain('NaN')
    }
  })

  it('follows the factoring option through render', () => {
    const flat = render('in 00\nH 1\nout calculate', { factorCalculated: false })
    const factored = render('in 00\nH 1\nout calculate', { factorCalculated: true })
    expect(factored.svg).not.toBe(flat.svg)
  })
})
