/**
 * Saving an animation as something that plays outside a browser.
 *
 * The encoders themselves need a canvas and, for MP4, WebCodecs, so what is
 * tested here is the part that decides *what* gets encoded: the run of stills.
 * They come from the same timeline the CSS is generated from, which is the
 * whole reason a saved file and the drawing agree.
 */

import { describe, expect, it } from 'vitest'
import { render, renderFrames } from '../core/index'
import { canMakeMp4 } from './movie'
import { parseCircuit } from '../core/circuit/parse'
import { layoutCircuit } from '../core/circuit/layout'
import { buildTimeline, positionAt } from '../core/circuit/animate'

const SRC = 'in 11\nCNOT 1 -> 2\nanimate'

describe('sampling an animation', () => {
  it('covers the whole run, ending before it repeats', () => {
    const shot = renderFrames(SRC, { fps: 10 })
    expect(shot.frames).toHaveLength(Math.round(shot.duration * 10))
    expect(shot.frames[0].t).toBe(0)
    // The last frame is one step short of the end, so a loop closes on the
    // first rather than showing it twice. The step is the run divided by the
    // frame count, which rounding makes a little longer than 1/fps.
    const step = shot.duration / shot.frames.length
    expect(shot.frames.at(-1)!.t).toBeCloseTo(shot.duration - step, 6)
  })

  it('draws the same size as the moving picture', () => {
    // Laid out once, so a saved file cannot disagree with what was on screen.
    const shot = renderFrames(SRC)
    const moving = render(SRC)
    expect(shot.width).toBeCloseTo(moving.width, 6)
    expect(shot.height).toBeCloseTo(moving.height, 6)
  })

  it('gives stills, not the animation over again', () => {
    const shot = renderFrames(SRC, { fps: 8 })
    for (const frame of shot.frames) {
      expect(frame.svg).not.toContain('@keyframes')
      expect(frame.svg).not.toContain('NaN')
    }
  })

  it('actually moves between frames', () => {
    const shot = renderFrames(SRC, { fps: 8 })
    expect(new Set(shot.frames.map((f) => f.svg)).size).toBeGreaterThan(1)
  })

  it('samples a superposition as readily as a classical state', () => {
    const shot = renderFrames('in 0|1\nH 1\nanimate', { fps: 6 })
    expect(shot.frames.length).toBeGreaterThan(1)
    expect(new Set(shot.frames.map((f) => f.svg)).size).toBeGreaterThan(1)
  })

  it('carries whether it repeats, which a file has to be told', () => {
    expect(renderFrames(SRC).loop).toBe(false)
    expect(renderFrames(`${SRC} loop=on`).loop).toBe(true)
  })

  it('keeps the frame rate sensible whatever it is asked for', () => {
    expect(renderFrames(SRC, { fps: 0 }).fps).toBe(1)
    expect(renderFrames(SRC, { fps: 999 }).fps).toBe(60)
    // Left fractional on purpose: a GIF's expressible rates mostly are.
    expect(renderFrames(SRC, { fps: 100 / 3 }).fps).toBeCloseTo(33.333, 3)
  })

  it('samples enough frames to fill the run at any rate', () => {
    for (const fps of [10, 25, 100 / 3, 50, 60]) {
      const shot = renderFrames(SRC, { fps })
      expect(shot.frames.length, String(fps)).toBe(Math.round(shot.duration * fps))
    }
  })

  it('says so when there is nothing moving to save', () => {
    expect(() => renderFrames('in 11\nCNOT 1 -> 2')).toThrow(/does not animate/)
    expect(() => renderFrames('00|11')).toThrow()
  })

  it('honours the drawing options it is given', () => {
    const plain = renderFrames(SRC, { fps: 4 })
    const dark = renderFrames(SRC, { fps: 4, dark: true })
    expect(dark.frames[0].svg).not.toBe(plain.frames[0].svg)
    expect(renderFrames(SRC, { fps: 4, scale: 2 }).width).toBeCloseTo(plain.width * 2, 6)
  })
})

describe('how it moves', () => {
  it('eases into and out of every move', () => {
    // Constant speed that halts in one frame is what makes an animation look
    // jerky, and no frame rate fixes it. The step per frame should grow, peak,
    // and fall away again.
    const shot = renderFrames(SRC, { fps: 30 })
    const doc = parseCircuit(SRC)
    const timeline = buildTimeline(
      doc,
      layoutCircuit(doc, { bareEnds: true }).geometry,
      doc.animate,
    )
    const ys = shot.frames.map((f) => positionAt(timeline.tracks[0], f.t).y)
    const steps = ys.slice(1).map((y, i) => y - ys[i]).filter((d) => d > 0.001)

    expect(steps.length).toBeGreaterThan(8)
    expect(steps[0]).toBeLessThan(Math.max(...steps) / 2)
    expect(steps.at(-1)!).toBeLessThan(Math.max(...steps))
  })

  it('spends a fair share of the run actually moving', () => {
    // Darting between gates and then waiting about reads as a stutter.
    const doc = parseCircuit(SRC)
    const timeline = buildTimeline(
      doc,
      layoutCircuit(doc, { bareEnds: true }).geometry,
      doc.animate,
    )
    const stops = timeline.tracks[0].stops
    let moving = 0
    for (let i = 1; i < stops.length; i++) {
      if (stops[i].y !== stops[i - 1].y) moving += stops[i].t - stops[i - 1].t
    }
    expect(moving / timeline.duration).toBeGreaterThan(0.35)
  })
})

describe('what the browser can manage', () => {
  it('reports no video encoder where there is none', () => {
    // Node has no WebCodecs, so the menu must not offer MP4 there — and the
    // check has to be a feature test rather than a browser guess.
    expect(canMakeMp4()).toBe(false)
  })
})
