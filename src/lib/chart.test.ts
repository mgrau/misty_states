/**
 * The state as a bar chart.
 *
 * What the plot is *for* is the thing to keep true: it shows every basis state
 * on one scale, including the empty ones, because a term that has cancelled is
 * the interesting part of an interference figure and a plot that quietly left
 * it out would show a different state.
 */

import { describe, expect, it } from 'vitest'
import { parseCircuit } from './circuit/parse'
import { chartBars, resolveCalculations } from './circuit/simulate'
import { render } from './index'
import { layoutChart } from './chart/layout'
import { DEFAULT_METRICS, textWidth } from './render/primitives'

const spec = (src: string) => resolveCalculations(parseCircuit(src)).chart!
const bars = (src: string) => spec(src).bars!

describe('asking for one', () => {
  it('plots amplitudes unless told otherwise', () => {
    expect(spec('in 00\nH 1\nchart').mode).toBe('amplitude')
  })

  it('takes the quantity in brackets, under any of its names', () => {
    expect(spec('in 00\nH 1\nchart(probability)').mode).toBe('probability')
    expect(spec('in 00\nH 1\nchart(p)').mode).toBe('probability')
    expect(spec('in 00\nH 1\nplot(amp)').mode).toBe('amplitude')
  })

  it('carries a caption and a note the same way a table does', () => {
    expect(spec('in 00\nH 1\nafter one gate: chart : the sign matters')).toMatchObject({
      caption: 'after one gate',
      note: 'the sign matters',
    })
  })

  it('refuses a quantity it cannot plot', () => {
    expect(() => parseCircuit('in 00\nH 1\nchart(colour)')).toThrow(/not something to chart/)
  })

  it('will not stand in for the input, which it is worked out from', () => {
    expect(() => parseCircuit('chart\nH 1')).toThrow(/cannot be the input/)
  })

  it('leaves no room for anything after it', () => {
    expect(() => parseCircuit('in 00\nH 1\nchart\n00')).toThrow(/nothing can follow it/)
  })
})

describe('what the bars say', () => {
  it('gives every basis state a bar, empty ones included', () => {
    // H on the first wire alone leaves two of the four states unoccupied.
    const all = bars('in 00\nH 1\nchart')
    expect(all).toHaveLength(4)
    expect(all.map((b) => Math.round(b.probability * 100))).toEqual([50, 0, 50, 0])
  })

  it('normalises, so a bar is a share of the whole state', () => {
    const [first] = bars('in 00\nH 1\nH 2\nchart')
    expect(first.amplitude).toBeCloseTo(0.5)
    expect(first.probability).toBeCloseTo(0.25)
  })

  it('keeps the sign that makes interference visible', () => {
    // |00> + |01> + |10> - |11>, all over two.
    const signs = bars('in 00\nH 1\nH 2\nCZ 1 2\nchart').map((b) => Math.sign(b.amplitude!))
    expect(signs).toEqual([1, 1, 1, -1])
  })

  it('normalises the overall sign away, which is not observable', () => {
    const one = bars('in 0|1\nchart').map((b) => b.amplitude)
    const other = bars('in -0|-1\nchart').map((b) => b.amplitude)
    expect(other).toEqual(one)
  })

  it('keeps it when the figure asks to', () => {
    const doc = parseCircuit('in -0|-1\nchart')
    expect(chartBars(doc, 0, { keepSign: true }).bars[0].amplitude).toBeLessThan(0)
  })

  it('shows a cancelled term as an empty place rather than dropping it', () => {
    // H(|0> + |1>) is |0> alone: the second bar is the one that cancelled.
    const [zero, one] = bars('in 0|1\nH 1\nchart')
    expect(zero.probability).toBeCloseTo(1)
    expect(one.probability).toBe(0)
  })

  it('turns into outcomes and their chances after a measurement', () => {
    const measured = spec('in 00\nH 1\nCNOT 1 -> 2\nM 1\nchart')
    expect(measured.measured).toBe(true)
    // Two outcomes rather than four basis states, and no amplitude to either.
    expect(measured.bars).toHaveLength(2)
    expect(measured.bars!.every((b) => b.amplitude === undefined)).toBe(true)
    expect(measured.bars!.map((b) => b.label)).toEqual(['50%', '50%'])
  })

  it('drops the empty bars once there are too many to read', () => {
    const wide = spec('qubits 6\nin 000000\nH 1\nchart')
    expect(wide.complete).toBe(false)
    expect(wide.bars).toHaveLength(2)
  })

  it('keeps them while the plot is still legible', () => {
    expect(spec('qubits 5\nin 00000\nH 1\nchart').complete).toBe(true)
  })
})

