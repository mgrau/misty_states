/**
 * Geometry for vertical circuits.
 *
 * One column per qubit, time running downward. Pipes are cut into segments that
 * stop at each gate they meet, rather than running full length behind the
 * bodies — so a gate joins its pipes at a seam instead of sitting on top of an
 * unbroken tube. Where that seam falls is the theme's business: an extruded
 * gate's visible top face is offset from its front face, so the theme supplies
 * an `Attach` describing the junction.
 */

import { boxUnion, type Box } from '../svg'
import { DEFAULT_SHAPE_ORDER, shapeAt, shapeHeight, type ShapeName } from '../shapes'
import {
  DEFAULT_METRICS, textWidth, translatePrims,
  type Layout, type Metrics, type Prim,
} from '../render/primitives'
import { FLAT_ATTACH, type Attach } from '../render/theme'
import { layoutState } from '../state/layout'
import type { CircuitDoc, Gate, Layer, ViewGate } from './ast'
import { gateSpan } from './ast'
import type { Factor, StateDoc, StateRow } from '../state/ast'
import { qubitWidth } from '../state/ast'

export interface CircuitLayoutOptions {
  metrics?: Metrics
  shapeOrder?: ShapeName[]
  attach?: Attach
}

/** Horizontal padding between a gate's edge and the outermost pipe it covers. */
const GATE_PAD_X = 12
/**
 * Pipe left protruding at the open ends of the circuit. Projections that
 * foreshorten the mouth lengthen the top via `attach.topLeadExtra`.
 */
const STUB_LEAD = 9
/**
 * Clear air between the circuit and whatever sits above or below it, be that an
 * input state, an output state, or the header shapes.
 */
const STATE_GAP = 11
/** Space between a caption in the left gutter and the circuit it labels. */
const CAPTION_GAP = 12
/**
 * Vertical room a view claims beyond the state it shows.
 *
 * A view is a break in the plumbing rather than a component bolted into it, so
 * it wants visibly more air than the gap between two gates. `STATE_GAP` of that
 * is empty — the pipes stop short of the state, exactly as they do at the ends
 * of the circuit — and the rest is pipe, leaving a stub either side.
 */
const VIEW_PAD = 14
/** Frame edge to pane edge on a window — the width of the surround. */
const PANE_INSET = 8
/** Between the outcomes of a measurement, stacked one above another. */
const ROW_GAP = 12

/** Radius of a control dot and of a ⊕ target, as fractions of the pipe width. */
const CONTROL_R = 0.22
const TARGET_R = 0.44

interface Interval {
  y0: number
  y1: number
}

function stateLayoutOf(row: StateRow, opts: CircuitLayoutOptions): Layout {
  const doc: StateDoc = { kind: 'state', rows: [row] }
  return layoutState(doc, { metrics: opts.metrics, shapeOrder: opts.shapeOrder })
}

/**
 * The factors of a state that can be spread across the columns, or null.
 *
 * A plain product — `000`, or `0(0|1)0` — has a factor per column group, so
 * each one can sit over the pipes it describes: bare qubits on their own, a
 * cloud centred over however many columns it spans. An equation, or anything
 * with a zero-width factor such as a text label, has no such correspondence and
 * is centred as a single group instead.
 */
function columnFactors(row: StateRow): Factor[] | null {
  if (row.sides.length !== 1 || row.relations.length > 0) return null
  const { factors } = row.sides[0]
  if (!factors.length) return null
  if (!factors.every((f) => qubitWidth(f) >= 1)) return null
  return factors
}

/**
 * Pin every qubit in a factor to a shape, so the factor can be laid out on its
 * own and still number its shapes as though the whole row were laid out at once.
 *
 * Numbering restarts for each term of a cloud — the terms of a superposition
 * describe the same qubits — and runs straight through nested clouds.
 */
function stampShapes(f: Factor, start: number, pick: (slot: number) => number): Factor {
  if (f.kind === 'qubit') return { ...f, shapeIndex: f.shapeIndex ?? pick(start) }
  if (f.kind !== 'cloud') return f
  return {
    ...f,
    terms: f.terms.map((term) => {
      let slot = start
      return {
        ...term,
        factors: term.factors.map((g) => {
          const stamped = stampShapes(g, slot, pick)
          slot += qubitWidth(g)
          return stamped
        }),
      }
    }),
  }
}

