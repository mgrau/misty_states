/**
 * Painting a box.
 *
 * `fill=` is how a figure marks one box out from the rest — an oracle a
 * different colour from the gates around it, a blank tinted to say "this one is
 * yours". The property under test is that it reaches everything with a face to
 * paint, and that where there is no such face the line is *refused* rather than
 * drawn as though the colour had never been written. A colour that is silently
 * dropped looks exactly like a colour that was wrong.
 */

import { describe, expect, it } from 'vitest'
import { render, renderFrames } from './index'

/** The colours this drawing actually paints with. */
const fills = (source: string): string[] => [
  ...new Set([...render(source, { check: false }).svg.matchAll(/fill="([^"]+)"/g)].map((m) => m[1])),
]
const refuses = (source: string): string => {
  try {
    render(source, { check: false })
  } catch (e) {
    return (e as Error).message
  }
  throw new Error(`"${source}" was accepted`)
}

describe('fill= paints what has a face to paint', () => {
  it('takes a hex colour on a box', () => {
    expect(fills('qubits 2\nbox "U" 1-2 fill=#e6f0e6')).toContain('#e6f0e6')
  })

  it('takes a colour name too', () => {
    expect(fills('qubits 2\nbox "U" 1-2 fill=salmon')).toContain('salmon')
  })

  it('paints a blank, whose paper it overrides', () => {
    // A frame for students to fill in is still a box, and tinting one to mark
    // it out is the whole reason for saying so.
    expect(fills('qubits 2\nblank 1-2 fill=salmon')).toContain('salmon')
  })

  it('leaves a blank its paper when nothing is asked for', () => {
    expect(fills('qubits 2\nblank 1-2')).not.toContain('salmon')
  })

  it('paints a gate letter, a rotation and a measurement', () => {
    expect(fills('qubits 1\nH 1 fill=salmon')).toContain('salmon')
    expect(fills('qubits 1\nRX(90) 1 fill=salmon')).toContain('salmon')
    expect(fills('qubits 1\nmeasure 1 Z fill=salmon')).toContain('salmon')
  })

  it('paints a window', () => {
    expect(fills('in 00\nH 1\nwindow calculate fill=salmon')).toContain('salmon')
  })
})

describe('fill= where there is nothing to paint', () => {
  it('refuses a controlled gate, a swap and a plain pipe', () => {
    for (const source of [
      'qubits 2\nCNOT 1 2 fill=salmon',
      'qubits 2\nCZ 1 2 fill=salmon',
      'qubits 2\nSWAP 1 2 fill=salmon',
      'qubits 3\nCSWAP 1 2 3 fill=salmon',
      'qubits 1\nI 1 fill=salmon',
    ]) {
      expect(refuses(source)).toContain('no box to fill')
    }
  })

  it('sends a view to its framed form, which has somewhere to put it', () => {
    expect(refuses('in 00\nH 1\nview calculate fill=salmon')).toContain('window')
  })

  it('refuses something that is not a colour', () => {
    expect(refuses('qubits 2\nbox "U" 1-2 fill=puce')).toContain('not a colour')
    expect(refuses('qubits 2\nbox "U" 1-2 fill=')).toContain('colour')
  })
})

/**
 * The accent: the colour a multi-qubit gate is drawn in.
 *
 * Set for the whole drawing rather than per gate, so the test is that every
 * part of the gate moves with it — a control dot left in the old blue beside a
 * `⊕` in the new colour would be worse than not offering the choice.
 */
describe('accent recolours what ties gates together', () => {
  const BLUE = '#1b3fae'
  const paints = (source: string, accent?: string) =>
    render(source, { check: false, accent }).svg

  it('reaches the control, the line and the target', () => {
    const svg = paints('qubits 2\nCNOT 1 -> 2', '#c0262d')
    expect(svg).not.toContain(BLUE)
    // Dot and ⊕ are filled with it; the line between them is stroked with it.
    expect(svg).toMatch(/<circle[^>]*fill="#c0262d"/)
    expect(svg).toMatch(/<line[^>]*stroke="#c0262d"/)
  })

  it('reaches a swap and a named gate on a chip', () => {
    for (const source of ['qubits 2\nSWAP 1 2', 'qubits 2\nCNOT "Oracle" 1 2']) {
      expect(paints(source, '#c0262d')).not.toContain(BLUE)
      expect(paints(source, '#c0262d')).toContain('#c0262d')
    }
  })

  it('tints a frame, unless the frame says otherwise', () => {
    const tinted = paints('in 00\n"Prep" {\n  H 1\n}', '#c0262d')
    const plain = paints('in 00\n"Prep" {\n  H 1\n}')
    expect(tinted).not.toEqual(plain)
    expect(paints('in 00\n"Prep" border=#d97706 {\n  H 1\n}', '#c0262d')).toContain('#d97706')
  })

  it('leaves the lettered gates their own colours', () => {
    // H is red because it is H, not because it is accented.
    expect(paints('qubits 1\nH 1', '#0f766e')).toContain('#ef5f5b')
  })

  it('takes three digits and no hash, and ignores what is not hex', () => {
    expect(paints('qubits 2\nCNOT 1 2', 'c22')).toContain('#cc2222')
    // A name would draw, but a frame blends the accent and would turn black.
    expect(paints('qubits 2\nCNOT 1 2', 'salmon')).toContain(BLUE)
    expect(paints('qubits 2\nCNOT 1 2', '')).toContain(BLUE)
  })

  it('reaches every frame of a movie too', () => {
    const { frames } = renderFrames('in 10\nCNOT 1 -> 2\nanimate', { fps: 4, accent: '#c0262d' })
    expect(frames.every((f) => !f.svg.includes(BLUE))).toBe(true)
    expect(frames.some((f) => f.svg.includes('#c0262d'))).toBe(true)
  })
})
