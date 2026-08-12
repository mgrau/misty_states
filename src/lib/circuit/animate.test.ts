/**
 * Moving a classical state through a circuit.
 *
 * The timeline is pure data, so most of this is about it rather than about the
 * drawing: where each qubit is, what colour, and when. The property that
 * matters most is that the picture agrees with the arithmetic — whatever the
 * animation ends up showing must be the state the simulator computes.
 */

import { describe, expect, it } from 'vitest'
import { parseCircuit } from './parse'
import { layoutCircuit } from './layout'
import { resolveCalculations, simulate } from './simulate'
import {
  buildTimeline, buildTermTimeline, classicalRun, frameAt, positionAt, activeAt, steps,
  termRun, NotClassicalError, GATE_FADE, type TermTimeline,
} from './animate'
import { animatedSvg, animationBox, termFrameAt } from './animate-svg'
import { render } from '../index'
import { THEMES } from '../render/themes'
import { LIGHT_PALETTE } from '../render/theme'
import { DEFAULT_METRICS } from '../render/primitives'
import { DEFAULT_SHAPE_ORDER } from '../shapes'

const laid = (src: string) => {
  const doc = parseCircuit(src)
  const layout = layoutCircuit(doc, { bareEnds: true })
  return { doc, layout, timeline: buildTimeline(doc, layout.geometry, doc.animate) }
}

/** Where each wire ends up, read off the finished animation. */
const ending = (src: string) => {
  const { layout, timeline } = laid(src)
  return timeline.tracks
    .map((track) => {
      const last = track.stops[track.stops.length - 1]
      return { column: layout.geometry.columns.indexOf(last.x), value: last.value }
    })
    .sort((a, b) => a.column - b.column)
    .map((e) => e.value)
    .join('')
}

describe('which circuits can move', () => {
  it('refuses a superposition, naming the layer that made one', () => {
    expect(() => laid('in 0\nH 1')).toThrow(NotClassicalError)
    expect(() => laid('in 0\nH 1')).toThrow(/layer 1 puts the register into a superposition/)
  })

  it('refuses a superposed input for what it is', () => {
    expect(() => laid('in 0|1\nX 1')).toThrow(/must be a single state, not a superposition/)
  })

  it('passes it on when the arithmetic itself cannot follow the circuit', () => {
    expect(() => laid('in ?\nX 1')).toThrow(/has no value/)
    expect(() => laid('in 00\nbox "Oracle" 1-2')).toThrow(/is a drawing/)
    expect(() => laid('in 0\nT 1')).toThrow(/turns by an eighth/)
  })

  it('allows every gate that keeps the state a single one', () => {
    // Not a list of gate names anywhere in the code — this is the property.
    for (const src of [
      'in 1\nX 1',
      'in 11\nCNOT 1 -> 2',
      'in 110\nToffoli 1 2 -> 3',
      'in 001\nSWAP 2 3',
      'in 1\nZ 1',
      'in 01\nI 1; I 2',
      'in 1\nmeasure 1 Z',
      'in 11\nCZ 1 2',
    ]) {
      expect(() => laid(src), src).not.toThrow()
    }
  })

  it('starts from every wire white when no input is written', () => {
    expect(classicalRun(parseCircuit('X 1')).bits).toEqual(['0', '1'])
  })
})