/**
 * Lift a caption out of a state row.
 *
 * In a bare state the caption sits in a gutter belonging to that state. In a
 * circuit the gutter belongs to the whole drawing, so every caption is drawn
 * against the same left edge and the state itself stays centred on its columns
 * — otherwise a captioned row would sit off-centre from an uncaptioned one.
 */
function liftCaption(row: StateRow): { caption?: string; row: StateRow } {
  const caption = row.sides[0]?.caption
  if (!caption) return { row }
  const sides = row.sides.map((s, i) => (i === 0 ? { ...s, caption: undefined } : s))
  return { caption, row: { ...row, sides } }
}

/**
 * Centres for a row of pieces that would each like to sit over its own columns.
 *
 * A cloud is nearly always wider than the column pitch — `(0|1)` alone holds
 * two qubits and a bar — so the wishes conflict. Pieces are pushed apart just
 * far enough not to collide and the result re-centred on the span, which keeps
 * everything on its own column where there is room and degrades to an evenly
 * spread row where there is not.
 */
function spreadOverColumns(pieces: { laid: Layout; mid: number }[], gap: number): number[] {
  const half = pieces.map((p) => p.laid.box.w / 2)
  const xs = pieces.map((p) => p.mid)
  const last = xs.length - 1
  const wanted = xs[last]
  for (let i = 1; i < xs.length; i++) {
    xs[i] = Math.max(xs[i], xs[i - 1] + half[i - 1] + half[i] + gap)
  }
  // Everything was pushed rightward; give back half of it so the row grows
  // symmetrically about the span. Nothing collided means nothing moved, and a
  // piece that fits its column stays exactly on it.
  const overflow = xs[last] - wanted
  if (overflow === 0) return xs
  return xs.map((x) => x - overflow / 2)
}

/**
 * The state a view shows.
 *
 * A `calculate` view reaches layout with this filled in — `resolveCalculations`
 * runs between parsing and here — so an empty one is a wiring mistake rather
 * than something a source file can cause.
 */
function viewRows(gate: ViewGate): StateRow[] {
  if (!gate.rows?.length) throw new Error('a calculated view reached layout unresolved')
  return gate.rows
}

/** Complement of `blocked` within [from, to], as drawable pipe segments. */
function gaps(from: number, to: number, blocked: Interval[]): Interval[] {
  const sorted = [...blocked].sort((a, b) => a.y0 - b.y0)
  const out: Interval[] = []
  let cursor = from
  for (const b of sorted) {
    if (b.y0 > cursor) out.push({ y0: cursor, y1: Math.min(b.y0, to) })
    cursor = Math.max(cursor, b.y1)
  }
  if (cursor < to) out.push({ y0: cursor, y1: to })
  return out.filter((s) => s.y1 - s.y0 > 0.5)
}

