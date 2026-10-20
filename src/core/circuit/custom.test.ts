/**
 * Gates known only by their names, and gates in colours of their own.
 *
 * `CNOT "U" 1 2` is a CNOT that happens to be labelled, and calculates as one.
 * `CGATE "U" 1 2` draws the same way and claims nothing about what it does, so
 * the properties under test are that it looks like the named target it is
 * modelled on, that it refuses to be calculated through rather than quietly
 * acting as an X, and that it — and its colour — survive every edit that
 * writes its line afresh.
 */

import { describe, expect, it } from 'vitest'
import { parseCircuit } from './parse'
import { asDroppable, cycleTarget, moveGate } from './edit'
import { blochOf } from '../bloch'
import { detectMode, render } from '../index'
import type { ControlledGate, Gate } from './ast'

const BLUE = '#1b3fae'
const RED = '#c0262d'

const gates = (source: string): Gate[] => parseCircuit(source).layers.flatMap((l) => l.gates)
const only = (source: string): Gate => gates(source)[0]
const svg = (source: string) => render(source, { check: false }).svg
const refuses = (source: string): string => {
  try {
    parseCircuit(source)
  } catch (e) {
    return (e as Error).message
  }
  throw new Error(`"${source}" was accepted`)
}

describe('CGATE and GATE are read as gates known by name', () => {
  it('reads CGATE as controls, a target, and the name standing on it', () => {
    expect(only('CGATE "©" 1 2')).toMatchObject({
      kind: 'controlled', controls: [1], target: 2, targetGlyph: 'label', label: '©', custom: true,
    })
    expect(only('CGATE "U" 3 -> 1')).toMatchObject({ controls: [3], target: 1 })
    expect(only('CGATE "U" 1 2 3')).toMatchObject({ controls: [1, 2], target: 3 })
  })

  it('reads GATE as the name alone, on one wire', () => {
    expect(only('GATE "©" 2')).toMatchObject({
      kind: 'controlled', controls: [], target: 2, label: '©', custom: true,
    })
  })

  it('reads them as a circuit, not a state', () => {
    expect(detectMode('CGATE "U" 1 2')).toBe('circuit')
    expect(detectMode('GATE "U" 1')).toBe('circuit')
  })

  it('wants a name, before the wires', () => {
    expect(refuses('CGATE 1 2')).toContain('needs a name')
    expect(refuses('GATE 1')).toContain('needs a name')
    expect(refuses('GATE "" 1')).toContain('needs a name')
    expect(refuses('CGATE "U" 1 2 "V"')).toContain('one name')
  })

  it('sends each wrong shape to the keyword that has it', () => {
    expect(refuses('CGATE "U" 1')).toContain('with none it is GATE')
    // GATE used to be another word for BOX; a range now says which to use.
    expect(refuses('gate "U" 1-3')).toContain('BOX')
    expect(refuses('CGATE "U" 1 2 fill=red')).toContain('colour=')
  })
})

describe('a gate known by name cannot be calculated through', () => {
  it('says so, where a named CNOT is still a CNOT', () => {
    expect(() => render('in 10\nCGATE "U" 1 2\nout calculate')).toThrow(/“U” is a drawing/)
    expect(() => render('in 1\nGATE "U" 1\nout calculate')).toThrow(/“U” is a drawing/)
    expect(render('in 10\nCNOT "U" 1 2\nout calculate').dirac?.join('')).toContain('11')
  })

  it('still draws when nothing asks it to be calculated', () => {
    expect(() => render('in 10\nCGATE "U" 1 2\nout 11')).not.toThrow()
  })
})

