/**
 * The `shape` line: which shape each position draws with, written a character
 * at a time.
 *
 * It reads the same in a state as in a circuit, which is the point — a figure
 * whose register is not in the default order should say so once, the same way,
 * whichever kind of diagram it is.
 */

import { describe, expect, it } from 'vitest'
import { parseState } from './state/parse'
import { parseCircuit } from './circuit/parse'
import { layoutState } from './state/layout'
import { layoutCircuit } from './circuit/layout'
import { resolveCalculations } from './circuit/simulate'
import { parseShapeSpec, SHAPE_SYMBOLS } from './shapes'
import { detectMode, render } from './index'
import type { ShapeName } from './shapes'

/** Shapes actually drawn, in order. */
const stateShapes = (src: string): ShapeName[] =>
  layoutState(parseState(src))
    .prims.filter((p) => p.t === 'qubit')
    .map((p) => (p.t === 'qubit' ? p.shape : 'circle'))

const circuitShapes = (src: string): ShapeName[] =>
  layoutCircuit(resolveCalculations(parseCircuit(src), {}))
    .prims.filter((p) => p.t === 'qubit')
    .map((p) => (p.t === 'qubit' ? p.shape : 'circle'))

describe('the symbols', () => {
  it('covers every shape', () => {
    const named = new Set(Object.values(SHAPE_SYMBOLS))
    expect([...named].sort()).toEqual([
      'circle', 'diamond', 'heart', 'hexagon', 'pentagon', 'square', 'star', 'triangle',
    ])
  })

  it('reads a run of them in order', () => {
    expect(parseShapeSpec('os^dv*ph')?.picks).toEqual([
      'circle', 'square', 'triangle', 'diamond', 'heart', 'star', 'pentagon', 'hexagon',
    ])
  })

  it('ignores spacing, so os^ and o s ^ agree', () => {
    expect(parseShapeSpec('o s ^')?.picks).toEqual(parseShapeSpec('os^')?.picks)
  })

  it('uses no digit, so the numeric form stays distinguishable', () => {
    expect(Object.keys(SHAPE_SYMBOLS).some((c) => /\d/.test(c))).toBe(false)
    expect(parseShapeSpec('2 3 1')?.picks).toEqual([1, 2, 0])
  })

  it('names the offender when a character is not a shape', () => {
    expect(parseShapeSpec('o!^')?.bad).toBe('!')
    expect(parseShapeSpec('')).toBeNull()
  })
})

describe('in a state', () => {
  it('sets the shapes by position', () => {
    expect(stateShapes('shape s^o\n010')).toEqual(['square', 'triangle', 'circle'])
  })

  it('leaves the default order alone without one', () => {
    expect(stateShapes('010')).toEqual(['circle', 'square', 'triangle'])
  })

  it('applies to every row and inside clouds', () => {
    expect(stateShapes('shape ^o\n(01|10)')).toEqual([
      'triangle', 'circle', 'triangle', 'circle',
    ])
  })

  it('falls back to the order past the end of the line', () => {
    expect(stateShapes('shape ^\n000')).toEqual(['triangle', 'square', 'triangle'])
  })

  it('still lets "@" pin one qubit against it', () => {
    expect(stateShapes('shape s^o\n0 0@1 0')).toEqual(['square', 'circle', 'circle'])
  })

  it('does not make the document look like a circuit', () => {
    expect(detectMode('shape s^o\n00|11')).toBe('state')
    expect(render('shape s^o\n00|11').kind).toBe('state')
  })
})

describe('in a circuit', () => {
  it('sets the shapes of the header, the states and the calculated ones alike', () => {
    const shapes = circuitShapes('shape s^o\nin 100\nout calculate')
    expect(shapes.slice(0, 3)).toEqual(['square', 'triangle', 'circle'])
    expect(shapes.slice(3, 6)).toEqual(['square', 'triangle', 'circle'])
  })

  it('accepts the older numeric form unchanged', () => {
    expect(circuitShapes('shapes 2 3 1\nin 100')).toEqual(
      circuitShapes('shape s^o\nin 100'),
    )
  })

  it('takes either keyword', () => {
    expect(circuitShapes('shape so\nin 10')).toEqual(circuitShapes('shapes so\nin 10'))
  })

  it('says what the symbols are when one is wrong', () => {
    expect(() => parseCircuit('shape o!\nH 1')).toThrow(/not a shape — use o circle/)
  })
})

describe('"#" is left to comments', () => {
  it('is not a shape, obvious though it looks for a square', () => {
    // `shape #^o` would lose its own argument to the comment stripper, so the
    // square is `s` and `#` means what it always did.
    expect(parseShapeSpec('#^o')?.bad).toBe('#')
  })

  it('lets a shape line carry a trailing comment', () => {
    expect(stateShapes('shape s^o  # the register\n000')).toEqual([
      'square', 'triangle', 'circle',
    ])
  })

  it('still comments out a whole shape line', () => {
    expect(stateShapes('# shape s^o\n000')).toEqual(['circle', 'square', 'triangle'])
  })

  it('leaves comments working everywhere else', () => {
    expect(stateShapes('000  # three qubits')).toEqual(['circle', 'square', 'triangle'])
  })
})

describe('a name means the same shape however the order is configured', () => {
  const reversed: ShapeName[] = [
    'hexagon', 'pentagon', 'star', 'heart', 'diamond', 'triangle', 'square', 'circle',
  ]

  it('pins by name, ignoring the configured order', () => {
    const laid = layoutState(parseState('shape os^\n000'), { shapeOrder: reversed })
    const shapes = laid.prims.filter((p) => p.t === 'qubit').map((p) => (p.t === 'qubit' ? p.shape : ''))
    expect(shapes).toEqual(['circle', 'square', 'triangle'])
  })

  it('whereas the numeric form picks the Nth of that order', () => {
    const laid = layoutState(parseState('000'), { shapeOrder: reversed })
    const shapes = laid.prims.filter((p) => p.t === 'qubit').map((p) => (p.t === 'qubit' ? p.shape : ''))
    expect(shapes).toEqual(['hexagon', 'pentagon', 'star'])
  })
})
