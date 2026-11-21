/**
 * Switching a gate on and off by hand.
 *
 * A condition reads a measurement; a switch is read by whoever is at the
 * screen. `X 3 off` is there to be seen and does nothing, and a click on its
 * switch makes it `X 3 on`. The same word on a frame or a use switches
 * everything inside — the bomb in a bomb tester, the error in a code.
 */

import { describe, expect, it } from 'vitest'
import { parseCircuit } from './parse'
import { moveGate, toggleSwitch } from './edit'
import { shotOdds, shotPlan } from './shots'
import { simulate } from './simulate'
import { classicalRun } from './animate'
import { render } from '../index'
import type { Gate } from './ast'

const gates = (src: string): Gate[] => parseCircuit(src).layers.flatMap((l) => l.gates)

/** Every record a shot can give, and its odds to three places. */
const odds = (src: string): Record<string, number> =>
  Object.fromEntries(shotOdds(parseCircuit(src)).map((o) => [o.record, Math.round(o.probability * 1000) / 1000]))

const BOMB = (word: string) =>
  ['in 00', 'H 1', `"Bomb" 1-2 fill=#f8d7d3 ${word} {`, 'CNOT 1 -> 2', 'M 2', '}', 'H 1', 'M 1'].join('\n')

describe('the word on a gate', () => {
  it('off: the gate is there and does nothing', () => {
    const [x] = gates('in 0\nX 1 off')
    expect(x).toMatchObject({ kind: 'controlled', off: true, switch: { on: false, line: 2, part: 0 } })
    expect([...simulate(parseCircuit('in 0\nX 1 off'), 1).keys()]).toEqual(['0'])
  })

  it('on: the gate acts, and has a switch to turn it off', () => {
    const [x] = gates('in 0\nX 1 on')
    expect(x.off).toBeUndefined()
    expect(x.switch).toEqual({ on: true, line: 2, part: 0 })
    expect([...simulate(parseCircuit('in 0\nX 1 on'), 1).keys()]).toEqual(['1'])
  })

  it('belongs to its own statement on a line of several', () => {
    const line = gates('in 000\nH 1; X 2 off; Z 3')
    expect(line.map((g) => !!g.off)).toEqual([false, true, false])
    expect(line[1].switch?.part).toBe(1)
    // A row written the way it is said: the word goes with the gate before it.
    const row = gates('in 000\nH X off Z')
    expect(row.map((g) => !!g.off)).toEqual([false, true, false])
    expect(row[1].switch?.part).toBe(1)
  })

  it('goes with a condition, a colour or a rotation', () => {
    expect(gates('in 00\nM 1\nX 2 if M1 off')[1]).toMatchObject({ off: true, given: { qubit: 1 } })
    expect(gates('in 0\nH 1 fill=#ffe9c7 on')[0]).toMatchObject({ accent: '#ffe9c7', switch: { on: true } })
    expect(gates('in 0\nRY(60) 1 OFF')[0]).toMatchObject({ angle: 60, off: true })
  })

  it('is not read inside a label', () => {
    expect(gates('in 00\nCNOT "on" 1 -> 2')[0].switch).toBeUndefined()
  })

  it('is refused where there is nothing to switch, or written twice', () => {
    expect(() => parseCircuit('in 0\nI 1 off')).toThrow(/nothing to switch/)
    expect(() => parseCircuit('in 0\nwindow calculate off')).toThrow(/nothing to switch/)
    expect(() => parseCircuit('in 0\nX 1 on off')).toThrow(/one switch/)
  })
})

describe('the word on a frame', () => {
  it('turns off everything inside it, and the frame carries the switch', () => {
    const doc = parseCircuit(BOMB('off'))
    expect(doc.frames?.[0].switch).toEqual({ on: false, line: 3 })
    const inside = doc.layers.flatMap((l) => l.gates).filter((g) => g.kind === 'controlled' || g.line === 5)
    expect(inside.every((g) => g.off)).toBe(true)
  })

  it('is the bomb tester with a dud and with a live bomb', () => {
    // A dud: the two beam splitters undo each other, and the photon is white.
    expect(odds(BOMB('off'))).toEqual({ '0': 1 })
    // Live: the bomb goes off half the time, and a quarter reach black unharmed.
    expect(odds(BOMB('on'))).toEqual({ '00': 0.25, '01': 0.25, '10': 0.25, '11': 0.25 })
  })

  it('leaves a measurement switched off out of the record', () => {
    expect(shotPlan(parseCircuit(BOMB('off'))).wires).toEqual([1])
    expect(shotPlan(parseCircuit(BOMB('on'))).wires).toEqual([1, 2])
  })

  it('is refused on a definition, which is switched where it is used', () => {
    expect(() => parseCircuit('def f off {\nX 1\n}\nin 0\nf 1')).toThrow(/switched where it is used/)
  })
})

