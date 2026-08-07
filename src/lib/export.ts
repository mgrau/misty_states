/**
 * Browser-side export helpers. Everything stays local — nothing is uploaded.
 *
 * Every exporter takes the rendered SVG, which by then already carries its own
 * source in a `<metadata>` element (see `metadata.ts`). The PNG and PDF paths
 * lift that text out and re-attach it in whatever form their format supports,
 * so a saved figure can always be reopened for editing.
 */

import {
  embedPngMeta, PDF_PREFIX, encodeSource, readFileMeta, readSvgMeta, stripSvgMeta,
  type DiagramMeta,
} from './metadata'

/** Recover a diagram from a file the user picked or dropped. */
export async function readSourceFile(file: File): Promise<DiagramMeta> {
  return readFileMeta(new Uint8Array(await file.arrayBuffer()), file.name)
}

function svgBlob(svg: string): Blob {
  return new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke on the next tick so Safari has finished reading the blob.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Save any text as a file — used for the YAML library export. */
export function downloadText(text: string, filename: string, mime = 'text/plain'): void {
  triggerDownload(new Blob([text], { type: `${mime};charset=utf-8` }), filename)
}

export function downloadSVG(svg: string, filename: string): void {
  triggerDownload(svgBlob(svg), filename.endsWith('.svg') ? filename : `${filename}.svg`)
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

export async function downloadPNG(svg: string, filename: string, scale = 3): Promise<void> {
  const blob = await svgToPngBlob(svg, scale)
  triggerDownload(blob, filename.endsWith('.png') ? filename : `${filename}.png`)
}

/**
 * Render the SVG into a vector PDF sized exactly to the drawing.
 *
 * jsPDF is a few hundred kB, so it is loaded on demand — the app stays small
 * for everyone who never exports a PDF.
 */
export async function svgToPdfBlob(svg: string): Promise<Blob> {
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import('jspdf'), import('svg2pdf.js')])

  // Parse into a live element; svg2pdf walks the DOM, not the markup.
  const meta = readSvgMeta(svg)
  const host = document.createElement('div')
  host.style.position = 'fixed'
  host.style.left = '-10000px'
  host.style.top = '0'
  // svg2pdf walks every node it is given; the metadata goes in the Info
  // dictionary below instead, where a PDF reader can actually show it.
  host.innerHTML = stripSvgMeta(svg)
  const root = host.firstElementChild
  if (!root || root.tagName.toLowerCase() !== 'svg') {
    throw new Error('could not parse the SVG')
  }
  const el = root as unknown as SVGSVGElement
  document.body.appendChild(host)

  try {
    // Fall back to the viewBox when width/height are missing.
    const box = el.viewBox?.baseVal
    const width = Number(el.getAttribute('width')) || box?.width || 300
    const height = Number(el.getAttribute('height')) || box?.height || 150

    const doc = new jsPDF({
      unit: 'pt',
      // A page exactly the size of the figure, so it drops into LaTeX with no
      // cropping; portrait/landscape follows the aspect ratio.
      orientation: width >= height ? 'landscape' : 'portrait',
      format: [width, height],
      compress: true,
    })
    if (meta) {
      doc.setProperties({
        creator: 'Misty States',
        title: meta.name ?? '',
        // Readable in a PDF viewer's Properties panel…
        subject: meta.source,
        // …but Info strings use a legacy charset, so the copy that gets read
        // back is base64 of UTF-8.
        keywords: PDF_PREFIX + encodeSource(meta.source),
      })
    }
    await svg2pdf(el, doc, { x: 0, y: 0, width, height })
    return doc.output('blob')
  } finally {
    host.remove()
  }
}

export async function downloadPDF(svg: string, filename: string): Promise<void> {
  const blob = await svgToPdfBlob(svg)
  triggerDownload(blob, filename.endsWith('.pdf') ? filename : `${filename}.pdf`)
}

export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
}

/** Copy a rendered PNG to the clipboard, for pasting straight into slides. */
export async function copyPNG(svg: string, scale = 3): Promise<void> {
  const blob = await svgToPngBlob(svg, scale)
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
}

/** How `copySVGImage` managed to get the drawing onto the clipboard. */
export type SvgCopyFlavor = 'image' | 'html'

/**
 * Copy the drawing to the clipboard *as an image*, keeping it vector.
 *
 * Browsers disagree here. The async clipboard only guarantees `text/plain`,
 * `text/html` and `image/png`; Safari also accepts `image/svg+xml`, while
 * Chrome and Firefox reject it. So try the real thing first, and otherwise fall
 * back to `text/html` carrying the markup — which many editors (Word, Keynote,
 * Illustrator) will paste as vector, unlike a PNG.
 *
 * Returns which route succeeded, so the caller can say what actually happened
 * rather than claiming a vector paste it may not have achieved.
 */
export async function copySVGImage(svg: string): Promise<SvgCopyFlavor> {
  try {
    const blob = new Blob([svg], { type: 'image/svg+xml' })
    await navigator.clipboard.write([new ClipboardItem({ 'image/svg+xml': blob })])
    return 'image'
  } catch {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([svg], { type: 'text/html' }),
        // Plain text keeps the markup reachable in editors that ignore HTML.
        'text/plain': new Blob([svg], { type: 'text/plain' }),
      }),
    ])
    return 'html'
  }
}

export function canCopyImages(): boolean {
  return typeof ClipboardItem !== 'undefined' && !!navigator.clipboard?.write
}

/** Base64 of raw bytes, chunked so a large diagram cannot blow the arg limit. */
function bytesToBase64(bytes: Uint8Array): string {
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

async function blobToDataUrl(blob: Blob, mime: string): Promise<string> {
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

/**
 * The PDF as a `data:` URL.
 *
 * The clipboard cannot carry `application/pdf` — browsers only accept a short
 * list of types — so this is how a PDF gets copied rather than saved: paste it
 * into the address bar and the browser opens the document.
 */
export async function pdfDataUrl(svg: string): Promise<string> {
  return blobToDataUrl(await svgToPdfBlob(svg), 'application/pdf')
}
