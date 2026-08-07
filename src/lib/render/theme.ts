import { Path, el, esc, g, n } from '../svg'
import { inscribedMark, shapePath } from '../shapes'
import type { Metrics, Prim, QubitPrim, TextPrim } from './primitives'
import { cloudPath } from './cloud'

export type ThemeId = 'solid' | 'flat' | 'isometric'

export interface Palette {
  ink: string
  paper: string
  /** Fill for |0⟩ and |1⟩ glyphs. */
  zero: string
  one: string
  pipe: string
  pipeEdge: string
  gate: string
  gateEdge: string
  measure: string
  accent: string
  hadamard: string
  muted: string
  /** Outline for a qubit whose value is unknown. */
  uncertain: string
}

export const LIGHT_PALETTE: Palette = {
  ink: '#111111',
  paper: '#ffffff',
  zero: '#ffffff',
  one: '#111111',
  pipe: '#d9d9d9',
  pipeEdge: '#8a8a8a',
  gate: '#e9e9e9',
  gateEdge: '#4a4a4a',
  measure: '#9d9d9d',
  accent: '#1b3fae',
  hadamard: '#ef5f5b',
  muted: '#6b6b6b',
  uncertain: '#b6b6b6',
}

export const DARK_PALETTE: Palette = {
  ink: '#f2f2f2',
  paper: '#101014',
  zero: '#101014',
  one: '#f2f2f2',
  pipe: '#3a3a42',
  pipeEdge: '#8c8c98',
  gate: '#2c2c34',
  gateEdge: '#b8b8c4',
  measure: '#4a4a54',
  accent: '#7aa2ff',
  hadamard: '#ef5f5b',
  muted: '#9a9aa6',
  uncertain: '#565660',
}

/**
 * How a gate body sits relative to the pipe it interrupts.
 *
 * In a flat projection a gate is centred on the pipe axis and pipes meet its
 * top and bottom edges exactly. An extruded gate is drawn in oblique
 * projection, so the *visible* top face is displaced by half the depth vector
 * from the front face — the pipe has to land there instead, or it appears to
 * enter the box off-centre.
 */
export interface Attach {
  /** Horizontal shift applied to gate bodies and their glyphs. */
  dx: number
  /** Where a pipe meets the gate, relative to the box's top edge. */
  topDy: number
  /** Where a pipe leaves the gate, relative to the box's bottom edge. */
  bottomDy: number
  /**
   * Extra length for the stub at the top of the circuit.
   *
   * Under an extruded projection the mouth is foreshortened and part of the
   * stub disappears behind the first gate's top face, so it has to run longer
   * to read as the same length as the tail.
   */
  topLeadExtra: number
  /**
   * Paint the stack from the bottom up, interleaving pipes with gate bodies.
   *
   * An extruded gate needs it: each pipe has to be behind the gate it leaves
   * and in front of the one it enters, which only a bottom-up walk gives. A
   * flat gate is a plate lying *on* the pipes — nothing passes in front of it —
   * so there the pipes are simply painted first, and gate shadows fall on them.
   */
  paintBottomUp: boolean
}

export const FLAT_ATTACH: Attach = {
  dx: 0,
  topDy: 0,
  bottomDy: 0,
  topLeadExtra: 0,
  paintBottomUp: false,
}

export interface Theme {
  id: ThemeId
  label: string
  description: string
  /** Extra room the theme's decoration needs outside the layout bounds. */
  bleed: { top: number; right: number; bottom: number; left: number }
  /** Where pipes meet gate bodies under this theme's projection. */
  attach: Attach
  defs(pal: Palette): string
  draw(p: Prim, pal: Palette, m: Metrics): string
}

export const FONT_STACK =
  "ui-sans-serif, system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif"

/* ------------------------------------------------------------------ *
 * Helpers shared by every theme. Only shading differs between them,
 * so glyph geometry lives here and is never duplicated.
 * ------------------------------------------------------------------ */