describe('the word on a use', () => {
  const DEF = 'def flip "Flip" {\nX 1\n}\nin 0\n'

  it('switches a use drawn open, and one folded into a box', () => {
    expect(odds(`${DEF}flip 1 off`)).toEqual({ '0': 1 })
    expect(odds(`${DEF}flip 1 collapsed off`)).toEqual({ '0': 1 })
    expect(odds(`${DEF}flip 1 collapsed on`)).toEqual({ '1': 1 })
    const [box] = gates(`${DEF}flip 1 collapsed off`)
    expect(box).toMatchObject({ kind: 'box', off: true, switch: { on: false, line: 5 } })
  })

  it('reaches a frame switched off inside a folded definition', () => {
    expect(odds('def f {\n"a" off {\nX 1\n}\n}\nin 0\nf 1 collapsed\nM 1')).toEqual({ '0': 1 })
  })

  it('switches one use and not another', () => {
    expect(odds(`${DEF}flip 1 off\nflip 1 on`)).toEqual({ '1': 1 })
  })
})

describe('a measurement switched off', () => {
  it('reads nothing, so a gate waiting on it is controlled by the wire itself', () => {
    // Measured, the X follows the reading; unmeasured, it follows the qubit —
    // and the odds come out the same, which is the deferred measurement.
    expect(odds('in 00\nH 1\nM 1 off\nX 2 if M1\nM 2')).toEqual({ '0': 0.5, '1': 0.5 })
  })
})

describe('the animation', () => {
  it('runs straight through a gate switched off', () => {
    expect(classicalRun(parseCircuit('in 0\nX 1 off\nanimate')).bits).toEqual(['0', '0'])
    expect(classicalRun(parseCircuit('in 0\nX 1 on\nanimate')).bits).toEqual(['0', '1'])
  })
})

describe('the drawing', () => {
  const SRC = 'in 00\nH 1 on\nCNOT 1 -> 2 off'

  it('has switches only when asked for, so an export never does', () => {
    expect(render(SRC).geometry?.switches).toBeUndefined()
    const shown = render(SRC, { switches: true }).geometry?.switches ?? []
    expect(shown.map((s) => [s.switch.line, s.switch.on])).toEqual([[2, true], [3, false]])
  })

  it('leaves the layout as it is with them or without', () => {
    const plain = render(SRC).geometry!
    const shown = render(SRC, { switches: true }).geometry!
    expect(shown.layers).toEqual(plain.layers)
    expect(shown.pipes).toEqual(plain.pipes)
  })

  it('fades a gate switched off and runs its wires through it', () => {
    const off = render('in 00\nCNOT 1 -> 2 off')
    const on = render('in 00\nCNOT 1 -> 2 on')
    const faded = (svg: string) => svg.split('opacity="0.3"').length
    expect(faded(off.svg)).toBeGreaterThan(faded(on.svg))
    // Fewer, longer runs of pipe: nothing stops them at the gate.
    expect(off.geometry!.pipes.length).toBeLessThan(on.geometry!.pipes.length)
  })

  it('puts a frame\'s switch on its tab', () => {
    const doc = render(BOMB('off'), { switches: true }).geometry!
    const [frame] = doc.frames!
    const [sw] = doc.switches!
    expect(sw.switch.line).toBe(3)
    expect(sw.box.y).toBeGreaterThanOrEqual(frame.box.y)
    expect(sw.box.y + sw.box.h).toBeLessThan(frame.box.y + 40)
  })
})

describe('a click on the switch', () => {
  const flip = (source: string, line: number, part?: number) =>
    toggleSwitch(source, { on: true, line, ...(part !== undefined ? { part } : {}) })?.source

  it('flips the one word, where it was written', () => {
    expect(flip('in 0\nX 1 off', 2)).toBe('in 0\nX 1 on')
    expect(flip('in 0\nX 1 on  # the error', 2)).toBe('in 0\nX 1 off  # the error')
    expect(flip('in 0\nflip: X 1 OFF : a note', 2)).toBe('in 0\nflip: X 1 ON : a note')
    expect(flip(BOMB('off'), 3)).toBe(BOMB('on'))
    expect(flip('def f {\nX 1\n}\nf 1 collapsed on', 4)).toBe('def f {\nX 1\n}\nf 1 collapsed off')
  })

  it('on a line of several switches, flips only its own', () => {
    expect(flip('in 00\nX 1 on; X 2 on', 2, 1)).toBe('in 00\nX 1 on; X 2 off')
    expect(flip('in 00\nX 1 on; X 2 on', 2, 0)).toBe('in 00\nX 1 off; X 2 on')
  })

  it('leaves a label alone, and a line with no switch', () => {
    expect(flip('in 00\nCNOT "on" 1 -> 2 off', 2)).toBe('in 00\nCNOT "on" 1 -> 2 on')
    expect(flip('in 0\nX 1', 2)).toBeUndefined()
  })

  it('is what the geometry hands over', () => {
    const src = 'in 00\nH 1 on\nCNOT 1 -> 2 off'
    const [, cnot] = render(src, { switches: true }).geometry!.switches!
    expect(toggleSwitch(src, cnot.switch)?.source).toBe('in 00\nH 1 on\nCNOT 1 -> 2 on')
  })
})

describe('moving a gate', () => {
  it('takes its switch along', () => {
    const src = 'in 000\nH 1\nX 2 off'
    const doc = parseCircuit(src)
    const x = doc.layers.flatMap((l) => l.gates).find((g) => g.switch)!
    const out = moveGate(src, doc, x, { wire: 3, layer: 1, where: 'in' })!.source
    expect(out).toContain('X 3 off')
  })
})
