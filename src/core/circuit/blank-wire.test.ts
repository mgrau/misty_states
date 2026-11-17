/**
 * Blank space on a wire: `_ 2`, or `M _ _` along a row.
 *
 * An identity that is not drawn, so a gate on one output need not stand beside
 * lengths of pipe on all the others. The qubit is still there and untouched.
 */

import { describe, expect, it } from 'vitest'
import { parseCircuit } from './parse'
import { layoutCircuit } from './layout'
import { canonical, simulate } from './simulate'
import type { PipePrim } from '../render/primitives'

const doc = (src: string) => parseCircuit(src)
const pipesOn = (src: string, x: number): PipePrim[] =>
  layoutCircuit(doc(src)).prims.filter((p): p is PipePrim => p.t === 'pipe' && Math.abs(p.cx - x) < 0.01)
const xOf = (src: string, q: number) => layoutCircuit(doc(src)).geometry.columns[q - 1]

describe('writing it', () => {
  it('is an identity marked as a gap', () => {
    expect(doc('in 00\n_ 2').layers[0].gates[0]).toMatchObject({ kind: 'identity', qubit: 2, gap: true })
  })

  it('takes the next free wire along a row', () => {
    const gates = doc('in 000\nM _ _').layers[0].gates
    expect(gates).toMatchObject([
      { kind: 'measure', qubit: 1 },
      { kind: 'identity', qubit: 2, gap: true },
      { kind: 'identity', qubit: 3, gap: true },
    ])
  })

  it('blanks each wire of a range', () => {
    const gates = doc('in 000\n_ 2-3; M 1').layers[0].gates
    expect(gates.filter((g) => g.kind === 'identity' && g.gap).map((g) => (g as { qubit: number }).qubit)).toEqual([2, 3])
  })

  it('can be given height but not width, and cannot bend', () => {
    expect(() => doc('_ 1 height=2')).not.toThrow()
    expect(() => doc('_ 1-2 height=2')).not.toThrow()
    expect(() => doc('_ 1 width=2')).toThrow(/blank is empty space/)
    expect(() => doc('_ 1 shift=1')).toThrow(/cannot bend/)
  })
})

describe('the state', () => {
  it('is left exactly as it was', () => {
    const with_ = simulate(doc('in 0(0|1)\nCNOT 2 1\nX _'), 2)
    const without = simulate(doc('in 0(0|1)\nCNOT 2 1\nX 1'), 2)
    expect(canonical(with_)).toEqual(canonical(without))
  })
})

describe('drawing it', () => {
  it('leaves a blank wire with no pipe past the last gate it was in', () => {
    const plain = 'in 000\nH 1; H 2; H 3\nM 1'
    const blank = 'in 000\nH 1; H 2; H 3\nM _ _'
    const before = pipesOn(plain, xOf(plain, 3))
    const after = pipesOn(blank, xOf(blank, 3))
    // Above the H and its stub below; nothing running on past the measurement.
    expect(Math.max(...after.map((p) => p.y1))).toBeLessThan(Math.max(...before.map((p) => p.y1)))
    expect(after).toHaveLength(2)
  })

  it('runs blanks in a row together, then opens the pipe again where the wire is used', () => {
    const s = 'in 00\nH 1; H 2\n_ 2; X 1\n_ 2; X 1\nCNOT 1 2'
    const runs = pipesOn(s, xOf(s, 2)).sort((a, b) => a.y0 - b.y0)
    // Into the H, its stub, back into the CNOT, and the CNOT's own stub — no
    // sliver between the two blanks.
    expect(runs).toHaveLength(4)
    expect(runs.map((r) => r.openTop)).toEqual([true, false, true, false])
  })

  it('never starts a wire blank from the top', () => {
    const s = 'in 00\nH 1; _ 2\nCNOT 1 2'
    const runs = pipesOn(s, xOf(s, 2)).sort((a, b) => a.y0 - b.y0)
    // Out of nowhere into the CNOT, and its stub: nothing down from the top.
    expect(runs).toHaveLength(2)
    expect(runs[0].openTop).toBe(true)
    expect(runs[0].y0).toBeGreaterThan(layoutCircuit(doc(s)).geometry.pipeTop + 1)
  })
})
