/**
 * Unrolling the arithmetic, a term at a time.
 *
 * Applying a gate to a superposition destroys exactly what an animation of it
 * wants to show: two terms landing on the same row and adding, or landing and
 * cancelling. These keep every emission apart, so the property that matters is
 * that putting them back together reproduces the simulator exactly — the same
 * standard the rest of the arithmetic is held to.
 */

import { describe, expect, it } from 'vitest'
import { parseCircuit } from './parse'
import { parseState } from '../state/parse'
import { amplitudesOf, simulate, traceGate, type Amplitudes } from './simulate'
import {
  bandHeight, buildTermTimeline, fadeAt, labelWidth, rowAt, termRun,
  MAX_TERMS, NotClassicalError,
} from './animate'
import { layoutCircuit } from './layout'
import { render } from '../index'
import { DEFAULT_METRICS } from '../render/primitives'

const state = (src: string, qubits: number) => amplitudesOf(parseState(src).rows[0], qubits)
const gateOf = (src: string) => parseCircuit(`in 00\n${src}`).layers[0].gates[0]

/** Contributions summed by where they landed — which must be what a gate does. */
const collect = (list: { to: string; amp: number }[]): Amplitudes => {
  const out: Amplitudes = new Map()
  for (const { to, amp } of list) {
    const sum = (out.get(to) ?? 0) + amp
    if (sum === 0) out.delete(to)
    else out.set(to, sum)
  }
  return out
}

/** When the last of a layer's results has reached its place. */
const landedBy = (t: { passes: { landed?: number; to: number }[] }) =>
  Math.max(...t.passes.map((p) => p.landed ?? p.to)) + 0.01

const shown = (t: { bits: string; amp: number }) =>
  `${t.amp < 0 ? '-' : ''}${Math.abs(t.amp) > 1 ? `${Math.abs(t.amp)}*` : ''}${t.bits}`

describe('tracing one gate', () => {
  it('splits a term the way a Hadamard does', () => {
    expect(traceGate(state('0', 1), gateOf('H 1'))).toEqual([
      { from: '0', to: '0', amp: 1 },
      { from: '0', to: '1', amp: 1 },
    ])
    expect(traceGate(state('1', 1), gateOf('H 1'))).toEqual([
      { from: '1', to: '0', amp: 1 },
      { from: '1', to: '1', amp: -1 },
    ])
  })

  it('keeps what a merge would swallow', () => {
    // 0|1 through H is two terms landing on white and adding, and two landing
    // on black and cancelling. Applying the gate shows neither.
    const traced = traceGate(state('0|1', 1), gateOf('H 1'))
    expect(traced).toHaveLength(4)
    expect(traced.filter((c) => c.to === '1').map((c) => c.amp)).toEqual([1, -1])
    expect([...collect(traced)]).toEqual([['0', 2]])
  })

  it('adds back up to what applying the gate gives, for every gate', () => {
    // The property, not an example: the same arithmetic taken apart and put
    // back together.
    const inputs = ['00', '01|10', '00|01|10|11', '00|-11', '2*01|3*10']
    const gates = ['H 1', 'H 2', 'X 1', 'CNOT 1 -> 2', 'CZ 1 2', 'SWAP 1 2', 'Z 2', 'I 1']
    for (const input of inputs) {
      for (const src of gates) {
        const amps = state(input, 2)
        const traced = collect(traceGate(amps, gateOf(src)))
        const applied = simulate(parseCircuit(`in ${input}\n${src}`), 1)
        expect([...traced].sort(), `${input} through ${src}`).toEqual([...applied].sort())
      }
    }
  })

  it('says which term each contribution came from', () => {
    const traced = traceGate(state('00|11', 2), gateOf('CNOT 1 -> 2'))
    expect(traced.map((c) => [c.from, c.to])).toEqual([
      ['00', '00'],
      ['11', '10'],
    ])
  })

  it('takes the terms in reading order', () => {
    const traced = traceGate(state('11|00|01', 2), gateOf('I 1'))
    expect(traced.map((c) => c.from)).toEqual(['00', '01', '11'])
  })
})

