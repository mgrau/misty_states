/**
 * Bending a wire: `I 3 shift=2` and `I 3 -> 5`.
 *
 * A bend moves where a wire is drawn and nothing else, so the properties worth
 * holding are that the arithmetic never notices, that the wire is drawn as one
 * pipe wherever it goes, that everything after the bend — gates, states, the
 * animation, a drop — follows it there, and that two wires never run into each
 * other on the way.
 */

import { describe, expect, it } from 'vitest'
import { parseCircuit } from './parse'
import { layoutCircuit } from './layout'
import { canonical, simulate } from './simulate'
import { buildTimeline } from './animate'
import { dropTarget } from './edit'
import { planWires } from './wires'
import { render } from '../index'
import type { PipePrim, Prim } from '../render/primitives'

const doc = (src: string) => parseCircuit(src)
const positions = (src: string) => {
  const d = doc(src)
  return planWires(d.qubits, d.layers, d.start, d.startLine).at
}
const pipes = (prims: Prim[]): PipePrim[] => prims.filter((p): p is PipePrim => p.t === 'pipe')

const TELEPORT = 'in 000\nH 2\nCNOT 2 -> 3\nI 3 shift=2\nCNOT 1 -> 2\nH 1\nM 1; M 2'

describe('writing it', () => {
  it('reads a shift and a destination', () => {
    expect(doc('I 3 shift=2').layers[0].gates[0]).toMatchObject({ kind: 'identity', qubit: 3, move: { by: 2 } })
    expect(doc('I 3 -> 5').layers[0].gates[0]).toMatchObject({ kind: 'identity', qubit: 3, move: { to: 5 } })
    expect(doc('I 1 shift=-1.5').layers[0].gates[0]).toMatchObject({ move: { by: -1.5 } })
  })

  it('leaves a wire where it was last put', () => {
    expect(positions('I 3 shift=2\nH 1\nI 3 shift=-1\nI 3 -> 3')).toEqual([
      [1, 2, 3], [1, 2, 5], [1, 2, 5], [1, 2, 4], [1, 2, 3],
    ])
  })

  it('says what is wrong rather than guessing', () => {
    expect(() => doc('H 1 shift=2')).toThrow(/only I bends a wire/)
    expect(() => doc('I 1 shift=x')).toThrow(/shift= takes a number/)
    expect(() => doc('I 1 -> abc')).toThrow(/not a position/)
    expect(() => doc('I 1 -> 5 shift=1')).toThrow(/not both/)
    expect(() => doc('I 1 shift=0.2')).toThrow(/no room to turn/)
  })

  it('is fenced: nothing packs in beside it or past it', () => {
    const d = doc('H 1\nI 3 shift=2\nH 2')
    expect(d.layers.map((l) => l.gates.map((g) => g.kind))).toEqual([['single'], ['identity'], ['single']])
  })

  it('cannot be folded into a box', () => {
    expect(() => doc('"U" collapsed {\nI 2 shift=2\n}')).toThrow(/moves a wire/)
  })

  it('moves along with a definition used on other wires', () => {
    const d = doc('def hop {\nI 1 -> 3\n}\nhop 2')
    expect(planWires(d.qubits, d.layers).at.at(-1)?.[1]).toBe(4)
  })
})

describe('starting apart', () => {
  it('puts each wire where the wires line says', () => {
    expect(positions('wires 1 4 5\nH 1')[0]).toEqual([1, 4, 5])
  })

  it('puts a wire it leaves out a column past the one before', () => {
    expect(positions('wires 1 4\nin 000')[0]).toEqual([1, 4, 5])
    expect(doc('wires 1 4 5').qubits).toBe(3)
  })

  it('moves wires from where they start', () => {
    expect(positions('wires 1 4 5\nI 2 -> 2').at(-1)).toEqual([1, 2, 5])
    expect(positions('wires 1 4 5\nI 2 shift=-2').at(-1)).toEqual([1, 2, 5])
  })

  it('packs gates by where the wires start', () => {
    // Wire 3 starts between 1 and 2, so a CNOT across them covers it.
    const d = doc('wires 1 3 2\nCNOT 1 -> 2\nX 3')
    expect(d.layers).toHaveLength(2)
  })

  it('draws the wires and the input where they start', () => {
    const { geometry, prims } = layoutCircuit(doc('wires 1 4 5\nin 000\nH 1'))
    const pitch = geometry.columns[1] / 3
    expect(geometry.columns).toEqual([0, 3 * pitch, 4 * pitch])
    const input = prims.filter((p) => p.t === 'qubit' && p.cy < geometry.pipeTop)
    expect(input.map((p) => (p.t === 'qubit' ? p.cx : 0))).toEqual(geometry.columns)
  })

  it('says what is wrong rather than guessing', () => {
    expect(() => doc('wires 1 1.5')).toThrow(/start on top of each other/)
    expect(() => doc('wires 1 x')).toThrow(/wires takes where each wire starts/)
    expect(() => doc('H 1\nwires 1 4')).toThrow(/goes above the gates/)
    expect(() => doc('wires 1 4 5\nI 2 -> 5.5')).toThrow(/would land on wire 3/)
  })
})

describe('collisions', () => {
  it('lets wires cross, as long as they do not land on each other', () => {
    expect(positions('in 000\nI 1 shift=3')[1]).toEqual([4, 2, 3])
    expect(() => doc('I 3 -> 2\nH 1')).toThrow(/would land on wire 2/)
    expect(() => doc('in 000\nI 1 -> 2.5')).toThrow(/wires stay a column apart/)
  })

  it('catches a wire that is only mentioned later', () => {
    expect(() => doc('I 1 -> 4\nH 4')).toThrow(/would land on wire 4/)
  })

  it('keeps two turns in one layer off each other', () => {
    expect(() => doc('I 1 shift=3; I 2 shift=3')).toThrow(/turn into each other/)
    expect(() => doc('in 0000\nI 1 shift=-1; I 4 shift=1')).not.toThrow()
  })

  it('will not turn through a gate', () => {
    expect(() => doc('H 2; I 1 shift=3')).toThrow(/turn through the gate on wire 2/)
    expect(() => doc('H 3; I 1 shift=-1')).not.toThrow()
  })
})

