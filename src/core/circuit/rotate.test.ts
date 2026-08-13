/**
 * Rotation gates.
 *
 * A rotation is defined here **up to global phase**, which is unobservable and
 * normalised away everywhere else — and that is what puts every right angle
 * exactly within reach of whole numbers. Past a right angle there are cosines
 * in the arithmetic, and the state stops being one the notation can draw.
 */

import { describe, expect, it } from 'vitest'
import { parseCircuit } from './parse'
import { canonical, simulate } from './simulate'
import { abs2, show } from './complex'
import { render } from '../index'

/**
 * The same state, by the comparison the checker uses.
 *
 * Scale and overall phase are both unobservable and both normalised away — and
 * a rotation carries scale for the same reason `H` does, the dropped `1/√2`.
 */
const sameState = (src: string) => {
  const doc = parseCircuit(src)
  return canonical(simulate(doc, doc.layers.length))
    .map(([bits, amp]) => `${bits}:${show(amp)}`)
    .join(' ')
}

const state = (src: string) => {
  const doc = parseCircuit(src)
  return [...simulate(doc, doc.layers.length)]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([bits, amp]) => `${bits}:${show(amp)}`)
    .join(' ')
}

describe('what a right angle does', () => {
  it('is the gate it already had a name for', () => {
    // RZ and P are the same gate up to global phase, and at a quarter turn
    // both are S.
    for (const bits of ['0', '1']) {
      expect(state(`in ${bits}\nRZ(90) 1`)).toBe(state(`in ${bits}\nS 1`))
      expect(state(`in ${bits}\nP(90) 1`)).toBe(state(`in ${bits}\nS 1`))
      expect(state(`in ${bits}\nRZ(180) 1`)).toBe(state(`in ${bits}\nZ 1`))
    }
  })

  it('keeps every amplitude whole', () => {
    // The common 1/√2 divides straight out, exactly as it does for H.
    expect(state('in 0\nRX(90) 1')).toBe('0:1 1:-i')
    expect(state('in 0\nRY(90) 1')).toBe('0:1 1:1')
    expect(state('in 0\nRX(180) 1')).toBe('1:-i')
  })

  it('undoes itself when turned back', () => {
    for (const g of ['RX', 'RY', 'RZ', 'P']) {
      for (const bits of ['0', '1']) {
        expect(sameState(`in ${bits}\n${g}(90) 1\n---\n${g}(-90) 1`), `${g} on ${bits}`)
          .toBe(sameState(`in ${bits}`))
      }
    }
  })

  it('comes back round after four quarter turns', () => {
    for (const g of ['RX', 'RY', 'RZ']) {
      const round = `in 0\n${g}(90) 1\n---\n${g}(90) 1\n---\n${g}(90) 1\n---\n${g}(90) 1`
      expect(sameState(round), g).toBe(sameState('in 0'))
    }
  })
})

describe('what an odd angle does', () => {
  it('leaves cosines in the amplitudes', () => {
    expect(state('in 0\nRX(30) 1')).toBe('0:0.966 1:-0.259i')
  })

  it('leaves the odds a distribution, at every angle', () => {
    // The one property that catches a floating-point slip nothing else will.
    // Not the raw weight: a rotation carries the dropped `1/√2` the same way
    // `H` does, so what is conserved is the shares, not their total.
    for (const angle of [0, 17, 30, 45, 90, 123, 180, 270, 359]) {
      for (const g of ['RX', 'RY', 'RZ', 'P']) {
        const doc = parseCircuit(`in 0|1\n${g}(${angle}) 1`)
        const amps = [...simulate(doc, doc.layers.length).values()]
        const total = amps.reduce((sum, a) => sum + abs2(a), 0)
        expect(amps.reduce((sum, a) => sum + abs2(a) / total, 0), `${g}(${angle})`)
          .toBeCloseTo(1, 9)
        expect(total, `${g}(${angle})`).toBeGreaterThan(0)
      }
    }
  })

  it('has nothing to draw, and says which view does', () => {
    expect(() => render('in 0\nRX(30) 1\nout calculate')).toThrow(/not a whole number/)
    expect(() => render('in 0\nRX(30) 1\nout calculate')).toThrow(/chart the probabilities/)
  })

  it('charts and writes out perfectly well', () => {
    expect(render('in 0\nRX(30) 1\nprobability').svg).toContain('<svg')
    expect(render('in 0\nRX(30) 1\ntabulate').svg).toContain('<svg')
    expect(render('in 0\nRX(30) 1').dirac?.[0]).toContain('0.259')
  })
})

describe('writing one', () => {
  it('takes the angle in degrees, positive or negative', () => {
    const gate = (src: string) => parseCircuit(`qubits 2\n${src}`).layers[0].gates[0]
    expect(gate('RZ(45) 1')).toMatchObject({ kind: 'single', label: 'RZ', angle: 45, qubit: 1 })
    expect(gate('rx(-90) 2')).toMatchObject({ label: 'RX', angle: -90, qubit: 2 })
    expect(gate('P(180)')).toMatchObject({ label: 'P', angle: 180, qubit: 1 })
  })

  it('reads as a circuit even though it opens with a bracket word', () => {
    expect(() => parseCircuit('in 0\nRZ(45) 1')).not.toThrow()
    expect(render('in 0\nRZ(45) 1').kind).toBe('circuit')
  })

  it('draws R with its axis below the line, and the angle under both', () => {
    // `RX` reads as two letters of equal weight; what is meant is one letter
    // saying rotation and a small one saying about which axis.
    const svg = render('RZ(90) 1').svg
    expect(svg).not.toContain('>RZ<')
    expect(svg).toContain('>R<')
    expect(svg).toContain('>Z<')
    expect(svg).toContain('>90°<')
  })

  it('keeps a colour per axis, though the letter is the same', () => {
    const chips = (src: string) =>
      [...render(src).svg.matchAll(/rx="2" fill="(#[0-9a-f]{6})"/g)].map((m) => m[1])
    expect(new Set(chips('qubits 3\nRX(90) 1; RY(45) 2; RZ(180) 3')).size).toBe(3)
  })

  it('refuses an angle it cannot read', () => {
    expect(() => parseCircuit('in 0\nRZ(x) 1')).toThrow()
  })
})

describe('a rotation with no angle', () => {
  const gateOf = (line: string) => parseCircuit(`qubits 2\n${line}`).layers[0].gates[0]

  it('turns by nothing, rather than being an unknown gate', () => {
    for (const head of ['RX', 'RY', 'RZ', 'P']) {
      const gate = gateOf(`${head} 1`)
      expect(gate).toMatchObject({ kind: 'single', label: head, angle: 0 })
    }
    expect(gateOf('RY() 1')).toMatchObject({ label: 'RY', angle: 0 })
  })

  it('still reads an angle when it is given one', () => {
    expect(gateOf('RY(45) 1')).toMatchObject({ label: 'RY', angle: 45 })
    expect(gateOf('RY(-90) 2')).toMatchObject({ label: 'RY', angle: -90, qubit: 2 })
  })

  it('has not made every word a gate', () => {
    for (const line of ['Q 1', 'R 1', 'RQ 1', 'PP', 'RY(x) 1']) {
      expect(() => parseCircuit(`qubits 2\n${line}`)).toThrow()
    }
    // A run of one-letter gates is still a run.
    expect(parseCircuit('qubits 2\nHH').layers[0].gates).toHaveLength(2)
  })
})
