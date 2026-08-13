/**
 * Views: states shown inside a circuit rather than only at its ends.
 *
 * Two things carry the feature. Position decides meaning — a state before the
 * gates is the input, after them the output, between them a snapshot — and a
 * view is placed over the columns it describes, so the drawing says *which*
 * qubits it is talking about.
 */

import { describe, expect, it } from 'vitest'
import { parseCircuit } from './parse'
import { layoutCircuit } from './layout'
import { resolveCalculations } from './simulate'
import { ParseError } from '../state/parse'
import { render } from '../index'
import type { ViewGate } from './ast'

const doc = (src: string) => parseCircuit(src)
const views = (src: string) =>
  doc(src).layers.flatMap((l) => l.gates).filter((g): g is ViewGate => g.kind === 'view')

/** Qubit glyphs in draw order, as {x, y} — enough to check alignment. */
const qubitsAt = (src: string) =>
  layoutCircuit(parseCircuit(src))
    .prims.filter((p) => p.t === 'qubit')
    .map((p) => (p.t === 'qubit' ? { cx: p.cx, cy: p.cy, value: p.value } : null!))

describe('position decides what a state means', () => {
  it('reads a state before the gates as the input', () => {
    const d = doc('000\nH 1')
    expect(d.input).toBeDefined()
    expect(d.output).toBeUndefined()
    expect(views('000\nH 1')).toHaveLength(0)
  })

  it('reads a state after the gates as the output', () => {
    const d = doc('H 1\n111')
    expect(d.output).toBeDefined()
    expect(d.input).toBeUndefined()
  })

  it('reads a state between gates as a view', () => {
    const d = doc('H 1\n0(0|1)\nCNOT 1 -> 2')
    expect(d.input).toBeUndefined()
    expect(d.output).toBeUndefined()
    expect(views('H 1\n0(0|1)\nCNOT 1 -> 2')).toHaveLength(1)
  })

  it('handles all three at once', () => {
    const src = '000\nH 1\n0(0|1)0\nCNOT 1 -> 2\n111'
    const d = doc(src)
    expect(d.input).toBeDefined()
    expect(d.output).toBeDefined()
    expect(views(src)).toHaveLength(1)
  })

  it('keeps in and out working, since naming them is often clearer', () => {
    const d = doc('in 000\nH 1\nout 111')
    expect(d.input).toBeDefined()
    expect(d.output).toBeDefined()
  })

  it('lets a bare line and an explicit keyword coexist', () => {
    // `in` claimed the input, so the bare line that follows is a view.
    const src = 'in 000\n000\nH 1'
    expect(doc(src).input).toBeDefined()
    expect(views(src)).toHaveLength(1)
  })

  it('makes only the last of several trailing states the output', () => {
    const src = 'H 1\n0(0|1)\n111'
    expect(views(src)).toHaveLength(1)
    expect(doc(src).output).toBeDefined()
  })
})

describe('a view takes a layer to itself', () => {
  it('never shares a layer with a gate', () => {
    const d = doc('H 1\n000\nH 2')
    for (const layer of d.layers) {
      const hasView = layer.gates.some((g) => g.kind === 'view')
      if (hasView) expect(layer.gates).toHaveLength(1)
    }
  })

  it('stops gates below it from packing up past it', () => {
    // Without the view, `H 2` would pack into the same layer as `H 1`.
    const packed = doc('H 1\nH 2')
    const split = doc('H 1\n000\nH 2')
    expect(packed.layers).toHaveLength(1)
    expect(split.layers).toHaveLength(3)
  })
})

