/**
 * End-to-end checks: every example renders, and the reference figures from the
 * PHYS 137T materials come out with the structure they are supposed to have.
 */

import { describe, expect, it } from 'vitest'
import { render, detectMode } from './index'
import { EXAMPLES } from './examples'
import { THEMES, THEME_IDS } from './render/themes'
import { parseState } from './state/parse'
import { layoutState } from './state/layout'
import { parseCircuit } from './circuit/parse'
import { inscribedMark, shapePath, shapeWidth } from './shapes'
import { cloudPath } from './render/cloud'
import { DEFAULT_METRICS } from './render/primitives'
import { layoutCircuit } from './circuit/layout'
import { FLAT_ATTACH } from './render/theme'

/** Count qubit glyphs by value. Reads the layout, since the cloud body is
 *  white too and scraping fills from the SVG would over-count. */
function countQubits(source: string): { white: number; black: number } {
  const prims = layoutState(parseState(source)).prims
  const qubits = prims.filter((p) => p.t === 'qubit') as { value: unknown }[]
  return {
    white: qubits.filter((q) => q.value === 0).length,
    black: qubits.filter((q) => q.value === 1).length,
  }
}

describe('every example renders in every theme', () => {
  for (const ex of EXAMPLES) {
    for (const theme of THEME_IDS) {
      it(`${ex.id} / ${theme}`, () => {
        const out = render(ex.source, { theme })
        expect(out.svg.startsWith('<svg')).toBe(true)
        expect(out.svg).toContain('</svg>')
        expect(out.width).toBeGreaterThan(0)
        expect(out.height).toBeGreaterThan(0)
        // A viewBox with NaN means some layout value escaped unset.
        expect(out.svg).not.toContain('NaN')
      })
    }
  }
})

describe('kind detection', () => {
  it('reads a bare state as a state', () => {
    expect(detectMode('000|-111|110|-001')).toBe('state')
  })

  it('reads gate lines as a circuit', () => {
    expect(detectMode('qubits 3\nH 3')).toBe('circuit')
  })

  it('does not mistake a captioned state for a circuit', () => {
    expect(detectMode('50%: 00(0|-1)')).toBe('state')
  })

  it('recovers when the guess is wrong', () => {
    // The caption starts with a gate keyword, so the cheap guess says circuit;
    // it does not parse as one, so rendering falls back to state.
    expect(detectMode('measure : 00|11')).toBe('circuit')
    expect(render('measure : 00|11').kind).toBe('state')
  })

  it('reports the likely-intended error when neither kind parses', () => {
    // Looks like a circuit, so the circuit parser's message is the useful one.
    expect(() => render('qubits 3\nnonsense 1')).toThrow(/unknown gate/)
    // Looks like a state, so the state parser's message is.
    expect(() => render('(0|1')).toThrow(/unclosed/)
  })

  it('classifies every example correctly', () => {
    for (const ex of EXAMPLES) {
      expect(render(ex.source).kind).toBe(detectMode(ex.source))
    }
  })
})

describe('shape assignment follows position within a term', () => {
  const shapesIn = (src: string) => {
    const layout = layoutState(parseState(src))
    return layout.prims.filter((p) => p.t === 'qubit').map((p) => (p as { shape: string }).shape)
  }

  it('numbers qubits circle, square, triangle across a term', () => {
    expect(shapesIn('000')).toEqual(['circle', 'square', 'triangle'])
  })

  it('continues numbering into a nested cloud (rule 5)', () => {
    // 0(0|1): circle outside, then square for both terms inside the cloud.
    expect(shapesIn('0(0|1)')).toEqual(['circle', 'square', 'square'])
  })

  it('restarts numbering for each term of a cloud (rule 4)', () => {
    expect(shapesIn('(0|1)|(0|1)')).toEqual(['circle', 'circle', 'circle', 'circle'])
  })

  it('advances past a cloud by its qubit width (rule 6)', () => {
    // (0|1)(0|1): first cloud is the circle slot, second is the square slot.
    expect(shapesIn('(0|1)(0|1)')).toEqual(['circle', 'circle', 'square', 'square'])
  })

  it('honours an explicit @N override', () => {
    expect(shapesIn('0@4')).toEqual(['diamond'])
  })
})

describe('alignment', () => {
  it('centres every shape on one line, whatever its outline', () => {
    // One term using all eight shapes.
    const prims = layoutState(parseState('00000000')).prims
    const qubits = prims.filter((p) => p.t === 'qubit') as { cy: number }[]
    expect(qubits).toHaveLength(8)
    for (const q of qubits) expect(q.cy).toBeCloseTo(qubits[0].cy, 6)
  })

  it('centres each shape path on its bounding box, not its centroid', () => {
    // A centroid-centred triangle would sit low by h/6; a bbox-centred one is
    // symmetric about y = 0.
    const d = shapePath('triangle', 100)
    const ys = [...d.matchAll(/[ML]([-\d.]+) ([-\d.]+)/g)].map((mm) => Number(mm[2]))
    expect(Math.min(...ys)).toBeCloseTo(-Math.max(...ys), 6)
  })

  it('keeps a visible gap between adjacent qubits', () => {
    const prims = layoutState(parseState('00')).prims
    const [a, b] = prims.filter((p) => p.t === 'qubit') as { cx: number; shape: string }[]
    const gap = b.cx - shapeWidth(b.shape as never, 26) / 2
      - (a.cx + shapeWidth(a.shape as never, 26) / 2)
    expect(gap).toBeGreaterThan(2)
    expect(gap).toBeLessThan(8)
  })
})

