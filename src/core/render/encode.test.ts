// @vitest-environment jsdom
/**
 * Data URLs are the browser-only stand-in for an image endpoint, so they must
 * be genuinely self-contained and decode back to exactly what was rendered.
 */

import { describe, expect, it } from 'vitest'
import { svgDataUrl } from './encode'
import { render } from '../index'

const decode = (url: string) => {
  const [head, payload] = url.split(',')
  expect(head).toMatch(/;base64$/)
  return new TextDecoder().decode(Uint8Array.from(atob(payload), (c) => c.charCodeAt(0)))
}

describe('svgDataUrl', () => {
  it('produces a base64 image/svg+xml data URL', () => {
    const url = svgDataUrl(render('00|11').svg)
    expect(url.startsWith('data:image/svg+xml;base64,')).toBe(true)
  })

  it('decodes back to the original SVG byte for byte', () => {
    const svg = render('000|-111|110|-001').svg
    expect(decode(svgDataUrl(svg))).toBe(svg)
  })

  it('survives non-ASCII content, which plain btoa would reject', () => {
    // Relation glyphs are outside Latin-1.
    const svg = render('0|1|-1 = 0 != 1').svg
    expect(svg).toMatch(/≠|=/)
    expect(decode(svgDataUrl(svg))).toBe(svg)
  })

  it('carries no external references, so the URL stands alone', () => {
    const svg = render('qubits 2\nH 1\nCNOT 1 -> 2\nout 00|11', { theme: 'solid' }).svg
    // Gradients and filters must be inline defs, not links to another document.
    expect(svg).not.toMatch(/href\s*=/)
    expect(svg).not.toMatch(/url\(['"]?https?:/)
    expect(decode(svgDataUrl(svg))).toContain('<defs>')
  })

  it('handles a large diagram without blowing the argument limit', () => {
    const svg = render(Array.from({ length: 40 }, () => '0000|1111').join('|')).svg
    expect(svg.length).toBeGreaterThan(20000)
    expect(decode(svgDataUrl(svg))).toBe(svg)
  })
})