export function layoutCircuit(doc: CircuitDoc, opts: CircuitLayoutOptions = {}): Layout {
  const m = opts.metrics ?? DEFAULT_METRICS
  const order = opts.shapeOrder ?? DEFAULT_SHAPE_ORDER
  const attach = opts.attach ?? FLAT_ATTACH
  const pitch = m.pipeWidth + m.colGap

  const colX = (q: number) => (q - 1) * pitch
  /** Column position on the gate's visible face. */
  const gateX = (q: number) => colX(q) + attach.dx

  const left = colX(1) - pitch / 2
  const right = colX(doc.qubits) + pitch / 2
  const centreX = (left + right) / 2

  const pipes: Prim[] = []
  const bodies: Prim[] = []
  const glyphs: Prim[] = []
  const caps: Prim[] = []
  const boxes: Box[] = []
  /** Per-qubit spans where a gate interrupts the pipe. */
  const blocked = new Map<number, Interval[]>()

  /* ------------------------------------------------------------- header --- */

  // Everything above or below the circuit — a state cloud or the header shapes
  // — is a separate object. The pipe always stops the same short distance past
  // the outermost gate, and a gap is left between it and whatever comes next.
  const showHeader = doc.header === true

  /** Captions lifted out of states, drawn together against one left edge. */
  const captions: { text: string; cy: number; left: number }[] = []

  /**
   * Stretches of pipe that a window frame overhangs without covering.
   *
   * A frame grows to hold what is inside it, which can carry it out over a
   * neighbouring wire that it has nothing to do with. Hiding that wire would
   * read as the window taking it in, so it is drawn again on top — the same
   * geometry, so the join is invisible, but now unmistakably passing in front.
   */
  const passesInFront: { q: number; y0: number; y1: number }[] = []

  /**
   * Per qubit, the heights at which a run of pipe begins in open air.
   *
   * A pipe leaving a gate has nothing to show at the join, but one starting
   * below a bare view is a genuinely open end, the same as the mouth at the top
   * of the circuit — so a projection that draws a bore should draw one here
   * too. A window is plumbed in like a gate and so is not one of these.
   */
  const openMouths = new Map<number, number[]>()

  // Measuring a layer and then placing it lays each state out twice. States are
  // small and the layout is pure, so this is cheaper than a cache that would
  // miss anyway — the per-column pieces are new rows on every call.
  const laidOut = (row: StateRow): Layout => stateLayoutOf(row, opts)

  /**
   * Place a state across the columns `q0..q1`. A plain classical term is spread
   * so each qubit sits over its own pipe, exactly like the header; anything else
   * — a superposition lives in one cloud — is centred over the span as a group.
   */
  /**
   * Which of `order` a wire draws with.
   *
   * A `shape` line can pin a shape by name, which has to be turned back into a
   * position here — everything downstream numbers shapes, and the numbering is
   * what carries through nested clouds.
   */
  const pickShape = (slot: number): number => {
    const pick = doc.shapePicks?.[slot]
    if (pick === undefined) return slot
    if (typeof pick === 'number') return pick
    const at = order.indexOf(pick)
    return at < 0 ? slot : at
  }

  const shapeFor = (slot: number): ShapeName => shapeAt(pickShape(slot), order)

  /**
   * Break a row into per-column pieces, or null if it has no such structure.
   *
   * Each piece is laid out on its own so it can be centred over exactly the
   * columns it describes; they are then aligned on a shared centre line, the
   * way qubits in a row already are.
   */
  const columnPieces = (row: StateRow, q0: number, q1: number) => {
    const factors = columnFactors(row)
    if (!factors) return null
    const widths = factors.map(qubitWidth)
    if (widths.reduce((a, b) => a + b, 0) !== q1 - q0 + 1) return null

    let col = q0
    return factors.map((f, i) => {
      const stamped = stampShapes(f, col - 1, pickShape)
      const laid = laidOut({ sides: [{ factors: [stamped] }], relations: [] })
      const mid = (colX(col) + colX(col + widths[i] - 1)) / 2
      col += widths[i]
      return { laid, mid }
    })
  }

  /**
   * Place a state across the columns `q0..q1`, over the pipes it describes where
   * that is meaningful and centred over the span where it is not.
   */
  const placeState = (
    row: StateRow,
    top: number,
    q0 = 1,
    q1 = doc.qubits,
  ): { prims: Prim[]; box: Box; content: Box } => {
    const pieces = columnPieces(row, q0, q1)
    if (pieces) {
      const tallest = Math.max(...pieces.map((p) => p.laid.box.h))
      const cy = top + tallest / 2
      const xs = spreadOverColumns(pieces, m.qubitGap)

      const prims: Prim[] = []
      const drawn: Box[] = []
      pieces.forEach(({ laid }, i) => {
        const dx = xs[i] - (laid.box.x + laid.box.w / 2)
        const dy = cy - (laid.box.y + laid.box.h / 2)
        prims.push(...translatePrims(laid.prims, dx, dy))
        drawn.push({ x: laid.box.x + dx, y: laid.box.y + dy, w: laid.box.w, h: laid.box.h })
      })
      // `box` reserves the columns as well, so a short state still keeps the
      // register's width; `content` is only what was actually drawn, which is
      // what a frame has to be big enough to hold.
      const content = boxUnion(drawn)
      const span = { x: colX(q0) - pitch / 2, y: top, w: colX(q1) - colX(q0) + pitch, h: tallest }
      return { prims, box: boxUnion([span, content]), content }
    }

    const laid = laidOut(row)
    const mid = q0 === 1 && q1 === doc.qubits ? centreX : (colX(q0) + colX(q1)) / 2
    const dx = mid - (laid.box.x + laid.box.w / 2)
    const dy = top - laid.box.y
    const box = { x: laid.box.x + dx, y: top, w: laid.box.w, h: laid.box.h }
    return { prims: translatePrims(laid.prims, dx, dy), box, content: box }
  }

  /** How tall a state is, without committing to where it goes. */
  const stateHeight = (row: StateRow, q0: number, q1: number): number => {
    const pieces = columnPieces(row, q0, q1)
    if (pieces) return Math.max(...pieces.map((p) => p.laid.box.h))
    return laidOut(row).box.h
  }

  /** Place a state at either end, lifting its caption into the shared gutter. */
  /**
   * Stack states one above another, sharing the register's columns.
   *
   * Usually there is one. A measurement leaves several possible outcomes, and
   * they read as a list — which is how the course writes them.
   */
  const placeStack = (
    raws: StateRow[],
    top: number,
    q0 = 1,
    q1 = doc.qubits,
  ): { prims: Prim[]; box: Box; content: Box } => {
    const prims: Prim[] = []
    const boxes: Box[] = []
    const contents: Box[] = []
    let at = top
    for (const raw of raws) {
      const { caption, row } = liftCaption(raw)
      const placed = placeState(row, at, q0, q1)
      if (caption) {
        captions.push({
          text: caption,
          cy: placed.box.y + placed.box.h / 2,
          left: placed.box.x,
        })
      }
      prims.push(...placed.prims)
      boxes.push(placed.box)
      contents.push(placed.content)
      at = placed.box.y + placed.box.h + ROW_GAP
    }
    return { prims, box: boxUnion(boxes), content: boxUnion(contents) }
  }

  const placeEndState = (raws: StateRow[], top: number) => placeStack(raws, top)

  let pipeTop: number
  if (doc.input) {
    const placed = placeEndState([doc.input], 0)
    caps.push(...placed.prims)
    boxes.push(placed.box)
    pipeTop = placed.box.y + placed.box.h + STATE_GAP
  } else if (showHeader) {
    const shapes = Array.from({ length: doc.qubits }, (_, i) =>
      shapeFor(i),
    )
    // All header glyphs share one centre line, whatever their outlines.
    const tallest = Math.max(...shapes.map((s) => shapeHeight(s, m.qubit)))
    shapes.forEach((shape, i) => {
      glyphs.push({ t: 'qubit', shape, value: 0, cx: colX(i + 1), cy: tallest / 2, size: m.qubit })
    })
    boxes.push({ x: left, y: 0, w: right - left, h: tallest })
    pipeTop = tallest + STATE_GAP
  } else {
    pipeTop = 0
  }

  /* -------------------------------------------------------------- gates --- */

  let y = pipeTop + STUB_LEAD + attach.topLeadExtra

  /**
   * Layers are as tall as what is in them.
   *
   * A gate is always `gateHeight`, so an ordinary circuit keeps its even
   * rhythm; a view is as tall as the state it shows, which for a row of bare
   * qubits is a good deal shorter than a gate and for a cloud may be taller.
   */
  const layerHeight = (layer: Layer): number =>
    Math.max(
      ...layer.gates.map((gate) => {
        if (gate.kind !== 'view') return m.gateHeight
        const [q0, q1] = gateSpan(gate)
        const rows = viewRows(gate).map((r) => stateHeight(liftCaption(r).row, q0, q1))
        const stacked = rows.reduce((a, b) => a + b, 0) + ROW_GAP * (rows.length - 1)
        return stacked + 2 * VIEW_PAD
      }),
    )

  /**
   * Place every view in a layer, keeping them off each other.
   *
   * Each is positioned over its own columns without knowing about the others,
   * so `view 2-3 00|11; I 1 0` would put the cloud straight through the lone
   * qubit beside it. Bare views are nudged apart afterwards, symmetrically, in
   * the same spirit as the pieces within one of them. A frame never overhangs
   * its columns, so a layer containing one is left alone.
   */
  const emitViews = (gates: ViewGate[], top: number, height: number) => {
    const placed = gates.map((gate) => ({ gate, ...measureView(gate, top, height) }))
    if (placed.length > 1 && !gates.some((g) => g.boxed)) {
      const order = [...placed].sort((a, b) => a.box.x - b.box.x)
      const wanted = order[order.length - 1].box.x
      let cursor = -Infinity
      for (const item of order) {
        const shift = Math.max(0, cursor + m.qubitGap - item.box.x)
        item.box = { ...item.box, x: item.box.x + shift }
        item.prims = translatePrims(item.prims, shift, 0)
        cursor = item.box.x + item.box.w
      }
      const overflow = order[order.length - 1].box.x - wanted
      if (overflow > 0) {
        for (const item of order) {
          item.box = { ...item.box, x: item.box.x - overflow / 2 }
          item.prims = translatePrims(item.prims, -overflow / 2, 0)
        }
      }
    }
    for (const item of placed) emitView(item)
  }

  /** Work out where a view goes, without committing it to the drawing. */
  const measureView = (gate: ViewGate, top: number, height: number) => {
    const [q0, q1] = gateSpan(gate)
    const rows = viewRows(gate)
    const heights = rows.map((r) => stateHeight(liftCaption(r).row, q0, q1))
    const stacked = heights.reduce((a, b) => a + b, 0) + ROW_GAP * (rows.length - 1)
    // Centred in the layer rather than pinned below its top, so a short state
    // still lines up with a taller one sharing the layer. With a layer of its
    // own this leaves exactly VIEW_PAD of clear pipe above and below.
    const laid = placeStack(rows, top + (height - stacked) / 2, q0, q1)

    // A frame is plumbed in like a gate: it takes the full layer, the pipes
    // meet it at the junction the theme describes, and its contents sit on the
    // visible face rather than on the column centres.
    if (!gate.boxed) return { prims: laid.prims, box: laid.box }

    // As wide as its columns, or as wide as what is inside it — whichever is
    // more. A cloud is easily wider than the wires it describes, and a frame
    // that did not grow would crop it.
    const spanW = colX(q1) - colX(q0) + m.pipeWidth + 2 * GATE_PAD_X
    const w = Math.max(spanW, laid.content.w + 2 * VIEW_PAD)
    // The contents are already centred on the span, so centring the frame there
    // too keeps the two concentric however far either has grown.
    const mid = (colX(q0) + colX(q1)) / 2 + attach.dx
    const frame: Box = { x: mid - w / 2, y: top, w, h: height }
    return { prims: translatePrims(laid.prims, attach.dx, 0), box: frame }
  }

  const emitView = (item: { gate: ViewGate; prims: Prim[]; box: Box }) => {
    const { gate, prims, box } = item
    if (gate.boxed) {
      // Frame first, in the stack where the pipes meet it — it is built like
      // any other gate, so it is shaded and projected like one.
      bodies.push({ t: 'gatebox', box, label: '', labelSize: m.fontSize })
      // Then the glazing, on the frame's front face. It goes with the glyphs
      // rather than the bodies so it stays immediately behind its own contents;
      // the painter's sort would otherwise separate the two.
      glyphs.push({
        t: 'pane',
        box: {
          x: box.x + PANE_INSET,
          y: box.y + PANE_INSET,
          w: box.w - 2 * PANE_INSET,
          h: box.h - 2 * PANE_INSET,
        },
        fill: gate.fill,
      })
    }
    // Contents go on after the stack: the pipes underneath are already cut
    // away, and a cloud wide enough to overhang a neighbouring column should
    // pass in front of it.
    glyphs.push(...prims)
    boxes.push(box)

    // A frame is joined to its pipes; a bare state is not. It stands clear of
    // them by the same distance an input or output state stands clear of the
    // circuit, so a break in the middle reads like the ends do.
    const block: Interval = gate.boxed
      ? { y0: box.y + attach.topDy, y1: box.y + box.h + attach.bottomDy }
      : { y0: box.y - STATE_GAP, y1: box.y + box.h + STATE_GAP }
    for (const q of gate.qubits) {
      const list = blocked.get(q) ?? []
      list.push(block)
      blocked.set(q, list)
      if (!gate.boxed) openMouths.set(q, [...(openMouths.get(q) ?? []), block.y1])
    }

    if (!gate.boxed) return
    for (let q = 1; q <= doc.qubits; q++) {
      if (gate.qubits.includes(q)) continue
      const x = colX(q)
      if (x > box.x && x < box.x + box.w) passesInFront.push({ q, y0: box.y, y1: box.y + box.h })
    }
  }

  for (const layer of doc.layers) {
    const layerH = layerHeight(layer)
    const viewGates = layer.gates.filter((g): g is ViewGate => g.kind === 'view')
    if (viewGates.length) emitViews(viewGates, y, layerH)

    for (const gate of layer.gates) {
      // An identity is a length of pipe, not a body: it neither interrupts the
      // pipe nor draws anything. It still holds its slot in the layer, which is
      // the whole reason to write one.
      if (gate.kind === 'identity') continue
      if (gate.kind === 'view') continue

      const [q0, q1] = gateSpan(gate)
      const box: Box = {
        x: gateX(q0) - m.pipeWidth / 2 - GATE_PAD_X,
        y,
        w: colX(q1) - colX(q0) + m.pipeWidth + 2 * GATE_PAD_X,
        h: m.gateHeight,
      }
      const cy = y + m.gateHeight / 2

      const topY = box.y + attach.topDy
      const bottomY = box.y + box.h + attach.bottomDy

      // The gate interrupts the pipe here; `gaps` then fills everything else
      // with a single run of pipe, so a gate's stubs and the run to the next
      // gate are one continuous piece rather than overlapping collars.
      for (let q = q0; q <= q1; q++) {
        const list = blocked.get(q) ?? []
        list.push({ y0: topY, y1: bottomY })
        blocked.set(q, list)
      }

      emitGate(gate, box, cy, gateX, m, bodies, glyphs)
      boxes.push(box)
    }
    y += layerH + m.gateGap
  }

  const lastGateBottom = doc.layers.length ? y - m.gateGap : pipeTop
  const pipeBottom = lastGateBottom + STUB_LEAD

  /* ------------------------------------------------------------- output --- */

  if (doc.output) {
    const placed = placeEndState(doc.output, pipeBottom + STATE_GAP)
    caps.push(...placed.prims)
    boxes.push(placed.box)
  }

  for (let q = 1; q <= doc.qubits; q++) {
    for (const seg of gaps(pipeTop, pipeBottom, blocked.get(q) ?? [])) {
      pipes.push({
        t: 'pipe',
        cx: colX(q),
        y0: seg.y0,
        y1: seg.y1,
        w: m.pipeWidth,
        // A run has an open mouth where it begins in open air: at the very top
        // of the circuit, or under a bare view. Everywhere else it begins by
        // leaving a gate, where there is no bore to see.
        openTop:
          seg.y0 <= pipeTop + 0.01 ||
          (openMouths.get(q) ?? []).some((y) => Math.abs(y - seg.y0) < 0.01),
      })
    }
  }
  boxes.push({ x: left, y: pipeTop, w: right - left, h: pipeBottom - pipeTop })

  // Redrawn over the frames that overhang them; `caps` is painted after the
  // whole stack. Only the overhung stretch, so no pipe mouth appears anywhere
  // a run does not really begin.
  for (const run of passesInFront) {
    caps.push({
      t: 'pipe',
      cx: colX(run.q),
      y0: run.y0,
      y1: run.y1,
      w: m.pipeWidth,
      openTop: false,
    })
  }

  /* ----------------------------------------------------------- captions --- */

  /*
   * Right-aligned against a single edge, so a column of them reads as a column
   * whatever their lengths.
   *
   * The edge comes from the captioned rows themselves — a cloud is routinely
   * wider than the wires it covers, so measuring from the first column would
   * run a caption straight through one. Measuring from the *whole* drawing
   * would be safe but far too timid: one wide state elsewhere would push every
   * caption out to meet it, leaving a gulf beside the short rows.
   */
  const gutterEdge =
    captions.reduce((x, c) => Math.min(x, c.left), left) - CAPTION_GAP

  for (const caption of captions) {
    const w = textWidth(caption.text, m.fontSize)
    caps.push({
      t: 'text',
      x: gutterEdge,
      cy: caption.cy,
      text: caption.text,
      size: m.fontSize,
      anchor: 'end',
    })
    boxes.push({ x: gutterEdge - w, y: caption.cy - m.fontSize / 2, w, h: m.fontSize })
  }

  /*
   * Painter's order: build the stack from the bottom upward.
   *
   * Every pipe has to be *behind* the gate it leaves and *in front of* the gate
   * it enters, which no single pipes-then-bodies order can express. Working up
   * the stack satisfies both at once: a gate covers the pipe emerging from its
   * underside, and the next pipe up then covers that gate's top face.
   *
   * Ties break left to right. Under an extruded projection a box's side face
   * lies behind the front face of the box beside it, so the rightmost must be
   * painted last — sorting rather than trusting source order keeps `H 2; H 1`
   * looking like `H 1; H 2`.
   */
  const anchor = (p: Prim): { y: number; x: number } => {
    if (p.t === 'pipe') return { y: p.y0, x: p.cx }
    if (p.t === 'gatebox' || p.t === 'measurebox') return { y: p.box.y, x: p.box.x }
    return { y: 0, x: 0 }
  }
  const stack = attach.paintBottomUp
    ? [...pipes, ...bodies].sort((a, b) => {
        const pa = anchor(a)
        const pb = anchor(b)
        return pb.y - pa.y || pa.x - pb.x
      })
    : // A flat gate is a plate lying on the pipes: nothing passes in front of
      // it, so the pipes go down first and the bodies sit on top of them.
      [
        ...pipes,
        ...[...bodies].sort((a, b) => {
          const pa = anchor(a)
          const pb = anchor(b)
          return pa.y - pb.y || pa.x - pb.x
        }),
      ]

  return { prims: [...stack, ...glyphs, ...caps], box: boxUnion(boxes) }
}

