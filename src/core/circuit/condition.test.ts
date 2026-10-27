/**
 * A gate that waits on a measurement: `X 3 if M1`.
 *
 * What matters is that it does what it says — the gate in the branches where
 * the wire was read the way asked, nothing in the others — that it can only
 * read a wire that holds a result, and that it is drawn as a reading rather
 * than as one more control dot.
 */

import { describe, expect, it } from 'vitest'
import { parseCircuit } from './parse'
import { layoutCircuit } from './layout'
import { simulateBranches } from './simulate'
import { moveGate } from './edit'
import { render } from '../index'
import { LIGHT_PALETTE } from '../render/theme'

const doc = (src: string) => parseCircuit(src)
/** Each outcome, as its basis states, sorted so the order of branches does not matter. */
const outcomes = (src: string) => {
  const d = doc(src)
  return simulateBranches(d, d.layers.length)
    .branches.map((b) => [...b.amps.keys()].sort().join('|'))
    .sort()
}

const TELEPORT = [
  'in (0|-1)00',
  'H 2',
  'CNOT 2 -> 3',
  'CNOT 1 -> 2',
  'H 1',
  'M 1; M 2',
  'X 3 if M2',
  'Z 3 if M1',
].join('\n')

describe('writing it', () => {
  it('reads the wire, and which way it has to have come out', () => {
    expect(doc('M 1\nX 2 if M1').layers[1].gates[0]).toMatchObject({ given: { qubit: 1, value: 1 } })
    expect(doc('M 1\nX 2 if M1=0').layers[1].gates[0]).toMatchObject({ given: { qubit: 1, value: 0 } })
    expect(doc('M 1\nRZ(90) 2 if M1').layers[1].gates[0]).toMatchObject({ kind: 'single', angle: 90 })
    expect(doc('in 00\nM 1\nGATE "U" 2 if M1').layers[1].gates[0]).toMatchObject({ custom: true })
  })

  it('keeps the M with the gate rather than reading it as a measurement', () => {
    const d = doc('M 1\nX 2 if M1 H 3')
    expect(d.layers[1].gates.map((g) => g.kind)).toEqual(['controlled', 'single'])
    expect(d.layers[1].gates[0].given?.qubit).toBe(1)
  })

  it('takes its wire from the row like any gate left without one', () => {
    expect(doc('M 1\nX if M1').layers[1].gates[0]).toMatchObject({ target: 2 })
  })

  it('says what is wrong rather than guessing', () => {
    expect(() => doc('X 2 if 1')).toThrow(/if takes a measured wire/)
    expect(() => doc('X 2 if M1')).toThrow(/has to be measured/)
    expect(() => doc('M 1 X\nX 2 if M1')).toThrow(/in Z/)
    expect(() => doc('M 1\nH 1\nX 2 if M1')).toThrow(/has to be measured/)
    expect(() => doc('M 1\nX 1 if M1')).toThrow(/its own wire/)
    expect(() => doc('M 1\nCNOT 2 3 if M1')).toThrow(/only a gate on one wire/)
  })

  it('goes with a definition onto the wires it is used on', () => {
    const d = doc('def fix {\nX 2 if M1\n}\nin 000\nM 2\nfix 2-3')
    expect(d.layers[1].gates[0]).toMatchObject({ target: 3, given: { qubit: 2 } })
  })
})

describe('the arithmetic', () => {
  it('acts where the wire came out black, and nowhere else', () => {
    expect(outcomes('in (0|1)0\nM 1\nX 2 if M1')).toEqual(['00', '11'])
    expect(outcomes('in (0|1)0\nM 1\nX 2 if M1=0')).toEqual(['01', '10'])
  })

  it('teleports: every outcome leaves Bob holding the message', () => {
    for (const branch of outcomes(TELEPORT)) {
      const terms = branch.split('|')
      // Alice's two wires fixed, Bob's in the message's superposition.
      expect(terms).toHaveLength(2)
      expect(terms.map((t) => t[2]).sort()).toEqual(['0', '1'])
    }
  })
})

