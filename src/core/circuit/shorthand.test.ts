/**
 * Shorthand for one-wire gates: `H` means `H 1`, and `HH` means `H 1; H 2`.
 *
 * A run says what a row of gates looks like rather than which wires they are
 * on, which is how these circuits are usually described out loud.
 */

import { describe, expect, it } from 'vitest'
import { parseCircuit, isGateRun } from './parse'
import { removeGate, cycleTarget } from './edit'
import { render, detectMode } from '../index'
import type { Gate } from './ast'

const layers = (src: string) => parseCircuit(src).layers
const gatesIn = (src: string): Gate[] => layers(src).flatMap((l) => l.gates)
const where = (src: string) =>
  gatesIn(src).map((g) => (g.kind === 'single' ? `${g.label}${g.qubit}` : g.kind))

describe('a lone gate takes the first wire', () => {
  it('reads H as H 1', () => {
    expect(where('H')).toEqual(['H1'])
    expect(where('H 1')).toEqual(['H1'])
  })

  it('does the same for every one-wire gate, spelt out or not', () => {
    expect(where('Z')).toEqual(['Z1'])
    expect(where('PETE')).toEqual(['H1'])
    for (const src of ['X', 'NOT', 'I', 'IDENTITY', 'M', 'MEASURE']) {
      const [gate] = gatesIn(src)
      expect(gate, src).toBeDefined()
      const qubit = gate.kind === 'controlled' ? gate.target : 'qubit' in gate ? gate.qubit : 0
      expect(qubit, src).toBe(1)
    }
  })

  it('keeps a measurement basis working without a wire number', () => {
    const [gate] = gatesIn('M X')
    expect(gate.kind === 'measure' && gate.basis).toBe('X')
    expect(gate.kind === 'measure' && gate.qubit).toBe(1)
  })

  it('still refuses a gate given more wires than it acts on', () => {
    expect(() => parseCircuit('H 1 2')).toThrow(/exactly one qubit/)
  })
})

describe('a run of letters is a row of gates', () => {
  it('reads HH as H 1; H 2', () => {
    expect(where('HH')).toEqual(['H1', 'H2'])
  })

  it('puts the whole run in one layer, as ";" would', () => {
    expect(layers('HH')).toHaveLength(1)
    expect(parseCircuit('HH')).toEqual(parseCircuit('H 1; H 2'))
  })

  it('mixes gates down the wires', () => {
    expect(where('HZT')).toEqual(['H1', 'Z2', 'T3'])
  })

  it('widens the register to the length of the run', () => {
    expect(parseCircuit('HHH').qubits).toBe(3)
  })

  it('takes identities and NOTs in the run', () => {
    const kinds = gatesIn('HIX').map((g) => g.kind)
    expect(kinds).toEqual(['single', 'identity', 'controlled'])
  })

  it('composes with everything else', () => {
    expect(where('HH\n---\nHH')).toEqual(['H1', 'H2', 'H1', 'H2'])
    expect(layers('HH\n---\nHH')).toHaveLength(2)
  })
})

describe('what a run is not', () => {
  it('leaves multi-letter gate names alone', () => {
    for (const name of ['CZ', 'CX', 'ID', 'SWAP', 'CNOT', 'PETE', 'TOFFOLI', 'BOX', 'BLANK']) {
      expect(isGateRun(name), name).toBe(false)
    }
  })

  it('leaves a measurement basis alone', () => {
    // `MZ` would read as "measure wire 1, Z on wire 2" when it means a Z-basis
    // measurement, so M is kept out of runs entirely.
    expect(isGateRun('MZ')).toBe(false)
    expect(() => parseCircuit('MZ')).toThrow(/unknown gate/)
  })

  it('is not a single letter, which is a gate keyword already', () => {
    expect(isGateRun('H')).toBe(false)
  })

  it('does not swallow a run given arguments', () => {
    expect(() => parseCircuit('HH 2')).toThrow(/unknown gate "HH"/)
  })
})

describe('it does not confuse a run with a state', () => {
  it('guesses a circuit for a bare run', () => {
    expect(detectMode('HH')).toBe('circuit')
    expect(render('HH').kind).toBe('circuit')
  })

  it('still guesses a state for a state', () => {
    expect(render('00|11').kind).toBe('state')
    expect(render('0(0|1)0').kind).toBe('state')
  })

  it('reads a run alongside states in a circuit', () => {
    const doc = parseCircuit('000\nHH\n0(0|1)0\n111')
    expect(doc.input).toBeDefined()
    expect(doc.output).toBeDefined()
    expect(doc.qubits).toBe(3)
  })
})

/**
 * The arrow in a controlled gate is punctuation, not grammar.
 *
 * It earns its place where a reader might wonder which wire is the target, and
 * gets in the way everywhere else — `CZ 1 2` and `SWAP 1 2` never wanted one,
 * so `CNOT 1 2` should not have to either.
 */
