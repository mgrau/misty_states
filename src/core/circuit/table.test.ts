/**
 * Tables of outcomes.
 *
 * `tabulate` draws what `calculate` computes, laid out as the course lays it
 * out — a Possibility / Probability table beside the circuit. The numbers are
 * the simulator's, already trusted; what these check is the *unit* of a row,
 * which follows the circuit rather than being chosen, and the drawing.
 */

import { describe, expect, it } from 'vitest'
import { parseCircuit } from './parse'
import { resolveCalculations, tabulate } from './simulate'
import { show } from './complex'
import { layoutCircuit } from './layout'
import { render } from '../index'
import type { Prim, TextPrim } from '../render/primitives'

const doc = (src: string) => parseCircuit(src)
const resolved = (src: string, opts = {}) => resolveCalculations(doc(src), { factor: true, ...opts })
/** The worked-out rows for a circuit, tabulated. Every column is filled in
 *  whichever are asked for, so the bare form is enough to read them all. */
const lines = (src: string, opts = {}) => resolved(`${src}\ntabulate`, opts).table!.lines!

const texts = (prims: Prim[]) => prims.filter((p): p is TextPrim => p.t === 'text')
const drawn = (src: string, opts = {}) => layoutCircuit(resolved(src, opts))
const rules = (src: string) => drawn(src).prims.filter((p) => p.t === 'rule')

describe('writing it', () => {
  it('takes either name, and either position', () => {
    for (const src of ['in 00\nH 1\ntabulate', 'in 00\nH 1\ntable', 'in 00\nH 1\nout tabulate']) {
      expect(doc(src).table?.columns, src).toHaveLength(2)
    }
  })

  it('defaults to the two columns the course uses', () => {
    expect(doc('in 00\nH 1\ntabulate').table!.columns).toEqual([
      { kind: 'possibility' },
      { kind: 'probability' },
    ])
  })

  it('takes a column list, in the order written', () => {
    expect(doc('in 00\nH 1\ntabulate(probability, amplitude)').table!.columns).toEqual([
      { kind: 'probability' },
      { kind: 'amplitude' },
    ])
  })

  it('takes short names for them', () => {
    expect(doc('in 00\nH 1\ntabulate(state, amp, p)').table!.columns.map((c) => c.kind)).toEqual([
      'possibility',
      'amplitude',
      'probability',
    ])
  })

  it('lets a column be renamed, since the heading is the one bit of English', () => {
    expect(doc('in 00\nH 1\ntabulate(p="Chance")').table!.columns).toEqual([
      { kind: 'probability', header: 'Chance' },
    ])
  })

  it('takes annotations either side, like anything else', () => {
    const spec = doc('in 00\nH 1\nthe outcomes: tabulate : both equally likely').table!
    expect(spec.caption).toBe('the outcomes')
    expect(spec.note).toBe('both equally likely')
  })

  it('says what is wrong rather than guessing', () => {
    expect(() => doc('in 00\nH 1\ntabulate()')).toThrow(/at least one column/)
    expect(() => doc('in 00\nH 1\ntabulate(sausage)')).toThrow(/is not a column/)
    expect(() => doc('in 00\nH 1\ntabulate(p=)')).toThrow(/needs a heading/)
    expect(() => doc('in tabulate\nH 1')).toThrow(/cannot be the input/)
    expect(() => doc('in 00\nH 1\ntabulate\nX 1')).toThrow(/nothing can follow it/)
  })
})

describe('what a row is', () => {
  it('is an outcome once there is a measurement', () => {
    // Two branches, and the amplitudes that produced them: PS3 §2.1 exactly.
    const rows = lines('in 0|0|1|1|1\nmeasure 1 Z', { exactOdds: true })
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.amplitude)).toEqual(['2', '3'])
    expect(rows.map((r) => r.probability)).toEqual(['4/13', '9/13'])
  })

  it('is a term when nothing was measured, which is what gives it an amplitude', () => {
    const rows = lines('in 00\nH 1\nCNOT 1 -> 2')
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.probability)).toEqual(['50%', '50%'])
    expect(rows.every((r) => r.amplitude === '1')).toBe(true)
  })

  it('gives a branch still in superposition the amplitude in front of it', () => {
    // PS3 §3.2: measuring the square leaves the circle misty in one branch. It
    // has an amplitude per term and so no single term to read one off, but as
    // drawn it is 1*((0|1)0) — and that is the number.
    const rows = lines('in 00|01|01|10\nI 1; measure 2 Z', { exactOdds: true })
    expect(rows.map((r) => r.amplitude)).toEqual(['1', '2'])
    expect(rows.map((r) => r.probability)).toEqual(['1/3', '2/3'])
  })

  it('reads the amplitude off the state as drawn, common factor and all', () => {
    // 00|01|00|-11 splits as 2*(00) and 1*((0|-1)1): the second branch is
    // reduced when drawn, so what stands in front of it is 1, not nothing.
    const rows = lines('00|01|00|-11\nM 2', { exactOdds: true })
    expect(rows.map((r) => r.amplitude)).toEqual(['2', '1'])
    expect(rows.map((r) => r.probability)).toEqual(['2/3', '1/3'])
  })

  it('keeps a negative branch negative', () => {
    // -01|-11 draws as -(0|1)1, so the amplitude in front of it is -1.
    const rows = lines('in 00|00|-01|-11\nM 2', { keepSign: true })
    expect(rows.map((r) => r.amplitude)).toEqual(['2', '-1'])
  })

  it('never leaves the column empty', () => {
    for (const src of [
      'in 0|0|1|1|1\nmeasure 1 Z',
      'in 00|01|01|10\nI 1; measure 2 Z',
      'in 000|001|110|-111\nI 1; I 2; measure 3 Z',
      'in 00\nH 1\nCNOT 1 -> 2',
      'in 00\nH 1\nH 1',
    ]) {
      for (const row of lines(src)) expect(row.amplitude, src).toMatch(/^-?\d+$/)
    }
  })

  it('reduces the whole table together, not each row on its own', () => {
    // Reducing per row would turn 2 and 3 into 1 and 1 — flattening exactly the
    // difference the column exists to show.
    expect(lines('in 0|0|1|1|1\nmeasure 1 Z').map((r) => r.amplitude)).toEqual(['2', '3'])
    // And the scale the arithmetic introduces is divided out: H·H is 2I.
    expect(lines('in 00\nH 1\nH 1').map((r) => r.amplitude)).toEqual(['1'])
  })

  it('follows the exact-odds setting, like a calculated state does', () => {
    // Only where a percentage would have to round: 4/5 reads 80% either way.
    expect(lines('in 0|0|1|1|1\nmeasure 1 Z')[0].probability).toBe('31%')
    expect(lines('in 0|0|1|1|1\nmeasure 1 Z', { exactOdds: true })[0].probability).toBe('4/13')
    expect(lines('in 00|00|01\nmeasure 2 Z', { exactOdds: true })[0].probability).toBe('80%')
  })

  it('refuses what it cannot follow, saying which and why', () => {
    expect(() => resolved('in ??\nH 1\ntabulate')).toThrow(/nothing to calculate from/)
    expect(() => resolved('in 00\nbox "Oracle" 1-2\ntabulate')).toThrow(/is a drawing/)
    // S is fine now — it is T that still wants a root of two.
    expect(() => resolved('in 0\nT 1\ntabulate')).toThrow(/turns by an eighth/)
  })
})