describe('what the qubits do', () => {
  it('ends where the simulator says it should', () => {
    for (const src of [
      'in 11\nCNOT 1 -> 2',
      'in 001\nSWAP 2 3',
      'in 101\nSWAP 1 3\nX 2',
      'in 110\nToffoli 1 2 -> 3',
      'in 0110\nSWAP 1 2; SWAP 3 4\nX 1',
    ]) {
      const want = [...simulate(parseCircuit(src), parseCircuit(src).layers.length).keys()][0]
      expect(ending(src), src).toBe(want)
    }
  })

  it('carries a swapped qubit across, keeping its own colour', () => {
    // The objects exchange places; their values do not change. Reading the new
    // wire's colour instead would show the swap as a recolouring, which is the
    // one thing a swap is not. The *shape*, though, belongs to the position.
    const { layout, timeline } = laid('in 001\nSWAP 2 3')
    const [, second, third] = timeline.tracks
    const startOf = (t: typeof second) => t.stops[0]
    const endOf = (t: typeof second) => t.stops[t.stops.length - 1]

    expect(startOf(second).value).toBe(0)
    expect(endOf(second).value).toBe(0)
    expect(endOf(second).x).toBe(layout.geometry.columns[2])
    expect(endOf(third).value).toBe(1)
    expect(endOf(third).x).toBe(layout.geometry.columns[1])

    // Shapes stay with the columns, so the finished picture is the one a
    // written `out 010` would draw.
    expect(startOf(second).shape).toBe(layout.geometry.shapes[1])
    expect(endOf(second).shape).toBe(layout.geometry.shapes[2])
    expect(endOf(third).shape).toBe(layout.geometry.shapes[1])
  })

  it('leaves an untouched wire in its column', () => {
    const { layout, timeline } = laid('in 11\nCNOT 1 -> 2')
    for (const stop of timeline.tracks[0].stops) {
      expect(stop.x).toBe(layout.geometry.columns[0])
    }
  })

  it('runs the wires in step, so the state travels as one', () => {
    const { timeline } = laid('in 011\nX 1\nCNOT 2 -> 3')
    const times = timeline.tracks.map((t) => t.stops.map((s) => s.t))
    for (const t of times) expect(t).toEqual(times[0])
  })

  it('moves steadily between gates and holds still inside one', () => {
    const { timeline } = laid('in 11\nCNOT 1 -> 2')
    const stops = timeline.tracks[0].stops
    const dwell = stops.find((s, i) => i > 0 && s.y === stops[i - 1].y)!
    expect(dwell).toBeDefined()
    const mid = positionAt(timeline.tracks[0], (stops[0].t + stops[1].t) / 2)
    expect(mid.y).toBeGreaterThan(stops[0].y)
    expect(mid.y).toBeLessThan(stops[1].y)
  })

  it('changes colour partway through the gate, not on leaving it', () => {
    // The flip is the thing being shown, so it happens while the casing is
    // clear rather than after it has closed again.
    const { timeline } = laid('in 11\nCNOT 1 -> 2')
    const target = timeline.tracks[1]
    const pass = timeline.passes[0]
    expect(positionAt(target, pass.from + 0.01).value).toBe(1)
    expect(positionAt(target, pass.to - 0.01).value).toBe(0)
  })

  it('takes longer over a longer circuit, and less with speed=', () => {
    const one = laid('in 1\nX 1').timeline.duration
    const two = laid('in 1\nX 1\nX 1').timeline.duration
    expect(two).toBeGreaterThan(one)
    expect(laid('in 1\nX 1\nanimate speed=2').timeline.duration).toBeLessThan(one)
  })
})

describe('drawing an instant of it', () => {
  const src = 'in 11\nCNOT 1 -> 2'

  it('fades the gate only while it is being passed through', () => {
    const { layout, timeline } = laid(src)
    const pass = timeline.passes[0]
    const boxAt = (t: number) =>
      frameAt(layout, timeline, t, DEFAULT_METRICS).find((p) => p.t === 'gatebox')!

    expect(boxAt(0).opacity).toBeUndefined()
    expect(boxAt((pass.from + pass.to) / 2).opacity).toBe(GATE_FADE)
    expect(boxAt(timeline.duration).opacity).toBeUndefined()
  })

  it('puts the travelling qubits between the casing and the markings', () => {
    // Behind the box so they read as inside it, in front of nothing that would
    // hide them — the target glyph sits exactly where the qubit is.
    const { layout, timeline } = laid(src)
    const prims = frameAt(layout, timeline, timeline.passes[0].from + 0.1, DEFAULT_METRICS)
    const firstRider = prims.findIndex((p) => p.t === 'qubit')
    const casing = prims.findIndex((p) => p.t === 'gatebox')
    const target = prims.findIndex((p) => p.t === 'target')
    expect(casing).toBeLessThan(firstRider)
    expect(firstRider).toBeLessThan(target)
  })

  it('draws one qubit per wire, wherever they are', () => {
    const { layout, timeline } = laid('in 011\nX 1')
    for (const u of [0, 0.25, 0.5, 0.75, 1]) {
      const prims = frameAt(layout, timeline, u * timeline.duration, DEFAULT_METRICS)
      expect(prims.filter((p) => p.t === 'qubit')).toHaveLength(3)
    }
  })

  it('says which gates are being passed through', () => {
    const { timeline } = laid('in 11\nCNOT 1 -> 2\nX 1')
    expect(activeAt(timeline, 0)).toEqual([])
    expect(activeAt(timeline, timeline.passes[0].from + 0.01)).toEqual([0])
    expect(activeAt(timeline, timeline.passes[1].from + 0.01)).toEqual([1])
  })
})

