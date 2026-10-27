/**
 * The three render themes.
 *
 * `solid` is the default: flat 2D geometry with just enough shading — cylinder
 * gradients on the pipes, a soft drop shadow under boxes and clouds — to read
 * as concrete objects you could pick up. `flat` strips the shading; `isometric`
 * extrudes the boxes and pipes into the drawn-in-3D look used in the course
 * materials.
 */

import { Path, el, g, n } from '../svg'
import type { Metrics, PipePrim, Prim } from './primitives'
import {
  FLAT_ATTACH, basisLabel, drawBar, drawCloud, drawQubit, drawDial, drawSign, drawText, mix,
  labelChip, meterGlyph, notGlyph, swapGlyph,
  type Attach, type Palette, type QubitStyle, type Theme, type ThemeId,
} from './theme'
import type { QubitValue } from '../state/ast'

/** Blend a hex colour toward white (amount > 0) or black (amount < 0). */
function shade(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  const v = parseInt(m[1], 16)
  const to = amount >= 0 ? 255 : 0
  const k = Math.abs(amount)
  const ch = (sh: number) => {
    const c = (v >> sh) & 0xff
    return Math.round(c + (to - c) * k)
  }
  const out = (ch(16) << 16) | (ch(8) << 8) | ch(0)
  return '#' + out.toString(16).padStart(6, '0')
}

const SHADOW = 'url(#ms-shadow)'
const ISO_DX = 13
const ISO_DY = -8

/* --------------------------------------------------------- bent pipe --- */

type Pt = { x: number; y: number }
type Heading = 'down' | 'east' | 'west'

/**
 * A pipe's centre line, as straight runs and quarter-circle elbows.
 *
 * `right` is a turn to the right as the qubit sees it, falling down the page:
 * down-then-west, or east-then-down. It says which side of the pipe is on the
 * inside of the elbow, which is what offsetting and shading both turn on.
 */
type Piece =
  | { kind: 'run'; a: Pt; b: Pt; heading: Heading }
  | { kind: 'elbow'; a: Pt; b: Pt; c: Pt; r: number; right: boolean; from: Heading; to: Heading }

function centreLine(cx: number, y0: number, y1: number, turns: NonNullable<PipePrim['turns']>): Piece[] {
  const out: Piece[] = []
  let x = cx
  let y = y0
  for (const t of turns) {
    const s = Math.sign(t.x - x) || 1
    const across: Heading = s > 0 ? 'east' : 'west'
    const { r } = t
    out.push({ kind: 'run', a: { x, y }, b: { x, y: t.y - r }, heading: 'down' })
    out.push({
      kind: 'elbow', a: { x, y: t.y - r }, b: { x: x + s * r, y: t.y }, c: { x: x + s * r, y: t.y - r },
      r, right: s < 0, from: 'down', to: across,
    })
    out.push({ kind: 'run', a: { x: x + s * r, y: t.y }, b: { x: t.x - s * r, y: t.y }, heading: across })
    out.push({
      kind: 'elbow', a: { x: t.x - s * r, y: t.y }, b: { x: t.x, y: t.y + r }, c: { x: t.x - s * r, y: t.y + r },
      r, right: s > 0, from: across, to: 'down',
    })
    x = t.x
    y = t.y + r
  }
  out.push({ kind: 'run', a: { x, y }, b: { x, y: y1 }, heading: 'down' })
  return out
}

/**
 * A point `o` out from the centre line, toward the qubit's right hand.
 *
 * Falling down the page, its right hand is the left of the page; going east,
 * the bottom; going west, the top.
 */
function aside(p: Pt, h: Heading, o: number): Pt {
  if (h === 'down') return { x: p.x - o, y: p.y }
  return h === 'east' ? { x: p.x, y: p.y + o } : { x: p.x, y: p.y - o }
}

/** An elbow's radius `o` out from its centre line: smaller on the inside of the turn. */
const elbowRadius = (e: Extract<Piece, { kind: 'elbow' }>, o: number) => (e.right ? e.r - o : e.r + o)

