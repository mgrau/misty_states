/**
 * Editing a circuit by pointing at it.
 *
 * The property under test throughout: a drop lands where it was aimed, and
 * everything else about the document — its comments, its layer breaks, its
 * annotations — comes back untouched. Both halves matter. A patch that places
 * the gate correctly by reprinting the file would pass the first and fail the
 * second, and the second is why the text is patched rather than regenerated.
 */

import { describe, expect, it } from 'vitest'
import { parseCircuit } from './parse'
import { layoutCircuit } from './layout'
import {
  asDroppable, dropTarget, gateAt, gateLine, insertGate, moveGate, removeGate,
  type Droppable, type DropTarget,
} from './edit'
import { DEFAULT_METRICS } from '../render/primitives'
import { DEFAULT_SHAPE_ORDER } from '../shapes'
import { THEMES } from '../render/themes'

const H: Droppable = { head: 'H', wires: 1 }
const CNOT: Droppable = { head: 'CNOT', wires: 2 }
const TOFFOLI: Droppable = { head: 'TOFFOLI', wires: 3 }

const at = (wire: number, layer: number, where: DropTarget['where']): DropTarget =>
  ({ wire, layer, where })

const drop = (source: string, target: DropTarget, gate: Droppable) =>
  insertGate(source, parseCircuit(source), target, gate).source

const geometryOf = (source: string) =>
  layoutCircuit(parseCircuit(source), {
    metrics: DEFAULT_METRICS,
    shapeOrder: DEFAULT_SHAPE_ORDER,
    attach: THEMES.flat.attach,
  }).geometry

describe('reading a position off the drawing', () => {
  const source = 'in 00\nH 1\nCNOT 1 2'

  it('picks the nearest wire', () => {
    const g = geometryOf(source)
    expect(dropTarget(g, { x: g.columns[0], y: g.layers[0].y + 20 }).wire).toBe(1)
    expect(dropTarget(g, { x: g.columns[1], y: g.layers[0].y + 20 }).wire).toBe(2)
  })

  it('offers one past the end, which is how the register widens', () => {
    const g = geometryOf(source)
    const gap = g.columns[1] - g.columns[0]
    expect(dropTarget(g, { x: g.columns[1] + gap, y: g.layers[0].y + 20 }).wire).toBe(3)
  })

  it('lands on a layer from its middle and between from its edges', () => {
    const g = geometryOf(source)
    const layer = g.layers[0]
    const x = g.columns[0]
    expect(dropTarget(g, { x, y: layer.y + layer.h / 2 }).where).toBe('in')
    expect(dropTarget(g, { x, y: layer.y + 1 }).where).toBe('before')
    expect(dropTarget(g, { x, y: layer.y + layer.h - 1 }).where).toBe('after')
  })

  it('reads above and below the circuit as its ends', () => {
    const g = geometryOf(source)
    const x = g.columns[0]
    expect(dropTarget(g, { x, y: g.layers[0].y - 50 })).toMatchObject({ layer: 0, where: 'before' })
    expect(dropTarget(g, { x, y: 10_000 })).toMatchObject({ layer: 1, where: 'after' })
  })

  it('has somewhere to put the first gate of an empty circuit', () => {
    const g = geometryOf('in 00')
    expect(g.layers).toHaveLength(0)
    expect(dropTarget(g, { x: g.columns[0], y: 0 })).toMatchObject({ layer: 0, where: 'after' })
  })
})

describe('writing the gate onto a wire', () => {
  it('puts a one-wire gate where it was dropped', () => {
    expect(gateLine(H, 2, 3)).toBe('H 2')
  })

  it('starts a wide gate on that wire and takes the ones below', () => {
    expect(gateLine(CNOT, 1, 3)).toBe('CNOT 1 2')
    expect(gateLine(TOFFOLI, 1, 3)).toBe('TOFFOLI 1 2 3')
  })

  it('grows the register by at most one wire', () => {
    // Dropped off the end of two wires, a pair lands against the end.
    expect(gateLine(CNOT, 9, 2)).toBe('CNOT 2 3')
    // And a gate too wide for the register starts at the top rather than hanging off.
    expect(gateLine(TOFFOLI, 2, 2)).toBe('TOFFOLI 1 2 3')
  })

  it('writes the forms each keyword wants', () => {
    expect(gateLine({ head: 'measure', wires: 1, tail: 'Z' }, 2, 3)).toBe('measure 2 Z')
    expect(gateLine({ head: 'box', wires: 2, label: '"U"', range: true }, 1, 3)).toBe('box "U" 1-2')
  })
})

