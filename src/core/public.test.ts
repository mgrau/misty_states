/**
 * What the library promises, written down.
 *
 * These three lists are the only things another application is allowed to
 * depend on, so they are the only things this repo is not free to rename. The
 * test is trivial and that is the point: it turns "we quietly dropped an
 * export" from a mystery in somebody else's build into a failure here, next to
 * the change that caused it.
 *
 * A diff in these lists is therefore a decision, not an accident. Adding a name
 * is cheap. Removing or renaming one is a breaking change for every consumer,
 * and the list is where that gets noticed and thought about.
 */

import { describe, expect, it } from 'vitest'
import * as index from './index'
import * as api from './api'
import * as kernel from './kernel'
import * as ui from './ui/board'

const names = (m: object) => Object.keys(m).sort()

describe('the published surfaces', () => {
  it('draws, from the render entry', () => {
    expect(names(index)).toEqual([
      'DARK_PALETTE',
      'DEFAULT_METRICS',
      'DEFAULT_SHAPE_ORDER',
      'LIGHT_PALETTE',
      'ParseError',
      'SHAPE_NAMES',
      'THEMES',
      'THEME_IDS',
      'VERSION',
      'detectMode',
      'render',
      'renderFrames',
    ])
  })

  it('offers one object to a script tag, from the convenience entry', () => {
    expect(names(api)).toEqual(['MistyStates'])
    // The shape of that object is the actual promise here.
    expect(names(api.MistyStates)).toContain('svg')
    expect(names(api.MistyStates)).toContain('svgDataUrl')
  })

  it('explains what a circuit means, from the kernel entry', () => {
    expect(names(kernel)).toEqual([
      'GATE_GALLERY',
      'ParseError',
      'SimulationError',
      // Editing rules — the whole of `circuit/edit`.
      'afterRemoval',
      'amplitudesOf',
      'asDroppable',
      'canonical',
      'chartBars',
      'checkCircuit',
      'checkState',
      'cycleTarget',
      'diracOf',
      'dropTarget',
      'gateAt',
      'gateLine',
      'gateQubits',
      'gateSpan',
      'insertGate',
      'moveGate',
      'nextQubit',
      'oddsLabel',
      'parseCircuit',
      'parseState',
      'qubitAt',
      'removeGate',
      'setAngle',
      'setQubit',
      'simulate',
      'simulateBranches',
      'stateFrom',
      'tabulate',
      'traceGate',
    ])
  })

  it('puts a circuit board on screen, from the ui entry', () => {
    // Deliberately small. A host supplies four callbacks and gets four methods;
    // everything else the drag layer knows stays behind the boundary.
    expect(names(ui)).toEqual(['createBoard'])
  })

  it('means the same thing through the kernel as through the modules', async () => {
    // Re-export, not reimplementation: a consumer that goes through the kernel
    // and one that reaches inside must get the identical function.
    const { simulate } = await import('./circuit/simulate')
    const { insertGate } = await import('./circuit/edit')
    expect(kernel.simulate).toBe(simulate)
    expect(kernel.insertGate).toBe(insertGate)
  })
})