describe('colour= paints one gate', () => {
  it("takes a CGATE's dot, line and box together", () => {
    const drawn = svg(`qubits 2\nCGATE "©" 1 2 colour=${RED}`)
    expect(drawn).not.toContain(BLUE)
    expect(drawn).toMatch(new RegExp(`<circle[^>]*fill="${RED}"`))
    expect(drawn).toMatch(new RegExp(`<line[^>]*stroke="${RED}"`))
    expect(drawn).toMatch(new RegExp(`<rect[^>]*fill="${RED}"`))
  })

  it('takes a GATE, which has only the box', () => {
    const drawn = svg(`qubits 1\nGATE "©" 1 colour=${RED}`)
    expect(drawn).toMatch(new RegExp(`<rect[^>]*fill="${RED}"`))
    expect(drawn).not.toContain('<circle')
  })

  it('takes every gate drawn in dots and lines', () => {
    for (const source of [
      'qubits 2\nCNOT 1 2', 'qubits 2\nCNOT "Oracle" 1 2', 'qubits 2\nCZ 1 2', 'qubits 1\nX 1',
      'qubits 2\nSWAP 1 2', 'qubits 3\nCSWAP 1 2 3',
    ]) {
      const drawn = svg(`${source} colour=${RED}`)
      expect(drawn, source).toContain(RED)
      expect(drawn, source).not.toContain(BLUE)
    }
  })

  it('leaves the gates beside it in the drawing’s colour', () => {
    const drawn = svg(`qubits 3\nCNOT 1 2 colour=${RED}\nCNOT 2 3`)
    expect(drawn).toContain(RED)
    expect(drawn).toContain(BLUE)
  })

  it('reads either spelling, and a colour name', () => {
    expect((only('CNOT 1 2 color=teal') as ControlledGate).accent).toBe('teal')
    expect((only('CNOT 1 2 colour=#c0262d') as ControlledGate).accent).toBe('#c0262d')
  })

  it('sends a box, a letter and a measurement to fill=, and refuses a non-colour', () => {
    for (const source of ['H 1 colour=red', 'RY(90) 1 colour=red', 'box "U" 1-2 colour=red', 'measure 1 colour=red', 'I 1 colour=red']) {
      expect(refuses(source), source).toContain('fill=')
    }
    expect(refuses('CNOT 1 2 colour=puce')).toContain('not a colour')
  })

  it('tints the Bloch sphere’s trail the same', () => {
    expect(blochOf('in 0\nX 1 colour=teal').tints).toContain('teal')
  })
})

describe('a custom gate and its colour survive being edited', () => {
  const first = (source: string) => {
    const doc = parseCircuit(source)
    return { doc, gate: doc.layers[0].gates[0] }
  }

  it('writes itself back as CGATE or GATE, name first', () => {
    expect(asDroppable(only('CGATE "U" 1 2'))).toMatchObject({ head: 'CGATE', label: '"U"', wires: 2 })
    expect(asDroppable(only('GATE "U" 2'))).toMatchObject({ head: 'GATE', label: '"U"', wires: 1 })
  })

  it('keeps its keyword, name and colour when moved', () => {
    const source = `qubits 3\nCGATE "©" 1 2 colour=${RED}\nH 3`
    const { doc, gate } = first(source)
    const out = moveGate(source, doc, gate, { wire: 2, layer: 1, where: 'after' })!.source
    expect(out).toContain(`CGATE "©" 2 3 colour=${RED}`)
  })

  it('keeps its colour when its target is moved', () => {
    for (const source of [`qubits 2\nCGATE "©" 1 2 colour=${RED}`, `qubits 2\nCNOT 1 2 color=teal`]) {
      const { doc, gate } = first(source)
      const out = cycleTarget(source, doc, gate)!.source
      expect(out, source).toMatch(/colou?r=\S+$/)
      expect((gates(out)[0] as ControlledGate).target).toBe(1)
    }
    const fredkin = `qubits 3\nCSWAP 1 2 3 colour=${RED}`
    const { doc, gate } = first(fredkin)
    expect(cycleTarget(fredkin, doc, gate)!.source).toContain(`colour=${RED}`)
  })
})