/** One edge of the pipe, `o` out from the centre, top to bottom; `back` walks it bottom to top. */
function edge(path: Path, pieces: Piece[], o: number, back: boolean, move: boolean): Path {
  const list = back ? [...pieces].reverse() : pieces
  const first = list[0]
  const start = back
    ? aside(first.b, first.kind === 'run' ? first.heading : first.to, o)
    : aside(first.a, first.kind === 'run' ? first.heading : first.from, o)
  if (move) path.M(start.x, start.y)
  else path.L(start.x, start.y)
  for (const p of list) {
    const end = back
      ? aside(p.a, p.kind === 'run' ? p.heading : p.from, o)
      : aside(p.b, p.kind === 'run' ? p.heading : p.to, o)
    if (p.kind === 'run') path.L(end.x, end.y)
    else {
      const rr = Math.max(0, elbowRadius(p, o))
      // Clockwise on the page for a right turn, walked forward.
      const sweep = (p.right ? 1 : 0) ^ (back ? 1 : 0)
      path.A(rr, rr, 0, 0, sweep as 0 | 1, end.x, end.y)
    }
  }
  return path
}

/**
 * The shading across a pipe, as stops from the qubit's right-hand edge (0) to
 * its left (1). Light from the upper left, so falling down the page the bright
 * stripe is left of centre.
 */
const PIPE_PROFILE: [number, number][] = [[0, -0.22], [0.32, 0.42], [0.62, 0], [1, -0.3]]

const profileStops = (pal: Palette, at: (s: number) => number): string =>
  PIPE_PROFILE
    .map(([s, k]) => ({ offset: at(s), colour: k ? shade(pal.pipe, k) : pal.pipe }))
    .sort((a, b) => a.offset - b.offset)
    .map((st) => el('stop', { offset: n(st.offset), 'stop-color': st.colour }))
    .join('')

/** A name for a gradient made for one place, which only that place will ask for. */
const localId = (kind: string, ...at: number[]) =>
  `ms-${kind}-${at.map((v) => n(v).replace('.', '_')).join('_')}`

/**
 * The fill of a bent pipe, shaded piece by piece so the stripe follows it round.
 *
 * Straight down it is the same gradient a straight pipe has. Straight across it
 * is that gradient turned to keep the same edge on the same side. Round an
 * elbow it is drawn as rings about the elbow's centre, so the shading bends
 * with the pipe instead of being cut off by it.
 */
function shadedBend(pieces: Piece[], w: number, pal: Palette): string {
  const h = w / 2
  // Pieces laid edge to edge leave a hairline where the antialiasing of each
  // lets the paper through, so a run reaches a little way under any elbow it
  // meets. Not at the ends of the pipe, where it would poke out.
  const tuck = 0.5
  return pieces.map((p, i) => {
    if (p.kind === 'run') {
      const before = i > 0 ? tuck : 0
      const after = i < pieces.length - 1 ? tuck : 0
      if (p.heading === 'down') {
        const len = p.b.y - p.a.y
        if (len < 0.01) return ''
        return el('rect', {
          x: p.a.x - h, y: p.a.y - before, width: w, height: len + before + after, fill: 'url(#ms-pipe)',
        })
      }
      const east = p.heading === 'east'
      const x0 = Math.min(p.a.x, p.b.x) - (east ? before : after)
      const len = Math.abs(p.b.x - p.a.x) + before + after
      if (len < 0.01 + before + after) return ''
      const id = localId('run', x0, p.a.y)
      const grad = el(
        'linearGradient',
        { id, x1: '0', y1: east ? '1' : '0', x2: '0', y2: east ? '0' : '1' },
        profileStops(pal, (s) => s),
      )
      return grad + el('rect', { x: x0, y: p.a.y - h, width: len, height: w, fill: `url(#${id})` })
    }
    const ro = p.r + h
    const ri = Math.max(0, p.r - h)
    const id = localId('elbow', p.c.x, p.c.y)
    // The right-hand edge is on the inside of a right turn, the outside of a left.
    const at = (s: number) => (p.right ? ri + s * w : ro - s * w) / ro
    const grad = el(
      'radialGradient',
      { id, gradientUnits: 'userSpaceOnUse', cx: p.c.x, cy: p.c.y, r: ro },
      profileStops(pal, at),
    )
    const ring = edge(new Path(), [p], h, false, true)
    edge(ring, [p], -h, true, false).Z()
    return grad + el('path', { d: ring.toString(), fill: `url(#${id})` })
  }).join('')
}

