/**
 * Sizing a gate: `width=` and `height=`.
 *
 * Both are multiples of the size the gate would otherwise take, so they mean
 * the same thing on every kind of gate. Height is the easy half — a layer is
 * as tall as what is in it. Width is the one with a consequence: a wider gate
 * reaches over its neighbours' wires, so the properties worth holding are that
 * nothing ends up underneath it, and that the wires it reaches across still
 * read as not being part of it.
 */

import { describe, expect, it } from 'vitest'
import { parseCircuit } from './parse'
import { layoutCircuit } from './layout'
import { moveGate } from './edit'
import { render } from '../index'
import type { Box } from '../svg'
import type { Prim } from '../render/primitives'

const doc = (src: string) => parseCircuit(src)
const prims = (src: string): Prim[] => layoutCircuit(doc(src)).prims
/** The drawn box of every gate body, in draw order. */
const boxes = (src: string): Box[] =>
  prims(src).flatMap((p) => (p.t === 'gatebox' || p.t === 'measurebox' ? [p.box] : []))
const height = (src: string) => render(src, { check: false }).height

describe('writing it', () => {
  it('goes on any gate, as a multiple of its size', () => {
    const [h] = doc('in 00\nH 1 width=2 height=1.5').layers[0].gates
    expect([h.width, h.height]).toEqual([2, 1.5])
    const [box] = doc('in 00\nbox "U" 1-2 height=2').layers[0].gates
    expect(box.height).toBe(2)
  })

  it('goes on a window', () => {
    const view = doc('in 00\nH 1\nwindow blank width=2 height=1.5\nCNOT 1 2').layers[1].gates[0]
    expect([view.width, view.height]).toEqual([2, 1.5])
  })

  it('takes either order, and alongside a colour', () => {
    const [g] = doc('in 00\nH 1 fill=salmon height=2 width=1.5').layers[0].gates
    expect([g.width, g.height]).toEqual([1.5, 2])
  })

  it('says what is wrong rather than guessing', () => {
    for (const bad of ['width=0', 'width=0.1', 'width=11', 'width=abc', 'width=', 'height=-1']) {
      expect(() => doc(`in 00\nH 1 ${bad}`), bad).toThrow(/multiple of the gate's own size/)
    }
    // A pipe is as wide as a pipe; it can be given height, and only height.
    expect(() => doc('in 00\nI 1 width=2')).toThrow(/plain pipe/)
    expect(() => doc('in 00\nI 1 height=2')).not.toThrow()
    // A bare view is the state itself, with no frame to size.
    expect(() => doc('in 00\nH 1\nview 01 width=2\nCNOT 1 2')).toThrow(/needs a frame/)
    expect(() => doc('in 00\nH 1\n01 height=2\nCNOT 1 2')).toThrow(/write it as a window/)
  })
})

describe('height', () => {
  it('makes the layer taller, and nothing else', () => {
    const plain = height('in 00\nH 1; H 2\nCNOT 1 2')
    expect(height('in 00\nH 1 height=2; H 2\nCNOT 1 2')).toBeGreaterThan(plain)
    expect(doc('in 00\nH 1 height=2; H 2\nCNOT 1 2').layers).toHaveLength(2)
  })

  it('scales the gate by exactly what was asked', () => {
    const [plain] = boxes('in 00\nH 1')
    const [tall] = boxes('in 00\nH 1 height=2')
    expect(tall.h).toBeCloseTo(plain.h * 2, 6)
  })

  it('grows a gate upwards, so its foot stays in line with its neighbours', () => {
    const [tall, short] = boxes('in 00\nH 1 height=2; H 2')
    expect(tall.y + tall.h).toBeCloseTo(short.y + short.h, 6)
  })

  it('on a plain pipe, gives the layer room with nothing in it', () => {
    expect(height('in 00\nH 1\nI 1 height=3\nCNOT 1 2')).toBeGreaterThan(height('in 00\nH 1\nI 1\nCNOT 1 2'))
  })

  it('scales a window as a whole, room and all', () => {
    const around = (w: string) => height(`in 00\nH 1\n${w}\nCNOT 1 2`)
    expect(around('window blank height=2')).toBeGreaterThan(around('window blank'))
  })
})

describe('width', () => {
  it('scales the gate about the middle of its own wires', () => {
    const [plain] = boxes('in 000\nH 2')
    const [wide] = boxes('in 000\nH 2 width=2')
    expect(wide.w).toBeCloseTo(plain.w * 2, 6)
    expect(wide.x + wide.w / 2).toBeCloseTo(plain.x + plain.w / 2, 6)
  })

  it('takes a layer to itself, so nothing is drawn underneath it', () => {
    // Plain, the two share a layer; widened, the H on wire 1 is fenced off.
    expect(doc('in 00\nH 1\nH 2').layers).toHaveLength(1)
    expect(doc('in 00\nH 1 width=2\nH 2').layers).toHaveLength(2)
    expect(doc('in 00\nH 1\nH 2 width=2').layers).toHaveLength(2)
    // Narrower cannot reach anything, so it packs as ever.
    expect(doc('in 00\nH 1 width=0.5\nH 2').layers).toHaveLength(1)
  })

  it('will not be joined to another gate with ";"', () => {
    expect(() => doc('in 00\nH 1 width=2; H 2')).toThrow(/takes a layer to itself/)
  })

  it('runs the wires it reaches across over the front of it', () => {
    // Wire 2's H, widened across wires 1 and 3: their pipes pass in front,
    // which is what says the gate is not acting on them.
    const src = 'in 000\nH 2 width=3'
    const [wide] = boxes(src)
    const inFront = prims(src).filter(
      (p) => p.t === 'pipe' && p.y0 >= wide.y - 1e-6 && p.y1 <= wide.y + wide.h + 1e-6,
    )
    expect(inFront).toHaveLength(2)
  })

  it('widens a window beyond its wires', () => {
    const frame = (w: string) =>
      boxes(`in 00\nH 1\n${w}\nCNOT 1 2`).reduce((a, b) => (b.w > a.w ? b : a))
    expect(frame('window blank width=2').w).toBeCloseTo(frame('window blank').w * 2, 6)
  })
})

describe('it survives being moved', () => {
  const move = (line: string) => {
    const src = `in 00\n${line}\nCNOT 1 2`
    const d = doc(src)
    return moveGate(src, d, d.layers[0].gates[0], { wire: 1, layer: 1, where: 'after' })!.source
  }

  it('keeps its size', () => {
    expect(move('H 1 width=2 height=1.5')).toContain('H 1 width=2 height=1.5')
  })

  it('keeps its colour, which it once lost', () => {
    expect(move('H 1 fill=salmon')).toContain('fill=salmon')
    expect(move('box "U" 1-2 fill=#e6f0e6')).toContain('fill=#e6f0e6')
  })
})

describe('an option does not move the qubits after it', () => {
  // A window's qubits know where they were written, which is what lets one be
  // clicked and changed. An option was once cut out of the line, and a colour
  // written after the state moved every qubit onto the colour's letters.
  const pointsAt = (src: string) => {
    const line = src.split('\n')[2]
    const start = src.indexOf(line)
    return (render(src, { check: false }).qubitSpots ?? [])
      .filter((s) => s.at >= start && s.at < start + line.length)
      .map((s) => src[s.at])
  }

  for (const line of ['window 01', 'window 01 fill=salmon', 'window width=2 01', 'window 01 rows=2 height=1.5']) {
    it(line, () => {
      expect(pointsAt(`in 00\nH 1\n${line}\nCNOT 1 2`)).toEqual(['0', '1'])
    })
  }
})
