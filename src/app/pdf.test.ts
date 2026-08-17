// @vitest-environment jsdom
/**
 * PDF export runs through jsPDF + svg2pdf, which walk a live DOM.
 *
 * These checks confirm the pipeline produces a real PDF and cleans up after
 * itself. They do NOT validate the drawing: jsdom has no SVG layout engine, so
 * `getBBox` is stubbed in test-setup and text placement inside the PDF is not
 * meaningful here. That needs checking in a real browser.
 */

import { describe, expect, it } from 'vitest'
import { svgToPdfBlob, pdfDataUrl } from './export'
import { embedSvgMeta, readPdfMeta } from '../core/metadata'
import { render } from '../core/index'
import { bandGradients } from '../core/render/band'

const head = async (blob: Blob) =>
  new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()).subarray(0, 8))

describe('svgToPdfBlob', () => {
  it('produces a PDF with the right magic bytes', async () => {
    const blob = await svgToPdfBlob(render('00|11').svg)
    expect(blob.type).toContain('pdf')
    expect(await head(blob)).toMatch(/^%PDF-/)
  })

  it('runs a circuit through without throwing', async () => {
    // Exercises the gradient, filter and text paths; see the note above about
    // what this does and does not prove.
    const blob = await svgToPdfBlob(render('qubits 2\nH 1\nCNOT 1 -> 2\nout 00|11').svg)
    expect(await head(blob)).toMatch(/^%PDF-/)
    expect(blob.size).toBeGreaterThan(500)
  })

  it('runs every theme through without throwing', async () => {
    for (const theme of ['solid', 'flat', 'isometric'] as const) {
      const blob = await svgToPdfBlob(render('qubits 2\nH 1\nout 00|11', { theme }).svg)
      expect(await head(blob)).toMatch(/^%PDF-/)
    }
  })

  it('cleans up the scratch element it parses into', async () => {
    const before = document.body.children.length
    await svgToPdfBlob(render('0|1').svg)
    expect(document.body.children.length).toBe(before)
  })

  it('removes the scratch element even when conversion fails', async () => {
    const before = document.body.children.length
    await expect(svgToPdfBlob('<p>not an svg</p>')).rejects.toThrow()
    expect(document.body.children.length).toBe(before)
  })

  it('rejects markup with no SVG root', async () => {
    await expect(svgToPdfBlob('')).rejects.toThrow(/could not parse/)
  })
})

describe('the source travels inside the PDF', () => {
  const SOURCE = ['in 001', 'SWAP 2 3', '---', 'CNOT 2 -> 1; X 3', 'out 111'].join('\n')

  const bytes = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer())

  it('writes it where it can be read back out', async () => {
    // This is the check that jsPDF really leaves the Info dictionary
    // uncompressed, which the reader depends on.
    const svg = embedSvgMeta(render(SOURCE).svg, { source: SOURCE })
    expect(readPdfMeta(await bytes(await svgToPdfBlob(svg)))?.source).toBe(SOURCE)
  })

  it('survives a diagram whose source is outside ASCII', async () => {
    const unicode = '"½ chance" 0|1 != 0'
    const svg = embedSvgMeta(render(unicode).svg, { source: unicode })
    expect(readPdfMeta(await bytes(await svgToPdfBlob(svg)))?.source).toBe(unicode)
  })

  it('leaves the metadata element out of the drawing itself', async () => {
    // svg2pdf walks every node it is handed; the element would be dead weight
    // at best and an unknown-tag failure at worst.
    const svg = embedSvgMeta(render('0|1').svg, { source: '0|1' })
    const text = new TextDecoder('latin1').decode(await bytes(await svgToPdfBlob(svg)))
    expect(text).not.toContain('<metadata')
  })

  it('says nothing when there is no source to carry', async () => {
    expect(readPdfMeta(await bytes(await svgToPdfBlob(render('0|1').svg)))).toBeNull()
  })
})

describe('pdfDataUrl', () => {
  it('is a base64 application/pdf data URL', async () => {
    const url = await pdfDataUrl(render('0|1').svg)
    expect(url.startsWith('data:application/pdf;base64,')).toBe(true)
    // Decodes back to a PDF.
    const b64 = url.split(',')[1]
    expect(atob(b64).slice(0, 5)).toBe('%PDF-')
  })
})

describe('gradients in a PDF', () => {
  it('are banded on the way in, since Preview will not draw a shading', () => {
    // The figure that goes to jsPDF must carry no gradient-filled rectangle:
    // PDFKit flattens a shading to one colour once the drawing is embedded in
    // another document, which is where every one of these is headed.
    const svg = render('qubits 2\nH 1\nCNOT 1 -> 2', { theme: 'solid' }).svg
    expect(svg).toMatch(/<rect[^>]*fill="url\(#ms-pipe\)"/)
    expect(bandGradients(svg)).not.toMatch(/<rect[^>]*fill="url\(#ms-(pipe|gate|shadow)\)"/)
  })
})