describe('the animated SVG', () => {
  const svgFor = (src: string) => {
    const { layout, timeline } = laid(src)
    const m = DEFAULT_METRICS
    return animatedSvg(
      layout, timeline, animationBox(layout, timeline, m),
      THEMES.solid, LIGHT_PALETTE, m,
    )
  }

  it('carries its own stylesheet, so the file plays on its own', () => {
    const svg = svgFor('in 11\nCNOT 1 -> 2')
    expect(svg).toContain('<style>')
    expect(svg).toContain('@keyframes')
    expect(svg).toContain('animation-duration')
    expect(svg).not.toContain('<script')
  })

  it('moves each qubit and fades each gate', () => {
    const svg = svgFor('in 11\nCNOT 1 -> 2')
    expect(svg).toMatch(/@keyframes m0\{.*translate/)
    expect(svg).toMatch(/@keyframes m1\{.*translate/)
    expect(svg).toContain(`opacity:${GATE_FADE}`)
  })

  it('draws both looks of a qubit that changes, and swaps them abruptly', () => {
    // White and black are different drawings, not a colour to interpolate.
    const svg = svgFor('in 11\nCNOT 1 -> 2')
    expect(svg).toContain('@keyframes v1_square_1')
    expect(svg).toContain('@keyframes v1_square_0')
    expect(svg).toContain('step-end')
  })

  it('draws the glyphs a swapped qubit takes on as well', () => {
    // It lands on another wire, so it is drawn as that wire's shape.
    const svg = svgFor('in 001\nSWAP 2 3')
    expect(svg).toContain('@keyframes v1_square_0')
    expect(svg).toContain('@keyframes v1_triangle_0')
  })

  it('plays once unless told to repeat', () => {
    // A figure is usually read once; a drawing that keeps restarting is hard
    // to talk over.
    expect(svgFor('in 1\nX 1')).toContain('animation-iteration-count:1')
    expect(svgFor('in 1\nX 1\nanimate loop=on')).toContain('animation-iteration-count:infinite')
  })

  it('is wide enough for the whole journey', () => {
    // A box cropped to the still circuit would clip the qubits at both ends.
    const { layout, timeline } = laid('in 11\nCNOT 1 -> 2')
    const box = animationBox(layout, timeline, DEFAULT_METRICS)
    for (const track of timeline.tracks) {
      for (const stop of track.stops) {
        expect(stop.y).toBeGreaterThanOrEqual(box.y)
        expect(stop.y).toBeLessThanOrEqual(box.y + box.h)
      }
    }
  })
})

describe('through render()', () => {
  it('produces an animation when asked and a still drawing otherwise', () => {
    expect(render('in 11\nCNOT 1 -> 2\nanimate').animation).toBeDefined()
    expect(render('in 11\nCNOT 1 -> 2').animation).toBeUndefined()
    expect(render('in 11\nCNOT 1 -> 2').svg).not.toContain('@keyframes')
  })

  it('leaves the written ends out, the travelling qubits being them', () => {
    const still = render('in 11\nCNOT 1 -> 2\nout 10')
    const moving = render('in 11\nCNOT 1 -> 2\nout 10\nanimate')
    expect(still.height).toBeGreaterThan(0)
    expect(moving.svg).toContain('@keyframes')
    // Two states drawn still, none drawn still when they are moving instead.
    expect(moving.svg.split('@keyframes m').length - 1).toBe(2)
  })

  it('works a superposition through a term at a time instead of refusing', () => {
    // It used to refuse: one qubit per wire has no meaning once there are two
    // terms. Now the terms take turns, so the same source draws.
    const out = render('in 0\nH 1\nanimate')
    expect(out.animation).toBeDefined()
    expect(out.svg).toContain('@keyframes')
    expect(out.svg).not.toContain('NaN')
  })

  it('still refuses what no animation can show', () => {
    expect(() => render('in 00\nH 1\nmeasure 1 Z\nanimate')).toThrow(/measures/)
    expect(() => render('in 0000\nH 1; H 2; H 3; H 4\nanimate')).toThrow(/more than the/)
  })

  it('says what is wrong with an option', () => {
    expect(() => render('in 1\nX 1\nanimate wobble=3')).toThrow(/not an animate option/)
    expect(() => render('in 1\nX 1\nanimate speed=0')).toThrow(/positive number/)
    expect(() => render('in 1\nX 1\nanimate loop=maybe')).toThrow(/"on" or "off"/)
  })

  it('never emits NaN, whatever the circuit', () => {
    for (const src of [
      'in 1\nX 1\nanimate',
      'in 001\nSWAP 2 3\nanimate',
      'in 110\nToffoli 1 2 -> 3\nanimate speed=2 dwell=0.2',
      'X 1\nanimate',
    ]) {
      expect(render(src).svg, src).not.toContain('NaN')
    }
  })
})

describe('stepping through it', () => {
  it('walks one gate in the order it happens', () => {
    expect(steps(laid('in 11\nCNOT 1 -> 2').timeline).map((s) => s.phase)).toEqual([
      'before', 'at', 'acting', 'after',
    ])
  })

  it('does not stop in the gap between two gates', () => {
    // Leaving one gate is being on the way into the next; pausing there says
    // nothing the stops either side do not.
    const marks = steps(laid('in 011\nCNOT 2 -> 3\nSWAP 1 2').timeline)
    expect(marks.map((s) => s.phase)).toEqual([
      'before', 'at', 'acting', 'at', 'acting', 'after',
    ])
    // Layers, not lines: gates on disjoint wires pack together and act at once.
    expect(steps(laid('in 11\nCNOT 1 -> 2\nX 1\nX 2').timeline)).toHaveLength(6)
    expect(steps(laid('in 1\nX 1\nX 1\nX 1').timeline)).toHaveLength(8)
  })

  it('holds each qubit in its own column until the gate acts', () => {
    // A swap crosses its qubits over; spread across the whole dwell there was
    // no instant at which they had arrived and not yet swapped.
    const { layout, timeline } = laid('in 001\nSWAP 2 3')
    const [, at, acting] = steps(timeline)
    const columns = layout.geometry.columns

    expect(timeline.tracks.map((t) => positionAt(t, at.t).x)).toEqual(columns)
    expect(timeline.tracks.map((t) => positionAt(t, acting.t).x)).toEqual([
      columns[0], columns[2], columns[1],
    ])
  })

  it('runs in order and never lands on the dead time at the end', () => {
    const { timeline } = laid('in 011\nCNOT 2 -> 3\nSWAP 1 2')
    const marks = steps(timeline)
    for (let i = 1; i < marks.length; i++) expect(marks[i].t).toBeGreaterThan(marks[i - 1].t)
    expect(marks[0].t).toBe(0)
    const settle = timeline.tracks[0].stops[timeline.tracks[0].stops.length - 1].t
    expect(marks[marks.length - 1].t).toBeCloseTo(settle, 6)
    expect(marks[marks.length - 1].t).toBeLessThan(timeline.duration)
  })

  it('puts "before" outside the gate and "at" inside it, unchanged', () => {
    const { layout, timeline } = laid('in 11\nCNOT 1 -> 2')
    const pass = timeline.passes[0]
    const [before, at] = steps(timeline)

    expect(before.t).toBeLessThan(pass.from)
    expect(positionAt(timeline.tracks[0], before.t).y).toBe(layout.geometry.startY)
    expect(at.t).toBeGreaterThan(pass.from)
    expect(at.t).toBeLessThan(pass.to)
    // Arrived, but the gate has not done anything yet.
    expect(positionAt(timeline.tracks[1], at.t).value).toBe(1)
  })

  it('shows the gate having acted, while it is still see-through', () => {
    // Landing after the casing closed would hide the result behind the gate's
    // own glyph, which is the thing the step exists to show.
    const { layout, timeline } = laid('in 11\nCNOT 1 -> 2')
    const acting = steps(timeline).find((s) => s.phase === 'acting')!
    const pass = timeline.passes[0]

    expect(positionAt(timeline.tracks[1], acting.t).value).toBe(0)
    expect(acting.t).toBeGreaterThan(pass.from)
    expect(acting.t).toBeLessThan(pass.to)
    const box = frameAt(layout, timeline, acting.t, DEFAULT_METRICS).find((p) => p.t === 'gatebox')!
    expect(box.opacity).toBe(GATE_FADE)
  })

  it('puts the one "after" clear of the last gate, casing closed again', () => {
    const { layout, timeline } = laid('in 011\nCNOT 2 -> 3\nSWAP 1 2')
    const afters = steps(timeline).filter((s) => s.phase === 'after')
    expect(afters).toHaveLength(1)
    expect(afters[0].t).toBeGreaterThan(timeline.passes[1].to)
    const boxes = frameAt(layout, timeline, afters[0].t, DEFAULT_METRICS)
      .filter((p) => p.t === 'gatebox')
    expect(boxes.every((p) => p.opacity === undefined)).toBe(true)
  })

  it('names the gate each stop belongs to', () => {
    const marks = steps(laid('in 011\nCNOT 2 -> 3\nSWAP 1 2').timeline)
    expect(marks.slice(0, 3).every((s) => s.layer === 0)).toBe(true)
    expect(marks.slice(3).every((s) => s.layer === 1)).toBe(true)
  })
})

describe('driving it from outside', () => {
  const svg = () => render('in 11\nCNOT 1 -> 2\nanimate').svg

  it('reads its play state and position from custom properties', () => {
    // So a page around it can pause or seek with two variables and no script
    // inside the file.
    expect(svg()).toContain('animation-play-state:var(--misty-play,running)')
    expect(svg()).toContain('animation-delay:var(--misty-at,0s)')
  })

  it('still plays unattended, the defaults being what it does alone', () => {
    expect(svg()).toContain('running')
    expect(svg()).not.toContain('<script')
  })
})

/**
 * What a bracket is doing while a term is worked through.
 *
 * The bracket is not decoration round an answer — it is the claim that these
 * qubits are one state. So it has to exist from the moment the gate makes them,
 * and the handover from the brackets round each term's results to the one round
 * the whole state has to read as a handover rather than a dissolve.
 */
describe('the brackets round a worked term', () => {
  const timelineOf = (src: string, inside: boolean) => {
    const doc = resolveCalculations(parseCircuit(src))
    const banded = layoutCircuit(doc, {
      metrics: DEFAULT_METRICS,
      shapeOrder: DEFAULT_SHAPE_ORDER,
      attach: THEMES.solid.attach,
      bareEnds: true,
      bands: new Array(doc.layers.length + 1).fill(120),
    })
    return { banded, timeline: buildTermTimeline(termRun(doc), banded.geometry, DEFAULT_METRICS, { inside }) }
  }

  const cloudsAt = (banded: ReturnType<typeof layoutCircuit>, timeline: TermTimeline, t: number) =>
    termFrameAt(banded, timeline, t, DEFAULT_METRICS)
      .filter((p) => p.t === 'cloud' && (p.opacity ?? 1) > 0.15)

  for (const inside of [true, false]) {
    it(`forms round the results at the gate, with inside=${inside}`, () => {
      const { banded, timeline } = timelineOf('0|1\nH\nanimate', inside)
      const band = banded.geometry.layers[0]
      let seen = false
      for (let t = 0; t <= timeline.duration; t += 0.05) {
        // A bracket sitting over the gate's own band: the results are held
        // together from where they are made, not from where they arrive.
        if (cloudsAt(banded, timeline, t).some(
          (c) => c.t === 'cloud' && c.content.y > band.y - 30 && c.content.y < band.y + band.h,
        )) {
          seen = true
          break
        }
      }
      expect(seen).toBe(true)
    })
  }

  it('drops the inner brackets before the outer one arrives', () => {
    const { banded, timeline } = timelineOf('0|1\nH\nanimate', true)
    let together = 0
    for (let t = 0; t <= timeline.duration; t += 0.02) {
      const clouds = cloudsAt(banded, timeline, t)
      const outer = clouds.filter((c) => c.t === 'cloud' && c.content.w > 150).length
      const inner = clouds.filter(
        (c) => c.t === 'cloud' && c.content.w <= 150 && c.content.y > 300,
      ).length
      if (outer && inner) together++
    }
    // Never both: the handover is a sequence, and two clouds fading through
    // each other says nothing about which became which.
    expect(together).toBe(0)
  })
})