/** The whole outline of a bent pipe, both edges and both ends. */
function bendOutline(pieces: Piece[], w: number, foot = 0): string {
  const path = edge(new Path(), pieces, w / 2, false, true)
  const last = pieces[pieces.length - 1]
  if (foot) {
    // The end seen from above, as a straight pipe's is.
    const to = aside(last.b, 'down', -w / 2)
    path.A(w / 2, foot, 0, 0, 0, to.x, to.y)
  }
  edge(path, pieces, -w / 2, true, false)
  return path.toString()
}

/** Each edge on its own, with nothing across the ends. */
function bendEdges(pieces: Piece[], w: number): string {
  const a = edge(new Path(), pieces, w / 2, false, true)
  const b = edge(new Path(), pieces, -w / 2, false, true)
  return a.toString() + b.toString()
}

interface Surface {
  /** Pipe segment, straight down unless it has turns. */
  pipe(
    cx: number, y0: number, y1: number, w: number,
    pal: Palette, m: Metrics, openTop: boolean,
    turns?: PipePrim['turns'], cut?: boolean,
  ): string
  /** Gate/measurement body; label and glyphs are drawn on top by the caller. */
  body(
    box: { x: number; y: number; w: number; h: number },
    fill: string,
    pal: Palette,
    m: Metrics,
  ): string
  shadow?: string
  defs(pal: Palette): string
  bleed: Theme['bleed']
  attach: Attach
  /** Shading applied to qubit glyphs; omitted themes draw them flat. */
  qubitStyle?(value: QubitValue): QubitStyle
}

/* ---------------------------------------------------------------- flat --- */

const flatSurface: Surface = {
  defs: () => '',
  bleed: { top: 2, right: 2, bottom: 2, left: 2 },
  attach: FLAT_ATTACH,
  pipe: (cx, y0, y1, w, pal, m, _openTop, turns, cut) => {
    const sw = m.stroke * 0.55
    if (!turns?.length) {
      return el('rect', {
        x: cx - w / 2, y: y0, width: w, height: y1 - y0,
        fill: pal.pipe, stroke: pal.pipeEdge, 'stroke-width': sw,
      })
    }
    const pieces = centreLine(cx, y0, y1, turns)
    if (!cut) {
      return el('path', { d: bendOutline(pieces, w), fill: pal.pipe, stroke: pal.pipeEdge, 'stroke-width': sw })
    }
    return el('path', { d: bendOutline(pieces, w), fill: pal.pipe }) +
      el('path', { d: bendEdges(pieces, w), fill: 'none', stroke: pal.pipeEdge, 'stroke-width': sw })
  },
  body: (box, fill, pal, m) =>
    el('rect', {
      x: box.x, y: box.y, width: box.w, height: box.h,
      fill, stroke: pal.gateEdge, 'stroke-width': m.stroke * 0.8,
    }),
}

/* --------------------------------------------------------------- solid --- */