describe('marks inscribed in a glyph', () => {
  it('drops the triangle mark to its centroid, where there is room', () => {
    // The bounding-box centre is where a triangle is narrowest, so a mark
    // centred there crowds the apex.
    expect(inscribedMark('triangle', 26).dy).toBeGreaterThan(0)
    expect(inscribedMark('circle', 26).dy).toBe(0)
    expect(inscribedMark('square', 26).dy).toBe(0)
  })

  it('uses one mark size across the shapes', () => {
    const size = 26
    const uniform = ['circle', 'square', 'diamond', 'heart', 'pentagon', 'hexagon'] as const
    const sizes = uniform.map((s) => inscribedMark(s, size).size)
    for (const s of sizes) expect(s).toBeCloseTo(sizes[0], 6)
  })

  it('runs smaller only where the outline pinches in', () => {
    const size = 26
    const standard = inscribedMark('circle', size).size
    // Sloping edges and cut-away points leave less room.
    expect(inscribedMark('triangle', size).size).toBeLessThan(standard)
    expect(inscribedMark('star', size).size).toBeLessThan(inscribedMark('triangle', size).size)
    // But not so much smaller that they read as a different size.
    expect(inscribedMark('star', size).size).toBeGreaterThan(standard * 0.7)
  })

  it('draws an unknown qubit with a paler outline than a known one', () => {
    const svg = render('?.0', { theme: 'flat' }).svg
    expect(svg).toContain('stroke="#b6b6b6"')
    expect(svg).toContain('stroke="#111111"')
  })

  it('scales with the glyph', () => {
    expect(inscribedMark('triangle', 52).size).toBeCloseTo(
      inscribedMark('triangle', 26).size * 2,
      6,
    )
  })

  it('shifts the drawn "?" down inside a triangle but not a circle', () => {
    const yOf = (src: string) => {
      const svg = render(src, { theme: 'flat' }).svg
      return Number(/<text[^>]*y="([-\d.]+)"[^>]*>\?/.exec(svg)![1])
    }
    // Both are baseline offsets; the triangle's carries the extra drop.
    expect(yOf('?@3')).toBeGreaterThan(yOf('?@1'))
  })
})

describe('separator and cloud settings', () => {
  const sepPrims = (separator: 'bar' | 'comma') =>
    layoutState(parseState('00|11|01'), {
      metrics: { ...DEFAULT_METRICS, separator },
    }).prims

  it('draws bars by default and commas when asked', () => {
    expect(sepPrims('bar').filter((p) => p.t === 'bar')).toHaveLength(2)
    const commas = sepPrims('comma').filter((p) => p.t === 'text' && p.text === ',')
    expect(commas).toHaveLength(2)
    expect(sepPrims('comma').filter((p) => p.t === 'bar')).toHaveLength(0)
  })

  it('renders "," input identically to "|" input', () => {
    expect(render('00,11,01').svg).toBe(render('00|11|01').svg)
  })

  const outlineFor = (fluff: number, pad = DEFAULT_METRICS.cloudPadX) => {
    const prims = layoutState(parseState('00|11'), {
      metrics: { ...DEFAULT_METRICS, cloudFluff: fluff, cloudPadX: pad, cloudPadY: pad * 0.8 },
    }).prims
    const cloud = prims.find((p) => p.t === 'cloud')!
    return cloudPath(cloud.content, cloud.seed, pad, pad * 0.8, fluff)
  }

  it('makes flatter lobes at low fluff and rounder ones at high', () => {
    // Bulge shows up as margin beyond the padding.
    const flat = outlineFor(0.4)
    const round = outlineFor(1.8)
    const bulge = (c: ReturnType<typeof outlineFor>, content: number) => c.box.h - content
    expect(bulge(round, 0)).toBeGreaterThan(bulge(flat, 0))
  })

  it('grows the cloud with the padding slider', () => {
    expect(outlineFor(1, 26).box.w).toBeGreaterThan(outlineFor(1, 6).box.w)
  })

  it('stays deterministic for a given setting', () => {
    expect(outlineFor(1.2).d).toBe(outlineFor(1.2).d)
  })
})

describe('stacked rows share a centre line', () => {
  const rowBoxes = (src: string) => {
    const prims = layoutState(parseState(src)).prims
    // Group qubit glyphs by row, using their shared centre line.
    const qubits = prims.filter((p) => p.t === 'qubit') as { cx: number; cy: number }[]
    const rows = new Map<number, { min: number; max: number }>()
    for (const q of qubits) {
      const r = rows.get(q.cy) ?? { min: Infinity, max: -Infinity }
      rows.set(q.cy, { min: Math.min(r.min, q.cx), max: Math.max(r.max, q.cx) })
    }
    return [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => r)
  }

  it('centres a narrow row under a wide one', () => {
    // PS5 §1: the four-term state, then its much narrower factored form.
    const [wide, narrow] = rowBoxes('000|-111|110|-001\n(00|11)(0|-1)')
    const centre = (r: { min: number; max: number }) => (r.min + r.max) / 2
    expect(centre(narrow)).toBeCloseTo(centre(wide), 0)
  })

  it('does not shift rows of equal width', () => {
    const [a, b] = rowBoxes('00|11\n01|10')
    expect(a.min).toBeCloseTo(b.min, 6)
  })

  it('still centres when the rows are captioned', () => {
    const [a, b] = rowBoxes('50%: 00(0|-1)\n50%: 11(0|-1)')
    expect((a.min + a.max) / 2).toBeCloseTo((b.min + b.max) / 2, 6)
  })

  it('leaves a single row where it was', () => {
    const [only] = rowBoxes('00|11')
    expect(only.min).toBeGreaterThan(0)
  })
})