describe('which qubits a view covers', () => {
  it('infers the span from the width of the state', () => {
    expect(views('H 1\n00\nCNOT 1 -> 3')[0].qubits).toEqual([1, 2])
  })

  it('takes an explicit range', () => {
    expect(views('H 1\nview 2-3 00|11\nH 1')[0].qubits).toEqual([2, 3])
  })

  it('takes a single qubit', () => {
    expect(views('H 1\nview 2 0\nH 1')[0].qubits).toEqual([2])
  })

  it('reads a lone number as the state when nothing follows it', () => {
    // `view 10` is the two-qubit state 10, not qubit 1 and then nothing.
    expect(views('H 1\nview 10\nH 1')[0].qubits).toEqual([1, 2])
  })

  it('rejects a range the state does not fill', () => {
    expect(() => doc('H 1\nview 2-3 000\nH 1')).toThrow(/names 2 qubits but its state is 3 wide/)
    expect(() => doc('H 1\nview 2-3 000\nH 1')).toThrow(ParseError)
  })

  it('widens the register to fit a view, like in and out already do', () => {
    expect(doc('H 1\nview 000\nH 1').qubits).toBe(3)
  })

  it('leaves qubits outside the span to flow past', () => {
    // Only the covered pipes are cut, so the others run through unbroken.
    const covered = layoutCircuit(parseCircuit('H 1\nview 2-3 00\nH 1'))
    const pipesOn = (cx: number) =>
      covered.prims.filter((p) => p.t === 'pipe' && Math.abs(p.cx - cx) < 0.5).length
    // Column 1 is interrupted only by its two H gates; columns 2 and 3 by the view.
    expect(pipesOn(0)).toBeGreaterThan(0)
    expect(pipesOn(60)).toBeGreaterThan(1)
  })
})

describe('a view sits over the columns it describes', () => {
  const COL = 60 // pipeWidth 30 + colGap 30

  it('puts each qubit of a classical state on its own pipe', () => {
    const qs = qubitsAt('H 1\n010\nH 1')
    // Three glyphs in the view, on the three column centres.
    const view = qs.filter((q) => q.cy > 0)
    expect(view.map((q) => q.cx)).toEqual([0, COL, 2 * COL])
    expect(view.map((q) => q.value)).toEqual([0, 1, 0])
  })

  it('spreads a factored state symmetrically when a cloud will not fit', () => {
    // `0(0|1)0` is a qubit, a cloud, a qubit. The cloud is far wider than one
    // column, so the bare qubits are pushed outward — evenly, staying centred
    // on the register rather than drifting to one side.
    const view = qubitsAt('H 1\n0(0|1)0\nH 1').filter((q) => q.cy > 0)
    const first = view[0].cx
    const last = view[view.length - 1].cx
    expect(first).toBeLessThan(0)
    expect(last).toBeGreaterThan(2 * COL)
    expect((first + last) / 2).toBeCloseTo(COL, 6)
  })

  it('numbers shapes from the column, not from the start of the state', () => {
    // Qubits 2 and 3, so a square and a triangle — never the circle that a
    // state starting from scratch would have drawn first.
    const shapes = layoutCircuit(parseCircuit('H 1\nview 2-3 00\nH 1'))
      .prims.filter((p) => p.t === 'qubit')
      .map((p) => (p.t === 'qubit' ? p.shape : ''))
    expect(shapes).toEqual(['square', 'triangle'])
  })

  it('pushes pieces apart rather than letting them collide', () => {
    const view = qubitsAt('H 1\n(0|1)(0|1)\nH 1').filter((q) => q.cy > 0)
    const xs = view.map((q) => q.cx).sort((a, b) => a - b)
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThan(0)
  })
})