describe('working a circuit through', () => {
  const run = (src: string) => termRun(parseCircuit(src))

  it('shows a layer as: terms in, what each gave, what is left', () => {
    const [layer] = run('in 0|1\nH 1')
    expect(layer.going.map(shown)).toEqual(['0', '1'])
    expect(layer.gave.map((c) => `${c.from}→${c.amp > 0 ? '+' : '-'}${c.to}`)).toEqual([
      '0→+0', '0→+1', '1→+0', '1→-1',
    ])
    expect(layer.summed.map(shown)).toEqual(['2*0'])
    expect(layer.left.map(shown)).toEqual(['0'])
  })

  it('holds the sum and the tidied state apart, both being worth showing', () => {
    // Adding the two whites together gives 2, and dividing that back out is a
    // second thing said. Collapsing the two would lose the step where the
    // amplitude appears at all.
    expect(run('in 0|1\nH 1')[0].summed.map(shown)).toEqual(['2*0'])
    expect(run('in 0|1\nH 1')[0].left.map(shown)).toEqual(['0'])
    expect(run('in 0\nH 1\nH 1')[1].summed.map(shown)).toEqual(['2*0'])
  })

  it('feeds each layer with what the last one left', () => {
    const layers = run('in 0\nH 1\nCNOT 1 -> 2')
    expect(layers).toHaveLength(2)
    expect(layers[1].going).toEqual(layers[0].left)
    expect(layers[1].left.map(shown)).toEqual(['00', '11'])
  })

  it('ends where the simulator ends', () => {
    for (const src of [
      'in 0|1\nH 1',
      'in 0\nH 1\nCNOT 1 -> 2',
      'in 00|11\nCNOT 1 -> 2\nSWAP 1 2',
      'in 01\nH 1\nH 2\nCZ 1 2',
      'in 1\nH 1\nZ 1\nH 1',
    ]) {
      const doc = parseCircuit(src)
      const ours = run(src).at(-1)!.left
      const theirs = simulate(doc, doc.layers.length)
      // Compared as states: the simulator reduces by the common factor and this
      // does not, so the two agree up to that scale.
      const scale = ours[0].amp / (theirs.get(ours[0].bits) ?? 1)
      expect(new Map(ours.map((t) => [t.bits, t.amp / scale])), src).toEqual(theirs)
    }
  })

  it('treats a layer of several gates as one step', () => {
    // They act on disjoint wires, so what is shown is the layer's doing, not
    // each gate's in turn.
    const [layer] = run('in 00\nH 1; H 2')
    expect(layer.going.map(shown)).toEqual(['00'])
    expect(layer.left).toHaveLength(4)
    expect(new Set(layer.gave.map((c) => c.from))).toEqual(new Set(['00']))
  })

  it('refuses more terms than a drawing can stack', () => {
    expect(() => run('in 0000\nH 1; H 2; H 3; H 4')).toThrow(NotClassicalError)
    expect(() => run('in 0000\nH 1; H 2; H 3; H 4')).toThrow(
      new RegExp(`more than the ${MAX_TERMS}`),
    )
    // Eight is the most it will draw, and it does draw eight.
    expect(run('in 000\nH 1; H 2; H 3')[0].gave).toHaveLength(MAX_TERMS)
  })

  it('refuses a measurement, which is branching rather than moving', () => {
    expect(() => run('in 00\nH 1\nmeasure 1 Z')).toThrow(/measures/)
  })

  it('passes on what the arithmetic cannot follow', () => {
    expect(() => run('in ?\nX 1')).toThrow(/has no value/)
    expect(() => run('in 00\nbox "Oracle" 1-2')).toThrow(/is a drawing/)
    expect(() => run('in 0\nS 1')).toThrow(/complex amplitudes/)
  })

  it('says so when everything cancels', () => {
    expect(() => run('in 0|1\nH 1\nH 1\nZ 1')).not.toThrow()
  })

  it('starts from every wire white when no input is written', () => {
    expect(run('H 1')[0].going.map(shown)).toEqual(['0'])
  })
})

