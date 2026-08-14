import { describe, expect, it } from 'vitest'
import { render } from '../index'
import { bandGradients } from './band'

describe('bandGradients', () => {
  it('leaves a drawing with no gradients untouched', () => {
    const svg = '<svg><rect x="0" y="0" width="10" height="10" fill="#123456"/></svg>'
    expect(bandGradients(svg)).toBe(svg)
  })

  it('replaces a linear-gradient rect fill with solid bands', () => {
    const svg =
      '<svg><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0">' +
      '<stop offset="0%" stop-color="#000000"/><stop offset="100%" stop-color="#ffffff"/>' +
      '</linearGradient></defs>' +
      '<rect x="0" y="0" width="24" height="10" fill="url(#g)" stroke="#888"/></svg>'
    const out = bandGradients(svg, 24)
    // No rectangle is painted with the shading any more...
    expect(out).not.toMatch(/<rect[^>]*fill="url\(#g\)"/)
    // ...but the stroked outline is kept (with its fill dropped)...
    expect(out).toMatch(/<rect[^>]*fill="none"[^>]*stroke="#888"/)
    // ...and it is redrawn as many solid strips sampled across the gradient.
    const strips = out.match(/fill="#[0-9a-f]{6}"/g) ?? []
    expect(strips.length).toBeGreaterThanOrEqual(20)
  })

  it('carries stop-opacity onto the bands (a shadow gradient)', () => {
    const svg =
      '<svg><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#000000" stop-opacity="0"/>' +
      '<stop offset="100%" stop-color="#000000" stop-opacity="0.5"/>' +
      '</linearGradient></defs>' +
      '<rect x="0" y="0" width="10" height="20" fill="url(#s)"/></svg>'
    const out = bandGradients(svg, 10)
    expect(out).toMatch(/fill-opacity="/)
  })

  it('clips bands to the rounded corners of a gate box', () => {
    const svg =
      '<svg><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#eeeeee"/><stop offset="100%" stop-color="#cccccc"/>' +
      '</linearGradient></defs>' +
      '<rect x="0" y="0" width="20" height="20" rx="3" fill="url(#g)"/></svg>'
    const out = bandGradients(svg, 8)
    expect(out).toMatch(/<clipPath id="[^"]*"><rect[^>]*rx="3"/)
    expect(out).toMatch(/clip-path="url\(#/)
  })

  it('bands a solid circuit render without leaving any rect shadings', () => {
    const { svg } = render('qubits 2\nH 1\nCNOT 1 -> 2', {
      theme: 'solid',
      bandedGradients: true,
    })
    // The pipes and gate faces are no longer gradient-filled rectangles.
    expect(svg).not.toMatch(/<rect[^>]*fill="url\(#ms-(pipe|gate|shadow)\)"/)
    // The smooth render still uses them, so the option is doing the work.
    const smooth = render('qubits 2\nH 1\nCNOT 1 -> 2', { theme: 'solid' }).svg
    expect(smooth).toMatch(/<rect[^>]*fill="url\(#ms-pipe\)"/)
  })
})
