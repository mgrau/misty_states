/**
 * Laying out a statevector plot: one bar per basis state.
 *
 * This is the view the drawn state cannot give. A cloud says which states are
 * in a superposition and, through the length of a term, roughly how much — but
 * it is a picture of the notation, so relative sizes are read off integers that
 * mean nothing on their own. A bar chart puts every basis state on one scale,
 * including the ones with nothing in them, which is what makes interference
 * visible: two states meeting and cancelling is a bar that is *not there*.
 *
 * The axis is labelled with drawn states rather than binary strings. It costs
 * width, but the whole course reads states as shapes, and a plot labelled `|01⟩`
 * would be the only place in a figure that does not.
 *
 * Amplitudes are signed and hang either side of a baseline; probabilities are
 * not and all stand on it. Both are wanted — the sign is the interesting half
 * of an amplitude, and the probability is what a measurement would actually do.
 */

import type { ChartBar, ChartSpec } from '../circuit/ast'
import { layoutState } from '../state/layout'
import type { Layout, Metrics, Prim } from '../render/primitives'
import { textWidth, translatePrims } from '../render/primitives'
import type { ShapeName } from '../shapes'

export interface ChartLayoutOptions {
  metrics: Metrics
  shapeOrder?: ShapeName[]
}

/** Height of the plotting area, per unit of the quantity charted. */
const UNIT = 78
/** Space between neighbouring bars. */
const GAP = 10
/** Space between the axis and the first bar, and after the last. */
const MARGIN = 12
/** Between the foot of the plot and the labels beneath it. */
const LABEL_GAP = 16
/** Between the tick text and the axis it names. */
const TICK_GAP = 7
/** A bar with nothing in it still needs to be visible as an empty place. */
const MIN_BAR = 1.5

/** Ticks down the axis, top to bottom. */
const ticksFor = (mode: ChartSpec['mode']): { at: number; text: string }[] =>
  mode === 'amplitude'
    ? [{ at: 1, text: '1' }, { at: 0, text: '0' }, { at: -1, text: '−1' }]
    : [{ at: 1, text: '1' }, { at: 0.5, text: '½' }, { at: 0, text: '0' }]

/** Ticks the plot has room for, once it is known whether it hangs below zero. */
const shownTicks = (mode: ChartSpec['mode'], signed: boolean) =>
  ticksFor(mode).filter((tick) => signed || tick.at >= 0)

const valueOf = (bar: ChartBar, mode: ChartSpec['mode']): number =>
  mode === 'amplitude' ? (bar.amplitude ?? 0) : bar.probability

/**
 * Lay the chart out with its top-left corner at the origin.
 *
 * The caller translates it into place, the same way a state or a table is.
 */
export function layoutChart(
  bars: ChartBar[],
  spec: ChartSpec,
  opts: ChartLayoutOptions,
): Layout {
  const m = opts.metrics

  // A measurement leaves outcomes rather than a statevector, so there are no
  // amplitudes left to plot even if the source asked for them.
  const mode = spec.measured ? 'probability' : spec.mode
  // The half below the axis is drawn only when something is down there. It is
  // the taller part of the plot and, on a state with no negative term, says
  // nothing the axis does not already say.
  const signed = mode === 'amplitude' && bars.some((bar) => (bar.amplitude ?? 0) < 0)

  const labels = bars.map((bar) =>
    layoutState({ kind: 'state', rows: [bar.state] }, {
      metrics: m,
      shapeOrder: opts.shapeOrder,
    }),
  )

  // Every bar is the same width — the widest label — so the axis is even and
  // a taller bar cannot be mistaken for a fatter one.
  const barW = Math.max(m.qubit, ...labels.map((l) => l.box.w))
  const ticks = shownTicks(mode, signed)

  // The value text sits over the tallest bar, so the plot needs room for it
  // whether or not that bar reaches the top of the axis.
  const values = mode === 'probability'
  const headroom = values ? m.fontSize + 6 : 0

  const top = headroom
  const zero = top + UNIT
  const bottom = signed ? zero + UNIT : zero
  const labelH = Math.max(...labels.map((l) => l.box.h))

  const tickW = Math.max(...ticks.map((t) => textWidth(t.text, m.fontSize)))
  const axisX = tickW + TICK_GAP
  const left = axisX + MARGIN

  const prims: Prim[] = []

  bars.forEach((bar, i) => {
    const x = left + i * (barW + GAP)
    const v = valueOf(bar, mode)
    const h = Math.abs(v) * UNIT

    prims.push({
      t: 'pane',
      tinted: true,
      box: {
        x,
        y: v < 0 ? zero : zero - Math.max(h, MIN_BAR),
        w: barW,
        h: Math.max(h, MIN_BAR),
      },
    })

    if (values && bar.probability > 0) {
      prims.push({
        t: 'text',
        x: x + barW / 2,
        cy: zero - h - m.fontSize * 0.6,
        text: bar.label,
        size: m.fontSize,
        anchor: 'middle',
      })
    }

    const { box } = labels[i]
    prims.push(
      ...translatePrims(
        labels[i].prims,
        x + barW / 2 - (box.x + box.w / 2),
        bottom + LABEL_GAP - box.y,
      ),
    )
  })

  const width = left + bars.length * (barW + GAP) - GAP + MARGIN
  const height = bottom + LABEL_GAP + labelH

  // The axis last, so it rules over a bar that starts hard against it rather
  // than being half-covered by one.
  for (const tick of ticks) {
    const y = zero - tick.at * UNIT
    if (tick.at === 0) prims.push({ t: 'rule', x0: axisX, y0: y, x1: width, y1: y })
    prims.push({
      t: 'text',
      x: axisX - TICK_GAP,
      cy: y,
      text: tick.text,
      size: m.fontSize,
      anchor: 'end',
    })
  }
  prims.push({ t: 'rule', x0: axisX, y0: top, x1: axisX, y1: bottom })

  return { prims, box: { x: 0, y: 0, w: width, h: height } }
}