/**
 * Fraction of the font size between the alphabetic baseline and the visual
 * centre. `dominant-baseline` is avoided because support varies across SVG
 * consumers (Inkscape and several PDF converters ignore it), which would shift
 * text on export; an explicit offset renders identically everywhere.
 */
const CAP_CENTRE = 0.355
const MATH_CENTRE = 0.28

export function baselineOffset(size: number, baseline: 'cap' | 'math' = 'cap'): number {
  return size * (baseline === 'math' ? MATH_CENTRE : CAP_CENTRE)
}

export interface QubitStyle {
  /** Paint layered over the glyph to model it as a solid body. */
  overlay?: string
  filter?: string
}

export function drawQubit(
  p: QubitPrim,
  pal: Palette,
  m: Metrics,
  style: QubitStyle = {},
): string {
  const unknown = p.value === 'unknown'
  const fill = p.value === 1 ? pal.one : pal.zero
  const d = shapePath(p.shape, p.size)
  const body = el('path', {
    d,
    fill,
    // A pale outline for an unknown value: the glyph is still a qubit, but it
    // should not assert itself the way a definite 0 or 1 does.
    stroke: unknown ? pal.uncertain : pal.ink,
    'stroke-width': m.stroke,
    'stroke-linejoin': 'round',
    filter: style.filter,
  })
  // Painted with the same path, so the shading is clipped to the glyph without
  // needing a clipPath per shape.
  const shading = style.overlay
    ? el('path', { d, fill: style.overlay, stroke: 'none' })
    : ''
  const inscribed = inscribedMark(p.shape, p.size)
  const markSize = inscribed.size
  const mark = unknown
      ? el(
          'text',
          {
            x: 0,
            y: inscribed.dy + baselineOffset(markSize),
            'text-anchor': 'middle',
            'font-family': FONT_STACK,
            'font-size': markSize,
            'font-weight': 700,
            fill: pal.muted,
          },
          '?',
        )
      : ''
  return g({ transform: `translate(${n(p.cx)} ${n(p.cy)})` }, body + shading + mark)
}

export function drawText(p: TextPrim, pal: Palette): string {
  return el(
    'text',
    {
      x: p.x,
      y: p.cy + baselineOffset(p.size, p.baseline),
      'text-anchor': p.anchor,
      'font-family': p.mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : FONT_STACK,
      'font-size': p.size,
      'font-weight': p.weight ?? 400,
      fill: p.color ?? pal.ink,
    },
    esc(p.text),
  )
}

/** The `-` of a negative amplitude: a bar centred exactly on the centre line. */
export function drawSign(x: number, cy: number, w: number, h: number, pal: Palette): string {
  return el('rect', { x, y: cy - h / 2, width: w, height: h, fill: pal.ink })
}

export function drawCloud(
  content: { x: number; y: number; w: number; h: number },
  seed: string,
  pal: Palette,
  m: Metrics,
  filter?: string,
): string {
  const { d } = cloudPath(content, seed, m.cloudPadX, m.cloudPadY, m.cloudFluff)
  return el('path', {
    d,
    fill: pal.paper,
    stroke: pal.ink,
    'stroke-width': m.cloudStroke,
    'stroke-linejoin': 'round',
    filter,
  })
}

export function drawBar(x: number, cy: number, h: number, pal: Palette, m: Metrics): string {
  return el('rect', {
    x: x - m.barWidth / 2,
    y: cy - h / 2,
    width: m.barWidth,
    height: h,
    fill: pal.ink,
  })
}

/**
 * Analog meter dial: a graduated scale with tick marks, a needle, and a pivot.
 *
 * Centred on (cx, cy) — the pivot sits half a radius low so the arc above it
 * balances about the centre. The basis label is drawn by the caller, so the
 * dial itself can stay centred in its box.
 */
