/**
 * The source must survive the round trip out to a file and back, in every
 * format the app can save. That is the whole point of the feature: a figure
 * found in a folder a year later should still be editable.
 */

import { describe, expect, it } from 'vitest'
import {
  NoSourceError, SOURCE_KEY, decodeSource, embedPngMeta, embedSvgMeta, encodeSource,
  readFileMeta, readPdfMeta, readPngMeta, readSvgMeta, stripSvgMeta,
} from './metadata'
import { render } from './index'

const CIRCUIT = ['in 001', 'SWAP 2 3', '---', 'CNOT 2 -> 1; X 3', 'out ???'].join('\n')

/** A PNG with nothing in it but the chunks the reader has to walk past. */
function barePng(): Uint8Array {
  const chunk = (type: string, data: number[]) => {
    const bytes = [...new TextEncoder().encode(type), ...data]
    // The reader never checks CRCs, so a placeholder is enough here; the CRC
    // our own writer produces is checked separately below.
    return [
      (data.length >>> 24) & 0xff, (data.length >>> 16) & 0xff,
      (data.length >>> 8) & 0xff, data.length & 0xff,
      ...bytes, 0, 0, 0, 0,
    ]
  }
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]),
    ...chunk('IDAT', [1, 2, 3]),
    ...chunk('IEND', []),
  ])
}

describe('base64 payload', () => {
  it('round-trips text the way btoa alone could not', () => {
    for (const text of ['0|1', CIRCUIT, 'caption ≠ 0 → 1', '“smart quotes” — em dash', '']) {
      expect(decodeSource(encodeSource(text))).toBe(text)
    }
  })

  it('produces only characters that are safe in all three containers', () => {
    // PNG tEXt is Latin-1, and a PDF literal string escapes parentheses.
    expect(encodeSource(CIRCUIT)).toMatch(/^[A-Za-z0-9+/=]*$/)
  })
})

describe('SVG metadata', () => {
  const svg = render(CIRCUIT).svg

  it('attaches the source and reads it back verbatim', () => {
    expect(readSvgMeta(embedSvgMeta(svg, { source: CIRCUIT }))?.source).toBe(CIRCUIT)
  })

  it('keeps the source readable in the file rather than encoding it', () => {
    // Someone opening the SVG in a text editor should see the syntax.
    expect(embedSvgMeta(svg, { source: CIRCUIT })).toContain('CNOT 2 -&gt; 1; X 3')
  })

  it('survives characters that would otherwise break the XML', () => {
    const nasty = 'a < b & c > d "quoted" \'single\''
    expect(readSvgMeta(embedSvgMeta(svg, { source: nasty }))?.source).toBe(nasty)
  })

  it('puts the element inside the root, leaving the opening tag intact', () => {
    const out = embedSvgMeta(svg, { source: CIRCUIT })
    expect(out.slice(0, svg.indexOf('>') + 1)).toBe(svg.slice(0, svg.indexOf('>') + 1))
    expect(out).toMatch(new RegExp(`<svg[^>]*><metadata id="${SOURCE_KEY}"`))
  })

  it('replaces an earlier copy instead of stacking them up', () => {
    const twice = embedSvgMeta(embedSvgMeta(svg, { source: "first" }), { source: "second" })
    expect(twice.match(/<metadata/g)).toHaveLength(1)
    expect(readSvgMeta(twice)?.source).toBe('second')
  })

  it('strips back to exactly the original drawing', () => {
    expect(stripSvgMeta(embedSvgMeta(svg, { source: CIRCUIT }))).toBe(svg)
  })

  it('reports nothing for an SVG that was not saved from here', () => {
    expect(readSvgMeta('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>')).toBeNull()
  })
})