describe('a bare view is a break in the plumbing', () => {
  const laid = (src: string) => layoutCircuit(parseCircuit(src))

  it('leaves clear pipe above and below the qubits', () => {
    const l = laid('H 1\n010\nH 1')
    const gate = l.prims.find((p) => p.t === 'gatebox')!
    const qubit = l.prims.filter((p) => p.t === 'qubit').sort((a, b) => a.cy - b.cy)[0]
    if (gate.t !== 'gatebox' || qubit.t !== 'qubit') throw new Error('missing prims')

    // Gate bottom to the top of the state: the gap between two gates would be
    // 10, and a view asks for visibly more than that.
    const clear = qubit.cy - qubit.size / 2 - (gate.box.y + gate.box.h)
    expect(clear).toBeGreaterThan(20)
  })

  it('stops the pipe short of the qubits rather than up against them', () => {
    const l = laid('H 1\n010\nH 1')
    const qubit = l.prims.filter((p) => p.t === 'qubit').sort((a, b) => a.cy - b.cy)[0]
    if (qubit.t !== 'qubit') throw new Error('missing prims')
    const top = qubit.cy - qubit.size / 2
    const ends = l.prims
      .filter((p) => p.t === 'pipe' && Math.abs(p.cx - qubit.cx) < 0.5)
      .map((p) => (p.t === 'pipe' ? p.y1 : 0))
      .filter((y1) => y1 < qubit.cy)

    // The nearest pipe above ends clear of the state, by the same margin the
    // circuit leaves before an input or output state.
    const nearest = Math.max(...ends)
    expect(top - nearest).toBeCloseTo(11, 6)
  })

  it('opens the mouth of the pipe leaving it, as at the top of the circuit', () => {
    // The state is not a gate, so the pipe below it begins in open air. Only a
    // projection that draws a bore shows this, which is why it lives on the
    // primitive rather than in a theme.
    const l = laid('H 1\n010\nH 1')
    const qubit = l.prims.filter((p) => p.t === 'qubit').sort((a, b) => a.cy - b.cy)[0]
    if (qubit.t !== 'qubit') throw new Error('missing prims')
    // The first run below it only — further down the wire, runs leave the gate
    // beneath and are closed again.
    const [next] = l.prims
      .filter((p) => p.t === 'pipe' && Math.abs(p.cx - qubit.cx) < 0.5 && p.y0 > qubit.cy)
      .sort((a, b) => (a.t === 'pipe' && b.t === 'pipe' ? a.y0 - b.y0 : 0))
    if (next?.t !== 'pipe') throw new Error('missing prims')
    expect(next.openTop).toBe(true)

    const later = l.prims.filter(
      (p) => p.t === 'pipe' && Math.abs(p.cx - qubit.cx) < 0.5 && p.y0 > next.y0 + 1,
    )
    expect(later.every((p) => p.t === 'pipe' && !p.openTop)).toBe(true)
  })

  it('leaves the pipe below a window closed, since it leaves a frame', () => {
    const l = laid('H 1\nwindow 010\nH 1')
    const frame = l.prims.find((p) => p.t === 'gatebox' && p.label === '')
    if (frame?.t !== 'gatebox') throw new Error('missing prims')
    const below = l.prims.filter(
      (p) => p.t === 'pipe' && p.y0 >= frame.box.y + frame.box.h - 1 && p.cx < 30,
    )
    expect(below.length).toBeGreaterThan(0)
    expect(below.some((p) => p.t === 'pipe' && p.openTop)).toBe(false)
  })

  it('still leaves a stub of pipe between the gate above and that gap', () => {
    const l = laid('H 1\n010\nH 1')
    const gate = l.prims.find((p) => p.t === 'gatebox')
    const qubit = l.prims.filter((p) => p.t === 'qubit').sort((a, b) => a.cy - b.cy)[0]
    if (gate?.t !== 'gatebox' || qubit.t !== 'qubit') throw new Error('missing prims')
    const stub = l.prims
      .filter((p) => p.t === 'pipe' && Math.abs(p.cx - qubit.cx) < 0.5 && p.y0 >= gate.box.y)
      .map((p) => (p.t === 'pipe' ? p.y1 - p.y0 : 0))
    expect(Math.max(...stub)).toBeGreaterThan(8)
  })
})

