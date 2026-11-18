/**
 * Qubit shapes. Qubit N of a term is drawn with the Nth shape in the sequence.
 *
 * The default order matches the PHYS 137T course materials: circle, square,
 * triangle, then diamond/heart/star/pentagon/hexagon for wider registers, and
 * cross/crescent/spade/drop past eight — Shor's code alone takes nine wires.
 *
 * Every path is centred on its **bounding box**, not its centroid, so that a
 * row of mixed shapes shares one centre line.
 */

import { Path, n } from './svg'

export type ShapeName =
  | 'circle' | 'square' | 'triangle' | 'diamond'
  | 'heart' | 'star' | 'pentagon' | 'hexagon'
  | 'cross' | 'crescent' | 'spade' | 'drop'

export const SHAPE_NAMES: ShapeName[] = [
  'circle', 'square', 'triangle', 'diamond', 'heart', 'star', 'pentagon', 'hexagon',
  'cross', 'crescent', 'spade', 'drop',
]

export const DEFAULT_SHAPE_ORDER: ShapeName[] = [
  'circle', 'square', 'triangle', 'diamond', 'heart', 'star', 'pentagon', 'hexagon',
  'cross', 'crescent', 'spade', 'drop',
]

/**
 * One character per shape, for writing a register out: `shape os^` is a
 * circle, a square and a triangle.
 *
 * Pictographic where a character allows — `o`, `^`, `*` — and the shape's
 * initial otherwise. Deliberately *not* `#` for square, obvious though it
 * looks: `#` starts a comment, so `shape #^o` would lose its own argument.
 * No digits either, so a run of symbols can never be mistaken for the numeric
 * form.
 */
export const SHAPE_SYMBOLS: Record<string, ShapeName> = {
  o: 'circle', O: 'circle',
  s: 'square', S: 'square',
  '^': 'triangle', t: 'triangle', T: 'triangle',
  d: 'diamond', D: 'diamond', '<': 'diamond',
  v: 'heart', V: 'heart',
  '*': 'star',
  p: 'pentagon', P: 'pentagon',
  h: 'hexagon', H: 'hexagon',
  x: 'cross', X: 'cross', '+': 'cross',
  c: 'crescent', C: 'crescent',
  k: 'spade', K: 'spade',
  q: 'drop', Q: 'drop',
}

/** The character each shape is written with, for reporting what is available. */
export const SHAPE_SYMBOL_HELP =
  'o circle, s square, ^ triangle, d diamond, v heart, * star, p pentagon, h hexagon, ' +
  'x cross, c crescent, k spade, q drop'

/**
 * How one wire's shape was chosen.
 *
 * A name pins the shape outright — that is what `shape o#^` writes, and it
 * means the same whatever order the shapes are configured in. A number picks
 * the Nth of the current order, which is what the older `shapes 2 3 1` writes.
 */
export type ShapePick = ShapeName | number

/**
 * A shape order read back from storage, or null if it cannot be trusted.
 *
 * One saved before the list grew is kept, with the shapes it has never heard of
 * added at the end in their usual order: whoever arranged eight shapes meant
 * that arrangement, and losing it because four more arrived would be a
 * surprise. Anything else — an unknown name, one named twice — is refused.
 */
export function savedShapeOrder(saved: unknown): ShapeName[] | null {
  if (!Array.isArray(saved) || !saved.length) return null
  if (!saved.every((s) => SHAPE_NAMES.includes(s))) return null
  if (new Set(saved).size !== saved.length) return null
  const kept = saved as ShapeName[]
  return [...kept, ...DEFAULT_SHAPE_ORDER.filter((s) => !kept.includes(s))]
}

export function resolveShape(pick: ShapePick, order: ShapeName[] = DEFAULT_SHAPE_ORDER): ShapeName {
  return typeof pick === 'number' ? order[pick % order.length] : pick
}

/** A `shape` line, in either kind of document. */
export const SHAPE_LINE = /^\s*shapes?\s+(\S.*?)\s*$/i

/**
 * Read a `shape` argument, in either form, or null if it is neither.
 *
 * `2 3 1` is the older numeric form; anything else is read a character at a
 * time. Whitespace is ignored either way, so `o s ^` and `os^` agree.
 */
export function parseShapeSpec(text: string): { picks: ShapePick[]; bad?: string } | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  if (/^[\d\s,]+$/.test(trimmed)) {
    const picks: ShapePick[] = []
    for (const tok of trimmed.split(/[\s,]+/).filter(Boolean)) {
      const v = Number(tok)
      if (!Number.isInteger(v) || v < 1) return { picks: [], bad: tok }
      picks.push(v - 1)
    }
    return { picks }
  }

  const picks: ShapePick[] = []
  for (const ch of trimmed.replace(/[\s,]+/g, '')) {
    const shape = SHAPE_SYMBOLS[ch]
    if (!shape) return { picks: [], bad: ch }
    picks.push(shape)
  }
  return { picks }
}

