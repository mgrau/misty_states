/**
 * Shorthand for one-wire gates: `H` means `H 1`, and `HH` means `H 1; H 2`.
 *
 * A run says what a row of gates looks like rather than which wires they are
 * on, which is how these circuits are usually described out loud.
 */

import { describe, expect, it } from 'vitest'
import { parseCircuit, isGateRun } from './parse'
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