describe('a window is a frame plumbed into the circuit', () => {
  const frames = (src: string) =>
    layoutCircuit(parseCircuit(src)).prims.filter((p) => p.t === 'gatebox' && p.label === '')

  it('draws a box around the state', () => {
    expect(frames('H 1\nwindow 010\nH 1')).toHaveLength(1)
  })

  it('draws no box for a bare view', () => {
    expect(frames('H 1\n010\nH 1')).toHaveLength(0)
  })

  const pane = (src: string) => layoutCircuit(parseCircuit(src)).prims.find((p) => p.t === 'pane')

  it('is never narrower than its columns, and sits square on them', () => {
    const [frame] = frames('H 1\nwindow 2-3 00\nH 1')
    const [gate] = layoutCircuit(parseCircuit('H 1\nbox "X" 2-3\nH 1')).prims.filter(
      (p) => p.t === 'gatebox' && p.label === 'X',
    )
    if (frame?.t !== 'gatebox' || gate?.t !== 'gatebox') throw new Error('missing prims')
    expect(frame.box.w).toBeGreaterThanOrEqual(gate.box.w)
    // Concentric with the gate that would cover the same wires, so the pipes
    // meet it exactly as they would meet that gate.
    expect(frame.box.x + frame.box.w / 2).toBeCloseTo(gate.box.x + gate.box.w / 2, 6)
  })

  it('grows to hold a state wider than its columns', () => {
    // A cloud over two wires is far wider than two wires.
    const [narrow] = frames('H 1\nwindow 2-3 00\nH 1')
    const [wide] = frames('H 1\nwindow 2-3 00|11\nH 1')
    if (narrow?.t !== 'gatebox' || wide?.t !== 'gatebox') throw new Error('missing prims')
    expect(wide.box.w).toBeGreaterThan(narrow.box.w)
    // Still concentric with the columns it covers, so the pipes meet it square.
    expect(wide.box.x + wide.box.w / 2).toBeCloseTo(narrow.box.x + narrow.box.w / 2, 6)
  })

  it('grows to hold a taller state too', () => {
    const [short] = frames('H 1\nwindow 010\nH 1')
    const [tall] = frames('H 1\nwindow 0(0|1)0\nH 1')
    if (short?.t !== 'gatebox' || tall?.t !== 'gatebox') throw new Error('missing prims')
    expect(tall.box.h).toBeGreaterThan(short.box.h)
  })

  it('sets a pane inside the frame, clear of every edge', () => {
    const [frame] = frames('H 1\nwindow 010\nH 1')
    const glass = pane('H 1\nwindow 010\nH 1')
    if (frame?.t !== 'gatebox' || glass?.t !== 'pane') throw new Error('missing prims')
    expect(glass.box.x).toBeGreaterThan(frame.box.x)
    expect(glass.box.y).toBeGreaterThan(frame.box.y)
    expect(glass.box.x + glass.box.w).toBeLessThan(frame.box.x + frame.box.w)
    expect(glass.box.y + glass.box.h).toBeLessThan(frame.box.y + frame.box.h)
  })

  it('holds the state inside the pane, not merely inside the frame', () => {
    const l = layoutCircuit(parseCircuit('H 1\nwindow 010\nH 1'))
    const glass = l.prims.find((p) => p.t === 'pane')
    const inside = l.prims.filter((p) => p.t === 'qubit' && p.cy > 60)
    if (glass?.t !== 'pane') throw new Error('missing prims')
    expect(inside.length).toBe(3)
    for (const q of inside) {
      if (q.t !== 'qubit') continue
      expect(q.cx - q.size / 2).toBeGreaterThanOrEqual(glass.box.x)
      expect(q.cx + q.size / 2).toBeLessThanOrEqual(glass.box.x + glass.box.w)
    }
  })

  it('glazes the pane rather than the frame, so the frame reads as a gate', () => {
    const [frame] = frames('H 1\nwindow 010\nH 1')
    const glass = pane('H 1\nwindow 010\nH 1')
    if (frame?.t !== 'gatebox' || glass?.t !== 'pane') throw new Error('missing prims')
    // The frame takes the ordinary gate treatment; only the pane is paper.
    expect(frame.fill).toBeUndefined()
    expect(frame.blank).toBeUndefined()
    expect(glass.fill).toBeUndefined()
  })

  it('lets a wire it overhangs but does not cover pass in front', () => {
    // The frame grows past column 1 to hold the cloud, but has nothing to do
    // with that wire — hiding it would read as the window taking it in.
    const { prims } = layoutCircuit(parseCircuit('H 1\nwindow 2-3 00|11\nH 1'))
    const frameAt = prims.findIndex((p) => p.t === 'gatebox' && p.label === '')
    const frame = prims[frameAt]
    if (frame?.t !== 'gatebox') throw new Error('missing prims')
    expect(frame.box.x).toBeLessThan(0) // it does overhang column 1

    const over = prims.findIndex(
      (p) =>
        p.t === 'pipe' &&
        Math.abs(p.cx) < 0.5 &&
        Math.abs(p.y0 - frame.box.y) < 0.01 &&
        Math.abs(p.y1 - (frame.box.y + frame.box.h)) < 0.01,
    )
    expect(over).toBeGreaterThan(frameAt)
  })

  it('draws nothing extra when the frame overhangs no one', () => {
    const { prims } = layoutCircuit(parseCircuit('H 1\nwindow 000\nH 1'))
    const frame = prims.find((p) => p.t === 'gatebox' && p.label === '')
    if (frame?.t !== 'gatebox') throw new Error('missing prims')
    const inside = prims.filter(
      (p) => p.t === 'pipe' && p.y0 >= frame.box.y && p.y1 <= frame.box.y + frame.box.h,
    )
    expect(inside).toHaveLength(0)
  })

  it('takes a fill colour, on the pane', () => {
    const glass = pane('H 1\nwindow 010 fill=#e3efe3\nH 1')
    if (glass?.t !== 'pane') throw new Error('missing prims')
    expect(glass.fill).toBe('#e3efe3')
  })

  it('rejects a fill on a bare view, which has nothing to fill', () => {
    expect(() => doc('H 1\nview 010 fill=red\nH 1')).toThrow(/needs a frame/)
  })

  it('rejects a colour it would have to render as black', () => {
    expect(() => doc('H 1\nwindow 010 fill=notacolour\nH 1')).toThrow(/is not a colour/)
  })
})