describe('drawing it', () => {
  it('is a line from the meter to the gate, labelled with what it waits for', () => {
    const { prims } = layoutCircuit(doc('in 00\nM 1\nX 2 if M1'))
    const meter = prims.find((p) => p.t === 'measurebox')!
    const target = prims.find((p) => p.t === 'target')!
    const cable = prims.find((p) => p.t === 'cable')!
    if (meter.t !== 'measurebox' || target.t !== 'target' || cable.t !== 'cable') throw new Error()
    // Out of the meter's bottom, between its pipe and its edge...
    const [start] = cable.points
    const mid = meter.box.x + meter.box.w / 2
    expect(start.y).toBe(meter.box.y + meter.box.h)
    expect(start.x).toBeGreaterThan(mid + 15)
    expect(start.x).toBeLessThan(meter.box.x + meter.box.w)
    // ...and into the gate at its wire's height.
    expect(cable.points.at(-1)!.y).toBe(target.cy)
    const marks = prims.filter((p) => p.t === 'qubit' && p.size < 26)
    expect(marks).toEqual([expect.objectContaining({ shape: 'circle', value: 1 })])
    expect(prims.some((p) => p.t === 'text' && p.text === '=')).toBe(true)
    expect(prims.some((p) => p.t === 'frame' && p.tab)).toBe(true)
  })

  it('draws the gate as itself, with no box across to the measured wire', () => {
    const { prims, geometry } = layoutCircuit(doc('in 00\nM 1\nZ 2 if M1=0'))
    const boxes = prims.filter((p) => p.t === 'gatebox')
    expect(boxes).toEqual([expect.objectContaining({ label: 'Z' })])
    const [box] = boxes
    if (box.t !== 'gatebox') throw new Error()
    expect(box.box.x).toBeGreaterThan(geometry.columns[0])
    expect(prims.find((p) => p.t === 'qubit' && p.size < 26)).toMatchObject({ value: 0 })
  })

  it('takes the colours of the gate it leads to, and stands beside it', () => {
    const { prims } = layoutCircuit(doc('in 00\nM 1\nZ 2 if M1'))
    expect(prims.find((p) => p.t === 'cable')).toMatchObject({ tint: 'Z' })
    const tab = prims.find((p) => p.t === 'frame' && p.tab)
    const gate = prims.find((p) => p.t === 'gatebox')
    expect(tab).toMatchObject({ tint: 'Z' })
    if (tab?.t !== 'frame' || gate?.t !== 'gatebox') throw new Error()
    expect(gate.box.x - (tab.box.x + tab.box.w)).toBeLessThan(6)
    // A NOT is drawn in the accent, or in the colour it was given.
    const not = layoutCircuit(doc('in 00\nM 1\nX 2 if M1 colour=#c0262d')).prims
    expect(not.find((p) => p.t === 'cable')).toMatchObject({ accent: '#c0262d' })
    // The solid theme draws a Z's line in the Z's purple, not the accent's blue.
    const svg = render('in 00\nM 1\nZ 2 if M1', { check: false }).svg
    expect(svg).toContain(`stroke="${LIGHT_PALETTE.gateChip.Z}"`)
  })

  it('covers the wires between, like any gate across them', () => {
    const d = doc('in 000\nM 1\nX 3 if M1')
    // Nothing on wire 2 can sit inside it.
    expect(doc('in 000\nM 1\nX 3 if M1\nH 2').layers).toHaveLength(d.layers.length + 1)
  })

  it('draws in every theme', () => {
    for (const theme of ['solid', 'flat', 'isometric'] as const) {
      expect(() => render(TELEPORT, { theme, check: false })).not.toThrow()
    }
  })
})

describe('editing', () => {
  it('keeps its condition when it is dragged to another wire', () => {
    const source = 'in 000\nM 1\nX 2 if M1'
    const d = doc(source)
    const gate = d.layers[1].gates[0]
    const edit = moveGate(source, d, gate, { wire: 3, layer: 1, where: 'in' })
    expect(edit?.source).toMatch(/X 3 if M1/)
  })
})
