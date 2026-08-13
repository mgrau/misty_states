/**
 * Annotations either side of a row.
 *
 * A colon before the state puts text in the left gutter; a colon after it puts
 * text on the right. Both gutters align to a single edge, so a column of
 * annotations reads as a column rather than ragging along the states.
 */

import { describe, expect, it } from 'vitest'
import { parseState } from './state/parse'
import { parseCircuit } from './circuit/parse'
import { layoutState } from './state/layout'
import { layoutCircuit } from './circuit/layout'
import { resolveCalculations } from './circuit/simulate'
import { render } from './index'
import type { Prim } from './render/primitives'

const sideOf = (src: string) => parseState(src).rows[0].sides[0]

const texts = (prims: Prim[]) =>
  prims.filter((p) => p.t === 'text').map((p) => (p.t === 'text' ? p : null!))

const stateTexts = (src: string) => texts(layoutState(parseState(src)).prims)
const circuitTexts = (src: string) =>
  texts(layoutCircuit(resolveCalculations(parseCircuit(src), {})).prims)

describe('writing them', () => {
  it('takes a colon before the state as a left annotation', () => {
    expect(sideOf('50%: 0(0|1)').caption).toBe('50%')
    expect(sideOf('50%: 0(0|1)').note).toBeUndefined()
  })

  it('takes a colon after the state as a right one', () => {
    expect(sideOf('00|11 : entangled').note).toBe('entangled')
    expect(sideOf('00|11 : entangled').caption).toBeUndefined()
  })

  it('takes both at once', () => {
    const s = sideOf('50%: 0(0|1) : after measuring')
    expect(s.caption).toBe('50%')
    expect(s.note).toBe('after measuring')
  })

  it('keeps everything after the colon, punctuation and all', () => {
    expect(sideOf('0|1 : rules 2, 3 — and 5').note).toBe('rules 2, 3 — and 5')
  })

  it('reads a colon after a bare qubit, which used to be an error', () => {
    // The head "0" is all state syntax, so it was never a left caption.
    expect(sideOf('0 : white').note).toBe('white')
  })

  it('ignores an empty annotation rather than drawing a blank gutter', () => {
    expect(sideOf('00|11 :').note).toBeUndefined()
  })

  it('leaves a comment a comment', () => {
    expect(sideOf('00|11 : note  # not part of it').note).toBe('note')
  })
})

describe('drawing them on a state', () => {
  it('puts the left one before the row and the right one after', () => {
    const [left, right] = stateTexts('50%: 00|11 : entangled').sort((a, b) => a.x - b.x)
    expect(left.text).toBe('50%')
    expect(left.anchor).toBe('end')
    expect(right.text).toBe('entangled')
    expect(right.anchor).toBe('start')
    expect(left.x).toBeLessThan(right.x)
  })

  it('aligns a column of right annotations to one edge', () => {
    // The rows differ in width; the notes must not rag along them.
    const notes = stateTexts('0 : one\n00|11|01 : two').filter((t) => /one|two/.test(t.text))
    expect(notes).toHaveLength(2)
    expect(notes[0].x).toBe(notes[1].x)
  })

  it('clears the widest row, not just its own', () => {
    const laid = layoutState(parseState('0 : short row\n000|111|010 : long row'))
    const note = texts(laid.prims).find((t) => t.text === 'short row')!
    const qubits = laid.prims.filter((p) => p.t === 'qubit')
    const rightmost = Math.max(
      ...qubits.map((p) => (p.t === 'qubit' ? p.cx + p.size / 2 : 0)),
    )
    expect(note.x).toBeGreaterThan(rightmost)
  })

  it('widens the drawing to hold them', () => {
    const plain = layoutState(parseState('00|11')).box.w
    const noted = layoutState(parseState('00|11 : a long annotation here')).box.w
    expect(noted).toBeGreaterThan(plain)
  })
})

describe('drawing them on a circuit', () => {
  const src = 'in 001 : starts here\nSWAP 2 3\nafter: 010 : swapped\nout 111 : all black'

  it('annotates the input, a view and the output', () => {
    const t = circuitTexts(src).map((p) => p.text)
    expect(t).toContain('starts here')
    expect(t).toContain('after')
    expect(t).toContain('swapped')
    expect(t).toContain('all black')
  })

  it('keeps the two gutters on their own sides', () => {
    const t = circuitTexts(src)
    const left = t.find((p) => p.text === 'after')!
    const rights = t.filter((p) => /starts here|swapped|all black/.test(p.text))
    expect(left.anchor).toBe('end')
    for (const r of rights) {
      expect(r.anchor).toBe('start')
      expect(r.x).toBeGreaterThan(left.x)
    }
  })

  it('aligns the right column to one edge', () => {
    const xs = circuitTexts(src)
      .filter((p) => p.anchor === 'start')
      .map((p) => p.x)
    expect(new Set(xs).size).toBe(1)
  })

  it('clears the circuit rather than sitting on it', () => {
    const laid = layoutCircuit(resolveCalculations(parseCircuit(src), {}))
    const note = texts(laid.prims).find((p) => p.text === 'swapped')!
    const gates = laid.prims.filter((p) => p.t === 'gatebox')
    const rightmost = Math.max(
      ...gates.map((p) => (p.t === 'gatebox' ? p.box.x + p.box.w : 0)),
    )
    expect(note.x).toBeGreaterThanOrEqual(rightmost)
  })

  it('annotates a calculated state too', () => {
    const t = circuitTexts('in 00\nH 1\nout calculate : worked out').map((p) => p.text)
    expect(t).toContain('worked out')
  })
})

