/**
 * Locking a frame, so the rest of a circuit can be moved round it.
 *
 * The case it is for: an error-correcting code with its encoding and decoding
 * locked, and the one error dragged from wire to wire to watch the correction
 * follow it. What must hold is that nothing the drag does reaches inside a
 * locked frame — no gate taken out, none put in — and that the frame round the
 * error goes with it rather than being left behind.
 */

import { describe, expect, it } from 'vitest'
import { parseCircuit } from './parse'
import { insertGate, isLocked, moveGate, removeGate, respectsLocks, toggleLock } from './edit'
import { EXAMPLES } from '../examples'
import { render } from '../index'
import type { Gate } from './ast'

const CODE = [
  'in 000',
  '"Encode" locked {',
  'CNOT 1 -> 2',
  'CNOT 1 -> 3',
  '}',
  '"Error" fill=#f8d7d3 {',
  'X 2',
  '}',
  '"Decode" locked {',
  'CNOT 1 -> 3',
  'CNOT 1 -> 2',
  'TOFFOLI 2 3 -> 1',
  '}',
  'out calculate',
].join('\n')

const doc = parseCircuit(CODE)
const placed = doc.layers.flatMap((l, layer) => l.gates.map((gate) => ({ gate, layer })))
const error = placed.find(({ gate }) => gate.kind === 'controlled' && !gate.controls.length)!
const encoding = placed[0].gate

/** The block of lines a frame writes, from its label to its closing brace. */
const block = (source: string, label: string): string => {
  const lines = source.split('\n')
  const from = lines.findIndex((l) => l.startsWith(`"${label}"`))
  const to = lines.findIndex((l, i) => i > from && l === '}')
  return lines.slice(from, to + 1).join('\n')
}

describe('the word', () => {
  it('is read on a frame, a definition and a use, and changes nothing drawn', () => {
    const src = [
      'def spread "Spread" locked {', 'CNOT 1 -> 2', '}',
      'def gather "Gather" {', 'CNOT 1 -> 2', '}',
      'in 0000',
      '"Encode" locked {', 'H 1', '}',
      'spread 1-2 collapsed',
      'gather 3-4 collapsed locked',
    ].join('\n')
    const parsed = parseCircuit(src)
    expect(parsed.frames?.map((f) => f.locked ?? false)).toEqual([true])
    expect(parsed.uses?.map((u) => u.locked ?? false)).toEqual([true, true])
    // The drawing is the same as without it: a lock is the editor's business.
    expect(render(src).svg).toBe(render(src.replace(/ locked/g, '')).svg)
  })

  it('goes on and comes off by a click, on the line that made the frame', () => {
    expect(toggleLock(CODE, 2)!.source.split('\n')[1]).toBe('"Encode" {')
    expect(toggleLock(CODE, 6)!.source.split('\n')[5]).toBe('"Error" fill=#f8d7d3 locked {')
    // A label that happens to say it is not the word.
    expect(toggleLock('"locked" {\nH 1\n}', 1)!.source.split('\n')[0]).toBe('"locked" locked {')
  })
})

describe('picking up', () => {
  it('refuses a gate inside a locked frame, and allows one outside', () => {
    expect(isLocked(CODE, encoding)).toBe(true)
    expect(isLocked(CODE, error.gate)).toBe(false)
  })

  it('refuses a box folded from a locked use', () => {
    const src = 'def g "G" {\nCNOT 1 -> 2\n}\nin 00\ng 1-2 collapsed locked'
    const box = parseCircuit(src).layers[0].gates[0] as Gate
    expect(isLocked(src, box)).toBe(true)
  })
})

describe('moving the error round', () => {
  const moved = (target: { wire: number; layer: number; where: 'in' | 'before' | 'after' }) =>
    moveGate(CODE, doc, error.gate, target)!.source

  it('takes its frame along with it', () => {
    const out = moved({ wire: 3, layer: error.layer, where: 'in' })
    expect(block(out, 'Error')).toBe('"Error" fill=#f8d7d3 {\nX 3\n}')
    expect(respectsLocks(CODE, out)).toBe(true)
  })

  it('lands outside a locked frame it is aimed into, never inside', () => {
    for (const layer of [0, 1, error.layer + 1, error.layer + 2]) {
      const out = moved({ wire: 3, layer, where: 'in' })
      expect(respectsLocks(CODE, out)).toBe(true)
      expect(block(out, 'Encode')).toBe(block(CODE, 'Encode'))
      expect(block(out, 'Decode')).toBe(block(CODE, 'Decode'))
    }
  })

  it('still corrects it, wherever it is put', () => {
    for (const wire of [1, 2, 3]) {
      const out = moved({ wire, layer: error.layer, where: 'in' })
      // The data qubit always comes back white; the other two name the wire.
      const [state] = render(out).dirac!
      expect(state.startsWith('|0')).toBe(true)
    }
  })
})

