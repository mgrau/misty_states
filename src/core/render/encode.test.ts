// @vitest-environment jsdom
/**
 * Data URLs are the browser-only stand-in for an image endpoint, so they must
 * be genuinely self-contained and decode back to exactly what was rendered.
 */

import { describe, expect, it } from 'vitest'
import { svgAtPrintSize, svgDataUrl } from './encode'
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

describe('svgAtPrintSize', () => {
  const attr = (svg: string, name: string) =>
    new RegExp(`<svg[^>]*\\b${name}="([^"]+)"`).exec(svg)?.[1]

  it('restates width and height in inches, at even pixels over 96', () => {
    // 130 is already even, so 130/96 = 1.3542in; a viewBox stays put.
    const svg = svgAtPrintSize(render('qubits 2\nH 1\nCNOT 1 -> 2').svg)
    expect(attr(svg, 'width')).toBe('1.3542in')
    expect(svg).toMatch(/viewBox="/)
  })

  it('rounds an odd side up to even first, matching a video and a PNG', () => {
    // Whatever the figure, its inch size is even(intrinsic)/96 on each side —
    // the same footprint every other export lands at, so they drop one size.
    const raw = render('in 11\nCNOT 1 -> 2\nout 00|11').svg
    const sized = svgAtPrintSize(raw)
    const px = (v: string | undefined) => parseFloat(v ?? '0')
    for (const side of ['width', 'height'] as const) {
      const intrinsic = px(attr(raw, side))
      const even = Math.max(2, Math.round(intrinsic / 2) * 2)
      expect(attr(sized, side)).toBe(`${(even / 96).toFixed(4)}in`)
    }
  })

  it('touches only the root, leaving the drawing and any metadata alone', () => {
    const raw = render('00|11').svg
    const sized = svgAtPrintSize(raw)
    // Everything after the opening tag is unchanged.
    expect(sized.slice(sized.indexOf('>'))).toBe(raw.slice(raw.indexOf('>')))
  })
})