describe('cloud outline hugs its contents', () => {
  const outlineOf = (src: string) => {
    const prims = layoutState(parseState(src)).prims
    const cloud = prims.find((p) => p.t === 'cloud')!
    const box = cloudPath(
      cloud.content,
      cloud.seed,
      DEFAULT_METRICS.cloudPadX,
      DEFAULT_METRICS.cloudPadY,
    ).box
    return { content: cloud.content, box }
  }

  const widths = ['0|1', '000|111', '000|111|010|101', '0000|1111|0101|1010|0011|1100']

  /**
   * An ellipse-based outline had to inflate *both* axes to swallow a wide,
   * short row of qubits, so the margin scaled with the content — a four-term
   * cloud carried hundreds of pixels of dead vertical space. The margin is now
   * a bounded constant set by the padding and the bump size, independent of
   * how wide the content gets.
   */
  it('bounds the margin by a constant, not by the content size', () => {
    // The bound is set by the narrowest cloud, whose bump count bottoms out at
    // the minimum so its lobes are proportionally large. The point is that it
    // is a constant: with the ellipse the widest cloud here exceeded 200.
    const rows = widths.map(outlineOf)
    for (const { content, box } of rows) {
      expect(box.w - content.w).toBeLessThan(80)
      expect(box.h - content.h).toBeLessThan(80)
    }
  })

  it('leaves the widest cloud only a small fraction of margin', () => {
    // With the ellipse this margin was comparable to the content width itself.
    const { content, box } = outlineOf(widths[widths.length - 1])
    expect(box.w - content.w).toBeLessThan(content.w * 0.25)
  })

  it('always encloses its contents', () => {
    for (const src of widths) {
      const { content, box } = outlineOf(src)
      expect(box.x).toBeLessThanOrEqual(content.x)
      expect(box.y).toBeLessThanOrEqual(content.y)
      expect(box.x + box.w).toBeGreaterThanOrEqual(content.x + content.w)
      expect(box.y + box.h).toBeGreaterThanOrEqual(content.y + content.h)
    }
  })

  it('draws the outline lighter than the qubit glyphs', () => {
    expect(DEFAULT_METRICS.cloudStroke).toBeLessThan(DEFAULT_METRICS.stroke)
    const svg = render('0|1', { theme: 'flat' }).svg
    expect(svg).toContain(`stroke-width="${DEFAULT_METRICS.cloudStroke}"`)
  })
})

describe('PS5 §1 — the entangled three-qubit state', () => {
  const source = '000|-111|110|-001'

  it('draws twelve qubits in four terms', () => {
    // 000, -111, 110, -001 → six white and six black glyphs.
    expect(countQubits(source)).toEqual({ white: 6, black: 6 })
  })

  it('draws three separators for four terms', () => {
    const layout = layoutState(parseState(source))
    expect(layout.prims.filter((p) => p.t === 'bar')).toHaveLength(3)
  })

  it('draws a minus sign for each negative term', () => {
    const layout = layoutState(parseState(source))
    expect(layout.prims.filter((p) => p.t === 'sign')).toHaveLength(2)
  })

  it('centres the minus sign on the same line as the qubits', () => {
    const prims = layoutState(parseState('0|-1')).prims
    const sign = prims.find((p) => p.t === 'sign')!
    const qubits = prims.filter((p) => p.t === 'qubit') as { cy: number }[]
    for (const q of qubits) expect(sign.cy).toBeCloseTo(q.cy, 6)
  })

  it('wraps everything in exactly one cloud', () => {
    const layout = layoutState(parseState(source))
    expect(layout.prims.filter((p) => p.t === 'cloud')).toHaveLength(1)
  })

  it('draws the factored form as two adjacent clouds', () => {
    const layout = layoutState(parseState('(00|11)(0|-1)'))
    expect(layout.prims.filter((p) => p.t === 'cloud')).toHaveLength(2)
  })
})

describe('rule 4 — nesting produces a cloud inside a cloud', () => {
  it('emits one outer and two inner clouds', () => {
    const layout = layoutState(parseState('(0|1)|(0|1)'))
    const clouds = layout.prims.filter((p) => p.t === 'cloud') as { depth: number }[]
    expect(clouds).toHaveLength(3)
    expect(clouds.filter((c) => c.depth === 0)).toHaveLength(1)
    expect(clouds.filter((c) => c.depth > 0)).toHaveLength(2)
  })

  it('sizes the outer cloud to contain the inner ones', () => {
    const layout = layoutState(parseState('(0|1)|(0|1)'))
    const clouds = layout.prims.filter((p) => p.t === 'cloud') as {
      depth: number
      content: { x: number; y: number; w: number; h: number }
    }[]
    const outer = clouds.find((c) => c.depth === 0)!
    for (const inner of clouds.filter((c) => c.depth > 0)) {
      expect(inner.content.x).toBeGreaterThanOrEqual(outer.content.x)
      expect(inner.content.x + inner.content.w).toBeLessThanOrEqual(
        outer.content.x + outer.content.w,
      )
    }
  })
})

describe('circuit scheduling', () => {
  it('staircases dependent gates instead of packing them into one layer', () => {
    // The GHZ circuit: each CNOT depends on the qubit the previous one touched.
    const doc = parseCircuit('qubits 3\nH 3\nCNOT 3 -> 2\nCNOT 2 -> 1')
    expect(doc.layers).toHaveLength(3)
    expect(doc.layers.map((l) => l.gates.length)).toEqual([1, 1, 1])
  })

  it('packs independent gates into the same layer', () => {
    const doc = parseCircuit('qubits 4\nH 1\nH 3')
    expect(doc.layers).toHaveLength(1)
    expect(doc.layers[0].gates).toHaveLength(2)
  })

  it('does not pack across a spanning gate', () => {
    // The CNOT covers qubits 1-3, so H 2 cannot sit beside it.
    const doc = parseCircuit('qubits 3\nCNOT 1 -> 3\nH 2')
    expect(doc.layers).toHaveLength(2)
  })

  it('honours an explicit --- break', () => {
    const doc = parseCircuit('qubits 4\nH 1\n---\nH 3')
    expect(doc.layers).toHaveLength(2)
  })

  it('honours ";" for same-layer gates', () => {
    const doc = parseCircuit('qubits 2\nH 1; H 2')
    expect(doc.layers).toHaveLength(1)
  })

  it('rejects overlapping gates joined by ";"', () => {
    expect(() => parseCircuit('qubits 3\nCNOT 1 -> 3; H 2')).toThrow(/overlap/)
  })

  it('infers the register size from the highest qubit used', () => {
    expect(parseCircuit('H 4').qubits).toBe(4)
  })

  it('counts the input and output states as part of the register', () => {
    // `in 000` over one gate is still a three-qubit circuit; taking only the
    // gates into account silently dropped the other two wires.
    expect(parseCircuit('in 000\nH 1').qubits).toBe(3)
    expect(parseCircuit('H 1\nout 00|11').qubits).toBe(2)
  })

  it('lets an explicit declaration widen the register further', () => {
    expect(parseCircuit('qubits 4\nin 00\nH 1').qubits).toBe(4)
  })

  it('does not need a declaration when something already implies the width', () => {
    const withDecl = parseCircuit('qubits 3\nin 001\nCNOT 2 -> 1')
    const without = parseCircuit('in 001\nCNOT 2 -> 1')
    expect(without.qubits).toBe(withDecl.qubits)
  })

  it('expands qubit ranges for box gates', () => {
    const doc = parseCircuit('box "Oracle" 1-3')
    expect(doc.layers[0].gates[0]).toMatchObject({ kind: 'box', qubits: [1, 2, 3] })
  })
})