describe('showing a qubit where nothing is happening', () => {
  it('reads "I 2 0" as an identity that shows its value', () => {
    const [v] = views('H 1\nI 2 0\nH 1')
    expect(v.qubits).toEqual([2])
    expect(v.boxed).toBeUndefined()
  })

  it('leaves a plain "I 2" as a plain length of pipe', () => {
    expect(views('H 1\nI 2\nH 3')).toHaveLength(0)
  })

  it('puts a view and a held qubit in one layer', () => {
    const d = doc('H 1\nview 2-3 00|11; I 1 0\nH 1')
    const shared = d.layers.find((l) => l.gates.length === 2)
    expect(shared).toBeDefined()
    expect(shared!.gates.every((g) => g.kind === 'view')).toBe(true)
  })

  it('keeps two views in a layer from overlapping', () => {
    // The cloud over qubits 2–3 is far wider than two columns and would run
    // straight through the lone qubit beside it.
    const l = layoutCircuit(parseCircuit('H 1\nview 2-3 00|11; I 1 0\nH 1'))
    const cloud = l.prims.find((p) => p.t === 'cloud')
    const lone = l.prims
      .filter((p) => p.t === 'qubit')
      .find((p) => p.t === 'qubit' && p.size > 0 && p.cx < 30)
    if (cloud?.t !== 'cloud' || lone?.t !== 'qubit') throw new Error('missing prims')
    expect(lone.cx + lone.size / 2).toBeLessThanOrEqual(cloud.content.x)
  })

  it('still refuses two statements that want the same wire', () => {
    expect(() => doc('H 1\nview 1-2 00; I 1 0\nH 1')).toThrow(/overlap/)
  })
})

