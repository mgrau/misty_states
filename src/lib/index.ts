/**
 * Public entry point: source text in, SVG out. Everything runs in the browser.
 */

import { parseState, ParseError } from './state/parse'
import { isGateRun, parseCircuit } from './circuit/parse'
import { resolveCalculations } from './circuit/simulate'
import { checkCircuit, checkState, type Check } from './check'
import { conceal, concealState, hasAnswer } from './conceal'
import {
  bandHeight, buildTermTimeline, buildTimeline,
  steps as animationSteps, termRun, termSteps, type Step as AnimationStep,
} from './circuit/animate'
import {
  animatedSvg, animatedTermSvg, animationBox, termAnimationBox,
} from './circuit/animate-svg'
import { layoutState } from './state/layout'
import { layoutCircuit } from './circuit/layout'
import { DEFAULT_METRICS, type Metrics } from './render/primitives'
import { THEMES, renderPrims } from './render/themes'
import { LIGHT_PALETTE, DARK_PALETTE, type Palette, type ThemeId } from './render/theme'
import { DEFAULT_SHAPE_ORDER, type ShapeName } from './shapes'

export interface RenderOptions {
  theme?: ThemeId
  palette?: Palette
  dark?: boolean
  scale?: number
  background?: boolean
  metrics?: Partial<Metrics>
  shapeOrder?: ShapeName[]
  /**
   * Draw a calculated state as a product where it separates, rather than as
   * one cloud of terms. On by default: it is how the course writes answers.
   */
  factorCalculated?: boolean
  /**
   * Write a measurement outcome's likelihood exactly where a percentage would
   * have to round — `9/13` rather than `69%`. An even split still reads `50%`.
   */
  exactOdds?: boolean
  /**
   * Draw an overall minus sign on a calculated state rather than normalising it
   * away. Off by default — it is unobservable, so it is noise unless the figure
   * exists to show a phase flip.
   */
  keepSign?: boolean
  /**
   * Show what a gate does to the state while it is inside it. On by default;
   * off draws the gate as a closed box that qubits go into and come out of.
   * A source's own `inside=` says otherwise.
   */
  animateInside?: boolean
  /**
   * Draw what `answer` marks, rather than hiding it behind unknowns. Off by
   * default: a figure with an answer in it is a question until it is asked.
   */
  answers?: boolean
  /**
   * Settle the claims the diagram makes — that an equation holds, that a
   * circuit's written output is the one it produces. On by default; it costs a
   * simulation of a diagram already being drawn.
   */
  check?: boolean
}

export interface RenderResult {
  svg: string
  kind: 'state' | 'circuit'
  width: number
  height: number
  /** Absent when the diagram claims nothing this could settle. */
  check?: Check
  /** True when the source marks something with `answer`, so it can be shown. */
  hasAnswer?: boolean
  /** Present when the SVG plays rather than standing still. */
  animation?: {
    /** Seconds for one pass through, including the pause at the end. */
    duration: number
    /** Moments worth stopping on: four per gate, plus the state going in. */
    steps: AnimationStep[]
    /** Whether the file repeats of its own accord. */
    loop: boolean
  }
}

const CIRCUIT_KEYWORDS = new Set([
  'qubits', 'in', 'out', 'view', 'show', 'header', 'labels',
  'h', 'x', 'y', 'z', 's', 't', 'i', 'id', 'identity', 'pete', 'not',
  'cnot', 'cx', 'cz', 'toffoli', 'ccnot', 'ccx', 'swap',
  'measure', 'm', 'box', 'gate', 'blank', 'tabulate', 'table', 'animate', 'answer',
])

/**
 * Guess whether the source describes a circuit or a bare state.
 *
 * A cheap first pass: a captioned state like `measure : 00|11` will be guessed
 * wrong, which `render` then corrects by falling back to the other parser.
 */