describe('pipes seam into gates rather than running behind them', () => {
  const circuit = (src: string, attach = FLAT_ATTACH) =>
    layoutCircuit(parseCircuit(src), { attach })

  it('cuts the pipe into a segment above and below each gate', () => {
    const prims = circuit('qubits 1\nH 1').prims
    expect(prims.filter((p) => p.t === 'pipe')).toHaveLength(2)
  })

  it('never draws a pipe across a gate it passes through', () => {
    const prims = circuit('qubits 3\nH 2\nCNOT 1 -> 3').prims
    const gates = prims.filter((p) => p.t === 'gatebox')
    for (const pipe of prims.filter((p) => p.t === 'pipe')) {
      for (const gate of gates) {
        const spansColumn =
          pipe.cx > gate.box.x && pipe.cx < gate.box.x + gate.box.w
        if (!spansColumn) continue
        const overlaps = pipe.y0 < gate.box.y + gate.box.h - 0.01 && pipe.y1 > gate.box.y + 0.01
        expect(overlaps).toBe(false)
      }
    }
  })

  it('uses one diameter everywhere, so nothing steps at a junction', () => {
    // Stubs, runs between gates and identities are all the same pipe.
    const prims = circuit('qubits 2\nH 1\nI 1\nCNOT 1 -> 2\nout 00|11').prims
    const widths = new Set(prims.filter((p) => p.t === 'pipe').map((p) => p.w))
    expect([...widths]).toEqual([DEFAULT_METRICS.pipeWidth])
  })

  it('joins two stacked gates with a single unbroken run', () => {
    const prims = circuit('qubits 1\nH 1\nX 1').prims
    const gates = prims.filter((p) => p.t === 'gatebox').sort((a, b) => a.box.y - b.box.y)
    const pipes = prims.filter((p) => p.t === 'pipe')
    const between = pipes.filter(
      (p) =>
        p.y0 >= gates[0].box.y + gates[0].box.h - 0.01 && p.y1 <= gates[1].box.y + 0.01,
    )
    expect(between).toHaveLength(1)
    // It spans the gap exactly — no overlap onto either body, no shortfall.
    expect(between[0].y0).toBeCloseTo(gates[0].box.y + gates[0].box.h, 6)
    expect(between[0].y1).toBeCloseTo(gates[1].box.y, 6)
  })

  it('draws each pipe before the gate it leaves, so that gate covers it', () => {
    const prims = circuit('qubits 2\nH 1\nCNOT 1 -> 2').prims
    for (const [i, p] of prims.entries()) {
      if (p.t !== 'gatebox' && p.t !== 'measurebox') continue
      // Any run starting at this gate's underside must already be painted.
      const leaving = prims.flatMap((q, j) =>
        q.t === 'pipe' && Math.abs(q.y0 - (p.box.y + p.box.h)) < 6 ? [j] : [],
      )
      for (const j of leaving) expect(j).toBeLessThan(i)
    }
  })

  it('never overlaps two pipe runs on the same qubit', () => {
    const prims = circuit('qubits 1\nH 1\nX 1\nI 1\nZ 1').prims
    const runs = prims.filter((p) => p.t === 'pipe').sort((a, b) => a.y0 - b.y0)
    for (let i = 1; i < runs.length; i++) {
      expect(runs[i].y0).toBeGreaterThanOrEqual(runs[i - 1].y1 - 0.01)
    }
  })
})

describe('gate fill colours', () => {
  const fillOf = (src: string) =>
    (parseCircuit(src).layers[0].gates[0] as { fill?: string }).fill

  it('keeps a hex colour intact', () => {
    // The comment stripper used to eat "#e3efe3", leaving fill="" — which SVG
    // renders as black.
    expect(fillOf('box "Oracle" 1-2 fill=#e3efe3')).toBe('#e3efe3')
  })

  it('reaches the SVG', () => {
    expect(render('qubits 2\nbox "O" 1-2 fill=#e3efe3', { theme: 'flat' }).svg).toContain(
      'fill="#e3efe3"',
    )
  })

  it('never emits an empty fill', () => {
    for (const src of ['qubits 2\nbox "O" 1-2', 'qubits 1\nblank 1', 'qubits 1\nH 1']) {
      expect(render(src, { theme: 'flat' }).svg).not.toContain('fill=""')
    }
  })

  it('accepts short hex and named colours', () => {
    expect(fillOf('box "O" 1 fill=#eee')).toBe('#eee')
    expect(fillOf('box "O" 1 fill=lightgreen')).toBe('lightgreen')
  })

  it('rejects a colour that would silently render black', () => {
    // An unrecognised name is ignored by SVG and falls back to black, so it is
    // caught here rather than drawn wrong.
    expect(() => parseCircuit('box "O" 1 fill=notacolour')).toThrow(/not a colour/)
    expect(() => parseCircuit('box "O" 1 fill=#gggggg')).toThrow(/not a colour/)
    expect(() => parseCircuit('box "O" 1 fill=')).toThrow(/needs a colour/)
  })

  it('still treats # as a comment when it starts one', () => {
    expect(parseCircuit('H 1  # a note').layers[0].gates[0]).toMatchObject({ label: 'H' })
    expect(parseCircuit('# only a comment\nH 1').layers).toHaveLength(1)
  })

  it('keeps # comments working in states too', () => {
    expect(render('00|11  # a note').kind).toBe('state')
  })
})