const solidSurface: Surface = {
  shadow: SHADOW,
  bleed: { top: 3, right: 5, bottom: 6, left: 5 },
  attach: FLAT_ATTACH,
  defs: (pal) => {
    const cyl = el(
      'linearGradient',
      { id: 'ms-pipe', x1: '0', y1: '0', x2: '1', y2: '0' },
      PIPE_PROFILE.map(([s, k]) =>
        el('stop', { offset: `${Math.round(s * 100)}%`, 'stop-color': k ? shade(pal.pipe, k) : pal.pipe }),
      ).join(''),
    )
    const gate = el(
      'linearGradient',
      { id: 'ms-gate', x1: '0', y1: '0', x2: '0', y2: '1' },
      [
        el('stop', { offset: '0%', 'stop-color': shade(pal.gate, 0.5) }),
        el('stop', { offset: '100%', 'stop-color': shade(pal.gate, -0.1) }),
      ].join(''),
    )
    /**
     * What a shadow is painted with, in place of a blur.
     *
     * `feDropShadow` is a raster operation: an illustrator, a PDF writer, or
     * anything else treating an SVG as vector art either drops it or rasterises
     * the whole drawing to honour it. A copy of the shape dropped behind the
     * real one and painted with a gradient that fades upwards is ordinary
     * geometry — it says the same thing about where the light is, and it
     * survives being exported.
     *
     * Clear at the top because that part is hidden behind the shape anyway;
     * what shows is the sliver below it and the sides near the bottom, which is
     * exactly where a shadow belongs with the light overhead.
     */
    const fall = (id: string, alpha: number) =>
      el(
        'linearGradient',
        { id, x1: '0', y1: '0', x2: '0', y2: '1' },
        [
          el('stop', { offset: '0%', 'stop-color': '#000000', 'stop-opacity': 0 }),
          el('stop', { offset: '55%', 'stop-color': '#000000', 'stop-opacity': alpha * 0.35 }),
          el('stop', { offset: '100%', 'stop-color': '#000000', 'stop-opacity': alpha }),
        ].join(''),
      )
    const shadow = fall('ms-shadow', 0.34)
    const qubitShadow = fall('ms-qubit-shadow', 0.3)
    // A light source up and to the left: pale glyphs darken toward the far
    // edge, dark glyphs pick up a specular highlight near the light.
    const lit = el(
      'radialGradient',
      { id: 'ms-qubit-lit', cx: '0.34', cy: '0.27', r: '0.78' },
      [
        el('stop', { offset: '0%', 'stop-color': '#ffffff', 'stop-opacity': 0.46 }),
        el('stop', { offset: '45%', 'stop-color': '#ffffff', 'stop-opacity': 0.11 }),
        el('stop', { offset: '100%', 'stop-color': '#ffffff', 'stop-opacity': 0 }),
      ].join(''),
    )
    const dim = el(
      'radialGradient',
      { id: 'ms-qubit-dim', cx: '0.35', cy: '0.28', r: '0.85' },
      [
        el('stop', { offset: '0%', 'stop-color': '#000000', 'stop-opacity': 0 }),
        el('stop', { offset: '58%', 'stop-color': '#000000', 'stop-opacity': 0.05 }),
        el('stop', { offset: '100%', 'stop-color': '#000000', 'stop-opacity': 0.21 }),
      ].join(''),
    )
    return cyl + gate + shadow + qubitShadow + lit + dim
  },
  qubitStyle: (value) => ({
    overlay: value === 1 ? 'url(#ms-qubit-lit)' : 'url(#ms-qubit-dim)',
    shadow: { paint: 'url(#ms-qubit-shadow)', dy: 1.6 },
  }),
  pipe: (cx, y0, y1, w, pal, m, _openTop, turns, cut) => {
    const sw = m.stroke * 0.5
    if (!turns?.length) {
      return el('rect', {
        x: cx - w / 2, y: y0, width: w, height: y1 - y0,
        fill: 'url(#ms-pipe)', stroke: pal.pipeEdge, 'stroke-width': sw,
      })
    }
    const pieces = centreLine(cx, y0, y1, turns)
    return shadedBend(pieces, w, pal) +
      el('path', {
        d: cut ? bendEdges(pieces, w) : bendOutline(pieces, w),
        fill: 'none', stroke: pal.pipeEdge, 'stroke-width': sw,
      })
  },
  body: (box, fill, pal, m) =>
    // The same box dropped behind itself, spread a little so the shadow shows
    // at the sides as well as under the foot.
    el('rect', {
      x: box.x - 0.8, y: box.y + 2.2, width: box.w + 1.6, height: box.h, rx: 3.5,
      fill: SHADOW, stroke: 'none',
    }) +
    el('rect', {
      x: box.x, y: box.y, width: box.w, height: box.h, rx: 3,
      fill: fill === pal.gate ? 'url(#ms-gate)' : fill,
      stroke: pal.gateEdge, 'stroke-width': m.stroke * 0.8,
    }),
}

/* ----------------------------------------------------------- isometric --- */

function parallelogram(x: number, y: number, w: number, h: number, dx: number, dy: number): string {
  return new Path().M(x, y).L(x + dx, y + dy).L(x + w + dx, y + h + dy).L(x + w, y + h).Z().toString()
}