function emitGate(
  gate: Gate,
  box: Box,
  cy: number,
  gateX: (q: number) => number,
  m: Metrics,
  bodies: Prim[],
  glyphs: Prim[],
): void {
  switch (gate.kind) {
    case 'identity':
      // Handled before this point; a bare pipe passes through.
      return

    case 'single':
      bodies.push({
        t: 'gatebox', box, label: gate.label, accent: gate.accent,
        labelSize: fitLabel(gate.label, box.w, m),
      })
      return

    case 'measure':
      bodies.push({ t: 'measurebox', box, basis: gate.basis })
      return

    case 'box':
      bodies.push({
        t: 'gatebox', box, label: gate.label, fill: gate.fill, blank: gate.blank,
        labelSize: fitLabel(gate.label, box.w, m),
      })
      return

    case 'swap': {
      bodies.push({ t: 'gatebox', box, label: '', labelSize: m.fontSize })
      const [a, b] = gate.qubits
      glyphs.push({ t: 'link', x0: gateX(a), x1: gateX(b), cy })
      glyphs.push({ t: 'swap', cx: gateX(a), cy, r: m.pipeWidth * 0.3 })
      glyphs.push({ t: 'swap', cx: gateX(b), cy, r: m.pipeWidth * 0.3 })
      return
    }

    case 'controlled': {
      bodies.push({ t: 'gatebox', box, label: '', labelSize: m.fontSize })
      // A bare NOT has no controls, so there is nothing to link it to.
      if (gate.controls.length) {
        const xs = [...gate.controls, gate.target].map(gateX)
        glyphs.push({ t: 'link', x0: Math.min(...xs), x1: Math.max(...xs), cy })
        for (const c of gate.controls) {
          glyphs.push({ t: 'control', cx: gateX(c), cy, r: m.pipeWidth * CONTROL_R })
        }
      }
      // Controlled-Z is symmetric, so its "target" is just another control dot.
      const isZ = gate.targetGlyph === 'z'
      glyphs.push({
        t: 'target', cx: gateX(gate.target), cy,
        r: m.pipeWidth * (isZ ? CONTROL_R : TARGET_R),
        glyph: isZ ? 'z' : 'not',
      })
      return
    }
  }
}

/** Shrink the label until it fits the box, so wide oracles still read. */
function fitLabel(label: string, boxWidth: number, m: Metrics): number {
  if (!label) return m.fontSize
  const available = boxWidth - 16
  const natural = textWidth(label, m.fontSize, true)
  if (natural <= available) return m.fontSize
  return Math.max(9, (m.fontSize * available) / natural)
}