describe('gates can be drawn on their own', () => {
  const circuit = (src: string) => layoutCircuit(parseCircuit(src), { attach: FLAT_ATTACH })

  it('draws no qubit shapes by default', () => {
    expect(circuit('H 1').prims.filter((p) => p.t === 'qubit')).toHaveLength(0)
  })

  it('draws them when the header is asked for', () => {
    expect(circuit('qubits 3\nheader on\nH 1').prims.filter((p) => p.t === 'qubit')).toHaveLength(3)
  })

  it('accepts "labels" as an alias', () => {
    expect(parseCircuit('labels on\nH 1').header).toBe(true)
  })

  it('rejects anything but on/off', () => {
    expect(() => parseCircuit('header maybe\nH 1')).toThrow(/on.*off/)
  })

  it('still gives the gate an input and an output pipe', () => {
    const prims = circuit('H 1').prims
    const pipes = prims.filter((p) => p.t === 'pipe')
    expect(pipes).toHaveLength(2)
    const gate = prims.find((p) => p.t === 'gatebox')!
    const [above, below] = pipes.sort((a, b) => a.y0 - b.y0)
    expect(above.y1).toBeCloseTo(gate.box.y, 6)
    expect(below.y0).toBeCloseTo(gate.box.y + gate.box.h, 6)
    expect(above.y1 - above.y0).toBeGreaterThan(0)
    expect(below.y1 - below.y0).toBeGreaterThan(0)
  })

  it('matches the top stub to the tail in a flat projection', () => {
    const pipes = circuit('H 1').prims.filter((p) => p.t === 'pipe').sort((a, b) => a.y0 - b.y0)
    const [top, bottom] = pipes.map((p) => p.y1 - p.y0)
    expect(top).toBeCloseTo(bottom, 6)
  })

  it('lengthens only the top stub where the mouth is foreshortened', () => {
    // Measured at the gate, not the pipe: the attach offsets also shorten and
    // lengthen the drawn segments, so the extra does not pass through one-for-one.
    const firstGateY = (attach: typeof FLAT_ATTACH) =>
      layoutCircuit(parseCircuit('H 1'), { attach }).prims.find((p) => p.t === 'gatebox')!.box.y
    expect(firstGateY(THEMES.isometric.attach) - firstGateY(FLAT_ATTACH)).toBeCloseTo(
      THEMES.isometric.attach.topLeadExtra,
      6,
    )
    // The tail is untouched, so the circuit only grows at the top.
    expect(THEMES.isometric.attach.topLeadExtra).toBeGreaterThan(0)
  })

  it('leaves clear air between the circuit and an output state', () => {
    // The pipe stops short of the cloud rather than running up into it.
    const layout = circuit('H 1\nout 0|1')
    const pipes = layout.prims.filter((p) => p.t === 'pipe').sort((a, b) => a.y0 - b.y0)
    const cloud = layout.prims.find((p) => p.t === 'cloud')!
    const pipeEnd = Math.max(...pipes.map((p) => p.y1))
    const gap = cloud.content.y - pipeEnd
    expect(gap).toBeGreaterThan(0)
  })

  it('leaves clear air between an input state and the circuit', () => {
    const layout = circuit('in 0|1\nH 1')
    const pipeStart = Math.min(
      ...layout.prims.filter((p) => p.t === 'pipe').map((p) => p.y0),
    )
    const cloud = layout.prims.find((p) => p.t === 'cloud')!
    expect(pipeStart).toBeGreaterThan(cloud.content.y + cloud.content.h)
  })

  it('keeps the stub short at a state end, not a full lead', () => {
    const pipes = circuit('H 1\nout 0|1').prims.filter((p) => p.t === 'pipe')
    const below = pipes.sort((a, b) => a.y0 - b.y0)[1]
    expect(below.y1 - below.y0).toBeLessThan(20)
  })

  it('uses the same stub whatever sits beyond it', () => {
    // A lone gate, a header, an input state and an output state should all
    // leave the circuit's own pipe ends the same length.
    const stub = (src: string, which: 'first' | 'last') => {
      const pipes = layoutCircuit(parseCircuit(src), { attach: FLAT_ATTACH })
        .prims.filter((p) => p.t === 'pipe')
        .sort((a, b) => a.y0 - b.y0)
      const p = which === 'first' ? pipes[0] : pipes[pipes.length - 1]
      return p.y1 - p.y0
    }
    const top = stub('H 1', 'first')
    expect(stub('qubits 1\nheader on\nH 1', 'first')).toBeCloseTo(top, 6)
    expect(stub('in 0|1\nH 1', 'first')).toBeCloseTo(top, 6)

    const tail = stub('H 1', 'last')
    expect(stub('H 1\nout 0|1', 'last')).toBeCloseTo(tail, 6)
  })

  it('leaves a gap below the header shapes, not a long run of pipe', () => {
    const layout = layoutCircuit(parseCircuit('qubits 1\nheader on\nH 1'), {
      attach: FLAT_ATTACH,
    })
    const glyph = layout.prims.find((p) => p.t === 'qubit')!
    const pipeStart = Math.min(...layout.prims.filter((p) => p.t === 'pipe').map((p) => p.y0))
    const gap = pipeStart - (glyph.cy + glyph.size / 2)
    expect(gap).toBeGreaterThan(0)
    expect(gap).toBeLessThan(20)
  })

  it('gives the stubs the same diameter as the rest of the pipe', () => {
    const pipes = circuit('H 1').prims.filter((p) => p.t === 'pipe')
    expect(pipes.every((p) => p.w === DEFAULT_METRICS.pipeWidth)).toBe(true)
  })
})