describe('patching the source', () => {
  it('shares a layer when the wires are free', () => {
    expect(drop('in 00\nH 1', at(2, 0, 'in'), H)).toBe('in 00\nH 1; H 2')
  })

  it('writes a new line instead when they are not', () => {
    expect(drop('in 00\nH 1', at(1, 0, 'in'), H)).toBe('in 00\nH 1\nH 1')
  })

  it('keeps the annotations either side of the line it extends', () => {
    expect(drop('in 00\nstep one: H 1 : the split', at(2, 0, 'in'), H)).toBe(
      'in 00\nstep one: H 1; H 2 : the split',
    )
  })

  it('puts the first gate of an empty circuit after what sets it up', () => {
    expect(drop('qubits 3\nin 000', at(2, 0, 'after'), H)).toBe('qubits 3\nin 000\nH 2')
  })

  it('goes above the output rather than after it', () => {
    expect(drop('in 00\nH 1\nout 00|11', at(2, 0, 'after'), H).split('\n').pop()).toBe('out 00|11')
  })

  it('leaves comments and layer breaks exactly where they were', () => {
    const source = 'in 00  # the input\nH 1\n---\nCNOT 1 2'
    const after = drop(source, at(1, 1, 'after'), H)
    expect(after).toContain('# the input')
    expect(after.split('\n').filter((l) => l.trim() === '---')).toHaveLength(1)
  })
})

describe('the gate lands where it was aimed', () => {
  /** Which layer of the patched document the new line ended up in. */
  const landedIn = (before: string, after: string): number => {
    const doc = parseCircuit(after)
    const lines = before.split('\n')
    const grown = after.split('\n')
    // The first line that differs — stepping over a break, which is written
    // ahead of the gate rather than being it.
    let i = 0
    while (i < lines.length && lines[i] === grown[i]) i++
    if (grown[i]?.trim() === '---') i++
    return doc.layers.findIndex((l) => l.lines.includes(i + 1))
  }

  const cases: [string, string, DropTarget, Droppable][] = [
    ['before the first layer', 'in 00\nH 1\nCNOT 1 2', at(2, 0, 'before'), H],
    ['before a later layer', 'in 00\nH 1\nCNOT 1 2', at(2, 1, 'before'), H],
    ['after the first layer', 'in 00\nH 1\nCNOT 1 2', at(2, 0, 'after'), H],
    ['at the end', 'in 00\nH 1\nCNOT 1 2', at(1, 1, 'after'), CNOT],
    ['onto a written output', 'in 00\nH 1\nout 00|11', at(2, 0, 'after'), H],
    ['past the end of the register', 'in 00\nH 1', at(3, 0, 'after'), CNOT],
  ]

  for (const [name, source, target, gate] of cases) {
    it(name, () => {
      const after = drop(source, target, gate)
      const want = target.where === 'after' ? target.layer + 1 : target.layer
      expect(landedIn(source, after)).toBe(want)
    })
  }

  it('forces a break only when the packer would float the gate away', () => {
    // Nothing is in the way below the first layer, so the gate can simply be
    // written and no break is needed.
    expect(drop('in 00\nH 1', at(2, 0, 'in'), H)).not.toContain('---')
    // Here it would pack up alongside the H, so a break holds it down.
    expect(drop('in 00\nH 1\nCNOT 1 2', at(2, 1, 'before'), H)).toContain('---')
  })

  it('always produces something that parses', () => {
    const source = 'in 000\nH 1\n---\nCNOT 1 2; H 3\nSWAP 2 3'
    const doc = parseCircuit(source)
    for (let wire = 1; wire <= 4; wire++) {
      for (let layer = 0; layer < doc.layers.length; layer++) {
        for (const where of ['in', 'before', 'after'] as const) {
          for (const gate of [H, CNOT, TOFFOLI]) {
            const after = insertGate(source, doc, { wire, layer, where }, gate)
            expect(() => parseCircuit(after.source)).not.toThrow()
            // And it says which line it wrote, which is what marks it on screen.
            expect(after.source.split('\n')[after.line - 1]).toContain(gate.head)
          }
        }
      }
    }
  })
})