const isoSurface: Surface = {
  bleed: { top: ISO_DX + 4, right: ISO_DX + 4, bottom: 4, left: ISO_DX },
  // The visible top face is displaced half the depth vector from the front
  // face, so the body shifts back by that much and the pipe lands on the face.
  attach: {
    dx: -ISO_DX / 2,
    // About a third of the way back across the top face: clear of the front
    // edge, so the pipe drops into the gate rather than resting on its lip,
    // while staying close enough to read as connected to it.
    topDy: ISO_DY * 0.375,
    // A pipe leaves through the gate's *bottom* face, which sits above the
    // front-bottom edge, so it emerges a little higher and overlaps the body.
    bottomDy: ISO_DY / 2,
    // The mouth is foreshortened and the first gate's top face swallows part of
    // the stub, so it runs longer to look the same length as the tail.
    topLeadExtra: 9,
    paintBottomUp: true,
    extrude: { dx: ISO_DX, dy: ISO_DY },
  },
  defs: () => '',
  pipe: (cx, y0, y1, w, pal, m, openTop, turns, cut) => {
    const rx = w / 2
    // A shallow ellipse: the pipe mouth is seen at a glancing angle, so it
    // foreshortens. Too flat and the bore disappears; too round and it reads
    // as a bowl.
    const ry = w * 0.17
    // The closing arc bulges `ry` below where it starts, so the sides stop that
    // much short — otherwise `y1` would not mean the pipe's lowest drawn pixel
    // the way it does in the flat themes, and the end would overshoot.
    const foot = y1 - ry
    const sw = m.stroke * 0.55
    if (turns?.length && cut) {
      const pieces = centreLine(cx, y0, y1, turns)
      return el('path', { d: bendOutline(pieces, w), fill: pal.pipe }) +
        el('path', { d: bendEdges(pieces, w), fill: 'none', stroke: pal.pipeEdge, 'stroke-width': sw })
    }
    // Open across the top, like a straight one: the mouth, or the gate above,
    // is what closes it.
    const d = turns?.length
      ? bendOutline(centreLine(cx, y0, foot, turns), w, ry)
      : new Path()
          .M(cx - rx, y0)
          .L(cx - rx, foot)
          .A(rx, ry, 0, 0, 0, cx + rx, foot)
          .L(cx + rx, y0)
          .toString()
    const body = el('path', { d, fill: pal.pipe, stroke: pal.pipeEdge, 'stroke-width': sw })
    const cap = openTop
      ? el('ellipse', {
          cx, cy: y0, rx, ry,
          fill: shade(pal.pipe, 0.34), stroke: pal.pipeEdge, 'stroke-width': m.stroke * 0.55,
        })
      : ''
    return body + cap
  },
  body: (box, fill, pal, m) => {
    const sw = m.stroke * 0.7
    const top = el('path', {
      d: parallelogram(box.x, box.y, box.w, 0, ISO_DX, ISO_DY),
      fill: shade(fill, 0.28), stroke: pal.gateEdge, 'stroke-width': sw, 'stroke-linejoin': 'round',
    })
    const right = el('path', {
      d: parallelogram(box.x + box.w, box.y, 0, box.h, ISO_DX, ISO_DY),
      fill: shade(fill, -0.2), stroke: pal.gateEdge, 'stroke-width': sw, 'stroke-linejoin': 'round',
    })
    const front = el('rect', {
      x: box.x, y: box.y, width: box.w, height: box.h,
      fill, stroke: pal.gateEdge, 'stroke-width': sw,
    })
    return top + right + front
  },
}

/* ---------------------------------------------------------------------- */

