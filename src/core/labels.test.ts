/**
 * Naming a controlled gate.
 *
 * The course uses two placements and means different things by them: a name on
 * the target says what the gate does to that wire, and a name beside the link
 * names the gate as a whole. Which one is chosen by where the quoted name is
 * written, so the syntax carries the distinction rather than a second keyword.
 */

import { describe, expect, it } from 'vitest'
import { parseCircuit } from './circuit/parse'
import { layoutCircuit } from './circuit/layout'
import { DEFAULT_METRICS } from './render/primitives'
import { THEMES } from './render/themes'
import { DEFAULT_SHAPE_ORDER } from './shapes'
import { render } from './index'

const gateOf = (src: string) => parseCircuit(`in 000\n${src}`).layers[0].gates[0]

describe('writing it', () => {
  it('takes a name before the wires as a name for the target', () => {
    expect(gateOf('CNOT "Parity" 1 2 -> 3')).toMatchObject({
      targetGlyph: 'label',
      label: 'Parity',
      controls: [1, 2],
      target: 3,
    })
  })

  it('takes a name after the wires as a name for the link', () => {
    expect(gateOf('CNOT 1 -> 2 "Tiger?"')).toMatchObject({
      targetGlyph: 'not',
      label: 'Tiger?',
      labelOnLink: true,
    })
  })

  it('names a CZ either way too', () => {
    expect(gateOf('CZ 1 2 "Phase"')).toMatchObject({ targetGlyph: 'z', labelOnLink: true })
    expect(gateOf('CZ "Parity" 1 2')).toMatchObject({ targetGlyph: 'label', label: 'Parity' })
  })

  it('leaves an unnamed gate exactly as it was', () => {
    expect(gateOf('CNOT 1 -> 2')).toEqual({
      kind: 'controlled',
      controls: [1],
      target: 2,
      targetGlyph: 'not',
      label: undefined,
      labelOnLink: undefined,
      // Every gate carries the line it was written on, named or not.
      line: 2,
    })
  })
})

describe('drawing it', () => {
  const texts = (src: string) => {
    const out = render(`in 000\n${src}`, { check: false }).svg
    return [...out.matchAll(/>([^<>]+)<\/text>/g)].map((m) => m[1])
  }

  it('puts the name where it was asked for', () => {
    expect(texts('CNOT "Parity" 1 2 -> 3')).toContain('Parity')
    expect(texts('CNOT 1 -> 2 "Tiger?"')).toContain('Tiger?')
  })

  it('drops the target glyph when a name stands there instead', () => {
    // ⊕ would only say again, less well, what the name already says.
    const named = render('in 000\nCNOT "Parity" 1 2 -> 3', { check: false }).svg
    const plain = render('in 000\nCNOT 1 2 -> 3', { check: false }).svg
    expect(plain.match(/<circle/g)?.length ?? 0).toBeGreaterThan(
      named.match(/<circle/g)?.length ?? 0,
    )
  })

  it('keeps the glyph when the name is on the link', () => {
    const named = render('in 000\nCNOT 1 -> 2 "Tiger?"', { check: false }).svg
    expect(named).toContain('Tiger?')
    expect(named.match(/<circle/g)?.length ?? 0).toBeGreaterThan(1)
  })

  it('makes room rather than hanging a name off its own box', () => {
    // A name on an end wire has nowhere to go unless the box widens for it.
    const wide = render('in 000\nCNOT "Parity" 1 2 -> 3', { check: false }).width
    const bare = render('in 000\nCNOT 1 2 -> 3', { check: false }).width
    expect(wide).toBeGreaterThan(bare)
  })

  it('draws in every theme without spilling', () => {
    for (const theme of ['solid', 'flat', 'isometric'] as const) {
      for (const src of ['CNOT "Parity" 1 2 -> 3', 'CNOT 1 -> 2 "Tiger?"']) {
        expect(render(`in 000\n${src}`, { theme, check: false }).svg, theme).not.toContain('NaN')
      }
    }
  })

  it('leaves the arithmetic alone: a name is a name', () => {
    expect(render('in 110\nTOFFOLI "Parity" 1 2 -> 3\nout 111').check!.ok).toBe(true)
    expect(render('in 10\nCNOT 1 -> 2 "Tiger?"\nout 11').check!.ok).toBe(true)
  })
})