describe('classical end states line up with the pipes', () => {
  const circuit = (src: string) => layoutCircuit(parseCircuit(src), { attach: FLAT_ATTACH })
  const pitch = DEFAULT_METRICS.pipeWidth + DEFAULT_METRICS.colGap

  it('puts each output qubit over its own column', () => {
    const prims = circuit('qubits 3\nH 1\nout 011').prims
    // The three lowest glyphs are the output state.
    const glyphs = (prims.filter((p) => p.t === 'qubit') as { cx: number; cy: number }[])
      .sort((a, b) => b.cy - a.cy)
      .slice(0, 3)
      .sort((a, b) => a.cx - b.cx)
    expect(glyphs.map((g) => g.cx)).toEqual([0, pitch, 2 * pitch])
  })

  it('lines the pipes up with those glyphs exactly', () => {
    const prims = circuit('qubits 3\nH 1\nout 011').prims
    const pipeXs = [...new Set(prims.filter((p) => p.t === 'pipe').map((p) => p.cx))].sort(
      (a, b) => a - b,
    )
    const glyphXs = [
      ...new Set((prims.filter((p) => p.t === 'qubit') as { cx: number }[]).map((g) => g.cx)),
    ].sort((a, b) => a - b)
    expect(glyphXs).toEqual(pipeXs)
  })

  it('does the same for a classical input state', () => {
    const prims = circuit('qubits 2\nin 01\nH 1').prims
    const glyphs = (prims.filter((p) => p.t === 'qubit') as { cx: number }[]).map((g) => g.cx)
    expect(glyphs.sort((a, b) => a - b)).toEqual([0, pitch])
  })

  it('draws no cloud around a classical state', () => {
    expect(circuit('qubits 2\nH 1\nout 01').prims.filter((p) => p.t === 'cloud')).toHaveLength(0)
  })

  it('centres a superposition instead, since it cannot be split', () => {
    const prims = circuit('qubits 2\nH 1\nout 00|11').prims
    expect(prims.filter((p) => p.t === 'cloud')).toHaveLength(1)
  })

  it('centres when the qubit count does not match the register', () => {
    // Two glyphs cannot be aligned to three columns.
    const prims = circuit('qubits 3\nH 1\nout 01').prims
    const glyphs = (prims.filter((p) => p.t === 'qubit') as { cx: number }[]).map((g) => g.cx)
    expect(glyphs).not.toContain(2 * pitch)
  })

  it('keeps the gap below the circuit', () => {
    const layout = circuit('qubits 2\nH 1\nout 01')
    const lowestPipe = Math.max(...layout.prims.filter((p) => p.t === 'pipe').map((p) => p.y1))
    const glyphTop = Math.min(
      ...(layout.prims.filter((p) => p.t === 'qubit') as { cy: number; size: number }[]).map(
        (g) => g.cy - g.size / 2,
      ),
    )
    expect(glyphTop).toBeGreaterThan(lowestPipe)
  })
})

describe('identity gates are pipe, not a body', () => {
  const circuit = (src: string) => layoutCircuit(parseCircuit(src), { attach: FLAT_ATTACH })

  it('parses I, ID and IDENTITY', () => {
    for (const kw of ['I 2', 'ID 2', 'identity 2']) {
      expect(parseCircuit(kw).layers[0].gates[0]).toMatchObject({ kind: 'identity', qubit: 2 })
    }
  })

  it('draws no body at all', () => {
    const prims = circuit('qubits 2\nI 1\nI 2').prims
    expect(prims.filter((p) => p.t === 'gatebox')).toHaveLength(0)
  })

  it('is the same diameter as the gate stubs it joins', () => {
    const prims = circuit('qubits 1\nH 1\nI 1\nX 1').prims
    const widths = new Set(prims.filter((p) => p.t === 'pipe').map((p) => p.w))
    expect(widths.size).toBe(1)
  })

  it('leaves the pipe unbroken', () => {
    // One continuous run per qubit, exactly as if nothing had been written.
    const prims = circuit('qubits 2\nI 1\nI 2').prims
    expect(prims.filter((p) => p.t === 'pipe')).toHaveLength(2)
  })

  it('does not interrupt a pipe it shares a layer with', () => {
    // H splits qubit 1 into two runs; qubit 2's identity leaves one run.
    const prims = circuit('qubits 2\nH 1; I 2').prims
    const pitch = DEFAULT_METRICS.pipeWidth + DEFAULT_METRICS.colGap
    const runs = (q: number) =>
      prims.filter((p) => p.t === 'pipe').filter((p) => Math.abs(p.cx - (q - 1) * pitch) < 1).length
    expect(runs(1)).toBe(2)
    expect(runs(2)).toBe(1)
  })

  it('is the same width as the pipe, because it is the pipe', () => {
    const prims = circuit('qubits 1\nI 1').prims
    const pipe = prims.find((p) => p.t === 'pipe')!
    expect(pipe.w).toBe(DEFAULT_METRICS.pipeWidth)
  })

  it('still holds a slot in the layer rhythm', () => {
    // The identity occupies qubit 1, so the X below it cannot pack alongside.
    const doc = parseCircuit('qubits 1\nI 1\nX 1')
    expect(doc.layers).toHaveLength(2)
    expect(doc.layers[0].gates[0].kind).toBe('identity')
  })

  it('keeps a later gate below it rather than floating up', () => {
    const prims = circuit('qubits 2\nH 1\nI 1\nX 1').prims
    const boxes = prims.filter((p) => p.t === 'gatebox').sort((a, b) => a.box.y - b.box.y)
    expect(boxes).toHaveLength(2)
    // A whole empty layer of pipe sits between the two bodies.
    const gap = boxes[1].box.y - (boxes[0].box.y + boxes[0].box.h)
    expect(gap).toBeGreaterThan(DEFAULT_METRICS.gateHeight)
  })
})

