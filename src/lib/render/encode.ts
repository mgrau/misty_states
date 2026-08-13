/**
 * A rendered SVG, turned into other bytes.
 *
 * These sit apart from the rest of the export helpers because of what they do
 * *not* need. Saving a file needs an anchor and a click; copying needs the
 * clipboard; a PDF needs jsPDF, several hundred kilobytes of it. These need a
 * canvas at most, and `svgDataUrl` needs nothing at all — which is what lets
 * the published surface offer "give me the picture as a URL" without the
 * editor's whole export apparatus coming with it.
 *
 * The metadata handling is the same as everywhere else: the rendered SVG
 * already carries its own source in a `<metadata>` element, and canvas throws
 * that away, so the PNG path puts it back as text chunks. A saved figure can
 * always be reopened for editing.
 */

import { embedPngMeta, readSvgMeta } from '../metadata'

export function svgBlob(svg: string): Blob {
  return new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
}

/** Rasterise an SVG string to a PNG blob at `scale`× its intrinsic size. */
export async function svgToPngBlob(svg: string, scale = 3): Promise<Blob> {
  const url = URL.createObjectURL(svgBlob(svg))
  try {
    const img = new Image()
    img.decoding = 'sync'
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('could not rasterise the SVG'))
      img.src = url
    })

    const w = Math.max(1, Math.round(img.naturalWidth * scale))
    const h = Math.max(1, Math.round(img.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas is unavailable')
    ctx.drawImage(img, 0, 0, w, h)

    const raw = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png')
    })

    // Canvas throws the metadata away, so put it back as text chunks.
    const meta = readSvgMeta(svg)
    if (!meta) return raw
    const bytes = embedPngMeta(new Uint8Array(await raw.arrayBuffer()), meta)
    return new Blob([bytes as unknown as BlobPart], { type: 'image/png' })
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Base64 of raw bytes, chunked so a large diagram cannot blow the arg limit. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

/** UTF-8 safe base64, since btoa alone rejects non-Latin-1 characters. */
function toBase64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text))
}

export async function blobToDataUrl(blob: Blob, mime: string): Promise<string> {
  return `data:${mime};base64,${bytesToBase64(new Uint8Array(await blob.arrayBuffer()))}`
}

/**
 * A self-contained `data:` URL for the SVG.
 *
 * This is the browser-only answer to "a URL that returns the image": it needs
 * no server, and works anywhere a document can reference an image by URL —
 * `<img src>`, HTML, CSS. Note that GitHub markdown strips data URLs and some
 * LaTeX/PDF pipelines will not fetch them.
 */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${toBase64(svg)}`
}

/** The same, rasterised to PNG via canvas. */
export async function pngDataUrl(svg: string, scale = 3): Promise<string> {
  return blobToDataUrl(await svgToPngBlob(svg, scale), 'image/png')
}
