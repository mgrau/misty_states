/**
 * Naming a wire: `tag 2`, or `tag` for all of them.
 *
 * A tag says which physical qubit a pipe is and nothing about what it holds,
 * so it is drawn as the wire's shape in outline only, does nothing to the
 * state, and takes less room than a gate.
 */

import { describe, expect, it } from 'vitest'
import { parseCircuit } from './parse'
import { layoutCircuit } from './layout'
import { canonical, simulate } from './simulate'
import { render } from '../index'
import type { QubitPrim } from '../render/primitives'

const doc = (src: string) => parseCircuit(src)
const outlines = (src: string): QubitPrim[] =>
  layoutCircuit(doc(src)).prims.filter((p): p is QubitPrim => p.t === 'qubit' && !!p.outline)

describe('writing it', () => {
  it('names the wires it is given', () => {
    expect(doc('in 000\ntag 2').layers[0].gates[0]).toMatchObject({ kind: 'tag', qubits: [2] })
    expect(doc('in 000\ntag 1-3').layers[0].gates[0]).toMatchObject({ qubits: [1, 2, 3] })
  })

  it('names every wire when given none, however many there turn out to be', () => {
    expect(doc('tag\nH 1\nCNOT 2 3').layers[0].gates[0]).toMatchObject({ qubits: [1, 2, 3] })
  })

  it('takes a layer of its own when it names every wire', () => {
    expect(doc('H 1\ntag\nH 2').layers).toHaveLength(3)
  })

  it('cannot be widened', () => {
    expect(() => doc('tag 1 width=2')).toThrow(/no box to widen/)
    expect(() => doc('tag 1 height=2')).not.toThrow()
  })
})

describe('the arithmetic', () => {
  it('never notices', () => {
    const tagged = doc('in 0\ntag\nH 1\ntag')
    expect(canonical(simulate(tagged, tagged.layers.length))).toEqual(
      canonical(simulate(doc('in 0\nH 1'), 1)),
    )
  })
})

describe('drawing it', () => {
  it('is each wire’s own shape, in outline, on its pipe', () => {
    const { geometry } = layoutCircuit(doc('in 000\ntag'))
    const marks = outlines('in 000\ntag')
    expect(marks.map((p) => p.shape)).toEqual(geometry.shapes)
    expect(marks.map((p) => p.cx)).toEqual(geometry.columns)
  })

  it('leaves the pipe whole, to show through the outline', () => {
    const pipes = layoutCircuit(doc('in 0\ntag')).prims.filter((p) => p.t === 'pipe')
    expect(pipes).toHaveLength(1)
  })

  it('is shorter than a gate', () => {
    const { geometry } = layoutCircuit(doc('in 0\ntag\nH 1'))
    expect(geometry.layers[0].h).toBeLessThan(geometry.layers[1].h)
  })

  it('follows a wire that has moved', () => {
    const { geometry } = layoutCircuit(doc('wires 1 4\nI 2 -> 2\ntag 2'))
    expect(outlines('wires 1 4\nI 2 -> 2\ntag 2')[0].cx).toBe(geometry.columnsAt.at(-1)![1])
  })

  it('draws with no fill in every theme', () => {
    for (const theme of ['solid', 'flat', 'isometric'] as const) {
      expect(render('in 0\ntag', { theme, check: false }).svg).toContain('fill="none"')
    }
  })
})