describe('picking a gate back up', () => {
  /**
   * One parse, not two. A gate is identified by *being* one of the document's
   * gates, so handing `removeGate` a gate from a second parse of the same text
   * would look right and match nothing.
   */
  const cutting = (source: string, layer: number, i = 0) => {
    const doc = parseCircuit(source)
    return removeGate(source, doc, doc.layers[layer].gates[i])
  }

  it('finds the gate under the pointer', () => {
    const source = 'in 00\nH 1\nCNOT 1 2'
    const doc = parseCircuit(source)
    const g = geometryOf(source)
    const found = gateAt(doc, g, { x: g.columns[0], y: g.layers[0].y + g.layers[0].h / 2 })
    expect(found?.kind).toBe('single')
  })

  it('finds nothing in the space between layers', () => {
    const source = 'in 00\nH 1\nCNOT 1 2'
    const doc = parseCircuit(source)
    const g = geometryOf(source)
    // Above the first layer is the input state, not a gate.
    expect(gateAt(doc, g, { x: g.columns[0], y: g.layers[0].y - 20 })).toBeUndefined()
  })

  it('takes the whole line when nothing else is on it', () => {
    const source = 'in 00\nH 1\nCNOT 1 2'
    const cut = cutting(source, 0)
    expect(cut?.source).toBe('in 00\nCNOT 1 2')
    expect(cut?.layerRemoved).toBe(0)
  })

  it('takes one statement off a shared line and leaves the rest', () => {
    const source = 'in 000\nH 1; X 3\nCNOT 1 2'
    const cut = cutting(source, 0, 1)
    expect(cut?.source).toBe('in 000\nH 1\nCNOT 1 2')
    // The layer is still there, so nothing below it shifts.
    expect(cut?.layerRemoved).toBeUndefined()
  })

  it('keeps the annotations on a line it thins out', () => {
    const source = 'in 000\nstep: H 1; X 3 : note'
    const cut = cutting(source, 0, 0)
    expect(cut?.source).toBe('in 000\nstep: X 3 : note')
  })
})

describe('moving a gate that is already there', () => {
  const moved = (source: string, layer: number, i: number, target: DropTarget) => {
    const doc = parseCircuit(source)
    return moveGate(source, doc, doc.layers[layer].gates[i], target)?.source
  }

  it('takes it out of one place and puts it in another', () => {
    expect(moved('in 00\nH 1\nCNOT 1 2', 0, 0, at(2, 1, 'after'))).toBe('in 00\nCNOT 1 2\nH 2')
  })

  it('lets a gate join a layer it was not in', () => {
    expect(moved('in 000\nH 1\nCNOT 1 2', 1, 0, at(2, 0, 'in'))).toBe('in 000\nH 1; CNOT 2 3')
  })

  it('leaves the document alone when put back where it came from', () => {
    const source = 'in 00\nH 1\nCNOT 1 2'
    expect(moved(source, 0, 0, at(1, 0, 'in'))).toBe(source)
  })

  it('writes each kind of gate back out as itself', () => {
    const source = 'in 000\nH 1\nCZ 1 2\nSWAP 1 2\nmeasure 3 X\nbox "U" 1-2\nblank 1-2'
    const doc = parseCircuit(source)
    // Sorted, because the packer decides the order and that is not the point.
    const heads = doc.layers.flatMap((l) => l.gates).map((g) => asDroppable(g).head).sort()
    expect(heads).toEqual(['CZ', 'H', 'SWAP', 'blank', 'box', 'measure'])
    expect(asDroppable(parseCircuit('X 1').layers[0].gates[0]).head).toBe('X')
    expect(asDroppable(parseCircuit('TOFFOLI 1 2 3').layers[0].gates[0])).toMatchObject({
      head: 'TOFFOLI',
      wires: 3,
    })
  })

  it('always produces something that parses, wherever it is put', () => {
    const source = 'in 000\nH 1; X 3\n---\nCNOT 1 2\nSWAP 2 3'
    const doc = parseCircuit(source)
    const all = doc.layers.flatMap((l, layer) => l.gates.map((gate) => ({ gate, layer })))
    for (const { gate } of all) {
      for (let wire = 1; wire <= 3; wire++) {
        for (let layer = 0; layer < doc.layers.length; layer++) {
          for (const where of ['in', 'before', 'after'] as const) {
            const out = moveGate(source, doc, gate, { wire, layer, where })
            expect(out).not.toBeNull()
            expect(() => parseCircuit(out!.source)).not.toThrow()
          }
        }
      }
    }
  })
})