describe('a controlled gate without its arrow', () => {
  const gate = (src: string) => parseCircuit(`qubits 3\n${src}`).layers[0].gates[0]

  it('reads the last wire as the target', () => {
    expect(gate('CNOT 1 2')).toEqual(gate('CNOT 1 -> 2'))
    expect(gate('CX 3 1')).toEqual(gate('CX 3 -> 1'))
  })

  it('does the same for two controls', () => {
    expect(gate('TOFFOLI 1 2 3')).toEqual(gate('TOFFOLI 1 2 -> 3'))
  })

  it('still takes a name either side of the wires', () => {
    expect(gate('CNOT "Oracle" 1 2')).toMatchObject({ targetGlyph: 'label', label: 'Oracle' })
    expect(gate('CNOT 1 2 "Tiger?"')).toMatchObject({ labelOnLink: true, label: 'Tiger?' })
  })

  it('draws the same figure either way', () => {
    expect(render('in 00\nCNOT 1 2').svg).toBe(render('in 00\nCNOT 1 -> 2').svg)
  })

  it('still wants a control to go with the target', () => {
    expect(() => gate('CNOT 2')).toThrow(/at least one control/)
  })
})

/**
 * A row written the way it is said.
 *
 * `H; H`, `H H` and `H1 H2` all mean `H 1; H 2`. Three relaxations, each of
 * which gives a meaning to something that used to be an error — so nothing
 * already written changes what it says. (That was checked against every
 * example and every entry of the course library, parsed and drawn before and
 * after: all of them identical.)
 */
describe('a gate without its wire takes the next free one', () => {
  it('reads H; H as H 1; H 2', () => {
    expect(where('H; H')).toEqual(['H1', 'H2'])
    expect(where('H; H; H')).toEqual(['H1', 'H2', 'H3'])
  })

  it('lets the wires they claim go first', () => {
    // Written wires are claimed before the rest are handed out, lowest first,
    // so a gate left without one never lands on top of one that has it.
    expect(where('H 2; H')).toEqual(['H2', 'H1'])
    expect(where('CNOT 1 2; H').filter((w) => w.startsWith('H'))).toEqual(['H3'])
  })

  it('means what a lone gate always meant', () => {
    // Before, a gate with no wire took wire 1 — valid only when nothing else on
    // the line had it. Wherever that was so, it is still wire 1.
    expect(where('H')).toEqual(['H1'])
    expect(where('H 2; H')).toEqual(['H2', 'H1'])
    expect(parseCircuit('in 000\nview 2-3 00|11; H').layers[0].gates.map((g) =>
      g.kind === 'single' ? g.qubit : 'view')).toEqual(['view', 1])
  })
})

describe('a gate name starts a new gate, as ";" would', () => {
  it('reads H H as H 1; H 2', () => {
    expect(parseCircuit('H H')).toEqual(parseCircuit('H 1; H 2'))
    expect(where('H X Z')).toEqual(['H1', 'controlled', 'Z3'])
  })

  it('takes gates with their wires, and gates without', () => {
    expect(where('H 1 H 2')).toEqual(['H1', 'H2'])
    expect(where('CNOT 1 2 H')).toEqual(['controlled', 'H3'])
    expect(where('HH H')).toEqual(['H1', 'H2', 'H3'])
    expect(where('RX(90) RY(90)')).toEqual(['RX1', 'RY2'])
  })

  it('keeps the row to one layer, as ";" does', () => {
    expect(layers('H X Z')).toHaveLength(1)
  })

  it('leaves a measurement its basis', () => {
    // X, Y and Z are gates and bases both. After a measurement they are its
    // basis, as they always were: `M X` measures in the X basis.
    const [m] = gatesIn('M X')
    expect(m.kind === 'measure' && [m.qubit, m.basis]).toEqual([1, 'X'])
    // Any other gate after one is a gate.
    expect(where('M H')).toEqual(['measure', 'H2'])
    expect(where('M X H')).toEqual(['measure', 'H2'])
    expect(where('measure 1 Z H')).toEqual(['measure', 'H2'])
  })

  it('does not read into a label, a colour, or a view', () => {
    expect(gatesIn('box "H X" 1-2')).toHaveLength(1)
    expect(gatesIn('CNOT 1 2 "Tiger?"')).toHaveLength(1)
    expect(gatesIn('H 1 fill=#e6f0e6')).toHaveLength(1)
  })

  it('takes annotations either side of the row', () => {
    const doc = parseCircuit('in 00\nsplit: H H : both wires')
    expect(doc.layers[0].caption).toBe('split')
    expect(doc.layers[0].note).toBe('both wires')
    expect(doc.layers[0].gates).toHaveLength(2)
  })
})