describe('captions', () => {
  it('draws a caption in the gutter, left of the circuit', () => {
    const laid = layoutCircuit(parseCircuit('H 1\nafter H: 0(0|1)0\nCNOT 1 -> 2'))
    const text = laid.prims.find((p) => p.t === 'text' && p.text === 'after H')
    expect(text).toBeDefined()
    if (text?.t === 'text') {
      expect(text.anchor).toBe('end')
      // Left of column 1, and inside the drawing's own bounds.
      expect(text.x).toBeLessThan(0)
      expect(laid.box.x).toBeLessThan(text.x)
    }
  })

  it('clears the row it labels without being shoved aside by another', () => {
    // A cloud is routinely wider than the wires it covers, so measuring from
    // the first column runs the caption through it — but measuring from the
    // whole drawing lets one wide state elsewhere push every caption away.
    const laid = layoutCircuit(
      resolveCalculations(parseCircuit('in 00|01|01|10\nI 1; measure 2 Z\ncalc'), {}),
    )
    const captions = laid.prims.filter((p) => p.t === 'text')
    expect(captions).toHaveLength(2)

    const clouds = laid.prims.filter((p) => p.t === 'cloud')
    /** Contents drawn in the same horizontal band as `cy`. */
    const beside = (cy: number) =>
      Math.min(
        ...clouds.flatMap((p) =>
          p.t === 'cloud' && p.content.y - 24 <= cy && cy <= p.content.y + p.content.h + 24
            ? [p.content.x]
            : [],
        ),
      )

    // The input is four two-qubit terms, far wider than either outcome row.
    const widest = Math.min(...clouds.map((p) => (p.t === 'cloud' ? p.content.x : 0)))

    for (const c of captions) {
      if (c.t !== 'text') continue
      // Right-aligned, so its own x is its right edge: clear of its own row…
      expect(c.x).toBeLessThanOrEqual(beside(c.cy))
      // …and not dragged out to clear the wide input cloud above it.
      expect(c.x).toBeGreaterThan(widest)
    }
  })

  it('leaves the state centred on its columns despite the caption', () => {
    const plain = qubitsAt('H 1\n010\nH 1').filter((q) => q.cy > 0).map((q) => q.cx)
    const noted = qubitsAt('H 1\nafter H: 010\nH 1').filter((q) => q.cy > 0).map((q) => q.cx)
    expect(noted).toEqual(plain)
  })

  it('captions an input or output state too', () => {
    const laid = layoutCircuit(parseCircuit('start: 000\nH 1\nend: 111'))
    const texts = laid.prims.filter((p) => p.t === 'text').map((p) => (p.t === 'text' ? p.text : ''))
    expect(texts).toContain('start')
    expect(texts).toContain('end')
  })
})

describe('it is still a circuit, and still tells you what went wrong', () => {
  it('renders in every theme', () => {
    for (const theme of ['solid', 'flat', 'isometric'] as const) {
      const { kind } = render('000\nH 1\n0(0|1)0\nCNOT 1 -> 2\n111', { theme })
      expect(kind, theme).toBe('circuit')
    }
  })

  it('still calls a bare state a state, not a circuit with one input', () => {
    expect(render('00|11').kind).toBe('state')
    expect(render('00|11\n0(0|1)').kind).toBe('state')
  })

  it('names an unknown gate rather than complaining about qubits', () => {
    expect(() => doc('H 1\nnonsense 2')).toThrow(/unknown gate "nonsense"/)
  })

  it('reports a bad state on a state line', () => {
    expect(() => doc('H 1\n0((0|1)\nH 1')).toThrow(/unclosed/)
  })
})
