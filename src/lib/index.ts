/**
 * Public entry point: source text in, SVG out. Everything runs in the browser.
 */

import { parseState, ParseError } from './state/parse'
import { isGateRun, parseCircuit } from './circuit/parse'
import { resolveCalculations } from './circuit/simulate'
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
}

export interface RenderResult {
  svg: string
  kind: 'state' | 'circuit'
  width: number
  height: number
}

const CIRCUIT_KEYWORDS = new Set([
  'qubits', 'in', 'out', 'view', 'show', 'header', 'labels', 'shapes',
  'h', 'x', 'y', 'z', 's', 't', 'i', 'id', 'identity', 'pete', 'not',
  'cnot', 'cx', 'cz', 'toffoli', 'ccnot', 'ccx', 'swap',
  'measure', 'm', 'box', 'gate', 'blank',
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

  const build = (kind: 'state' | 'circuit') => {
    if (kind === 'state') return layoutState(parseState(source), { metrics, shapeOrder })
    // `calculate` is resolved between parsing and layout: it needs the whole
    // circuit to work anything out, and layout should only ever see states.
    const doc = resolveCalculations(parseCircuit(source), {
      factor: opts.factorCalculated ?? true,
    })
    return layoutCircuit(doc, { metrics, shapeOrder, attach: theme.attach })
  }

  // A source with no circuit keyword in it parses as both — as a bare state, or
  // as a circuit that is nothing but an input state — so the guess is trusted
  // whenever it parses, and the fallback is only for when it does not. On a
  // genuine syntax error both fail; report the guessed kind's message, since
  // that is the one the author was more likely writing.
  const guess = detectMode(source)
  let kind = guess
  let layout
  try {
    layout = build(guess)
  } catch (err) {
    const other = guess === 'state' ? 'circuit' : 'state'
    try {
      layout = build(other)
      kind = other
    } catch {
      throw err
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
  }
}

export { ParseError }
export { THEMES, THEME_IDS } from './render/themes'
export { LIGHT_PALETTE, DARK_PALETTE } from './render/theme'
export type { Palette, ThemeId } from './render/theme'
export { DEFAULT_SHAPE_ORDER, SHAPE_NAMES } from './shapes'
export type { ShapeName } from './shapes'
export { DEFAULT_METRICS } from './render/primitives'
export type { Metrics } from './render/primitives'