export function detectMode(source: string): 'state' | 'circuit' {
  for (const raw of source.split('\n')) {
    const line = raw.replace(/(^|\s)#.*$/, '').trim()
    if (!line) continue
    if (/^-{3,}$/.test(line)) return 'circuit'
    const first = line.split(/[\s;]+/)[0].toLowerCase()
    if (CIRCUIT_KEYWORDS.has(first)) return 'circuit'
    // `HH` is a row of gates, not a keyword and not anything a state could be.
    if (/^[a-z]+$/.test(first) && isGateRun(first)) return 'circuit'
  }
  return 'state'
}

export function render(source: string, opts: RenderOptions = {}): RenderResult {
  const metrics: Metrics = { ...DEFAULT_METRICS, ...opts.metrics }
  const shapeOrder = opts.shapeOrder ?? DEFAULT_SHAPE_ORDER
  const theme = THEMES[opts.theme ?? 'solid']
  const palette = opts.palette ?? (opts.dark ? DARK_PALETTE : LIGHT_PALETTE)

  const wantCheck = opts.check ?? true

  const build = (kind: 'state' | 'circuit') => {
    if (kind === 'state') {
      const doc = parseState(source)
      return {
        doc: undefined,
        answered: hasAnswer(doc),
        // Checked before concealing: the claim is the answer the source holds,
        // whether or not the drawing is showing it.
        check: wantCheck ? checkState(doc) : undefined,
        layout: layoutState(opts.answers ? doc : concealState(doc), { metrics, shapeOrder }),
      }
    }
    // `calculate` is resolved between parsing and layout: it needs the whole
    // circuit to work anything out, and layout should only ever see states.
    // Checking happens after, where a calculated view can still be told apart
    // from a written one by its `calculate` flag.
    const doc = resolveCalculations(parseCircuit(source), {
      factor: opts.factorCalculated ?? true,
      exactOdds: opts.exactOdds,
      keepSign: opts.keepSign,
    })
    // An animation draws its own ends: the qubits travelling *are* the input
    // and output, so leaving the written ones in would stand a copy at each.
    const shown = opts.answers ? doc : conceal(doc)
    return {
      doc,
      answered: hasAnswer(doc),
      check: wantCheck ? checkCircuit(doc) : undefined,
      layout: layoutCircuit(shown, {
        metrics,
        shapeOrder,
        attach: theme.attach,
        bareEnds: !!doc.animate,
      }),
    }
  }

  // A source with no circuit keyword in it parses as both — as a bare state, or
  // as a circuit that is nothing but an input state — so the guess is trusted
  // whenever it parses, and the fallback is only for when it does not. On a
  // genuine syntax error both fail; report the guessed kind's message, since
  // that is the one the author was more likely writing.
  const guess = detectMode(source)
  let kind = guess
  let built
  try {
    built = build(guess)
  } catch (err) {
    const other = guess === 'state' ? 'circuit' : 'state'
    try {
      built = build(other)
      kind = other
    } catch {
      throw err
    }
  }
  const { doc, layout, check, answered } = built

  // An animation is a different document, not a different drawing: the still
  // path cannot produce it, and the moving one has no use for the still box.
  if (doc?.animate && 'geometry' in layout) {
    const working = termRun(doc)
    const many = working.some((w) => w.going.length > 1 || w.gave.length > 1)

    // A single term is one row of qubits on the wires, which is what the
    // travelling animation already draws — so the simpler picture is kept for
    // it, individual qubits and crossing swaps and all. Only a state with more
    // than one term needs the queue.
    if (!many) {
      const timeline = buildTimeline(doc, layout.geometry, {
        inside: opts.animateInside ?? true,
        ...doc.animate,
      })
      const box = animationBox(layout, timeline, metrics)
      return {
        svg: animatedSvg(layout, timeline, box, theme, palette, metrics, {
          scale: opts.scale,
          background: opts.background,
        }),
        kind,
        width: box.w + theme.bleed.left + theme.bleed.right,
        height: box.h + theme.bleed.top + theme.bleed.bottom,
        check: check?.checked ? check : undefined,
        animation: {
          duration: timeline.duration,
          steps: animationSteps(timeline),
          loop: timeline.loop,
        },
      }
    }

    // Laid out twice: the bands have to be measured before the circuit can make
    // room for them, and the rows placed once it has. Every band is one row
    // tall — a state's terms stand side by side, not stacked.
    const bands = Array.from({ length: doc.layers.length + 1 }, () => bandHeight(metrics))
    const banded = layoutCircuit(doc, {
      metrics,
      shapeOrder,
      attach: theme.attach,
      bareEnds: true,
      bands,
    })
    const timeline = buildTermTimeline(working, banded.geometry, metrics, {
      inside: opts.animateInside ?? true,
      ...doc.animate,
    })
    const box = termAnimationBox(banded, timeline, metrics)
    return {
      svg: animatedTermSvg(banded, timeline, box, theme, palette, metrics, {
        scale: opts.scale,
        background: opts.background,
      }),
      kind,
      width: box.w + theme.bleed.left + theme.bleed.right,
      height: box.h + theme.bleed.top + theme.bleed.bottom,
      check: check?.checked ? check : undefined,
      hasAnswer: answered || undefined,
      animation: {
        duration: timeline.duration,
        steps: termSteps(timeline),
        loop: timeline.loop,
      },
    }
  }

  const svg = renderPrims(layout.prims, layout.box, theme, palette, metrics, {
    scale: opts.scale,
    background: opts.background,
  })

  return {
    svg,
    kind,
    width: layout.box.w + theme.bleed.left + theme.bleed.right,
    height: layout.box.h + theme.bleed.top + theme.bleed.bottom,
    // Nothing checkable is the common case; saying nothing beats saying "0 of 0".
    check: check?.checked ? check : undefined,
    hasAnswer: answered || undefined,
  }
}

export { ParseError }
export type { Check } from './check'
export type { Step as AnimationStep } from './circuit/animate'
export { THEMES, THEME_IDS } from './render/themes'
export { LIGHT_PALETTE, DARK_PALETTE } from './render/theme'
export type { Palette, ThemeId } from './render/theme'
export { DEFAULT_SHAPE_ORDER, SHAPE_NAMES } from './shapes'
export type { ShapeName } from './shapes'
export { DEFAULT_METRICS } from './render/primitives'
export type { Metrics } from './render/primitives'