describe('drawing it', () => {
  const src = 'in 0|0|1|1|1\nmeasure 1 Z\ntabulate(possibility, amplitude, probability)'

  it('heads every column', () => {
    const written = texts(drawn(src).prims).map((t) => t.text)
    for (const head of ['Possibility', 'Amplitude', 'Probability']) {
      expect(written).toContain(head)
    }
  })

  it('uses the heading it was given instead', () => {
    const written = texts(drawn('in 00\nH 1\ntabulate(p="Chance")').prims).map((t) => t.text)
    expect(written).toContain('Chance')
    expect(written).not.toContain('Probability')
  })

  it('rules a grid that closes on every side', () => {
    // Three columns and two rows of body, plus the header: 4 verticals, 4
    // horizontals. Shared edges are one rule, not two.
    const grid = rules(src)
    expect(grid.filter((r) => r.t === 'rule' && r.y0 === r.y1)).toHaveLength(4)
    expect(grid.filter((r) => r.t === 'rule' && r.x0 === r.x1)).toHaveLength(4)
  })

  it('sits below the circuit rather than over it', () => {
    const laid = drawn(src)
    const grid = rules(src)
    const top = Math.min(...grid.map((r) => (r.t === 'rule' ? r.y0 : 0)))
    const gates = laid.prims.filter((p) => p.t === 'gatebox' || p.t === 'measurebox')
    for (const g of gates) {
      if (g.t === 'gatebox' || g.t === 'measurebox') expect(g.box.y + g.box.h).toBeLessThan(top)
    }
  })

  it('widens a column to the widest thing in it', () => {
    const narrow = drawn('in 00\nH 1\ntabulate')
    const wide = drawn('in 00\nH 1\ntabulate(possibility="A very much longer heading")')
    expect(wide.box.w).toBeGreaterThan(narrow.box.w)
  })

  it('hangs its annotations in the gutters, like a state', () => {
    const found = texts(
      drawn('in 00\nH 1\nthe outcomes: tabulate : both equally likely').prims,
    )
    const left = found.find((t) => t.text === 'the outcomes')!
    const right = found.find((t) => t.text === 'both equally likely')!
    expect(left.anchor).toBe('end')
    expect(right.anchor).toBe('start')
    expect(left.x).toBeLessThan(right.x)
  })

  it('draws in every theme', () => {
    for (const theme of ['solid', 'flat', 'isometric'] as const) {
      const out = render(src, { theme })
      expect(out.svg, theme).not.toContain('NaN')
      expect(out.svg, theme).toContain('Possibility')
    }
  })
})

describe('it changes nothing else', () => {
  it('leaves a circuit without one exactly as it was', () => {
    const src = 'in 00\nH 1\nCNOT 1 -> 2\nout calculate'
    expect(render(src).svg).toBe(render(src).svg)
    expect(doc(src).table).toBeUndefined()
    expect(resolveCalculations(doc(src), {}).table).toBeUndefined()
  })

  it('says nothing to the checker, being the answer rather than a claim', () => {
    expect(render('in 0|0|1|1|1\nmeasure 1 Z\ntabulate').check).toBeUndefined()
  })

  it('exposes the numbers without the presentation, for anything else that wants them', () => {
    const d = doc('in 0|0|1|1|1\nmeasure 1 Z')
    const { entries, measured } = tabulate(d, d.layers.length, {})
    expect(measured).toBe(true)
    expect(entries.map((e) => show(e.amplitude))).toEqual(['2', '3'])
    expect(entries.map((e) => e.odds)).toEqual([{ n: 4, d: 13 }, { n: 9, d: 13 }])
  })
})