describe('PNG metadata', () => {
  it('round-trips through a tEXt chunk', () => {
    expect(readPngMeta(embedPngMeta(barePng(), { source: CIRCUIT }))?.source).toBe(CIRCUIT)
  })

  it('writes a chunk with a valid CRC, so decoders accept the file', () => {
    const png = embedPngMeta(barePng(), { source: '0|1' })
    const at = png.length - 12 - (new TextEncoder().encode(SOURCE_KEY).length + 1 + 4) - 0
    // Locate our chunk by its type rather than by arithmetic.
    const text = String.fromCharCode(...png)
    const start = text.indexOf('tEXt') - 4
    expect(start).toBeGreaterThan(0)
    expect(at).toBeGreaterThan(0)

    const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
    const length = view.getUint32(start)
    const stored = view.getUint32(start + 8 + length)

    let c = 0xffffffff
    for (const byte of png.subarray(start + 4, start + 8 + length)) {
      c = (c >>> 8) ^ crcTable[(c ^ byte) & 0xff]
    }
    expect((c ^ 0xffffffff) >>> 0).toBe(stored)
  })

  it('lands before IEND, which must stay last', () => {
    const png = embedPngMeta(barePng(), { source: CIRCUIT })
    const text = String.fromCharCode(...png)
    expect(text.indexOf('tEXt')).toBeLessThan(text.indexOf('IEND'))
    expect(text.indexOf('IEND')).toBe(text.length - 8)
  })

  it('leaves a non-PNG alone rather than corrupting it', () => {
    const other = new Uint8Array([1, 2, 3, 4])
    expect(embedPngMeta(other, { source: CIRCUIT })).toBe(other)
    expect(readPngMeta(other)).toBeNull()
  })

  it('reports nothing for a PNG with no chunk of ours', () => {
    expect(readPngMeta(barePng())).toBeNull()
  })
})

/** CRC-32 table, duplicated here so the test checks the writer independently. */
const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

describe('PDF metadata', () => {
  const fakePdf = (body: string) => new TextEncoder().encode(`%PDF-1.3\n${body}\n%%EOF`)

  it('reads the payload out of an Info dictionary', () => {
    const pdf = fakePdf(`/Keywords (${SOURCE_KEY}:${encodeSource(CIRCUIT)})`)
    expect(readPdfMeta(pdf)?.source).toBe(CIRCUIT)
  })

  it('reports nothing for a PDF from anywhere else', () => {
    expect(readPdfMeta(fakePdf('/Keywords (quantum, teaching)'))).toBeNull()
  })
})

describe('opening a dropped file', () => {
  const bytes = (text: string) => new TextEncoder().encode(text)

  it('recognises each format by its content, not its name', () => {
    const svg = embedSvgMeta(render('00|11').svg, { source: '00|11' })
    expect(readFileMeta(bytes(svg), 'anything.dat')?.source).toBe('00|11')
    expect(readFileMeta(embedPngMeta(barePng(), { source: '0|1' }), 'x')?.source).toBe('0|1')
    expect(
      readFileMeta(bytes(`%PDF-1.3\n/Keywords (${SOURCE_KEY}:${encodeSource('1|0')})`), 'x').source,
    ).toBe('1|0')
  })

  it('takes a plain text file as its own source, and its filename as a name', () => {
    const meta = readFileMeta(bytes('in 001\nH 1\n'), 'figure.txt')
    expect(meta.source).toBe('in 001\nH 1')
    expect(meta.name).toBe('figure')
  })

  it('explains what is wrong with an image from somewhere else', () => {
    expect(() => readFileMeta(barePng(), 'photo.png')).toThrow(NoSourceError)
    expect(() => readFileMeta(barePng(), 'photo.png')).toThrow(/carries no diagram source/)
    expect(() => readFileMeta(bytes('%PDF-1.3\nnothing here'), 'paper.pdf')).toThrow(
      /carries no diagram source/,
    )
    expect(() => readFileMeta(bytes('<svg xmlns="x"></svg>'), 'other.svg')).toThrow(
      /carries no diagram source/,
    )
  })

  it('names the file when it cannot make sense of it at all', () => {
    const binary = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46])
    expect(() => readFileMeta(binary, 'photo.jpg')).toThrow(/photo\.jpg/)
  })
})