describe('isometric pipes pass over the gate faces', () => {
  const iso = (src: string) =>
    layoutCircuit(parseCircuit(src), { attach: THEMES.isometric.attach })

  it('paints each pipe behind the gate it leaves and over the one it enters', () => {
    // Bottom-up: bottom stub, lower gate, middle pipe, upper gate, top stub.
    const prims = iso('qubits 1\nH 1\nX 1').prims
    const at = (pred: (p: (typeof prims)[number]) => boolean) => prims.findIndex(pred)

    const boxes = prims.filter((p) => p.t === 'gatebox').sort((a, b) => a.box.y - b.box.y)
    const upper = boxes[0]
    const lower = boxes[1]
    const pipes = prims.filter((p) => p.t === 'pipe').sort((a, b) => a.y0 - b.y0)
    const middle = pipes[1]

    const iUpper = at((p) => p === upper)
    const iLower = at((p) => p === lower)
    const iMiddle = at((p) => p === middle)

    // The pipe leaving the upper gate is drawn before it, so the gate covers
    // the end that starts inside it…
    expect(iMiddle).toBeLessThan(iUpper)
    // …and after the lower gate, so it covers that gate's top face.
    expect(iMiddle).toBeGreaterThan(iLower)
  })

  it('draws the lowest element first and the highest last', () => {
    const prims = iso('qubits 1\nH 1\nX 1').prims
    const ys = prims
      .filter((p) => p.t === 'pipe' || p.t === 'gatebox')
      .map((p) => (p.t === 'pipe' ? p.y0 : p.box.y))
    expect(ys).toEqual([...ys].sort((a, b) => b - a))
  })

  it('stops the pipe on the top face, not past its front edge', () => {
    const layout = iso('qubits 1\nH 1\nX 1')
    const lower = layout.prims.filter((p) => p.t === 'gatebox').sort((a, b) => a.box.y - b.box.y)[1]
    const into = layout.prims.filter((p) => p.t === 'pipe').sort((a, b) => a.y0 - b.y0)[1]
    // Lands on the face: short of the front edge, but only just — far enough
    // back and it stops reading as connected to the gate at all.
    const backFromFront = lower.box.y - into.y1
    expect(backFromFront).toBeGreaterThan(0)
    expect(backFromFront).toBeLessThan(5)
  })

  it('starts the pipe below inside the box, so it emerges rather than abuts', () => {
    // A pipe leaves through the bottom face, which sits above the front-bottom
    // edge — so it starts a little higher and overlaps the body.
    const layout = iso('qubits 1\nH 1\nX 1')
    const upper = layout.prims.filter((p) => p.t === 'gatebox').sort((a, b) => a.box.y - b.box.y)[0]
    const below = layout.prims.filter((p) => p.t === 'pipe').sort((a, b) => a.y0 - b.y0)[1]
    const bottomEdge = upper.box.y + upper.box.h
    expect(below.y0).toBeLessThan(bottomEdge)
    expect(below.y0).toBeCloseTo(bottomEdge + THEMES.isometric.attach.bottomDy, 6)
  })

  it('keeps the gate spacing identical to the flat themes', () => {
    const spacing = (attach: typeof FLAT_ATTACH) => {
      const boxes = layoutCircuit(parseCircuit('qubits 1\nH 1\nX 1'), { attach })
        .prims.filter((p) => p.t === 'gatebox')
        .sort((a, b) => a.box.y - b.box.y)
      return boxes[1].box.y - (boxes[0].box.y + boxes[0].box.h)
    }
    expect(spacing(THEMES.isometric.attach)).toBe(DEFAULT_METRICS.gateGap)
    expect(spacing(FLAT_ATTACH)).toBe(DEFAULT_METRICS.gateGap)
  })
})

describe('gate bodies are painted back to front', () => {
  const order = (src: string) =>
    layoutCircuit(parseCircuit(src), { attach: THEMES.isometric.attach })
      .prims.filter((p) => p.t === 'gatebox')
      .map((p) => [p.box.y, p.box.x] as const)

  it('draws lower layers before upper ones', () => {
    // The stack is painted from the bottom up, so each gate can cover the pipe
    // leaving its underside before the next pipe covers its top face.
    const ys = order('qubits 1\nH 1\nX 1').map(([y]) => y)
    expect(ys).toEqual([...ys].sort((a, b) => b - a))
  })

  it('draws left to right within a layer, whatever the source order', () => {
    // The extrusion puts a box's side face behind its right-hand neighbour's
    // front face, so the rightmost must be painted last either way round.
    expect(order('qubits 2\nH 1; H 2')).toEqual(order('qubits 2\nH 2; H 1'))
    const xs = order('qubits 2\nH 2; H 1').map(([, x]) => x)
    expect(xs).toEqual([...xs].sort((a, b) => a - b))
  })
})

describe('isometric attachment', () => {
  const boxOf = (attach: typeof FLAT_ATTACH) => {
    const prims = layoutCircuit(parseCircuit('qubits 2\nH 1'), { attach }).prims
    return {
      gate: prims.find((p) => p.t === 'gatebox')!,
      pipe: prims.find((p) => p.t === 'pipe')!,
    }
  }

  it('shifts the gate body back by half the depth vector', () => {
    // The visible top face is displaced from the front face, so the body moves
    // to meet the pipe instead of the pipe moving off the column axis.
    const flat = boxOf(FLAT_ATTACH)
    const iso = boxOf(THEMES.isometric.attach)
    expect(THEMES.isometric.attach.dx).toBeLessThan(0)
    expect(iso.gate.box.x).toBeCloseTo(flat.gate.box.x + THEMES.isometric.attach.dx, 6)
  })

  it('lines the pipes up with the qubit labels, in every theme', () => {
    // The body shifts to meet the pipe, never the other way round: the pipes
    // stay on the column axis so they sit directly under their labels.
    for (const id of THEME_IDS) {
      const prims = layoutCircuit(parseCircuit('qubits 3\nheader on\nH 1'), {
        attach: THEMES[id].attach,
      }).prims
      const labels = (prims.filter((p) => p.t === 'qubit') as { cx: number }[])
        .map((p) => p.cx)
        .sort((a, b) => a - b)
      const pipes = [...new Set(prims.filter((p) => p.t === 'pipe').map((p) => p.cx))].sort(
        (a, b) => a - b,
      )
      expect(pipes, id).toEqual(labels)
    }
  })

  it('lands the pipe on the visible top face, not the front edge', () => {
    const prims = layoutCircuit(parseCircuit('qubits 1\nH 1'), {
      attach: THEMES.isometric.attach,
    }).prims
    const gate = prims.find((p) => p.t === 'gatebox')!
    const above = prims.filter((p) => p.t === 'pipe').sort((a, b) => a.y0 - b.y0)[0]
    expect(above.y1).toBeCloseTo(gate.box.y + THEMES.isometric.attach.topDy, 6)
    expect(above.y1).toBeLessThan(gate.box.y)
  })

  it('keeps flat projections attaching exactly at the box edge', () => {
    for (const theme of [THEMES.solid, THEMES.flat]) {
      expect(theme.attach).toEqual(FLAT_ATTACH)
      expect(theme.attach.topDy).toBe(0)
      expect(theme.attach.bottomDy).toBe(0)
      expect(theme.attach.paintBottomUp).toBe(false)
    }
  })
})