describe('a gate glued to its wire', () => {
  it('reads H2 as H 2', () => {
    expect(parseCircuit('H2')).toEqual(parseCircuit('H 2'))
    expect(where('H1 H2')).toEqual(['H1', 'H2'])
  })

  it('works for any gate, and its other wires still take spaces', () => {
    expect(parseCircuit('CNOT1 2')).toEqual(parseCircuit('CNOT 1 2'))
    expect(parseCircuit('M2 X')).toEqual(parseCircuit('M 2 X'))
    expect(parseCircuit('in 00\nblank1-2')).toEqual(parseCircuit('in 00\nblank 1-2'))
    expect(where('H1 CNOT2 3')).toEqual(['H1', 'controlled'])
  })

  it('is read as a circuit, not a state', () => {
    for (const src of ['H2', 'H1 H2', 'H H', 'H; H', 'CNOT1 2']) expect(detectMode(src), src).toBe('circuit')
  })

  it('still refuses what it always refused', () => {
    expect(() => parseCircuit('HH 2')).toThrow(/unknown gate "HH"/)
    expect(() => parseCircuit('H 1 2')).toThrow(/exactly one qubit/)
    expect(() => parseCircuit('MZ')).toThrow(/unknown gate/)
    expect(() => parseCircuit('Q2')).toThrow(/unknown gate/)
  })
})

/**
 * Editing a row written in shorthand.
 *
 * The editor has to split a line exactly as the parser does, or a gate's place
 * among its line-mates is wrong — and `HH` never was split that way: removing
 * its first H took the whole line, and its second could not be removed at all.
 * And since a gate without a wire was given the lowest one free, taking a gate
 * away can free a lower one; the others must keep the wires they had.
 */
describe('editing a row written in shorthand', () => {
  const remove = (src: string, which: number) => {
    const doc = parseCircuit(src)
    const out = removeGate(src, doc, doc.layers[0].gates[which])!
    return where(out.source)
  }

  it('removes one gate of a run, not the line', () => {
    expect(remove('HH', 0)).toEqual(['H2'])
    expect(remove('HH', 1)).toEqual(['H1'])
  })

  it('removes one gate of a row, and the rest stay where they were', () => {
    expect(remove('H H', 0)).toEqual(['H2'])
    expect(remove('H X Z', 1)).toEqual(['H1', 'Z3'])
    expect(remove('CNOT 1 2 H', 0)).toEqual(['H3'])
  })

  it('edits a gate in a row without moving its neighbours', () => {
    const src = 'H CNOT 2 3'
    const doc = parseCircuit(src)
    const cnot = doc.layers[0].gates[1]
    const out = cycleTarget(src, doc, cnot)!
    const [h, c] = parseCircuit(out.source).layers[0].gates
    expect(h.kind === 'single' && h.qubit).toBe(1)
    expect(c.kind === 'controlled' && c.target).toBe(2)
  })
})

/**
 * A gate over several wires, written without them.
 *
 * `CNOT` is `CNOT 1 2`: control, then target, the way the arrowless form has
 * always read. It takes the lowest run of free wires long enough to hold it —
 * a gate is drawn across its span, so the wires have to be side by side.
 */
describe('a multi-wire gate without its wires', () => {
  const same = (short: string, long: string) =>
    expect(parseCircuit(short), short).toEqual(parseCircuit(long))

  it('reads CNOT as CNOT 1 2, and the others the same way', () => {
    same('CNOT', 'CNOT 1 2')
    same('CX', 'CX 1 2')
    same('CZ', 'CZ 1 2')
    same('SWAP', 'SWAP 1 2')
    same('TOFFOLI', 'TOFFOLI 1 2 3')
    same('CCNOT', 'CCNOT 1 2 3')
    same('CSWAP', 'CSWAP 1 2 3')
  })

  it('takes its place in a row', () => {
    same('H CNOT', 'H 1; CNOT 2 3')
    same('CNOT H', 'CNOT 1 2; H 3')
    same('CNOT CNOT', 'CNOT 1 2; CNOT 3 4')
  })

  it('wants its wires side by side', () => {
    // Wire 1 is free but alone; the first free pair is 3 and 4.
    same('H 2; CNOT', 'H 2; CNOT 3 4')
  })

  it('keeps its options', () => {
    same('CNOT height=2', 'CNOT 1 2 height=2')
  })

  it('leaves a named one to say where its name stands', () => {
    // Before the wires names the target; after, the link. With no wires there
    // is no telling which was meant, so it is refused as it always was.
    expect(() => parseCircuit('CNOT "Oracle"')).toThrow(/needs at least one control/)
  })

  it('keeps its wires when a neighbour is taken away', () => {
    const src = 'in 000\nH CNOT'
    const doc = parseCircuit(src)
    const out = removeGate(src, doc, doc.layers[0].gates[0])!
    expect(parseCircuit(out.source)).toEqual(parseCircuit('in 000\nCNOT 2 3'))
  })
})
