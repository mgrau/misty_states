// @vitest-environment jsdom
/**
 * Copying the drawing as an image.
 *
 * jsdom has no clipboard, so these stub `navigator.clipboard` and
 * `ClipboardItem` to record what would have been written. That is the right
 * level here: the interesting behaviour is *which MIME types we offer* and how
 * we degrade when a browser rejects `image/svg+xml`.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest'
import { copySVGImage } from './export'
import { render } from './index'

interface Written {
  types: string[]
  parts: Record<string, string>
}

let written: Written[]
let rejectTypes: string[]

beforeEach(() => {
  written = []
  rejectTypes = []

  class FakeClipboardItem {
    constructor(readonly items: Record<string, Blob>) {}
  }
  vi.stubGlobal('ClipboardItem', FakeClipboardItem)

  vi.stubGlobal('navigator', {
    clipboard: {
      async write(items: FakeClipboardItem[]) {
        for (const item of items) {
          const types = Object.keys(item.items)
          const blocked = types.find((t) => rejectTypes.includes(t))
          if (blocked) throw new Error(`Type ${blocked} not supported on write`)
          const parts: Record<string, string> = {}
          for (const [type, blob] of Object.entries(item.items)) parts[type] = await blob.text()
          written.push({ types, parts })
        }
      },
    },
  })
})

const svg = () => render('00|11').svg

describe('when the browser accepts image/svg+xml (Safari)', () => {
  it('puts a real SVG image on the clipboard', async () => {
    expect(await copySVGImage(svg())).toBe('image')
    expect(written).toHaveLength(1)
    expect(written[0].types).toEqual(['image/svg+xml'])
  })

  it('writes the drawing itself, not a description of it', async () => {
    await copySVGImage(svg())
    expect(written[0].parts['image/svg+xml'].startsWith('<svg')).toBe(true)
  })
})

describe('when the browser rejects image/svg+xml (Chrome, Firefox)', () => {
  beforeEach(() => {
    rejectTypes = ['image/svg+xml']
  })

  it('falls back rather than failing', async () => {
    expect(await copySVGImage(svg())).toBe('html')
  })

  it('offers HTML so editors can still paste it as vector', async () => {
    await copySVGImage(svg())
    const last = written[written.length - 1]
    expect(last.types).toContain('text/html')
    expect(last.parts['text/html'].startsWith('<svg')).toBe(true)
  })

  it('includes plain text for editors that ignore HTML', async () => {
    await copySVGImage(svg())
    const last = written[written.length - 1]
    expect(last.types).toContain('text/plain')
    expect(last.parts['text/plain']).toBe(last.parts['text/html'])
  })

  it('offers both flavours in a single clipboard item', async () => {
    // Two items would mean two clipboard entries, not one with two flavours.
    await copySVGImage(svg())
    expect(written).toHaveLength(1)
  })

  it('never silently degrades to a raster', async () => {
    await copySVGImage(svg())
    expect(written.flatMap((w) => w.types)).not.toContain('image/png')
  })
})

describe('when the clipboard is unavailable entirely', () => {
  it('propagates the failure instead of reporting success', async () => {
    rejectTypes = ['image/svg+xml', 'text/html']
    await expect(copySVGImage(svg())).rejects.toThrow()
  })
})