export function meterGlyph(cx: number, cy: number, r: number, pal: Palette, m: Metrics): string {
  const py = cy + r * 0.5
  const sw = m.stroke * 0.7

  const scale = el('path', {
    d: new Path().M(cx - r, py).A(r, r, 0, 0, 1, cx + r, py).toString(),
    fill: 'none',
    stroke: pal.ink,
    'stroke-width': sw,
    'stroke-linecap': 'round',
  })

  // Graduations at 0°, 45°, 90°, 135°, 180° around the scale.
  const ticks = [0, 1, 2, 3, 4]
    .map((i) => {
      const a = Math.PI - (i * Math.PI) / 4
      const inner = r * 0.76
      return el('line', {
        x1: cx + inner * Math.cos(a),
        y1: py - inner * Math.sin(a),
        x2: cx + r * Math.cos(a),
        y2: py - r * Math.sin(a),
        stroke: pal.ink,
        'stroke-width': sw * 0.8,
        'stroke-linecap': 'round',
      })
    })
    .join('')

  // Deliberately halfway between the 45° and 90° graduations: a needle resting
  // exactly on a tick reads as a fixed symbol rather than a dial in use.
  const angle = Math.PI * 0.375
  // Overshoots the scale, the way a real pointer passes in front of its face.
  const reach = r * 1.14
  const needle = el('line', {
    x1: cx,
    y1: py,
    x2: cx + reach * Math.cos(angle),
    y2: py - reach * Math.sin(angle),
    stroke: pal.ink,
    'stroke-width': sw * 1.5,
    'stroke-linecap': 'round',
  })

  const pivot = el('circle', { cx, cy: py, r: Math.max(2.2, r * 0.21), fill: pal.ink })

  return scale + ticks + needle + pivot
}

/** Basis letter for a measurement, tucked into a corner clear of the dial. */
export function basisLabel(
  x: number,
  y: number,
  text: string,
  size: number,
  pal: Palette,
): string {
  if (!text) return ''
  return el(
    'text',
    {
      x,
      y: y + baselineOffset(size),
      'text-anchor': 'end',
      'font-family': FONT_STACK,
      'font-size': size,
      'font-weight': 700,
      fill: pal.ink,
    },
    esc(text),
  )
}

/** ⊕ target glyph. */
export function notGlyph(cx: number, cy: number, r: number, pal: Palette, m: Metrics): string {
  const circle = el('circle', { cx, cy, r, fill: pal.accent })
  const bar = (x1: number, y1: number, x2: number, y2: number) =>
    el('line', {
      x1, y1, x2, y2,
      stroke: pal.paper,
      'stroke-width': m.stroke * 1.1,
      'stroke-linecap': 'round',
    })
  return circle + bar(cx - r * 0.55, cy, cx + r * 0.55, cy) + bar(cx, cy - r * 0.55, cx, cy + r * 0.55)
}

export function swapGlyph(cx: number, cy: number, r: number, pal: Palette, m: Metrics): string {
  const bar = (x1: number, y1: number, x2: number, y2: number) =>
    el('line', {
      x1, y1, x2, y2,
      stroke: pal.accent,
      'stroke-width': m.stroke * 1.4,
      'stroke-linecap': 'round',
    })
  return bar(cx - r, cy - r, cx + r, cy + r) + bar(cx - r, cy + r, cx + r, cy - r)
}

/** Label chip inside a gate box: accent-filled rounded rect with the letter. */
export function labelChip(
  cx: number,
  cy: number,
  text: string,
  size: number,
  accent: string | undefined,
  pal: Palette,
): string {
  if (!text) return ''
  if (!accent) {
    return drawText(
      { t: 'text', x: cx, cy, text, size, anchor: 'middle', weight: 600 },
      pal,
    )
  }
  const w = Math.max(size * 1.25, text.length * size * 0.66)
  const h = size * 1.3
  return (
    el('rect', {
      x: cx - w / 2,
      y: cy - h / 2,
      width: w,
      height: h,
      rx: 2,
      fill: accent,
    }) +
    drawText(
      { t: 'text', x: cx, cy, text, size, anchor: 'middle', weight: 700, color: '#ffffff' },
      pal,
    )
  )
}