/**
 * A name beside the link needs room above the wire.
 *
 * Without it the name straddles the top edge of the gate — half on the box,
 * half on the pipe above it — which reads as a mistake rather than a label.
 */
describe('making room for the name', () => {
  const laidOut = (src: string) =>
    layoutCircuit(parseCircuit(`qubits 3\n${src}`), {
      metrics: DEFAULT_METRICS,
      shapeOrder: DEFAULT_SHAPE_ORDER,
      attach: THEMES.flat.attach,
    })
  const bodies = (src: string) =>
    laidOut(src).prims.filter((p) => p.t === 'gatebox').map((p) => p.box)
  const bodyHeight = (src: string) => bodies(src)[0].h

  it('grows by what the name needs and no more', () => {
    const laid = laidOut('CNOT 1 -> 2 "Tiger?"')
    const body = bodies('CNOT 1 -> 2 "Tiger?"')[0]
    const label = laid.prims.filter((p) => p.t === 'text').find((p) => p.text === 'Tiger?')!
    const clear = label.cy - DEFAULT_METRICS.fontSize / 2 - body.y
    // Snug: a margin above the name rather than a gap, so the box does not
    // read as hollow.
    expect(clear).toBeGreaterThan(0)
    expect(clear).toBeLessThan(DEFAULT_METRICS.fontSize / 2)
    expect(bodyHeight('CNOT 1 -> 2 "Tiger?"')).toBeLessThan(DEFAULT_METRICS.gateHeight * 1.4)
  })

  it('leaves a target-labelled one alone, where the name sits centred already', () => {
    expect(bodyHeight('CNOT "Oracle" 1 -> 2')).toBe(DEFAULT_METRICS.gateHeight)
    expect(bodyHeight('CNOT 1 -> 2')).toBe(DEFAULT_METRICS.gateHeight)
  })

  it('keeps the name inside the box it grew for', () => {
    const laid = laidOut('CNOT 1 -> 2 "Tiger?"')
    const gate = bodies('CNOT 1 -> 2 "Tiger?"')[0]
    const label = laid.prims
      .filter((p) => p.t === 'text')
      .find((p) => p.text === 'Tiger?')!
    // Half a line above and below the text's centre, and still inside.
    expect(label.cy - DEFAULT_METRICS.fontSize / 2).toBeGreaterThan(gate.y)
    expect(label.cy + DEFAULT_METRICS.fontSize / 2).toBeLessThan(gate.y + gate.h)
  })

  it('adds the room above the wire and none below it', () => {
    const wireOf = (src: string) => {
      const target = laidOut(src).prims.find((p) => p.t === 'target')!
      const body = bodies(src)[0]
      return { above: target.cy - body.y, below: body.y + body.h - target.cy }
    }
    const named = wireOf('CNOT 1 -> 2 "Tiger?"')
    const plain = wireOf('CNOT 1 -> 2')
    // The foot of the gate stays exactly where an unnamed one puts it...
    expect(named.below).toBeCloseTo(plain.below, 5)
    // ...and the whole of the extra height is headroom for the name.
    expect(named.above - plain.above).toBeCloseTo(
      bodyHeight('CNOT 1 -> 2 "Tiger?"') - DEFAULT_METRICS.gateHeight,
      5,
    )
  })

  it('stands a plain gate on the same foot as a taller neighbour', () => {
    const feet = bodies('CNOT 1 -> 2 "Tiger?"; H 3').map((b) => b.y + b.h)
    expect(Math.max(...feet) - Math.min(...feet)).toBeCloseTo(0, 5)
  })

  it('keeps every wire in a row on one line', () => {
    const laid = laidOut('CNOT 1 -> 2 "Tiger?"; H 3')
    const dots = laid.prims.filter((p) => p.t === 'control' || p.t === 'target')
    const link = laid.prims.filter((p) => p.t === 'link')
    const ys = [...dots, ...link].map((p) => p.cy)
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(0, 5)
    // And a gate's own foot is the usual distance below that line.
    const body = bodies('CNOT 1 -> 2 "Tiger?"; H 3')[0]
    expect(body.y + body.h - ys[0]).toBeCloseTo(DEFAULT_METRICS.gateHeight / 2, 5)
  })
})