describe('a gate brought in from the palette', () => {
  it('goes beside a locked frame rather than into it', () => {
    const out = insertGate(CODE, doc, { wire: 2, layer: 0, where: 'in' }, { head: 'Z', wires: 1 }).source
    expect(respectsLocks(CODE, out)).toBe(true)
    expect(out).toContain('Z 2')
  })

  it('is unaffected where nothing is locked', () => {
    const open = CODE.replace(/ locked/g, '')
    const target = { wire: 2, layer: 0, where: 'in' as const }
    const out = insertGate(open, parseCircuit(open), target, { head: 'Z', wires: 1 }).source
    // Joined to the first layer, inside the frame, as it always was.
    expect(block(out, 'Encode')).toContain('Z 2')
  })
})

describe('the padlocks', () => {
  it('are drawn only when asked for, so an export never has them', () => {
    expect(render(CODE).geometry?.locks).toBeUndefined()
    const drawn = render(CODE, { locks: true }).geometry?.locks ?? []
    expect(drawn.map((l) => [l.line, l.locked])).toEqual([[2, true], [6, false], [9, true]])
  })

  it('leave the layout as it is', () => {
    const plain = render(CODE).geometry!
    const shown = render(CODE, { locks: true }).geometry!
    expect(shown.frames).toEqual(plain.frames)
    expect(shown.layers).toEqual(plain.layers)
  })
})

describe('a slot for the error', () => {
  // Shor's code as the examples have it: everything locked but "Error" 1-9,
  // which names its wires and so keeps its place when it is emptied.
  const SHOR = EXAMPLES.find((e) => e.id === 'shor-code')!.source
  const shor = parseCircuit(SHOR)
  const slotLayer = shor.layers.findIndex((l) => l.gates.some((g) => g.kind === 'single' && g.label === 'Y'))
  const y = shor.layers[slotLayer].gates.find((g) => g.kind === 'single' && g.label === 'Y')!
  /** Where every layer and frame is drawn: the thing that must not move. */
  const shape = (src: string) => {
    // Boxes only: which line a frame folds from shifts with the text above it.
    const g = render(src).geometry!
    return JSON.stringify([g.layers, g.frames?.map((f) => f.box)])
  }
  const errorLines = (src: string) => block(src, 'Error').split('\n').slice(1, -1)

  it('may be empty, and is drawn as pipe the height of a gate', () => {
    const empty = 'in 00\n"Error" 1-2 {\n}\nH 1'
    expect(() => parseCircuit(empty)).not.toThrow()
    expect(render(empty).geometry!.layers).toHaveLength(2)
    // Without wires an empty frame is still a mistake, and says how to mean it.
    expect(() => parseCircuit('in 00\n"Error" {\n}\nH 1')).toThrow(/name its wires/)
  })

  it('keeps the circuit round it where it is, wherever the error goes', () => {
    const before = shape(SHOR)
    for (const wire of [1, 4, 9]) {
      const out = moveGate(SHOR, shor, y, { wire, layer: slotLayer, where: 'in' })!.source
      expect(errorLines(out)).toEqual([`Y ${wire}`])
      expect(shape(out)).toBe(before)
    }
  })

  it('stays when its error is taken out, and takes the next one in', () => {
    const cut = removeGate(SHOR, shor, y)!
    expect(cut.layerRemoved).toBeUndefined()
    expect(errorLines(cut.source)).toEqual([])
    expect(shape(cut.source)).toBe(shape(SHOR))
    for (const where of ['in', 'before', 'after'] as const) {
      const back = insertGate(cut.source, parseCircuit(cut.source), { wire: 2, layer: slotLayer, where }, { head: 'Z', wires: 1 })
      expect(errorLines(back.source)).toEqual(['Z 2'])
    }
  })

  it('is where a drop aimed at a locked block goes', () => {
    for (const layer of [0, slotLayer - 1, slotLayer + 1, shor.layers.length - 1]) {
      const out = moveGate(SHOR, shor, y, { wire: 6, layer, where: 'in' })!.source
      expect(errorLines(out)).toEqual(['Y 6'])
      expect(shape(out)).toBe(shape(SHOR))
    }
  })
})