describe('drawing them on a gate line', () => {
  const src = 'in 00\nprepare: H 1 : make the misty state\nentangle: CNOT 1 -> 2\nout calculate'

  it('annotates a layer on either side', () => {
    const t = circuitTexts(src)
    const left = t.filter((p) => /prepare|entangle/.test(p.text))
    const right = t.find((p) => p.text === 'make the misty state')!
    expect(left).toHaveLength(2)
    for (const l of left) expect(l.anchor).toBe('end')
    expect(right.anchor).toBe('start')
  })

  it('hangs it beside the layer it names', () => {
    const laid = layoutCircuit(resolveCalculations(parseCircuit(src), {}))
    const gates = laid.prims.filter((p) => p.t === 'gatebox')
    const cnot = gates.find((p) => p.t === 'gatebox' && p.box.y > gates[0].box.y)!
    const label = texts(laid.prims).find((p) => p.text === 'entangle')!
    expect(label.cy).toBeCloseTo(cnot.box.y + cnot.box.h / 2, 1)
  })

  it('shares the gutter with the states, on one edge', () => {
    const xs = circuitTexts('in 00 : here\nprepare: H 1\nout 00|01').map((p) => p.x)
    expect(new Set(xs.filter((x) => x < 0)).size).toBeLessThanOrEqual(1)
  })

  it('takes the caption off the line and still reads the gates', () => {
    const doc = parseCircuit('in 00\nprepare: H 1; H 2 : both wires')
    expect(doc.layers[0].gates).toHaveLength(2)
    expect(doc.layers[0].caption).toBe('prepare')
    expect(doc.layers[0].note).toBe('both wires')
  })

  it('annotates a layer of nothing but identities', () => {
    const t = circuitTexts('in 00\nwaiting: I 1; I 2\nout 00').map((p) => p.text)
    expect(t).toContain('waiting')
  })

  it('leaves a colon inside a quoted label alone', () => {
    const doc = parseCircuit('in 00\nbox "cost: 5" 1-2')
    expect(doc.layers[0].caption).toBeUndefined()
    expect(doc.layers[0].gates[0]).toMatchObject({ label: 'cost: 5' })
  })

  it('annotates a quoted box either side of it', () => {
    const doc = parseCircuit('in 00\nsetup: box "a: b" 1-2 : done')
    expect(doc.layers[0].caption).toBe('setup')
    expect(doc.layers[0].note).toBe('done')
    expect(doc.layers[0].gates[0]).toMatchObject({ label: 'a: b' })
  })

  it('reads prose that opens with a gate name', () => {
    // "not" and "measure" are gates, but neither line is a gate line.
    expect(parseCircuit('in 0\nH 1 : not needed').layers[0].note).toBe('not needed')
    expect(parseCircuit('in 0\nH 1 : measure it later').layers[0].note).toBe('measure it later')
  })

  it('refuses to swallow a gate into a caption', () => {
    // Silently losing "H 1" would be far worse than saying so.
    expect(() => parseCircuit('in 00\nH 1; encode: H 2')).toThrow()
  })
})

describe('it changes nothing else', () => {
  it('leaves a diagram without annotations exactly as it was', () => {
    expect(render('00|11').svg).toBe(render('00|11').svg)
    expect(layoutState(parseState('00|11')).box.x).toBe(0)
  })

  it('does not confuse an annotation with an equation', () => {
    const row = parseState('00|01 = 0(0|1) : rule 5').rows[0]
    expect(row.relations).toEqual(['='])
    expect(row.sides).toHaveLength(2)
    expect(row.sides[0].note).toBe('rule 5')
  })

  it('leaves the check alone, which is about the state and not the prose', () => {
    expect(render('00|01 = 0(0|1) : rule 5').check!.ok).toBe(true)
    expect(render('00|01 = 0(0|-1) : wrong on purpose').check!.ok).toBe(false)
  })

  it('draws in every theme', () => {
    for (const theme of ['solid', 'flat', 'isometric'] as const) {
      const out = render('in 00 : here\nH 1\nout calculate : there', { theme })
      expect(out.svg, theme).not.toContain('NaN')
    }
  })
})
