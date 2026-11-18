/**
 * Controls that act on white, and controlled-Z across any number of wires.
 *
 * `CNOT 1=0 -> 2` flips wire 2 when wire 1 is white; it is drawn as an open
 * ring where a control acting on black is a filled dot. `CZ 1 2 3` flips the
 * sign where all three are black, and any of its dots may act on white. A
 * click on a dot turns it from one to the other.
 */

import { describe, expect, it } from 'vitest'
import { parseCircuit } from './parse'
import { simulate } from './simulate'
import { layoutCircuit } from './layout'
import { asDroppable, cycleTarget, moveGate, toggleControl, type DropTarget } from './edit'
import { render } from '../index'
import { show } from './complex'

const gate = (src: string) => parseCircuit(src).layers[0].gates[0]
const out = (src: string) => {
  const doc = parseCircuit(src)
  return [...simulate(doc, doc.layers.length)].map(([b, a]) => `${show(a)}*${b}`).sort()
}

describe('writing it', () => {
  it('marks a control that acts on white with =0', () => {
    expect(gate('CNOT 1=0 -> 2')).toMatchObject({ controls: [1], target: 2, open: [1] })
    expect(gate('CNOT 1=0 2')).toMatchObject({ controls: [1], target: 2, open: [1] })
    expect(gate('TOFFOLI 1=0 2 -> 3')).toMatchObject({ controls: [1, 2], target: 3, open: [1] })
    expect(gate('CSWAP 1=0 2 3')).toMatchObject({ controls: [1], qubits: [2, 3], open: [1] })
    expect(gate('CGATE "U" 1=0 2')).toMatchObject({ controls: [1], target: 2, open: [1] })
  })

  it('reads =1 as the plain dot it always was', () => {
    expect(gate('CNOT 1=1 2')).not.toHaveProperty('open')
    expect(gate('CNOT 1 2')).not.toHaveProperty('open')
  })

  it('takes a mark on a range as a mark on each of it', () => {
    expect(gate('TOFFOLI 1-2=0 -> 3')).toMatchObject({ controls: [1, 2], open: [1, 2] })
  })

  it('writes a CZ on as many wires as it is given', () => {
    expect(gate('CZ 1 2 3')).toMatchObject({ controls: [1, 2], target: 3, targetGlyph: 'z' })
    expect(gate('CCZ 1 2 3')).toMatchObject({ controls: [1, 2], target: 3, targetGlyph: 'z' })
    expect(gate('CZ 1=0 2 3=0')).toMatchObject({ open: [1, 3] })
  })

  it('gives a bare CCZ three wires, as it gives a bare CZ two', () => {
    expect(gate('CCZ')).toMatchObject({ controls: [1, 2], target: 3 })
    expect(gate('H CCZ').kind).toBe('single')
    expect(parseCircuit('H CCZ').layers[0].gates[1]).toMatchObject({ controls: [2, 3], target: 4 })
    // A marked wire is a wire written: this CZ has one, and says so.
    expect(() => parseCircuit('CZ 1=0')).toThrow(/two qubits or more/)
  })

  it('says what is wrong', () => {
    expect(() => parseCircuit('CNOT 1=2 -> 3')).toThrow(/acts on 0 or 1/)
    expect(() => parseCircuit('CNOT 1 -> 2=0')).toThrow(/only a control/)
    expect(() => parseCircuit('CSWAP 1 -> 2=0 3')).toThrow(/only a control/)
    expect(() => parseCircuit('CCZ 1 2')).toThrow(/three/)
    expect(() => parseCircuit('CZ 1 -> 2')).toThrow(/no target/)
    expect(() => parseCircuit('CZ 1')).toThrow(/two qubits or more/)
  })
})

