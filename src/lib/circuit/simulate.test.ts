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
import { layoutCircuit } from './layout'
import {
  amplitudesOf, canonical, resolveCalculations, simulate, stateFrom, SimulationError,
} from './simulate'
import { parseState } from '../state/parse'
import type { Factor, StateRow } from '../state/ast'
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

  it('lets the circuit choose the shapes, as it does for a written state', () => {
    // `shapes` reorders the register. A calculated state must go through the
    // same numbering as a written one — pinning shapes while building it would
    // silently win over the override.
    const shaped = resolveCalculations(
      parseCircuit('shapes 2 3 1\nin 100\nout calculate'),
      {},
    )
    const laid = layoutCircuit(shaped)
    const drawn = laid.prims.filter((p) => p.t === 'qubit').map((p) => (p.t === 'qubit' ? p.shape : ''))
    // Input and output are the same state, so they must draw the same shapes.
    expect(drawn.slice(0, 3)).toEqual(['square', 'triangle', 'circle'])
    expect(drawn.slice(3, 6)).toEqual(['square', 'triangle', 'circle'])
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

  it('refuses an X- or Y-basis measurement, which has no outcome to draw', () => {
    expect(fails('in 0\nH 1\nmeasure 1 X')).toThrow(/no white-or-black outcome/)
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

describe('measuring — one state becomes several', () => {
  const outcomes = (src: string, exactOdds = false) =>
    resolveCalculations(parseCircuit(src), { factor: true, exactOdds }).output!.map((row) => ({
      odds: row.sides[0].caption,
      state: write({ sides: [{ factors: row.sides[0].factors }] }),
    }))

  it('splits an even superposition down the middle', () => {
    expect(outcomes('in 00\nH 1\nCNOT 1 -> 2\nmeasure 1 Z; measure 2 Z\nout calculate')).toEqual([
      { odds: '50%', state: '00' },
      { odds: '50%', state: '11' },
    ])
  })

  it('weighs the outcomes by the Born rule', () => {
    // 3² and 2² out of 13 — the amplitudes squared, not the amplitudes.
    expect(outcomes('in 3*0|2*1\nmeasure 1 Z\nout calculate')).toEqual([
      { odds: '69%', state: '0' },
      { odds: '31%', state: '1' },
    ])
  })

  it('writes the odds exactly when asked, rather than rounding', () => {
    expect(outcomes('in 3*0|2*1\nmeasure 1 Z\nout calculate', true).map((o) => o.odds)).toEqual([
      '9/13',
      '4/13',
    ])
  })

  it('still says 50% exactly, whichever way odds are written', () => {
    const even = 'in 00\nH 1\nCNOT 1 -> 2\nmeasure 1 Z\nout calculate'
    expect(outcomes(even, true).map((o) => o.odds)).toEqual(['50%', '50%'])
  })

  it('leaves the unmeasured qubits in superposition', () => {
    // PS4 §1.5: only the circle is measured, and the square keeps its sign.
    expect(outcomes('in 00|10|-01|11\nmeasure 1 Z\nout calculate')).toEqual([
      { odds: '50%', state: '0(0|-1)' },
      { odds: '50%', state: '1(0|1)' },
    ])
  })

  it('reports a certain outcome as 100%, which is worth saying after a measurement', () => {
    // PS3 §3.1: both terms have a black square, so the measurement tells you
    // nothing you did not know — and the circle stays in superposition.
    expect(outcomes('in 01|11\nI 1; measure 2 Z\nout calculate')).toEqual([
      { odds: '100%', state: '(0|1)1' },
    ])
  })

  it('says nothing about odds when nothing was measured', () => {
    expect(outcomes('in 00\nH 1\nout calculate')).toEqual([{ odds: undefined, state: '(0|1)0' }])
  })

  it('branches again on a second measurement', () => {
    const all = outcomes('in 000\nH 1\nH 2\nmeasure 1 Z; measure 2 Z\nout calculate')
    expect(all).toHaveLength(4)
    expect(all.map((o) => o.odds)).toEqual(['25%', '25%', '25%', '25%'])
    expect(all.map((o) => o.state)).toEqual(['000', '010', '100', '110'])
  })

  it('drops an outcome that cannot happen', () => {
    // Nothing in this state has a black circle, so there is no such branch.
    expect(outcomes('in 00|01\nmeasure 1 Z\nout calculate')).toHaveLength(1)
  })

  it('keeps a written caption alongside the odds', () => {
    const [first] = outcomes('in 00\nH 1\nmeasure 1 Z\nafter measuring: calculate')
    expect(first.odds).toBe('after measuring — 50%')
  })

  it('shows the branches part-way through a circuit too', () => {
    const doc = resolveCalculations(
      parseCircuit('in 00\nH 1\nmeasure 1 Z\ncalculate\nX 2'),
      { factor: true },
    )
    const view = doc.layers.flatMap((l) => l.gates).find((g) => g.kind === 'view')
    expect(view?.kind === 'view' && view.rows).toHaveLength(2)
  })

  it('carries on applying gates to every branch', () => {
    // The X after the measurement lands on both outcomes.
    expect(outcomes('in 00\nH 1\nmeasure 1 Z\nX 2\nout calculate').map((o) => o.state)).toEqual([
      '01',
      '11',
    ])
  })

  it('refuses a basis with no white-or-black outcome', () => {
    expect(() => outcomes('in 0\nH 1\nmeasure 1 X\nout calculate')).toThrow(
      /no white-or-black outcome/,
    )
  })

  it('draws the branches, end to end', () => {
    const out = render('in 00\nH 1\nCNOT 1 -> 2\nmeasure 1 Z; measure 2 Z\nout calculate')
    expect(out.svg).not.toContain('NaN')
    expect(out.svg).toContain('50%')
  })
})

describe('where calculate can go', () => {
  const doc = (src: string) => resolveCalculations(parseCircuit(src), { factor: false })
  const views = (src: string) =>
    doc(src).layers.flatMap((l) => l.gates).filter((g) => g.kind === 'view')

  it('takes the place of an output state', () => {
    expect(write(doc('in 00\nH 1\nCNOT 1 -> 2\nout calculate').output![0])).toBe('00|11')
  })

  it('accepts the short spelling', () => {
    expect(write(doc('in 00\nH 1\nout calc').output![0])).toBe('00|10')
  })

  it('works as a bare line after the last gate', () => {
    expect(write(doc('in 00\nH 1\nCNOT 1 -> 2\ncalculate').output![0])).toBe('00|11')
  })

  it('shows the state part-way through as a view', () => {
    const [first] = views('in 001\nSWAP 2 3\ncalculate\nCNOT 2 -> 1; X 3')
    expect(first.kind === 'view' && write(first.rows![0])).toBe('010')
  })

  it('gives the state entering its own layer, not leaving it', () => {
    // The snapshot sits between the gates above and below, so the CNOT under
    // it has not happened yet.
    const [first] = views('in 00\nH 1\ncalculate\nCNOT 1 -> 2')
    expect(first.kind === 'view' && write(first.rows![0])).toBe('00|10')
  })

  it('works inside a window', () => {
    const [first] = views('in 00\nH 1\nwindow calculate\nCNOT 1 -> 2')
    expect(first.kind === 'view' && first.boxed).toBe(true)
    expect(first.kind === 'view' && write(first.rows![0])).toBe('00|10')
  })

  it('calculates several points in one circuit', () => {
    const all = views('in 001\nSWAP 2 3\ncalculate\nX 3\ncalculate\nCNOT 2 -> 1')
    expect(all.map((v) => (v.kind === 'view' ? write(v.rows![0]) : ''))).toEqual(['010', '011'])
  })

  it('takes a caption, like any other state', () => {
    const [first] = views('in 001\nSWAP 2 3\nafter the swap: calculate\nX 3')
    expect(first.kind === 'view' && first.rows![0].sides[0].caption).toBe('after the swap')
    expect(first.kind === 'view' && write(first.rows![0])).toBe('010')
  })

  it('takes a caption on a bare trailing line too', () => {
    const out = doc('in 00\nH 1\nresult: calculate').output!
    expect(out[0].sides[0].caption).toBe('result')
  })

  it('can be the input, worked back from a state written later', () => {
    // It could not once: `calculate` was defined as reading forwards from the
    // input. Every gate here is its own inverse, so a run is settled by the
    // state at any point, and asking for the input is a fair question.
    expect(() => parseCircuit('in calculate\nH 1\nout 0|1')).not.toThrow()
    expect(() => parseCircuit('calculate\nH 1\nout 0|1')).not.toThrow()
    expect(parseCircuit('calculate\nH 1\nout 0|1').calculateInput).toBe(true)
  })

  it('says so when there is nothing to work the input back from', () => {
    expect(() => render('in calculate\nH 1')).toThrow(/written somewhere else/)
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

/**
 * An overall minus sign.
 *
 * Unobservable, so it is normalised away by default — but a figure drawn to
 * show a phase flip happening needs it, and those outputs were otherwise
 * written by hand against the arithmetic.
 */
describe('keeping a meaningful minus sign', () => {
  const outOf = (src: string, keepSign: boolean) =>
    resolveCalculations(parseCircuit(src), { factor: true, keepSign }).output![0].sides[0]

  /** The written form, so these read as the notation rather than as an AST. */
  const written = (side: { factors: Factor[] }): string =>
    side.factors
      .map((f) => {
        if (f.kind === 'qubit') return String(f.value)
        if (f.kind !== 'cloud') return '?'
        return f.terms
          .map(
            (t) =>
              (t.sign < 0 ? '-' : '') +
              (t.coeff ?? '') +
              t.factors.map((q) => (q.kind === 'qubit' ? String(q.value) : '?')).join(''),
          )
          .join('|')
      })
      .join('')

  const FLIP = 'in 1\nH 1\nX 1\nH 1\nout calculate'

  it('draws the minus when asked and tidies it away when not', () => {
    expect(written(outOf(FLIP, true))).toBe('-1')
    expect(written(outOf(FLIP, false))).toBe('1')
  })

  it('produces exactly what writing it by hand produces', () => {
    const byHand = parseState('-1').rows[0].sides[0]
    expect(outOf(FLIP, true)).toEqual(byHand)
  })

  it('keeps the sign on one block of a product, not on every one', () => {
    // Doubling it would cancel, which is the trap in canonicalising blocks
    // separately. Here the second wire is a cloud in its own right, so the
    // product survives and there is a real choice of where the sign lands.
    const side = outOf('in 11\nH 1; H 2\nX 1\nH 1\nout calculate', true)
    expect(written(side)).toBe('-10|-1')
    expect(side.factors.filter((f) => f.kind === 'cloud' && f.terms[0].sign < 0)).toHaveLength(1)
  })

  it('gives up the product rather than add a bracket to carry the sign', () => {
    // `(-1)1` would be a bracket the notation does not otherwise need; the
    // course writes `(-11)`, which is this.
    const side = outOf('in 11\nCZ 2 1\nout calculate', true)
    expect(side).toEqual(parseState('(-11)').rows[0].sides[0])
  })

  it('reproduces the figures that were written by hand against it', () => {
    // PS7 §3 and §5 draw the minus deliberately; those outputs are the reason
    // this option exists.
    for (const [src, hand] of [
      ['in 11\nCZ 2 1\nout calculate', '(-11)'],
      ['in 11\nCZ 1 2\nout calculate', '(-11)'],
      ['in 1\nH 1\nX 1\nH 1\nout calculate', '(-1)'],
    ] as const) {
      expect(outOf(src, true), src).toEqual(parseState(hand).rows[0].sides[0])
    }
  })

  it('leaves a state whose leading term is already positive alone', () => {
    const src = 'in 11\nH 1; H 2\nZ 1\nH 1\nout calculate'
    expect(written(outOf(src, true))).toBe(written(outOf(src, false)))
  })

  it('keeps a relative sign either way, which was always observable', () => {
    expect(written(outOf('in 1\nH 1\nout calculate', false))).toBe('0|-1')
    expect(written(outOf('in 1\nH 1\nout calculate', true))).toBe('0|-1')
  })

  it('does not disturb comparison, which wants both states equal', () => {
    // Every check in the codebase compares through the default canonical form.
    expect(canonical(new Map([['0', -1]]))).toEqual([['0', 1]])
    expect(canonical(new Map([['0', -1]]), { keepSign: true })).toEqual([['0', -1]])
    expect(render('in 1\nH 1\nX 1\nH 1\nout 1', { keepSign: true }).check!.ok).toBe(true)
  })

  it('still divides out the common factor', () => {
    expect(canonical(new Map([['0', -2], ['1', -4]]), { keepSign: true })).toEqual([
      ['0', -1],
      ['1', -2],
    ])
  })

  it('follows the option through render, in every theme', () => {
    for (const theme of ['solid', 'flat', 'isometric'] as const) {
      const kept = render(FLIP, { theme, keepSign: true })
      expect(kept.svg, theme).not.toContain('NaN')
      expect(kept.svg, theme).not.toBe(render(FLIP, { theme, keepSign: false }).svg)
    }
  })
})

/**
 * Reading a circuit backwards.
 *
 * Every gate this notation can follow is its own inverse — `H·H = 2I`, and the
 * rest are permutations — so a run is determined by the state at *any* point,
 * not only at the start. A figure that gives the output and asks for the input
 * is the common case, and it used to be a parse error.
 */
describe('working out the input', () => {
  const inputOf = (src: string) => {
    const doc = resolveCalculations(parseCircuit(src), { factor: false })
    return doc.input!
  }
  const bits = (row: StateRow): string =>
    row.sides[0].factors
      .map((f) => (f.kind === 'qubit' ? String(f.value) : '?'))
      .join('')

  it('undoes a permutation', () => {
    expect(bits(inputOf('in calculate\nX 1\nout 1'))).toBe('0')
    expect(bits(inputOf('in calculate\nSWAP 1 2\nCNOT 2 -> 1\nSWAP 1 2\nout 11'))).toBe('10')
  })

  it('undoes a Hadamard, whose square is twice the identity', () => {
    // The factor of two is scale, which is not observable, so it comes back
    // reduced.
    expect(bits(inputOf('in calculate\nH 1\nout 0|1'))).toBe('0')
    expect(bits(inputOf('in calculate\nH 1\nout 0|-1'))).toBe('1')
  })

  it('takes the whole circuit into account, not just the last gate', () => {
    const src = 'in calculate\nH 3\nCNOT 3 -> 2\nSWAP 1 2; X 3\nout 000|101'
    expect(bits(inputOf(src))).toBe('010')
    // And running forwards from it lands back on what was written.
    expect(render(src).check?.ok ?? true).toBe(true)
    expect(render('in 010\nH 3\nCNOT 3 -> 2\nSWAP 1 2; X 3\nout 000|101').check!.ok).toBe(true)
  })

  it('reads from a state written part-way down as well as from the end', () => {
    expect(bits(inputOf('in calculate\nX 1\n1\nX 1'))).toBe('0')
  })

  it('leaves a written input alone', () => {
    // Nothing changes for a circuit that says where it starts.
    const doc = parseCircuit('in 01\nX 1\nout 11')
    expect(resolveCalculations(doc, {}).input).toEqual(doc.input)
  })

  it('still starts every wire white when nothing is written', () => {
    expect(render('H 1\nCNOT 1 -> 2\nout 00|11').check!.ok).toBe(true)
  })

  it('refuses what cannot be undone, and says why', () => {
    expect(() => inputOf('in calculate\nmeasure 1 Z\nout 0')).toThrow(/measurement cannot be undone/)
    expect(() => inputOf('in calculate\nX 1')).toThrow(/written somewhere else/)
    expect(() => inputOf('in calculate\nbox "Oracle" 1-2\nout 00')).toThrow(/is a drawing/)
  })

  it('is what a bare answer means at the top of a circuit', () => {
    const bare = 'answer\nX 1\nout 1'
    const spelt = 'answer in calculate\nX 1\nout 1'
    expect(render(bare, { answers: true }).svg).toBe(render(spelt, { answers: true }).svg)
    expect(render(bare).hasAnswer).toBe(true)
  })
})
