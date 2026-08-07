/**
 * Qubit shapes. Qubit N of a term is drawn with the Nth shape in the sequence.
 *
 * The default order matches the PHYS 137T course materials: circle, square,
 * triangle, then diamond/heart/star/pentagon/hexagon for wider registers.
 *
 * Every path is centred on its **bounding box**, not its centroid, so that a
 * row of mixed shapes shares one centre line.
 */

import { Path, n } from './svg'

export type ShapeName =
  | 'circle' | 'square' | 'triangle' | 'diamond'
  | 'heart' | 'star' | 'pentagon' | 'hexagon'

export const SHAPE_NAMES: ShapeName[] = [
  'circle', 'square', 'triangle', 'diamond', 'heart', 'star', 'pentagon', 'hexagon',
]

export const DEFAULT_SHAPE_ORDER: ShapeName[] = [
  'circle', 'square', 'triangle', 'diamond', 'heart', 'star', 'pentagon', 'hexagon',
]

interface ShapeGeom {
  /**
   * Weight correction. A square at the circle's full size reads as much
   * heavier and a triangle much lighter, so they are nudged apart.
   */
  scale: number
  /** Bounding box, in units of the corrected size `s`. */
  w: number
  h: number
  /**
   * Shift applied to the raw path to bring its bounding-box centre onto the
   * origin, in units of `s`. Non-zero for shapes whose natural construction
   * point is a centroid or a circumcircle centre.
   */
  dy: number
}

const GEOM: Record<ShapeName, ShapeGeom> = {
  circle: { scale: 1, w: 1, h: 1, dy: 0 },
  square: { scale: 0.9, w: 1, h: 1, dy: 0 },
  triangle: { scale: 1.14, w: 1, h: 0.866, dy: 0 },
  diamond: { scale: 1.12, w: 1, h: 1, dy: 0 },
  heart: { scale: 1.08, w: 0.99, h: 0.947, dy: 0.024 },
  // A regular polygon with a vertex at the top sits low in its circumcircle.
  star: { scale: 1.18, w: 0.951, h: 0.905, dy: 0.0478 },
  pentagon: { scale: 1.04, w: 0.951, h: 0.905, dy: 0.0478 },
  hexagon: { scale: 1.04, w: 0.866, h: 1, dy: 0 },
}

function regularPolygon(sides: number, r: number, rotation: number, dy: number): string {
  const p = new Path()
  for (let i = 0; i < sides; i++) {
    const a = rotation + (i * 2 * Math.PI) / sides
    const x = r * Math.cos(a)
    const y = r * Math.sin(a) + dy
    if (i === 0) p.M(x, y)
    else p.L(x, y)
  }
  return p.Z().toString()
}

function starPath(points: number, R: number, dy: number): string {
  const r = R * 0.42
  const p = new Path()
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / points
    const rad = i % 2 === 0 ? R : r
    const x = rad * Math.cos(a)
    const y = rad * Math.sin(a) + dy
    if (i === 0) p.M(x, y)
    else p.L(x, y)
  }
  return p.Z().toString()
}

function heartPath(s: number, dy: number): string {
  const k = (v: number) => v * s
  const j = (v: number) => v * s + dy
  return new Path()
    .M(0, j(0.45))
    .C(k(-0.75), j(-0.2), k(-0.5), j(-0.65), k(-0.22), j(-0.45))
    .C(k(-0.08), j(-0.36), k(-0.02), j(-0.22), 0, j(-0.15))
    .C(k(0.02), j(-0.22), k(0.08), j(-0.36), k(0.22), j(-0.45))
    .C(k(0.5), j(-0.65), k(0.75), j(-0.2), 0, j(0.45))
    .Z()
    .toString()
}

/** SVG path data for `shape`, centred on the origin. */
export function shapePath(shape: ShapeName, size: number): string {
  const geom = GEOM[shape]
  const s = size * geom.scale
  const r = s / 2
  const dy = geom.dy * s

  switch (shape) {
    case 'circle':
      // Two arcs, so every shape is a <path> and themes treat them uniformly.
      return `M${n(-r)} 0A${n(r)} ${n(r)} 0 1 0 ${n(r)} 0A${n(r)} ${n(r)} 0 1 0 ${n(-r)} 0Z`
    case 'square': {
      const h = s / 2
      return new Path().M(-h, -h).L(h, -h).L(h, h).L(-h, h).Z().toString()
    }
    case 'triangle': {
      // Equilateral, point up, centred on its bounding box (not its centroid).
      const h = (Math.sqrt(3) / 2) * s
      return new Path().M(0, -h / 2).L(s / 2, h / 2).L(-s / 2, h / 2).Z().toString()
    }
    case 'diamond':
      return new Path().M(0, -r).L(r, 0).L(0, r).L(-r, 0).Z().toString()
    case 'heart':
      return heartPath(s, dy)
    case 'star':
      return starPath(5, r, dy)
    case 'pentagon':
      return regularPolygon(5, r, -Math.PI / 2, dy)
    case 'hexagon':
      return regularPolygon(6, r, -Math.PI / 2, dy)
  }
}

/**
 * Where a mark drawn *inside* a glyph should sit, and how big it can be.
 *
 * The bounding-box centre is the wrong place for anything inscribed: a triangle
 * is at its narrowest there, so a centred `?` crowds the apex. The right anchor
 * is the shape's own centre of area, and the right size is what its inscribed
 * circle will take. Both are in units of the nominal qubit size.
 */
const MARK_DY: Record<ShapeName, number> = {
  circle: 0,
  square: 0,
  // The centroid sits h/6 below the bounding-box centre — the box centre is
  // where a triangle is narrowest, so a mark there crowds the apex.
  triangle: 0.16,
  diamond: 0,
  heart: 0.04,
  star: 0.05,
  pentagon: 0.03,
  hexagon: 0,
}

/**
 * One size across the shapes, so a row of unknown qubits reads as a set rather
 * than as glyphs of drifting importance.
 */
const MARK_SCALE = 0.52

/**
 * Except where the outline pinches in around the mark. A triangle's edges slope
 * inward and a star's points cut away most of its width, so those two run
 * smaller — enough to sit clear of the outline, not enough to look like a
 * different size.
 */
const MARK_SCALE_OVERRIDE: Partial<Record<ShapeName, number>> = {
  triangle: 0.46,
  star: 0.4,
}

/** Offset and font size for a mark inscribed in `shape`. */
export function inscribedMark(shape: ShapeName, size: number): { dy: number; size: number } {
  return {
    dy: MARK_DY[shape] * size,
    size: (MARK_SCALE_OVERRIDE[shape] ?? MARK_SCALE) * size,
  }
}

/** Shape for the qubit at position `index` (0-based) within a term. */
export function shapeAt(index: number, order: ShapeName[] = DEFAULT_SHAPE_ORDER): ShapeName {
  return order[index % order.length]
}

/** Drawn width of the glyph — the horizontal advance used by layout. */
export function shapeWidth(shape: ShapeName, size: number): number {
  const geom = GEOM[shape]
  return size * geom.scale * geom.w
}

/** Drawn height of the glyph, measured about the shared centre line. */
export function shapeHeight(shape: ShapeName, size: number): number {
  const geom = GEOM[shape]
  return size * geom.scale * geom.h
}