describe('what it does', () => {
  it('flips the target where the control is white, and only there', () => {
    expect(out('in 00\nCNOT 1=0 -> 2')).toEqual(['1*01'])
    expect(out('in 10\nCNOT 1=0 -> 2')).toEqual(['1*10'])
  })

  it('needs every control to hold what it acts on', () => {
    expect(out('in 010\nTOFFOLI 1=0 2 -> 3')).toEqual(['1*011'])
    expect(out('in 110\nTOFFOLI 1=0 2 -> 3')).toEqual(['1*110'])
    expect(out('in 000\nTOFFOLI 1=0 2 -> 3')).toEqual(['1*000'])
  })

  it('flips the sign of a CZ only where every wire is black', () => {
    expect(out('in (0|1)11\nCZ 1 2 3')).toEqual(['-1*111', '1*011'])
    expect(out('in (0|1)(0|1)1\nCZ 1 2 3')).toEqual(['-1*111', '1*001', '1*011', '1*101'])
  })

  it('puts the sign on white where a CZ dot acts on white — the last one too', () => {
    expect(out('in (0|1)1\nCZ 1=0 2')).toEqual(['-1*01', '1*11'])
    expect(out('in 1(0|1)\nCZ 1 2=0')).toEqual(['-1*10', '1*11'])
  })

  it('swaps where its control is white', () => {
    expect(out('in 001\nCSWAP 1=0 2 3')).toEqual(['1*010'])
    expect(out('in 101\nCSWAP 1=0 2 3')).toEqual(['1*101'])
  })
})

describe('drawing it', () => {
  const prims = (src: string) => layoutCircuit(parseCircuit(src)).prims

  it('draws a control that acts on white as an open ring', () => {
    const controls = prims('CNOT 1=0 -> 2; CNOT 3 -> 4').filter((p) => p.t === 'control')
    expect(controls.map((p) => p.t === 'control' && !!p.open)).toEqual([true, false])
  })

  it('draws every wire of a CZ as a dot, open where it acts on white', () => {
    const dots = prims('CZ 1 2=0 3').filter((p) => p.t === 'control' || p.t === 'target')
    expect(dots.map((p) => ('open' in p && p.open) || false)).toEqual([false, true, false])
    const last = prims('CZ 1 2 3=0').find((p) => p.t === 'target')
    expect(last).toMatchObject({ glyph: 'z', open: true })
  })

  it('fills the ring with the paper, so the line behind it does not show through', () => {
    const svg = render('CNOT 1=0 -> 2').svg
    expect(svg).toMatch(/<circle[^>]*fill="[^"]+"[^>]*stroke="[^"]+"/)
  })
})

describe('clicking a dot', () => {
  const toggled = (src: string, wire: number) => {
    const doc = parseCircuit(src)
    const g = doc.layers.flatMap((l) => l.gates).find((x) => x.kind === 'controlled' || x.kind === 'swap')!
    return toggleControl(src, doc, g, wire)?.source
  }

  it('turns a dot from black to white and back', () => {
    expect(toggled('CNOT 1 -> 2', 1)).toBe('CNOT 1=0 -> 2')
    expect(toggled('CNOT 1=0 -> 2', 1)).toBe('CNOT 1 -> 2')
    expect(toggled('CX 1 2', 1)).toBe('CX 1=0 2')
  })

  it('leaves the target to the click it always had', () => {
    expect(toggled('CNOT 1 -> 2', 2)).toBeUndefined()
    // …which still moves the ⊕.
    const doc = parseCircuit('CNOT 1 -> 2')
    expect(cycleTarget('CNOT 1 -> 2', doc, doc.layers[0].gates[0])?.source).toBe('CNOT 2 -> 1')
  })

  it('turns any dot of a CZ, the last one included', () => {
    expect(toggled('CZ 1 2 3', 3)).toBe('CZ 1 2 3=0')
    expect(toggled('CZ 1-3', 2)).toBe('CZ 1 2=0 3')
  })

  it('turns the control of a swap', () => {
    expect(toggled('CSWAP 1 2 3', 1)).toBe('CSWAP 1=0 2 3')
    expect(toggled('CSWAP 1 2 3', 2)).toBeUndefined()
  })

  it('keeps the rest of the line, and the gate\'s options, as they were', () => {
    expect(toggled('in 000\nH 3; CNOT 1 -> 2 colour=red : note', 1))
      .toBe('in 000\nH 3; CNOT 1=0 -> 2 colour=red : note')
    expect(toggled('CNOT "Tiger?" 1 -> 2', 1)).toBe('CNOT "Tiger?" 1=0 -> 2')
  })

  it('keeps what each control acts on as the target moves round', () => {
    const src = 'TOFFOLI 1=0 2 -> 3'
    const doc = parseCircuit(src)
    expect(cycleTarget(src, doc, doc.layers[0].gates[0])?.source).toBe('TOFFOLI 2 3 -> 1')
    const src2 = 'TOFFOLI 1 2=0 -> 3'
    const doc2 = parseCircuit(src2)
    expect(cycleTarget(src2, doc2, doc2.layers[0].gates[0])?.source).toBe('TOFFOLI 2=0 3 -> 1')
  })
})