/**
 * Drawing it: terms queue above a gate, go through one at a time, and pile up
 * below it until they are added together.
 */
describe('animating a superposition', () => {
  const built = (src: string) => {
    const doc = parseCircuit(src)
    const working = termRun(doc)
    const bands = Array.from({ length: doc.layers.length + 1 }, () => bandHeight(DEFAULT_METRICS))
    const layout = layoutCircuit(doc, { bareEnds: true, bands })
    return {
      layout,
      timeline: buildTermTimeline(working, layout.geometry, DEFAULT_METRICS),
    }
  }
  const look = (r: { bits: string; amp: number }) => `${r.amp > 0 ? '+' : ''}${r.amp}${r.bits}`

  it('gives each stage a band of its own, one row tall', () => {
    // The terms of a state stand side by side the way the notation writes
    // them, so a band holds four of them in the same height as one.
    const { layout } = built('in 0|1\nH 1')
    expect(layout.geometry.bands).toHaveLength(2)
    const heights = layout.geometry.bands.map((b) => b.h)
    expect(heights[0]).toBe(heights[1])
  })

  it('leaves the wires out of the bands at either end', () => {
    // The state going in and the state coming out are not on the wires, any
    // more than a written `in` is; pipe drawn up past them carries nothing.
    // The bands between two gates are a different matter — what leaves one is
    // on its way into the next — so the wires do run through those.
    const { layout } = built('0\nH 1\nH 1')
    const { bands, pipeTop, pipeBottom } = layout.geometry
    expect(bands).toHaveLength(3)
    expect(bands[0].y + bands[0].h).toBeLessThanOrEqual(pipeTop + 0.01)
    expect(bands[2].y).toBeGreaterThanOrEqual(pipeBottom - 0.01)
    expect(bands[1].y).toBeGreaterThan(pipeTop)
    expect(bands[1].y + bands[1].h).toBeLessThan(pipeBottom)
  })

  it('makes room in the circuit for them', () => {
    const plain = layoutCircuit(parseCircuit('in 0|1\nH 1'), { bareEnds: true })
    const { layout } = built('in 0|1\nH 1')
    expect(layout.box.h).toBeGreaterThan(plain.box.h)
    expect(layout.geometry.bands).toHaveLength(2)
    expect(layout.geometry.bands[0].y).toBeLessThan(layout.geometry.layers[0].y)
    expect(layout.geometry.bands[1].y).toBeGreaterThan(layout.geometry.layers[0].y)
  })

  it('stands the terms of a state side by side, and one on the wires', () => {
    // A term waits off to one side and shifts across before it goes down: what
    // is being taken apart is a state, not a queue.
    const { timeline } = built('in 0|1\nH 1')
    const [first, second] = timeline.rows
    expect(first.stops[0].x).toBeLessThan(0)
    expect(second.stops[0].x).toBeGreaterThan(0)
    // Each is square on the wires by the time it reaches the gate.
    expect(first.stops.some((s) => s.x === 0)).toBe(true)
  })

  it('draws a cloud round a state while it is whole', () => {
    const { timeline } = built('in 0|1\nH 1')
    expect(timeline.clouds.length).toBeGreaterThan(0)
    // And not round a state of one term, which is not misty.
    expect(built('in 0\nX 1').timeline.clouds).toHaveLength(0)
  })

  it('brackets each term\u2019s own results, then drops the brackets', () => {
    // ((0|1)|(0|-1)) before (0|1|0|-1): the inner brackets say which term gave
    // what, and dropping them is a step of the algebra rather than bookkeeping.
    const { timeline } = built('in 0|1\nH 1')
    const widths = timeline.clouds.map((c) => c.box.w)
    // Brackets round a pair, and one round all four of them.
    expect(new Set(widths).size).toBeGreaterThan(1)
    expect(Math.max(...widths)).toBeGreaterThan(Math.min(...widths) * 1.5)
  })

  it('separates the terms of a state with bars', () => {
    const { timeline } = built('in 0|1\nH 1')
    // One gap in the state going in, three in the four results, and one in
    // each of the two brackets round a pair.
    expect(timeline.bars.length).toBeGreaterThanOrEqual(6)
    // A bracket's bar is there from the moment the bracket is, not only once
    // the outer state has formed around it.
    const early = Math.min(...timeline.bars.map((b) => b.stops.find((s) => s.alpha === 1)!.t))
    expect(early).toBeLessThan(landedBy(timeline))
  })

  it('widens the gap for whatever amplitude has to fit in it', () => {
    // The coefficient is written in the gap between two terms, where the bar
    // already is. Sized for a bare minus, a two-digit coefficient is drawn
    // straight through the bar — so the gap is measured from the amplitudes the
    // run actually produces.
    const gapOf = (src: string) => {
      const { timeline } = built(src)
      const xs = [...new Set(timeline.rows.map((r) => rowAt(r, landedBy(timeline)).x))]
        .sort((a, b) => a - b)
      return xs[1] - xs[0]
    }
    expect(gapOf('in 10*0|1\nX 1')).toBeGreaterThan(gapOf('in 2*0|1\nX 1'))
    expect(gapOf('in 2*0|1\nX 1')).toBeGreaterThan(gapOf('in 0|1\nX 1'))
  })

  it('keeps the bar clear of the amplitude beside it', () => {
    for (const src of ['in 0|1\nH 1', 'in 10*0|1\nX 1', 'in 0|-1\nH 1']) {
      const { timeline } = built(src)
      const settled = landedBy(timeline)
      for (const row of timeline.rows) {
        const now = rowAt(row, settled)
        if (now.alpha < 0.9) continue
        const label = labelWidth(row.amp, DEFAULT_METRICS)
        if (!label) continue
        const left = now.x - DEFAULT_METRICS.qubit / 2 - DEFAULT_METRICS.signGap - label
        for (const bar of timeline.bars) {
          const at = bar.x + fadeAt(bar, settled).x
          if (at > now.x) continue
          expect(at + DEFAULT_METRICS.barWidth / 2, `${src} @ ${row.amp}`).toBeLessThan(left)
        }
      }
    }
  })

  it('leaves room in the gap for a bar and a minus sign together', () => {
    // They sit in the same gap: the bar between two terms, the sign in front of
    // the right-hand one. Too tight and the bar is drawn straight through it.
    const { timeline } = built('in 0|1\nH 1')
    const negative = timeline.rows.find((r) => r.amp < 0)!
    // Where it stands once the brackets have been dropped, not where it was
    // made — at the gate every term shares one place.
    const x = rowAt(negative, landedBy(timeline)).x
    const nearest = timeline.bars
      .map((b) => b.x)
      .filter((bx) => bx < x)
      .sort((a, b) => b - a)[0]
    const sign = x - DEFAULT_METRICS.qubit / 2 - DEFAULT_METRICS.signGap
    expect(nearest).toBeLessThan(sign - DEFAULT_METRICS.barWidth * 2)
  })

  it('works the terms in the order they stand, whatever that order is', () => {
    // The arithmetic hands its results back in bit order, but a layer can
    // leave a band in some other order — and from then on the two disagree,
    // sending results to homes that are not where they landed. Every layer of
    // these must land in the order it fills.
    const inOrder = (src: string) => {
      for (const layer of termRun(parseCircuit(src))) {
        const landing: string[] = []
        for (const term of layer.going) {
          for (const c of layer.gave.filter((x) => x.from === term.bits)) landing.push(c.to)
        }
        const survives = new Set(layer.summed.map((t) => t.bits))
        const first: string[] = []
        for (const bits of landing) {
          if (survives.has(bits) && !first.includes(bits)) first.push(bits)
        }
        expect(first, src).toEqual(layer.summed.map((t) => t.bits))
      }
    }
    inOrder('in 01|10\nSWAP 1 2')
    inOrder('in 0|1\nH 1')
    inOrder('in 00\nH 1\nH 2\nCZ 1 2\nH 1')
    inOrder(
      'in 00(0|1|1)\nCNOT 3 -> 2\nCNOT 3 -> 1\n---\nX 1\n---\n' +
        'CNOT 3 -> 2\nCNOT 3 -> 1\nTOFFOLI 1 2 -> 3',
    )
  })

  it('moves only what actually combines', () => {
    // A swap's two results have nothing to do with each other, so adding up
    // must leave them where they landed. Re-sorting into bit order made them
    // cross over again, which reads as part of the arithmetic when it is not.
    // Nothing merges here, so there is no adding-up stage at all — and the two
    // results must be in the same place before and after the tidying that is
    // left.
    const { timeline } = built('in 01|10\nSWAP 1 2')
    expect(timeline.tidies[0]).toHaveLength(0)
    const settled = landedBy(timeline)
    const landedRows = timeline.rows.filter((r) => r.stops[0].t > 0)
    expect(landedRows).toHaveLength(2)
    for (const row of landedRows) {
      expect(rowAt(row, timeline.duration).x).toBeCloseTo(rowAt(row, settled).x, 6)
    }
  })

  it('keeps the cloud up for the whole of the tidying', () => {
    // The state does not stop being misty while it is being tidied: between
    // dropping the brackets and adding the terms up, the terms are all still
    // there. It used to blink out in the middle of that.
    // Through the adding up, while the terms are all still standing there.
    const { timeline } = built('0\nH 1\nH 1')
    const stages = timeline.tidies[1]
    const flat = stages.find((s) => s.phase === 'flatten')!.t
    const merged = stages.find((s) => s.phase === 'merge')!.t
    for (let t = flat; t <= merged; t += 0.05) {
      const covered = timeline.clouds.some((c) => fadeAt(c, t).alpha > 0.9)
      expect(covered, `no cloud at ${t.toFixed(2)}s`).toBe(true)
    }
  })

  it('has the bracket drawn by the moment its terms have landed', () => {
    // The stepper stops there, so a bracket that formed a beat later would be
    // caught half-made — or missing.
    const { timeline } = built('0\nH 1\nH 1')
    const landed = timeline.passes[0].landed!
    expect(timeline.clouds.some((c) => fadeAt(c, landed).alpha > 0.9)).toBe(true)
  })

  it('stops on every stage of the tidying up', () => {
    const { timeline } = built('in 0|1\nH 1')
    // Brackets dropped, terms added, factor divided out.
    expect(timeline.tidies[0].map((s) => s.phase)).toEqual(['flatten', 'merge', 'reduce'])
    const [flat, merged, reduced] = timeline.tidies[0].map((s) => s.t)
    expect(flat).toBeLessThan(merged)
    expect(merged).toBeLessThan(reduced)
  })

  it('draws a row per term, per contribution and per sum', () => {
    // Two going in, four coming out, one left after adding up — the black ones
    // cancel, so they leave nothing behind.
    // Two going in, four coming out, their sum, and the sum with its common
    // factor divided out — every state the working passes through.
    const { timeline } = built('in 0|1\nH 1')
    expect(timeline.rows.map(look)).toEqual([
      '+10', '+11', '+10', '+11', '+10', '-11', '+20', '+10',
    ])
  })

  it('takes the terms one at a time, never two at once in a gate', () => {
    const { timeline } = built('in 0|1\nH 1')
    const spells = timeline.passes
    expect(spells).toHaveLength(2)
    expect(spells[0].to).toBeLessThan(spells[1].from)
  })

  it('adds two that land together and leaves their sum', () => {
    const { timeline } = built('in 0|1\nH 1')
    const sum = timeline.rows.find((r) => r.amp === 2)!
    const first = sum.stops[0]
    expect(first.alpha).toBe(0)
    // It shows up, and then gives way to itself with the factor divided out.
    expect(sum.stops.some((s) => s.alpha === 1)).toBe(true)
    // It arrives where the rows it came from were sent. The terms that went
    // *in* also read "+1 0", so they are told apart by having been there from
    // the start rather than by what they show.
    const flattened = landedBy(timeline)
    const made = timeline.rows.filter((r) => r.stops[0].t > 0 && r.stops[0].t < flattened)
    const merged = made.filter((r) => r.bits === '0' && r.amp === 1)
    expect(merged).toHaveLength(2)
    for (const row of merged) {
      expect(row.stops[row.stops.length - 1].y).toBe(first.y)
      expect(row.stops[row.stops.length - 1].alpha).toBe(0)
    }
  })

  it('takes two opposites away and leaves nothing', () => {
    const { timeline } = built('in 0|1\nH 1')
    const flat = landedBy(timeline)
    const opposites = timeline.rows.filter(
      (r) => r.stops[0].t > 0 && r.stops[0].t < flat && r.bits === '1',
    )
    expect(opposites.map((r) => r.amp).sort()).toEqual([-1, 1])
    for (const row of opposites) {
      expect(row.stops[row.stops.length - 1].alpha).toBe(0)
    }
    // And nothing is left holding that term at the end.
    expect(timeline.rows.some((r) => r.bits === '1' && r.stops.at(-1)!.alpha > 0)).toBe(false)
  })

  it('never shows a term before the thing that made it', () => {
    const { timeline } = built('in 0|1\nH 1')
    for (const row of timeline.rows) {
      const first = row.stops[0]
      if (first.t > 0) expect(first.alpha, look(row)).toBe(0)
    }
  })

  it('feeds the next gate with what the last one left', () => {
    const { timeline } = built('in 0\nH 1\nCNOT 1 -> 2')
    const layers = [...new Set(timeline.passes.map((p) => p.layer))]
    expect(layers).toEqual([0, 1])
    expect(timeline.collects).toHaveLength(2)
    expect(timeline.collects[0]).toBeLessThan(timeline.collects[1])
  })
})

