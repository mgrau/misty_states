/**
 * Definitions as gates to pick up: offered by name and width, dropped as a
 * use, and — once down — carried or thrown away as the whole line that uses
 * them, whichever of the gates it drew was held.
 */

import { describe, expect, it } from 'vitest'
import { definitionsOf, parseCircuit } from './parse'
import { insertGate, moveGate, removeGate, useDroppable } from './edit'
import type { Gate } from './ast'

const ORACLE = 'def oracle "U_f" {\n  CNOT 1 -> 2\n  H 2\n}'
const gatesOf = (source: string): Gate[] =>
  parseCircuit(source).layers.flatMap((l) => l.gates)

describe('definitionsOf', () => {
  it('offers each definition with the wires it takes', () => {
    const src = `${ORACLE}\ndef flip {\n  X 1\n}\nqubits 3\nH 1`
    expect(definitionsOf(src).map(({ name, wires }) => ({ name, wires }))).toEqual([
      { name: 'oracle', wires: 2 },
      { name: 'flip', wires: 1 },
    ])
  })

  it('keeps them while the circuit below is half-written', () => {
    expect(definitionsOf(`${ORACLE}\nCNOT 1 1`).map((d) => d.name)).toEqual(['oracle'])
  })

  it('offers nothing for a source without any, or with a broken one', () => {
    expect(definitionsOf('H 1')).toEqual([])
    expect(definitionsOf('def loop {\n  loop\n}')).toEqual([])
    expect(definitionsOf('def open {\n  H 1')).toEqual([])
  })
})

describe('the uses a circuit writes', () => {
  it('records each top-level use, and stamps what it draws', () => {
    const src = `${ORACLE}\nqubits 3\noracle 2-3\noracle "V" 1 3 collapsed`
    const doc = parseCircuit(src)
    expect(doc.uses).toEqual([
      { line: 6, name: 'oracle', wires: [2, 3], collapsed: false },
      { line: 7, name: 'oracle', wires: [1, 3], collapsed: true, label: 'V' },
    ])
    expect(gatesOf(src).every((g) => g.use === 'oracle')).toBe(true)
  })

  it('stamps only the outermost use, through one inside another', () => {
    const src = `${ORACLE}\ndef twice {\n  oracle\n  oracle\n}\ntwice`
    expect(parseCircuit(src).uses?.map((u) => u.name)).toEqual(['twice'])
    expect(gatesOf(src).every((g) => g.use === 'twice')).toBe(true)
  })

  it('leaves gates written on their own lines unstamped', () => {
    expect(gatesOf('H 1')[0].use).toBeUndefined()
  })
})

describe('dropping, moving and removing a use', () => {
  it('writes a dropped definition as a use on the wires it lands on', () => {
    const src = `${ORACLE}\nqubits 3\nH 1`
    const drop = useDroppable({ line: 0, name: 'oracle', wires: [1, 2], collapsed: false })
    const out = insertGate(src, parseCircuit(src), { wire: 2, layer: 0, where: 'after' }, drop)
    expect(out.source.split('\n')).toContain('oracle 2-3')
  })

  it('takes the whole line away, whichever gate was held', () => {
    const src = `${ORACLE}\nqubits 3\nH 1\noracle 2-3\nX 1`
    const doc = parseCircuit(src)
    const held = doc.layers.flatMap((l) => l.gates).find((g) => g.kind === 'single' && g.use)!
    expect(removeGate(src, doc, held)?.source).toBe(`${ORACLE}\nqubits 3\nH 1\nX 1`)
  })

  it('takes away a use that sits inside a frame, and the frame with it', () => {
    const src = `${ORACLE}\nqubits 2\n"Step" {\n  oracle\n}`
    const doc = parseCircuit(src)
    expect(removeGate(src, doc, gatesOf(src)[0])?.source).toBe(`${ORACLE}\nqubits 2`)
  })

  it('moves a use as a use, keeping its label and its fold', () => {
    const src = `${ORACLE}\nqubits 3\noracle "V" 1-2 collapsed\nX 1`
    const doc = parseCircuit(src)
    const box = doc.layers[0].gates[0]
    const out = moveGate(src, doc, box, { wire: 2, layer: 1, where: 'after' })
    // Written after X, with a break so it is not packed up beside it.
    expect(out?.source.split('\n').slice(-3)).toEqual(['X 1', '---', 'oracle "V" 2-3 collapsed'])
  })

  it('aims past every layer an open use took with it', () => {
    // The use takes layers 0 and 1 to itself; X is layer 2, Z layer 3.
    const src = `${ORACLE}\nqubits 2\noracle\nX 1\nZ 1`
    const doc = parseCircuit(src)
    const out = moveGate(src, doc, doc.layers[0].gates[0], { wire: 1, layer: 3, where: 'before' })
    expect(out?.source.split('\n').slice(-4)).toEqual(['qubits 2', 'X 1', 'oracle 1-2', 'Z 1'])
  })
})