describe('moving it', () => {
  const moved = (source: string, target: DropTarget) => {
    const doc = parseCircuit(source)
    const g = doc.layers[0].gates[0]
    return moveGate(source, doc, g, target)?.source.split('\n').find((l) => /CNOT|TOFFOLI|CZ|SWAP/.test(l))
  }
  const after = (wire: number): DropTarget => ({ wire, layer: 1, where: 'after' })

  it('keeps what each control acts on', () => {
    expect(moved('in 000\nCNOT 1=0 -> 2\nH 3', after(2))).toBe('CNOT 2=0 -> 3')
    expect(moved('in 000\nCZ 1 2=0\nH 3', after(2))).toBe('CZ 2 3=0')
    expect(moved('in 0000\nCSWAP 1=0 2 3\nH 4', after(2))).toBe('CSWAP 2=0 3 4')
  })

  it('does not make a control of a wire the gate only reaches across', () => {
    // It used to: a CNOT 1 -> 3 put down again came back a Toffoli.
    expect(moved('in 0000\nCNOT 1 -> 3\nH 2', after(2))).toBe('CNOT 2 -> 4')
    expect(moved('in 0000\nCZ 1 3\nH 2', after(2))).toBe('CZ 2 4')
    expect(moved('in 0000\nSWAP 1 3\nH 2', after(2))).toBe('SWAP 2 4')
    expect(moved('in 00000\nCSWAP 1 -> 3 4\nH 2', after(2))).toBe('CSWAP 2 -> 4 5')
  })

  it('writes a CZ written backwards in order, since nothing tells its wires apart', () => {
    expect(asDroppable(gate('CZ 2 1'))).toMatchObject({ targetAt: 1, controlsAt: [0] })
  })
})

/**
 * A name on a controlled-Z's last wire stands where its dot was. It used to
 * stand in for the gate as well: `CZ "Phase" 1 2` was worked out as a CNOT,
 * and written back as one when it was moved.
 */
describe('a controlled-Z under a name', () => {
  it('is still a controlled-Z', () => {
    expect(out('in 11\nCZ "Phase" 1 2')).toEqual(['-1*11'])
    expect(out('in 111\nCZ "Phase" 1 2 3')).toEqual(['-1*111'])
    expect(out('in 01\nCZ "Phase" 1=0 2')).toEqual(['-1*01'])
    expect(out('in 11\nCZ 1 2 "Phase"')).toEqual(['-1*11'])
  })

  it('agrees with the matrices', () => {
    for (const bits of ['00', '01', '10', '11']) {
      expect(out(`in ${bits}\nCZ "P" 1 2`)).toEqual(out(`in ${bits}\nCZ 1 2`))
    }
  })

  it('stays a CZ when it is moved, with its name on the same wire', () => {
    const move = (source: string) => {
      const doc = parseCircuit(source)
      return moveGate(source, doc, doc.layers[0].gates[0], { wire: 2, layer: 1, where: 'after' })
        ?.source.split('\n').find((l) => l.includes('"'))
    }
    expect(move('in 000\nCZ "Phase" 1 2\nH 3')).toBe('CZ "Phase" 2 3')
    expect(move('in 000\nCZ "Phase" 2 1\nH 3')).toBe('CZ "Phase" 3 2')
    expect(move('in 000\nCZ 1 2 "Phase"\nH 3')).toBe('CZ 2 3 "Phase"')
  })

  it('walks its name round its wires on a click, as a CNOT walks its ⊕', () => {
    const src = 'CZ "Phase" 1 2'
    const doc = parseCircuit(src)
    expect(cycleTarget(src, doc, doc.layers[0].gates[0])?.source).toBe('CZ "Phase" 2 1')
  })

  it('has no dot under the name to turn', () => {
    const src = 'CZ "Phase" 1 2'
    const doc = parseCircuit(src)
    expect(toggleControl(src, doc, doc.layers[0].gates[0], 2)).toBeNull()
    expect(toggleControl(src, doc, doc.layers[0].gates[0], 1)?.source).toBe('CZ "Phase" 1=0 2')
    expect(() => parseCircuit('CZ "Phase" 1 2=0')).toThrow(/no dot to act on 0/)
  })
})