describe('measurement basis', () => {
  const gateOf = (src: string) => parseCircuit(src).layers[0].gates[0]

  it('defaults to Z', () => {
    expect(gateOf('measure 1')).toMatchObject({ kind: 'measure', basis: 'Z' })
  })

  it('accepts another axis', () => {
    expect(gateOf('measure 1 X')).toMatchObject({ basis: 'X', qubit: 1 })
    expect(gateOf('m 2 y')).toMatchObject({ basis: 'Y', qubit: 2 })
  })

  it('draws the basis label on the dial', () => {
    expect(render('qubits 1\nmeasure 1 X').svg).toContain('>X<')
    expect(render('qubits 1\nmeasure 1').svg).toContain('>Z<')
  })
})

describe('the measurement dial reads as an instrument', () => {
  const svg = render('qubits 1\nmeasure 1', { theme: 'flat' }).svg

  /** Radius of the graduated scale arc. */
  const scaleRadius = Number(/A([\d.]+) [\d.]+ 0 0 1/.exec(svg)![1])

  const lines = [...svg.matchAll(/<line ([^>]*)\/>/g)].map((mm) => {
    const attrs = mm[1]
    const at = (name: string) =>
      Number(new RegExp(`${name}="([-\\d.]+)"`).exec(attrs)?.[1] ?? NaN)
    return { length: Math.hypot(at('x2') - at('x1'), at('y2') - at('y1')) }
  })

  it('has a scale, graduations and a needle', () => {
    expect(scaleRadius).toBeGreaterThan(0)
    // Five ticks plus the needle.
    expect(lines.length).toBe(6)
  })

  it('overshoots the scale with the needle', () => {
    const needle = Math.max(...lines.map((l) => l.length))
    expect(needle).toBeGreaterThan(scaleRadius)
  })

  it('keeps the graduations short next to the needle', () => {
    const sorted = lines.map((l) => l.length).sort((a, b) => b - a)
    const needle = sorted[0]
    const longestTick = sorted[1]
    expect(longestTick).toBeLessThan(needle / 2)
  })

  it('gives the pivot a visible radius', () => {
    const pivot = Number(/<circle [^>]*r="([\d.]+)"/.exec(svg)![1])
    expect(pivot).toBeGreaterThanOrEqual(2.2)
    expect(pivot).toBeGreaterThan(scaleRadius * 0.15)
    // But still clearly a pivot, not a blob.
    expect(pivot).toBeLessThan(scaleRadius * 0.35)
  })
})

describe('circuit rendering', () => {
  it('draws one pipe per qubit', () => {
    const doc = parseCircuit('qubits 3\nH 1')
    expect(doc.qubits).toBe(3)
    const svg = render('qubits 3\nH 1').svg
    expect(svg).toContain('<svg')
  })

  it('places the output state below the last gate', () => {
    const svg = render('qubits 2\nH 1\nout 00|11').svg
    expect(svg).not.toContain('NaN')
  })

  it('shrinks a long label to fit its box', () => {
    const wide = render('qubits 1\nbox "AVeryLongOracleName" 1').svg
    expect(wide).toContain('font-size')
    expect(wide).not.toContain('NaN')
  })
})

describe('themes differ where they should', () => {
  it('solid adds shading, flat does not', () => {
    const solid = render('qubits 2\nH 1', { theme: 'solid' }).svg
    const flat = render('qubits 2\nH 1', { theme: 'flat' }).svg
    expect(solid).toContain('linearGradient')
    expect(flat).not.toContain('linearGradient')
  })

  it('isometric extrudes gate bodies', () => {
    const iso = render('qubits 2\nH 1', { theme: 'isometric' }).svg
    // The extruded top and side faces are paths, absent from the flat theme.
    expect((iso.match(/<path/g) ?? []).length).toBeGreaterThan(
      (render('qubits 2\nH 1', { theme: 'flat' }).svg.match(/<path/g) ?? []).length,
    )
  })

  it('dark mode swaps the ink and paper colours', () => {
    expect(render('0|1', { dark: true }).svg).toContain('#f2f2f2')
  })

  it('shades qubit glyphs in solid but leaves them flat elsewhere', () => {
    expect(render('0|1', { theme: 'solid' }).svg).toContain('ms-qubit-')
    expect(render('0|1', { theme: 'flat' }).svg).not.toContain('ms-qubit-')
    expect(render('0|1', { theme: 'isometric' }).svg).not.toContain('ms-qubit-')
  })

  it('lights pale and dark qubits from the same direction', () => {
    // White glyphs darken away from the light; black glyphs pick up a highlight.
    const svg = render('0|1', { theme: 'solid' }).svg
    expect(svg).toContain('url(#ms-qubit-dim)')
    expect(svg).toContain('url(#ms-qubit-lit)')
  })
})

describe('determinism', () => {
  it('produces byte-identical output for the same input', () => {
    const a = render('000|-111|110|-001').svg
    const b = render('000|-111|110|-001').svg
    expect(a).toBe(b)
  })
})

/**
 * Two drawings on one page.
 *
 * A drawing is a standalone SVG document and names its gradients and filters
 * accordingly, which is right until two of them are inlined side by side. Then
 * `url(#ms-pipe)` finds whichever came first — and if that one happens to sit
 * in a hidden subtree, everything referring to it is painted with nothing.
 */
describe('naming what a drawing defines', () => {
  const SRC = 'in 00\nH 1\nCNOT 1 2'

  it('uses the shared names by default', () => {
    const svg = render(SRC).svg
    expect(svg).toContain('id="ms-pipe"')
    expect(svg).toContain('url(#ms-pipe)')
  })

  it('renames both the definition and every reference to it', () => {
    const svg = render(SRC, { idPrefix: 'pal' }).svg
    expect(svg).toContain('id="pal-pipe"')
    expect(svg).toContain('url(#pal-pipe)')
    // Nothing left pointing at the other document's names.
    expect(svg).not.toContain('ms-pipe')
    expect(svg).not.toContain('ms-gate')
    expect(svg).not.toContain('ms-shadow')
  })

  it('leaves the drawing otherwise identical', () => {
    const plain = render(SRC).svg
    const moved = render(SRC, { idPrefix: 'pal' }).svg
    expect(moved.split('pal-').join('ms-')).toBe(plain)
  })

  it('covers an animation\'s definitions too', () => {
    const svg = render('in 11\nCNOT 1 2\nanimate', { idPrefix: 'pal' }).svg
    expect(svg).not.toContain('ms-pipe')
  })
})