describe('drawing it', () => {
  it('draws a bar per basis state, under the circuit', () => {
    const svg = render('in 00\nH 1\nH 2\nchart').svg
    expect(svg).toContain('<svg')
    // Four bars, plus the panes the drawing already had for its gates.
    expect(svg.split('<rect').length - 1).toBeGreaterThanOrEqual(4)
  })

  it('hangs the axis below zero only when something is down there', () => {
    const flat = render('in 00\nH 1\nH 2\nchart').height
    const signed = render('in 00\nH 1\nH 2\nCZ 1 2\nchart').height
    expect(signed).toBeGreaterThan(flat)
  })

  it('says how likely each outcome is when it is plotting chances', () => {
    // Anchored, because a gradient stop reading "150%" is not a bar label.
    expect(render('in 00\nH 1\nchart(probability)').svg).toContain('>50%<')
  })

  it('leaves the amplitude plot unlabelled, where the axis already says it', () => {
    expect(render('in 00\nH 1\nchart').svg).not.toContain('>50%<')
  })
})

describe('reading it at a glance', () => {
  const svg = (src: string) => render(src).svg

  it('writes the basis states down the page, not across', () => {
    // Stacked, so a bar is one qubit wide however many wires there are.
    const two = render('in 00\nH 1\nchart').width
    const three = render('in 000\nH 1\nchart').width
    // Four bars of two wires against eight of three: wider, but not by the
    // factor a register laid sideways under every bar would cost.
    expect(three).toBeLessThan(two * 2)
  })

  it('colours an amplitude by its sign, and leaves a probability plain', () => {
    const tones = (mode: string) => {
      const doc = resolveCalculations(parseCircuit(`in 00\nH 1\nH 2\nCZ 1 2\n${mode}`))
      return layoutChart(doc.chart!.bars!, doc.chart!, { metrics: DEFAULT_METRICS })
        .prims.filter((p) => p.t === 'pane')
        .map((p) => p.tone)
    }
    // Signed, and scaled: one bar leans each way, so both ends of the ramp are
    // asked for.
    expect(tones('chart')).toEqual([0.5, 0.5, 0.5, -0.5])
    // A chance has no sign, so colouring it would say nothing the height does
    // not — and would leave the two kinds of plot looking alike.
    expect(tones('chart(probability)').every((t) => t === undefined)).toBe(true)
  })

  it('names the scale, written up the axis', () => {
    expect(svg('in 00\nH 1\nchart')).toMatch(/rotate\(-90[^)]*\)[^>]*>Amplitude</)
    expect(svg('in 00\nH 1\nchart(probability)')).toMatch(/rotate\(-90[^)]*\)[^>]*>Probability</)
  })

  it('shrinks the chances so they fit over their bars', () => {
    // Stacking the labels makes every bar one qubit wide, so a chance written
    // over one has very little room — and running two into each other says
    // less than the axis beside them already does.
    const written = (src: string) =>
      [...svg(src).matchAll(/font-size="([\d.]+)"[^>]*>([\d./]+%?)</g)]
        .filter((m) => m[2].includes('%'))
        .map((m) => ({ size: Number(m[1]), text: m[2] }))

    for (const src of [
      'in 0\nH 1\nchart(probability)',
      'in 00\nH 1\nCNOT 1 2\nchart(probability)',
      'qubits 4\nin 0000\nH 1\nH 2\nH 3\nH 4\nchart(probability)',
    ]) {
      const all = written(src)
      expect(all.length).toBeGreaterThan(0)
      for (const { size, text } of all) {
        // Inside its bar and the gap beside it...
        expect(textWidth(text, size)).toBeLessThanOrEqual(DEFAULT_METRICS.qubit + 8)
        // ...and never shrunk past the point of being worth reading.
        expect(size).toBeGreaterThanOrEqual(DEFAULT_METRICS.fontSize * 0.6)
        expect(size).toBeLessThanOrEqual(DEFAULT_METRICS.fontSize)
      }
    }
  })

  it('leaves out the plumbing when there are no gates to plumb', () => {
    // A state with a plot under it is not a one-wire circuit, and a stub of
    // pipe between the two reads as an identity nobody wrote.
    expect(svg('0|0|-1\nchart')).not.toContain('url(#ms-pipe)')
    expect(svg('in 0\nH 1\nchart')).toContain('url(#ms-pipe)')
  })
})