describe('the arithmetic', () => {
  it('never notices', () => {
    const unmeasured = TELEPORT.replace('\nM 1; M 2', '')
    const plain = doc(unmeasured.replace('I 3 shift=2\n', ''))
    const bent = doc(unmeasured)
    expect(canonical(simulate(bent, bent.layers.length))).toEqual(
      canonical(simulate(plain, plain.layers.length)),
    )
  })
})

describe('packing', () => {
  it('counts a wire by where it stands, not by its number', () => {
    // Wire 3 has moved in between 1 and 2, so the CNOT covers it.
    const d = doc('in 0000\nI 1 -> 0\nI 4 -> 1\nCNOT 1 -> 2\nX 4')
    const last = d.layers.slice(-2).map((l) => l.gates.map((g) => g.kind))
    expect(last).toEqual([['controlled'], ['controlled']])
    // And one that has moved away no longer is.
    const e = doc('in 000\nI 2 -> 5\nCNOT 1 -> 3\nX 2')
    expect(e.layers.at(-1)?.gates).toHaveLength(2)
  })

  it('refuses a ";" that would put a wire under a gate', () => {
    expect(() => doc('in 000\nI 3 -> 1.5\nCNOT 1 -> 2; X 3')).toThrow()
  })
})

describe('drawing it', () => {
  it('draws the wire as one pipe that turns, and the rest straight', () => {
    const { prims, geometry } = layoutCircuit(doc(TELEPORT))
    const turned = pipes(prims).filter((p) => p.turns?.length)
    expect(turned).toHaveLength(1)
    const [pipe] = turned
    expect(pipe.cx).toBe(geometry.columns[2])
    expect(pipe.turns![0].x).toBe(geometry.columnsAt.at(-1)![2])
    expect(pipe.turns![0].x - pipe.cx).toBeCloseTo(2 * (geometry.columns[1] - geometry.columns[0]))
  })

  it('publishes where the wires are, layer by layer', () => {
    const { geometry } = layoutCircuit(doc(TELEPORT))
    const pitch = geometry.columns[1] - geometry.columns[0]
    expect(geometry.columnsAt).toHaveLength(doc(TELEPORT).layers.length + 1)
    expect(geometry.columnsAt.at(-1)).toEqual([0, pitch, 4 * pitch])
    expect(geometry.turns).toEqual([
      expect.objectContaining({ qubit: 3, layer: 2, x0: 2 * pitch, x1: 4 * pitch }),
    ])
  })

  it('gives a bend room for both its elbows', () => {
    const { geometry } = layoutCircuit(doc(TELEPORT))
    const { r, y } = geometry.turns[0]
    const band = geometry.layers[2]
    expect(y - r).toBeGreaterThan(band.y)
    expect(y + r).toBeLessThan(band.y + band.h)
  })

  it('puts the output over the wires where they ended up', () => {
    const { prims, geometry } = layoutCircuit(doc('in 00\nI 2 shift=2\nout 01'))
    const qubits = prims.filter((p) => p.t === 'qubit' && p.cy > geometry.pipeBottom)
    expect(qubits.map((p) => (p.t === 'qubit' ? p.cx : 0))).toEqual(geometry.columnsAt.at(-1))
  })

  it('draws a crossing in front of the wire it crosses, and only then', () => {
    const crossing = pipes(layoutCircuit(doc('in 000\nI 1 shift=3')).prims).filter((p) => p.cut)
    expect(crossing).toHaveLength(1)
    const clear = pipes(layoutCircuit(doc(TELEPORT)).prims).filter((p) => p.cut)
    expect(clear).toHaveLength(0)
  })

  it('widens the drawing to take in where the wires go', () => {
    const plain = render('in 000\nH 1', { check: false }).width
    const bent = render('in 000\nH 1\nI 3 shift=3', { check: false }).width
    expect(bent).toBeGreaterThan(plain)
  })

  it('draws in every theme', () => {
    for (const theme of ['solid', 'flat', 'isometric'] as const) {
      const { svg } = render(TELEPORT, { theme, check: false })
      expect(svg).toContain(' A')
      if (theme === 'solid') expect(svg).toContain('radialGradient')
    }
  })
})

describe('following it', () => {
  it('carries a travelling qubit across with its wire', () => {
    const d = doc('in 00\nX 1\nI 2 shift=2\nCNOT 1 -> 2\nanimate')
    const { geometry } = layoutCircuit(d, { bareEnds: true })
    const track = buildTimeline(d, geometry, d.animate).tracks[1]
    expect(track.stops[0].x).toBe(geometry.columns[1])
    expect(track.stops.at(-1)!.x).toBe(geometry.columnsAt.at(-1)![1])
  })

  it('drops onto the wire where it is at that height', () => {
    const { geometry } = layoutCircuit(doc('in 00\nH 1\nI 2 shift=2\nH 1'))
    const last = geometry.layers.at(-1)!
    const x = geometry.columnsAt.at(-1)![1]
    expect(dropTarget(geometry, { x, y: last.y + last.h / 2 }).wire).toBe(2)
    // Above the bend, the same spot is clear of the register.
    const first = geometry.layers[0]
    expect(dropTarget(geometry, { x, y: first.y + first.h / 2 }).wire).toBe(3)
  })
})