describe('through render()', () => {
  const svg = (src: string) => render(src).svg

  it('draws a superposition rather than refusing it', () => {
    const out = render('in 0|1\nH 1\nanimate')
    expect(out.animation).toBeDefined()
    expect(out.svg).not.toContain('NaN')
  })

  it('runs every keyframe list from nought to a hundred', () => {
    // A list that stops short at either end leaves the browser to fill the rest
    // from the element's own style — unmoved and fully opaque — which drew rows
    // that did not exist yet at the top of the page, and a cloud that never
    // went away. Both were real bugs, and this is what catches them.
    const drawing = svg('in 0|1\nH 1\nanimate')
    const named = [...drawing.matchAll(/@keyframes ([rc]\d+)\{(.*?)\}(?=@keyframes|<\/style>)/gs)]
    expect(named.length).toBeGreaterThan(0)
    for (const [, name, body] of named) {
      expect(body.startsWith('0%{'), `${name} must start at 0%`).toBe(true)
      expect(body.includes('100%{'), `${name} must reach 100%`).toBe(true)
    }
  })

  it('keeps the simple picture for a state with one term', () => {
    // One row of qubits on the wires is what the travelling animation already
    // draws, crossing swaps and all, so it is not given the queue.
    expect(svg('in 11\nCNOT 1 -> 2\nanimate')).toContain('@keyframes m0')
    expect(svg('in 0|1\nH 1\nanimate')).not.toContain('@keyframes m0')
  })

  it('stops on each term arriving, what it gave, and the adding up', () => {
    const steps = render('in 0|1\nH 1\nanimate').animation!.steps
    expect(steps.map((s) => s.phase)).toEqual([
      'before',
      'at', 'acting', 'landed',
      'at', 'acting', 'landed',
      'flatten', 'merge', 'reduce',
    ])
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i].t).toBeGreaterThan(steps[i - 1].t)
    }
  })

  it('splits a term where the gate acts, then carries the pair out together', () => {
    // The two results are made apart from each other inside the gate — that is
    // the gate doing something — and leave as one state rather than each
    // finding its own way down.
    const doc = parseCircuit('in 0|1\nH 1')
    const working = termRun(doc)
    const bands = Array.from({ length: 2 }, () => bandHeight(DEFAULT_METRICS))
    const layout = layoutCircuit(doc, { bareEnds: true, bands })
    const timeline = buildTermTimeline(working, layout.geometry, DEFAULT_METRICS)

    const gate = layout.geometry.layers[0]
    const gateY = gate.y + gate.h / 2
    const pair = timeline.rows.filter((r) => r.stops[0].t > 0).slice(0, 2)
    // Apart from each other while still at the gate.
    const born = pair.map((r) => r.stops.find((st) => st.alpha === 1)!)
    expect(born[0].y).toBeCloseTo(gateY, 6)
    expect(born[0].x).not.toBe(born[1].x)
    // And the gap between them is the same once they have arrived.
    const rest = pair.map((r) => rowAt(r, landedBy(timeline)))
    expect(rest[1].x - rest[0].x).toBeCloseTo(born[1].x - born[0].x, 6)
  })

  it('moves the same whether the gates are open or closed', () => {
    // A closed gate is not a different journey — the qubits go behind the box
    // instead of being seen inside it, and that is a matter of what is drawn in
    // front of what, not of where anything goes.
    const doc = parseCircuit('in 0|1\nH 1')
    const working = termRun(doc)
    const bands = Array.from({ length: 2 }, () => bandHeight(DEFAULT_METRICS))
    const layout = layoutCircuit(doc, { bareEnds: true, bands })
    const open = buildTermTimeline(working, layout.geometry, DEFAULT_METRICS, { inside: true })
    const shut = buildTermTimeline(working, layout.geometry, DEFAULT_METRICS, { inside: false })

    expect(shut.inside).toBe(false)
    expect(shut.duration).toBeCloseTo(open.duration, 6)
    expect(shut.rows.map((r) => r.stops)).toEqual(open.rows.map((r) => r.stops))
  })

  it('draws a qubit behind a closed gate and in front of an open one', () => {
    const src = 'in 0|1\nH 1\nanimate'
    // Painted in document order, so position in the string is depth. The
    // gate's casing is the first rounded rectangle; a rider is a keyframed
    // group.
    const order = (svg: string) => {
      const casing = svg.search(/<rect[^>]*rx=/)
      const rider = svg.indexOf('animation-name:r0')
      return rider < casing ? 'behind' : 'in front'
    }
    expect(order(render(src, { animateInside: false }).svg)).toBe('behind')
    expect(order(render(src, { animateInside: true }).svg)).toBe('in front')
  })

  it('leaves a closed gate undimmed', () => {
    const open = render('in 0|1\nH 1\nanimate', { animateInside: true })
    const shut = render('in 0|1\nH 1\nanimate', { animateInside: false })
    expect(open.svg).toContain('opacity:0.22')
    expect(shut.svg).not.toContain('opacity:0.22')
  })

  it('lets the source say so, whatever the setting is', () => {
    // The file is the thing being generated, so what it asks for wins.
    const forced = render('in 0|1\nH 1\nanimate inside=off', { animateInside: true })
    expect(forced.svg).not.toContain('opacity:0.22')
    expect(() => render('in 0|1\nH 1\nanimate inside=maybe')).toThrow(/"on" or "off"/)
  })

  it('draws in every theme', () => {
    for (const theme of ['solid', 'flat', 'isometric'] as const) {
      expect(render('in 0|1\nH 1\nanimate', { theme }).svg, theme).not.toContain('NaN')
    }
  })
})
