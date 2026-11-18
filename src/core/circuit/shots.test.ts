/**
 * Shots: one run at a time, each measurement coming out one way.
 *
 * What matters: a shot only ever comes out a way the circuit allows; enough of
 * them come out in the proportions the odds say; the odds themselves are the
 * Born rule's, kept per record rather than merged by end state; and a shot
 * drawn puts each reading in its measurement's box.
 */

import { describe, expect, it } from 'vitest'
import { parseCircuit } from './parse'
import { sampleShot, shotOdds, shotPlan } from './shots'
import { layoutCircuit } from './layout'
import { render } from '../index'
import { seededRandom } from '../svg'

const doc = (src: string) => parseCircuit(src)
const odds = (src: string) => Object.fromEntries(shotOdds(doc(src)).map((o) => [o.record, +o.probability.toFixed(6)]))

describe('what a shot reads', () => {
  it('reads the measured wires, in wire order', () => {
    expect(shotPlan(doc('in 000\nM 3; M 1'))).toEqual({ wires: [1, 3], atEnd: false })
  })

  it('reads every wire at the end of a circuit with no measurement', () => {
    expect(shotPlan(doc('in 00\nH 1'))).toEqual({ wires: [1, 2], atEnd: true })
  })
})

describe('the odds', () => {
  it('are the Born rule\'s', () => {
    expect(odds('in 00\nH 1\nCNOT 1 -> 2')).toEqual({ '00': 0.5, '11': 0.5 })
    expect(odds('in 0\nRY(60) 1\nM 1')).toEqual({ '0': 0.75, '1': 0.25 })
  })

  it('follow a gate that waits on a reading', () => {
    // Teleportation: whatever Alice reads, Bob's qubit ends up holding the input.
    const tele = 'in 100\nH 2\nCNOT 2 -> 3\nCNOT 1 -> 2\nH 1\nM 1; M 2\nX 3 if M2\nZ 3 if M1\nM 3'
    const o = odds(tele)
    expect(Object.keys(o).every((r) => r.endsWith('1'))).toBe(true)
    expect(Object.values(o).reduce((a, b) => a + b, 0)).toBeCloseTo(1)
  })

  it('handle two measurements in one layer', () => {
    expect(odds('in 00\nH 1; H 2\nM 1; M 2')).toEqual({ '00': 0.25, '01': 0.25, '10': 0.25, '11': 0.25 })
  })

  it('say why a circuit cannot be shot', () => {
    expect(() => shotOdds(doc('in 0\nM 1 X'))).toThrow(/X measurement/)
  })
})

describe('a shot', () => {
  it('only ever comes out a way the circuit allows', () => {
    const d = doc('in 00\nH 1\nCNOT 1 -> 2\nM 1; M 2')
    const rand = seededRandom('shots')
    for (let i = 0; i < 200; i++) expect(['00', '11']).toContain(sampleShot(d, rand).record)
  })

  it('comes out in the proportions the odds say, given enough of them', () => {
    const d = doc('in 0\nRY(60) 1\nM 1')
    const rand = seededRandom('tally')
    let ones = 0
    const n = 4000
    for (let i = 0; i < n; i++) if (sampleShot(d, rand).record === '1') ones++
    expect(ones / n).toBeGreaterThan(0.22)
    expect(ones / n).toBeLessThan(0.28)
  })

  it('remembers where each measurement was', () => {
    // `M 2` has nothing in its way, so it shares the first layer with the X.
    const shot = sampleShot(doc('in 00\nX 1\nM 1\nM 2'), seededRandom('where'))
    expect(shot.readings).toEqual([
      { layer: 0, qubit: 2, value: 0 },
      { layer: 1, qubit: 1, value: 1 },
    ])
    expect(shot.record).toBe('10')
  })

  it('is the same every time from the same seed', () => {
    const d = doc('in 000\nH 1; H 2; H 3')
    const run = () => {
      const rand = seededRandom('same')
      return Array.from({ length: 20 }, () => sampleShot(d, rand).record)
    }
    expect(run()).toEqual(run())
  })
})

describe('a shot drawn', () => {
  it('puts each reading in its measurement\'s box, in the wire\'s shape', () => {
    const d = doc('in 00\nX 1\nM 1; M 2')
    const prims = layoutCircuit(d, { readings: [{ layer: 1, qubit: 1, value: 1 }, { layer: 1, qubit: 2, value: 0 }] }).prims
    const meters = prims.filter((p) => p.t === 'measurebox')
    expect(meters.every((p) => p.t === 'measurebox' && p.read)).toBe(true)
    // The ones inside a box, not the input row above.
    const inside = (p: (typeof prims)[number]) =>
      p.t === 'qubit' && meters.some((b) => b.t === 'measurebox' && p.cy > b.box.y && p.cy < b.box.y + b.box.h)
    const read = prims.filter(inside)
    expect(read.map((p) => p.t === 'qubit' && [p.shape, p.value])).toEqual([['circle', 1], ['square', 0]])
  })

  it('leaves a measurement with no reading as it was', () => {
    const svg = (shot?: boolean) =>
      render('in 0\nM 1', shot ? { shot: { record: '0', readings: [] } } : {}).svg
    expect(svg(true)).toBe(svg(false))
  })

  it('shows the record as the output of a circuit with no measurement', () => {
    const plain = render('in 00\nH 1').svg
    const shot = render('in 00\nH 1', { shot: { record: '10', readings: [] } }).svg
    expect(shot).not.toBe(plain)
    expect(shot).toContain('>shot<')
  })
})
