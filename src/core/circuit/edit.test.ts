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
import { detectMode, render } from '../index'
import { GATE_GALLERY } from '../gates'
import {
  asDroppable, cycleTarget, dropTarget, gateAt, gateLine, insertGate, moveGate, removeGate,
  setAngle,
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

describe('moving a target round its own wires', () => {
  /** Spin the first gate of a layer n times, reporting the line each time. */
  const spin = (source: string, times: number, layer = 0, i = 0) => {
    const out: string[] = []
    let cur = source
    for (let n = 0; n < times; n++) {
      const doc = parseCircuit(cur)
      const next = cycleTarget(cur, doc, doc.layers[layer].gates[i])
      if (!next) return out.concat('(refused)')
      cur = next.source
      out.push(cur.split('\n')[next.line - 1])
    }
    return out
  }

  it('swaps the two wires of a CNOT and comes back', () => {
    expect(spin('in 00\nCNOT 1 -> 2', 2)).toEqual(['CNOT 2 -> 1', 'CNOT 1 -> 2'])
  })

  it('goes round all three wires of a Toffoli', () => {
    expect(spin('in 000\nTOFFOLI 1 2 3', 3)).toEqual([
      'TOFFOLI 2 3 1',
      'TOFFOLI 1 3 2',
      'TOFFOLI 1 2 3',
    ])
  })

  it('writes it back the way it was written', () => {
    // The arrow only where there was one, and the keyword as it was typed.
    expect(spin('in 00\nCNOT 1 2', 1)).toEqual(['CNOT 2 1'])
    expect(spin('qubits 3\nCX 3 1', 1)).toEqual(['CX 1 3'])
  })

  it('keeps a name on whichever side it was on', () => {
    expect(spin('in 00\nCNOT 1 2 "Tiger?"', 1)).toEqual(['CNOT 2 1 "Tiger?"'])
    expect(spin('in 000\nCNOT "Oracle" 1 3', 1)).toEqual(['CNOT "Oracle" 3 1'])
  })

  it('leaves its line-mates alone', () => {
    expect(spin('in 000\nH 3; CNOT 1 2', 1, 0, 1)).toEqual(['H 3; CNOT 2 1'])
  })

  it('refuses where there is no target to move', () => {
    // Controlled-Z is symmetric, and a bare NOT has no controls to swap with.
    expect(spin('in 00\nCZ 1 2', 1)).toEqual(['(refused)'])
    expect(spin('in 00\nX 1', 1)).toEqual(['(refused)'])
    expect(spin('in 00\nH 1', 1)).toEqual(['(refused)'])
  })

  it('never changes which wires the gate covers', () => {
    const wires = (src: string) => {
      const g = parseCircuit(src).layers[0].gates[0]
      return g.kind === 'controlled' ? [...g.controls, g.target].sort() : []
    }
    let cur = 'in 000\nTOFFOLI 1 2 3'
    const want = wires(cur)
    for (let n = 0; n < 5; n++) {
      const doc = parseCircuit(cur)
      cur = cycleTarget(cur, doc, doc.layers[0].gates[0])!.source
      expect(wires(cur)).toEqual(want)
    }
  })
})

/**
 * A state is a circuit nothing has been done to yet.
 *
 * That is what lets a gate be dragged onto one: the bare state line at the top
 * of a document *is* the input, so a gate dropped on it belongs underneath, and
 * the result is a circuit.
 */
describe('starting a circuit from a state', () => {
  const put = (source: string, wire = 1) =>
    insertGate(source, parseCircuit(source), at(wire, 0, 'after'), H).source

  it('goes under a bare state line, not over it', () => {
    expect(put('00|11', 2)).toBe('00|11\nH 2')
    expect(put('0(0|1)')).toBe('0(0|1)\nH 1')
  })

  it('knows the line whether the input was named or not', () => {
    expect(parseCircuit('00|11').inputLine).toBe(1)
    expect(parseCircuit('# a note\n\nin 00|11').inputLine).toBe(3)
    expect(parseCircuit('H 1').inputLine).toBeUndefined()
  })

  it('still goes after anything that sets the register up', () => {
    expect(put('qubits 3\n000', 3)).toBe('qubits 3\n000\nH 3')
    expect(put('shape os\nin 00', 2)).toBe('shape os\nin 00\nH 2')
  })

  it('turns the document into a circuit, which is the point', () => {
    const after = put('00|11')
    expect(detectMode('00|11')).toBe('state')
    expect(detectMode(after)).toBe('circuit')
    // And the state it was is now the state it starts from.
    expect(parseCircuit(after).layers).toHaveLength(1)
    expect(render(after).dirac).toEqual(render('00|11').dirac?.map(() => expect.any(String)))
  })

  it('reports the register width for a state as well as a circuit', () => {
    // A gate has to land on one of its wires, so there have to be wires.
    expect(render('00|11').qubits).toBe(2)
    expect(render('000|-111').qubits).toBe(3)
    expect(render('in 00\nH 1').qubits).toBe(2)
  })
})

describe('moving a gate keeps it the gate it was', () => {
  const moved = (source: string, target: DropTarget) => {
    const doc = parseCircuit(source)
    const out = moveGate(source, doc, doc.layers[0].gates[0], target)?.source ?? ''
    return out.split('\n').find((l) => /CNOT|TOFFOLI|CZ/.test(l))
  }
  const down = at(1, 1, 'after')

  it('keeps the target on the wire it was on', () => {
    // The whole point of a controlled gate is which wire takes the ⊕. Picking
    // one up and putting it down must not quietly turn it round.
    expect(moved('in 000\nCNOT 2 -> 1\nH 3', down)).toBe('CNOT 2 -> 1')
    expect(moved('in 0000\nTOFFOLI 1 3 -> 2\nH 4', at(2, 1, 'after')))
      .toBe('TOFFOLI 2 4 -> 3')
  })

  it('points at the target where the bare form cannot', () => {
    // `CNOT 2 1` means the last wire is the target, so a target that is *not*
    // last has to be written with the arrow whatever the original used.
    expect(moved('in 000\nCNOT 2 1\nH 3', down)).toBe('CNOT 2 -> 1')
  })

  it('keeps the arrow where there was one, and leaves it off where there was not', () => {
    expect(moved('in 000\nCNOT 1 -> 2\nH 3', down)).toBe('CNOT 1 -> 2')
    expect(moved('in 000\nCNOT 1 2\nH 3', down)).toBe('CNOT 1 2')
  })

  it('keeps a name on the side that decides what kind of name it is', () => {
    // Before the wires it stands on the target; after them it labels the link.
    expect(moved('in 000\nCNOT 2 -> 1 "Tiger?"\nH 3', at(2, 1, 'after')))
      .toBe('CNOT 3 -> 2 "Tiger?"')
    expect(moved('in 000\nCNOT "Oracle" 2 -> 1\nH 3', at(2, 1, 'after')))
      .toBe('CNOT "Oracle" 3 -> 2')
  })

  it('leaves a symmetric gate alone', () => {
    expect(moved('in 000\nCZ 1 2\nH 3', at(2, 1, 'after'))).toBe('CZ 2 3')
  })

  it('drops a fresh one from the palette with its target last, as ever', () => {
    const source = 'in 000\nH 1'
    const doc = parseCircuit(source)
    expect(insertGate(source, doc, at(1, 0, 'after'), CNOT).source).toContain('CNOT 1 2')
  })
})

/**
 * Dropping a window.
 *
 * A view is not a gate: it does not sit on a wire, it breaks across all of
 * them, and what it holds is worked out rather than chosen. So the thing being
 * dropped says what it *shows* instead of how many wires it takes.
 */
describe('dropping a view into a circuit', () => {
  const WINDOW: Droppable = { head: 'window', wires: 1, shows: 'calculate' }
  const put = (source: string, target: DropTarget) =>
    insertGate(source, parseCircuit(source), target, WINDOW).source

  it('shows the state at that point, worked out', () => {
    expect(put('in 00\nH 1\nCNOT 1 2', at(1, 0, 'after')))
      .toBe('in 00\nH 1\nwindow calculate\nCNOT 1 2')
  })

  it('takes a layer of its own, never a share of one', () => {
    // A view fences its layer at both ends, so `;` onto a gate line is not a
    // placement it has — aiming at one is read as aiming just below it.
    expect(put('in 00\nH 1\nCNOT 1 2', at(1, 0, 'in'))).not.toContain(';')
    expect(put('in 00\nH 1\nCNOT 1 2', at(1, 0, 'in')))
      .toBe('in 00\nH 1\nwindow calculate\nCNOT 1 2')
  })

  it('asks the question instead where the arithmetic cannot follow', () => {
    // A custom box does not say what it does, so there is nothing to calculate
    // — and a window of unknowns is a question rather than a failure.
    expect(put('in 000\nH 1\nbox "U" 1-3\nCNOT 1 2', at(1, 1, 'after')))
      .toContain('window ???')
  })

  it('starts a circuit from a state, like any other drop', () => {
    expect(put('00|11', at(1, 0, 'after'))).toBe('00|11\nwindow calculate')
  })

  it('is offered by the palette', () => {
    const droppable = GATE_GALLERY.flatMap((g) => g.items).filter((i) => i.drop)
    expect(droppable.map((i) => i.code)).toContain('window calculate')
  })
})

describe('turning a rotation by a different angle', () => {
  const turned = (source: string, angle: number) => {
    const doc = parseCircuit(source)
    const gate = doc.layers.flatMap((l) => l.gates)
      .find((g) => g.kind === 'single' && g.angle !== undefined)
    return gate ? setAngle(source, doc, gate, angle)?.source.split('\n')[1] : 'no rotation'
  }

  it('changes the angle and nothing else', () => {
    expect(turned('in 0\nRX(90) 1', 45)).toBe('RX(45) 1')
    expect(turned('in 00\nH 1; RZ(30) 2', 180)).toBe('H 1; RZ(180) 2')
  })

  it('keeps the annotations either side of the line', () => {
    expect(turned('in 0\nturn: RY(-90) 1 : note', 60)).toBe('turn: RY(60) 1 : note')
  })

  it('has nothing to say about a gate that does not turn', () => {
    const doc = parseCircuit('in 0\nH 1')
    expect(setAngle('in 0\nH 1', doc, doc.layers[0].gates[0], 45)).toBeNull()
  })

  it('offers every axis in the palette', () => {
    const codes = GATE_GALLERY.flatMap((g) => g.items).filter((i) => i.drop).map((i) => i.code)
    expect(codes).toEqual(expect.arrayContaining(['RX(90) 1', 'RY(90) 1', 'RZ(90) 1', 'P(90) 1']))
  })
})
