/**
 * Positioned, theme-agnostic drawing instructions.
 *
 * Layout produces these; a theme turns them into SVG. Keeping the two apart is
 * what lets the flat, solid and isometric looks share identical geometry.
 */

import type { ShapeName } from '../shapes'
import type { Box } from '../svg'
import type { QubitValue } from '../state/ast'

export interface QubitPrim {
  t: 'qubit'
  shape: ShapeName
  value: QubitValue
  cx: number
  cy: number
  size: number
}

/** The bumpy outline enclosing a superposition. */
export interface CloudPrim {
  t: 'cloud'
  content: Box
  seed: string
  /** Nesting depth, so inner clouds can be drawn slightly lighter. */
  depth: number
}

/** The `|` separating terms inside a cloud. */
export interface BarPrim {
  t: 'bar'
  x: number
  cy: number
  h: number
}

export interface TextPrim {
  t: 'text'
  x: number
  cy: number
  text: string
  size: number
  anchor: 'start' | 'middle' | 'end'
  weight?: number
  color?: string
  mono?: boolean
  /**
   * How to centre the run on `cy`. 'cap' centres the cap height and suits
   * letters and digits; 'math' centres on the font's math axis and suits
   * symbols like `=`. Defaults to 'cap'.
   */
  baseline?: 'cap' | 'math'
}

/**
 * The `-` of a negative amplitude, drawn as geometry rather than a glyph so it
 * lands exactly on the centre line and keeps a consistent weight.
 */
export interface SignPrim {
  t: 'sign'
  x: number
  cy: number
  w: number
  h: number
}

/** Vertical pipe segment a qubit falls through. */
export interface PipePrim {
  t: 'pipe'
  cx: number
  y0: number
  y1: number
  w: number
  /**
   * The upper end is an open mouth rather than a join into a gate.
   *
   * A projection that shows a bore draws it only here: where a pipe leaves a
   * gate there is nothing to see, and drawing one would put a rim over the
   * gate's bottom edge.
   */
  openTop: boolean
}

export interface GateBoxPrim {
  t: 'gatebox'
  box: Box
  label: string
  accent?: string
  fill?: string
  blank?: boolean
  /** Font size chosen by layout so long labels still fit. */
  labelSize: number
}

/**
 * The glazed panel inside a window's frame.
 *
 * Flat in every theme: the frame is the thing that is projected, and glass set
 * into its front face reads as glass whichever way the box is drawn.
 */
export interface PanePrim {
  t: 'pane'
  box: Box
  fill?: string
}

export interface MeasureBoxPrim {
  t: 'measurebox'
  box: Box
  basis: string
}

export interface ControlPrim {
  t: 'control'
  cx: number
  cy: number
  r: number
}

export interface TargetPrim {
  t: 'target'
  cx: number
  cy: number
  r: number
  glyph: 'not' | 'z'
}

export interface SwapPrim {
  t: 'swap'
  cx: number
  cy: number
  r: number
}

/** Horizontal wire joining controls to their target. */
export interface LinkPrim {
  t: 'link'
  x0: number
  x1: number
  cy: number
}

export type Prim =
  | QubitPrim | CloudPrim | BarPrim | TextPrim | SignPrim | PipePrim
  | GateBoxPrim | PanePrim | MeasureBoxPrim | ControlPrim | TargetPrim | SwapPrim | LinkPrim

/** Layout result: what to draw, and the bounds it occupies. */
export interface Layout {
  prims: Prim[]
  box: Box
}

/**
 * Shift primitives by (dx, dy).
 *
 * Layout places a cloud's contents before it knows where the cloud's outline
 * will land, then moves the whole group into position — so this is used on
 * every nesting level, and for stacking rows.
 */
export function translatePrims(prims: Prim[], dx: number, dy: number): Prim[] {
  if (dx === 0 && dy === 0) return prims
  return prims.map((p): Prim => {
    switch (p.t) {
      case 'qubit':
      case 'control':
      case 'target':
      case 'swap':
        return { ...p, cx: p.cx + dx, cy: p.cy + dy }
      case 'cloud':
        return { ...p, content: { ...p.content, x: p.content.x + dx, y: p.content.y + dy } }
      case 'bar':
      case 'text':
      case 'sign':
        return { ...p, x: p.x + dx, cy: p.cy + dy }
      case 'pipe':
        return { ...p, cx: p.cx + dx, y0: p.y0 + dy, y1: p.y1 + dy }
      case 'link':
        return { ...p, x0: p.x0 + dx, x1: p.x1 + dx, cy: p.cy + dy }
      case 'gatebox':
      case 'pane':
      case 'measurebox':
        return { ...p, box: { ...p.box, x: p.box.x + dx, y: p.box.y + dy } }
    }
  })
}

/**
 * Advance widths for the Helvetica/Arial metrics the sans stack resolves to,
 * in units per 1000 em.
 *
 * A flat per-character average is not good enough: `%` is 0.889 em against a
 * digit's 0.556, so a right-anchored caption like `50%` would be measured ~13%
 * short and clip off the left edge of its own box.
 */
const ADVANCE: Record<string, number> = {
  ' ': 278, '!': 278, '"': 355, '#': 556, $: 556, '%': 889, '&': 667, "'": 191,
  '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
  '0': 556, '1': 556, '2': 556, '3': 556, '4': 556, '5': 556, '6': 556, '7': 556,
  '8': 556, '9': 556,
  ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556, '@': 1015,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500,
  K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611,
  U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  '[': 278, '\\': 278, ']': 278, '^': 469, _: 556, '`': 333,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222,
  k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278,
  u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  '{': 334, '|': 260, '}': 334, '~': 584,
  '≠': 549, '→': 987, '−': 584, '×': 584,
}

/** Fallback for anything outside the table — a touch generous, never short. */
const DEFAULT_ADVANCE = 600

/** Advance width of a text run, used for centring, gutters and label fitting. */
export function textWidth(text: string, size: number, bold = false): number {
  let units = 0
  for (const ch of text) units += ADVANCE[ch] ?? DEFAULT_ADVANCE
  // Bold faces run a few percent wider at the same nominal size.
  return (units / 1000) * size * (bold ? 1.06 : 1)
}

export interface Metrics {
  qubit: number
  qubitGap: number
  termGap: number
  barWidth: number
  cloudPadX: number
  cloudPadY: number
  signGap: number
  /** Glyph drawn between the terms of a superposition. */
  separator: 'bar' | 'comma'
  /**
   * How round the cloud's lobes are. 1 is the reference; lower flattens the
   * outline toward a rounded rectangle, higher makes it bubblier.
   */
  cloudFluff: number
  /** Outline weight for qubit glyphs. */
  stroke: number
  /** Outline weight for cloud outlines — lighter, so clouds read as vapour. */
  cloudStroke: number
  fontSize: number
  /**
   * Circuit metrics.
   *
   * There is a single pipe diameter: the stubs a gate carries, the runs between
   * gates, and an identity are all the same pipe, so they join without a seam.
   */
  pipeWidth: number
  colGap: number
  gateHeight: number
  gateGap: number
}

export const DEFAULT_METRICS: Metrics = {
  qubit: 26,
  qubitGap: 4,
  termGap: 6,
  barWidth: 3.2,
  cloudPadX: 14,
  cloudPadY: 11,
  signGap: 3,
  separator: 'bar',
  cloudFluff: 1,
  stroke: 2.2,
  cloudStroke: 1.3,
  fontSize: 22,
  pipeWidth: 30,
  colGap: 30,
  gateHeight: 54,
  gateGap: 10,
}
