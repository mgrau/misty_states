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
import { render } from './index'

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
