/**
 * AST for misty states.
 *
 * A *factor* is one drawable atom: a qubit, a cloud, or an unknown. A *term* is
 * a juxtaposed run of factors with an optional sign and coefficient. A *cloud*
 * is a `|`-separated list of terms. Clouds nest inside terms, which is what
 * makes rules 4 and 6 (flattening and distribution) expressible.
 */

import type { ShapePick } from '../shapes'

export type QubitValue = 0 | 1 | 'unknown'

export interface QubitNode {
  kind: 'qubit'
  value: QubitValue
  /** Explicit shape override from `0@3` syntax; otherwise position decides. */
  shapeIndex?: number
}

export interface CloudNode {
  kind: 'cloud'
  terms: Term[]
}

export interface LabelNode {
  kind: 'label'
  text: string
}

/**
 * An operator drawn between factors. Written `x` or `*` and drawn `×`, for the
 * multiplication of two misty states.
 */
export interface OpNode {
  kind: 'op'
  symbol: '×'
}

export type Factor = QubitNode | CloudNode | LabelNode | OpNode

export interface Term {
  sign: 1 | -1
  /** Integer amplitude weight; undefined means 1 and draws no prefix. */
  coeff?: number
  factors: Factor[]
}

/** One side of an `=` chain: a juxtaposed product of factors. */
export interface Product {
  factors: Factor[]
  /** Annotation drawn to the left, written `50%: 0(0|1)`. */
  caption?: string
  /** Annotation drawn to the right, written `0(0|1) : after measuring`. */
  note?: string
}

/** One line of input: products joined by relation glyphs. */
export interface StateRow {
  /** Written `answer`: hidden behind unknowns until the answer is asked for. */
  answer?: boolean
  /** Sides separated by `=`. A single side is the common case. */
  sides: Product[]
  /** Relation glyphs between sides, one fewer than `sides`. */
  relations: string[]
}

/** A whole state document. Each input line becomes a row, stacked vertically. */
export interface StateDoc {
  kind: 'state'
  rows: StateRow[]
  /** Per-position shape override from a `shape` line; defaults to order. */
  shapePicks?: ShapePick[]
}

/** Number of qubit slots a factor occupies, used to advance shape numbering. */
export function qubitWidth(f: Factor): number {
  switch (f.kind) {
    case 'qubit':
      return 1
    case 'label':
    case 'op':
      return 0
    case 'cloud':
      return f.terms.reduce(
        (max, t) => Math.max(max, t.factors.reduce((s, x) => s + qubitWidth(x), 0)),
        0,
      )
  }
}

export function productWidth(p: Product): number {
  return p.factors.reduce((s, f) => s + qubitWidth(f), 0)
}