function makeTheme(
  id: ThemeId,
  label: string,
  description: string,
  s: Surface,
): Theme {
  return {
    id,
    label,
    description,
    bleed: s.bleed,
    attach: s.attach,
    defs: (pal) => s.defs(pal),
    draw(p: Prim, pal: Palette, m: Metrics): string {
      switch (p.t) {
        case 'qubit':
          return drawQubit(p, pal, m, s.qubitStyle?.(p.value))

        case 'cloud':
          // Nested clouds sit on top of their parent, so only the outermost
          // one casts a shadow — otherwise the stack muddies.
          return drawCloud(p.content, p.seed, pal, m, p.depth === 0 ? s.shadow : undefined)

        case 'bar':
          return drawBar(p.x, p.cy, p.h, pal, m)

        case 'text':
          return drawText(p, pal)

        case 'sign':
          return drawSign(p.x, p.cy, p.w, p.h, pal)

        case 'dial':
          return drawDial(p, pal, m)

        case 'pipe':
          return s.pipe(p.cx, p.y0, p.y1, p.w, pal, m, p.openTop, p.turns, p.cut)

        case 'gatebox': {
          // `||`, not `??`: an empty fill would reach the SVG as fill="" and
          // render black, which is worse than falling back to the default.
          // A colour that was asked for wins over the blank's paper: a frame
          // for students to fill in is still a box, and tinting one to mark it
          // out is the whole reason for saying so.
          const fill = p.fill || (p.blank ? pal.paper : pal.gate)
          const body = s.body(p.box, fill, pal, m)
          const cx = p.box.x + p.box.w / 2
          const cy = p.box.y + p.box.h / 2
          // An explicit `fill=` wins; otherwise the palette decides by letter,
          // and a gate it says nothing about gets no chip at all. The axis
          // counts as part of the letter for this: `R` alone is not a gate, and
          // the three of them are told apart by colour as much as by subscript.
          const accent =
            p.accent ?? pal.gateChip[p.label + (p.subscript ?? '')] ?? pal.gateChip[p.label]
          // Lifted to make room where there is a second line, so the pair sits
          // centred in the box rather than the letters alone.
          const lift = p.sub ? p.labelSize * 0.34 : 0
          const chip = labelChip(cx, cy - lift, p.label, p.labelSize, accent, pal, p.subscript)
          if (!p.sub) return body + chip
          return body + chip + drawText(
            {
              t: 'text',
              x: cx,
              cy: cy + p.labelSize * 0.72,
              text: p.sub,
              size: p.labelSize * 0.62,
              anchor: 'middle',
              weight: 600,
              color: pal.muted,
            },
            pal,
          )
        }

        case 'pane': {
          // Pale at nothing, strong at everything, and never quite white, so a
          // bar with almost nothing in it is still visibly a bar.
          const toned =
            p.tone === undefined
              ? undefined
              : mix(pal.paper, p.tone < 0 ? pal.chartDown : pal.chartUp,
                  0.16 + 0.64 * Math.min(1, Math.abs(p.tone)))
          // `||`, not `??`, for the same reason as the gate fill below: an
          // empty string would reach the SVG and paint the pane black.
          return el('rect', {
            x: p.box.x, y: p.box.y, width: p.box.w, height: p.box.h, rx: 2,
            fill: p.fill || toned || pal.paper,
            stroke: pal.gateEdge,
            'stroke-width': m.stroke * 0.55,
          })
        }

        case 'measurebox': {
          const body = s.body(p.box, p.fill || pal.measure, pal, m)
          const cx = p.box.x + p.box.w / 2
          const cy = p.box.y + p.box.h / 2
          const r = Math.min(p.box.w, p.box.h) * 0.3
          // Dial centred in the box; the basis letter sits in the top-right
          // corner, clear of the arc rather than crowding it.
          const size = r * 0.8
          const label = basisLabel(
            p.box.x + p.box.w - size * 0.45,
            p.box.y + size * 0.6,
            p.basis,
            size,
            pal,
          )
          return body + meterGlyph(cx, cy, r, pal, m) + label
        }

        case 'control':
          return el('circle', { cx: p.cx, cy: p.cy, r: p.r, fill: p.accent ?? pal.accent })

        case 'target': {
          const accent = p.accent ?? pal.accent
          if (p.glyph === 'not') return notGlyph(p.cx, p.cy, p.r, pal, m, accent)
          if (p.glyph === 'z') {
            return el('circle', { cx: p.cx, cy: p.cy, r: p.r, fill: accent })
          }
          // A marked port: the ring a control has, with its mark inside it.
          return (
            el('circle', {
              cx: p.cx, cy: p.cy, r: p.r,
              fill: pal.paper, stroke: accent, 'stroke-width': m.stroke * 1.2,
            }) +
            drawText(
              {
                t: 'text', x: p.cx, cy: p.cy, text: p.glyph,
                size: p.r * 1.3, anchor: 'middle', weight: 700, color: accent,
              },
              pal,
            )
          )
        }

        case 'swap':
          return swapGlyph(p.cx, p.cy, p.r, pal, m, p.accent ?? pal.accent)

        // Doubled by drawing it wide and then again, narrow, in the paper:
        // two parallel lines that stay parallel round every corner, which two
        // offset lines would not.
        case 'cable': {
          const d = p.points
            .map((q, i) => `${i ? 'L' : 'M'}${n(q.x)} ${n(q.y)}`)
            .join('')
          const line = { d, fill: 'none', 'stroke-linejoin': 'round', 'stroke-linecap': 'butt' }
          const colour = p.accent ?? (p.tint && pal.gateChip[p.tint]) ?? pal.accent
          return el('path', { ...line, stroke: colour, 'stroke-width': m.stroke * 2.4 }) +
            el('path', { ...line, stroke: pal.paper, 'stroke-width': m.stroke * 0.8 })
        }

        case 'link':
          return el('line', {
            x1: p.x0, y1: p.cy, x2: p.x1, y2: p.cy,
            stroke: p.accent ?? pal.accent, 'stroke-width': m.stroke * 1.5,
            'stroke-linecap': 'round',
          })

        // A tint of the accent unless told otherwise: enough to see the edge
        // of the region, not so much that it competes with the gates in it.
        case 'frame': {
          const hue = (p.tint && pal.gateChip[p.tint]) || pal.accent
          return el('rect', {
            x: p.box.x, y: p.box.y, width: p.box.w, height: p.box.h, rx: p.tab ? 4 : 7,
            fill: p.fill || mix(pal.paper, hue, 0.07),
            stroke: p.border === 'none' ? 'none' : p.border || mix(pal.paper, hue, 0.45),
            'stroke-width': m.stroke * 0.9,
          })
        }

        // Flat in every theme, like the pane: a table is a piece of paper
        // beside the drawing rather than another object in the scene.
        case 'rule':
          return el('line', {
            x1: p.x0, y1: p.y0, x2: p.x1, y2: p.y1,
            stroke: pal.gateEdge, 'stroke-width': m.stroke * 0.55,
          })
      }
    },
  }
}