/**
 * A crescent opening to the right, as ☾ does: the outer circle with a smaller
 * one cut out of it, set off to the right.
 *
 * In units of the outer radius. The band is thickest at the back, and that is
 * where an inscribed mark has to go — the bounding-box centre is in the hollow.
 */
const CRESCENT = (() => {
  const inner = 0.8
  const off = 0.5
  // Where the two circles cross.
  const tipX = (1 - inner * inner + off * off) / (2 * off)
  const tipY = Math.sqrt(1 - tipX * tipX)
  // Shifted right by this much, the bounding box is centred on the origin.
  const shift = (1 - tipX) / 2
  return { inner, off, tipX, tipY, shift, w: (1 + tipX) / 2, markX: (-1 + (off - inner)) / 2 + shift }
})()

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
  // Thin arms carry less ink than a square's face, so it is not shrunk as one is.
  cross: { scale: 1, w: 1, h: 1, dy: 0 },
  // Two circles' difference: as wide as the outer one less the part cut away.
  crescent: { scale: 1.1, w: CRESCENT.w, h: 1, dy: 0 },
  // A heart turned point-up, on a stem that reaches a little below its lobes.
  spade: { scale: 1.04, w: 0.928, h: 1.05, dy: -0.075 },
  drop: { scale: 1.1, w: 0.72, h: 1, dy: 0 },
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

/**
 * A heart, point up, with a stem flaring out from where its lobes meet.
 *
 * One outline rather than a heart and a triangle laid over each other, so a
 * white spade has no seam drawn across it where the two would meet.
 */
function spadePath(s: number, dy: number): string {
  const k = (v: number) => v * s
  const j = (v: number) => v * s + dy
  return new Path()
    .M(0, j(-0.45))
    .C(k(-0.75), j(0.2), k(-0.45), j(0.75), k(-0.07), j(0.4))
    .L(k(-0.21), j(0.6))
    .L(k(0.21), j(0.6))
    .L(k(0.07), j(0.4))
    .C(k(0.45), j(0.75), k(0.75), j(0.2), 0, j(-0.45))
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
    case 'cross': {
      const a = r
      const t = s * 0.18
      return new Path()
        .M(-t, -a).L(t, -a).L(t, -t).L(a, -t).L(a, t).L(t, t)
        .L(t, a).L(-t, a).L(-t, t).L(-a, t).L(-a, -t).L(-t, -t)
        .Z().toString()
    }
    case 'crescent': {
      const { inner, tipX, tipY, shift } = CRESCENT
      const x = (v: number) => (v + shift) * r
      // Round the back the long way from tip to tip, then back along the inner
      // circle the long way the other way round.
      return `M${n(x(tipX))} ${n(-tipY * r)}` +
        `A${n(r)} ${n(r)} 0 1 0 ${n(x(tipX))} ${n(tipY * r)}` +
        `A${n(inner * r)} ${n(inner * r)} 0 1 1 ${n(x(tipX))} ${n(-tipY * r)}Z`
    }
    case 'spade':
      return spadePath(s, dy)
    case 'drop': {
      // A circle at the foot, and the two lines from the point that just touch it.
      const a = 0.36 * s
      const cy = 0.5 * s - a
      const apex = -0.5 * s
      const d = cy - apex
      const tx = (a * Math.sqrt(d * d - a * a)) / d
      const ty = cy - (a * a) / d
      return new Path().M(0, apex).L(tx, ty).toString() +
        `A${n(a)} ${n(a)} 0 1 1 ${n(-tx)} ${n(ty)}Z`
    }
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
  cross: 0,
  crescent: 0,
  // The lobes are the broad part; the stem below them has no room.
  spade: -0.05,
  // The round foot is where the room is.
  drop: 0.14,
}

/**
 * Sideways, for the one shape whose middle is not inside it: a crescent's
 * bounding-box centre is in its hollow. In units of the nominal size.
 */
const MARK_DX: Partial<Record<ShapeName, number>> = {
  crescent: (CRESCENT.markX / 2) * 1.1,
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
  // Only the square where the arms cross is wide enough.
  cross: 0.34,
  // The back of the band, and no more.
  crescent: 0.34,
  spade: 0.44,
  drop: 0.44,
}

/** Offset and font size for a mark inscribed in `shape`. */
export function inscribedMark(shape: ShapeName, size: number): { dx: number; dy: number; size: number } {
  return {
    dx: (MARK_DX[shape] ?? 0) * size,
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