export const THEMES: Record<ThemeId, Theme> = {
  solid: makeTheme(
    'solid',
    'Solid',
    'Flat shapes with soft shading and shadows — objects you could pick up.',
    solidSurface,
  ),
  flat: makeTheme('flat', 'Flat', 'Pure line art with no shading. Best for print.', flatSurface),
  isometric: makeTheme(
    'isometric',
    'Isometric',
    'Extruded boxes and cylindrical pipes, as drawn in the course materials.',
    isoSurface,
  ),
}

export const THEME_IDS = Object.keys(THEMES) as ThemeId[]

/**
 * Wrap a drawn primitive when it carries something the markup has to say.
 *
 * Opacity, and a `key` for anything that wants to follow this piece across a
 * redraw. Both are one wrapper, so a keyed translucent primitive gets one
 * group rather than two.
 */
const wrapped = (drawn: string, p: Prim): string => {
  const attrs: Record<string, string | number> = {}
  if (p.opacity !== undefined && p.opacity < 1) attrs.opacity = n(p.opacity)
  if (p.key) attrs['data-key'] = p.key
  if (p.highlight) attrs['data-highlight'] = 'true'
  return Object.keys(attrs).length ? g(attrs, drawn) : drawn
}

/** Wrap primitives into a complete, standalone SVG document. */
export function renderPrims(
  prims: Prim[],
  box: { x: number; y: number; w: number; h: number },
  theme: Theme,
  pal: Palette,
  m: Metrics,
  opts: { scale?: number; background?: boolean } = {},
): string {
  const b = theme.bleed
  const x = box.x - b.left
  const y = box.y - b.top
  const w = Math.max(1, box.w + b.left + b.right)
  const h = Math.max(1, box.h + b.top + b.bottom)
  const scale = opts.scale ?? 1

  const defs = theme.defs(pal)
  const bg = opts.background
    ? el('rect', { x, y, width: w, height: h, fill: pal.paper })
    : ''

  return el(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      viewBox: `${n(x)} ${n(y)} ${n(w)} ${n(h)}`,
      width: n(w * scale),
      height: n(h * scale),
      'shape-rendering': 'geometricPrecision',
    },
    (defs ? el('defs', {}, defs) : '') + bg + g({}, prims.map((p) => wrapped(theme.draw(p, pal, m), p))),
  )
}
