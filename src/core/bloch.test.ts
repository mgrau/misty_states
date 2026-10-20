import { describe, expect, it } from 'vitest'
import { blochAt, blochOf, blochPath, layersAt, tintColour, type Vec3 } from './bloch'
import { simulateBranches } from './circuit/simulate'
import { LIGHT_PALETTE } from './render/theme'
import { parseCircuit } from './circuit/parse'
import { render } from './index'

const path = (src: string) => blochPath(parseCircuit(src))
const near = (v: Vec3) => v.map((x) => expect.closeTo(x, 9))

describe('the points', () => {
  it('puts white at the top and black at the bottom', () => {
    expect(path('in 0\nI 1').points[0]).toEqual(near([0, 0, 1]))
    expect(path('in 1\nI 1').points[0]).toEqual(near([0, 0, -1]))
  })

  it('puts the even superpositions round the equator', () => {
    expect(path('in 0\nH 1').points[1]).toEqual(near([1, 0, 0]))
    expect(path('in 1\nH 1').points[1]).toEqual(near([-1, 0, 0]))
    expect(path('in 0\nH 1\nS 1').points[2]).toEqual(near([0, 1, 0]))
  })

  it('starts from white when nothing is written', () => {
    expect(path('X 1').points).toEqual([near([0, 0, 1]), near([0, 0, -1])])
  })

  it('averages a measurement, which lands inside the sphere', () => {
    expect(path('in 0\nH 1\nmeasure 1 Z').points[2]).toEqual(near([0, 0, 0]))
    expect(path('in 0\nRY(60) 1\nmeasure 1 Z').points[2]).toEqual(near([0, 0, 0.5]))
  })
})

describe('the way between them', () => {
  const lands = (src: string) => {
    const p = path(src)
    p.moves.forEach((_, k) => {
      const v = blochAt(p, k + 1 - 1e-12)
      p.points[k + 1].forEach((x, i) => expect(v[i]).toBeCloseTo(x, 6))
    })
  }

  it('turns onto exactly the point the arithmetic gives, for every gate', () => {
    lands('in 0\nH 1\nS 1\nX 1\nY 1\nZ 1\nH 1')
    lands('in 0\nRX(30) 1\nRY(100) 1\nRZ(-70) 1\nP(45) 1\nRY(270) 1')
    lands('in 0|1\nY 1\nH 1\nmeasure 1 Z\nH 1')
  })

  it('goes round the sphere rather than through it', () => {
    // Half way through H from white is on the surface, between the pole and +x.
    const v = blochAt(path('in 0\nH 1'), 0.5)
    expect(Math.hypot(...v)).toBeCloseTo(1)
    expect(v[1]).not.toBeCloseTo(0)
  })

  it('takes a written angle the long way when that is what was written', () => {
    // RY(270) a third of the way is 90°, at +x; the short way would be at -x.
    expect(blochAt(path('in 0\nRY(270) 1'), 1 / 3)).toEqual(near([1, 0, 0]))
  })

  it('drops straight onto the axis while measuring', () => {
    expect(blochAt(path('in 0\nH 1\nmeasure 1 Z'), 1.5)).toEqual(near([0.5, 0, 0]))
  })
})

describe('the colours of the way', () => {
  it('names each layer by the gate that drew it', () => {
    expect(path('in 0\nH 1\nRY(30) 1\nX 1\nmeasure 1 Z\nI 1').tints).toEqual([
      'H', 'RY', 'accent', 'measure', null,
    ])
  })

  it('takes a colour written on the gate, as the drawing does', () => {
    expect(path('in 0\nH 1 fill=#00ff00').tints).toEqual(['#00ff00'])
    expect(tintColour('#00ff00', LIGHT_PALETTE)).toBe('#00ff00')
    expect(tintColour('H', LIGHT_PALETTE)).toBe(LIGHT_PALETTE.gateChip.H)
    expect(tintColour('accent', LIGHT_PALETTE)).toBe(LIGHT_PALETTE.accent)
  })
})

describe('working the path out', () => {
  it('in one run, landing where running to each layer in turn lands', () => {
    const src = 'in 0\nH 1\nRY(30) 1\nmeasure 1 Z\nH 1\nT 1'
    const doc = parseCircuit(src)
    blochPath(doc).points.forEach((p, k) => {
      const { branches } = simulateBranches(doc, k)
      const z = branches.reduce((sum, b) => {
        const n = [...b.amps.values()].reduce((t, a) => t + a.re ** 2 + a.im ** 2, 0)
        const w = (b.amps.get('0')?.re ?? 0) ** 2 + (b.amps.get('0')?.im ?? 0) ** 2
        const black = n - w
        return sum + (b.odds.n / b.odds.d) * ((w - black) / n)
      }, 0)
      expect(p[2], `layer ${k}`).toBeCloseTo(z)
    })
  })
})

describe('keeping time with an animation', () => {
  const spans = [{ from: 1, to: 2 }, undefined, { from: 3, to: 5 }]

  it('counts the layers done, and eases through the one at work', () => {
    expect(layersAt(spans, 0)).toBe(0)
    expect(layersAt(spans, 1.5)).toBeCloseTo(0.5)
    expect(layersAt(spans, 2.5)).toBe(2)
    expect(layersAt(spans, 4)).toBeCloseTo(2.5)
    expect(layersAt(spans, 9)).toBe(3)
  })
})

describe('keeping time with a real animation', () => {
  it('has finished every layer by the last step, which is where playing stops', () => {
    for (const src of [
      'in 0|1\nRZ(45) 1',
      'in 0\nH 1',
      'in 0|1\nH 1\nRZ(90) 1',
      'in 0\nX 1',
      'in 0\nRY(30) 1\nH 1\nS 1',
    ]) {
      const animation = render(`${src}\nanimate`).animation!
      const last = animation.steps[animation.steps.length - 1].t
      expect(layersAt(animation.spans, last), src).toBe(animation.spans.length)
    }
  })

  it('has finished each layer by its own last step, so stepping lands on the turned state', () => {
    const animation = render('in 0|1\nH 1\nRZ(90) 1\nanimate').animation!
    for (const [k] of animation.spans.entries()) {
      const mine = animation.steps.filter((st) => st.layer === k).map((st) => st.t)
      expect(layersAt(animation.spans, Math.max(...mine))).toBeGreaterThanOrEqual(k + 1)
    }
  })
})

describe('what it will not draw', () => {
  it('refuses more than one wire', () => {
    expect(() => blochOf('in 00\nH 1')).toThrow(/one qubit/)
  })

  it('refuses a bare state', () => {
    expect(() => blochOf('0|1')).toThrow(/circuit/)
  })

  it('follows a source with no input written', () => {
    expect(blochOf('0\nH 1\nmeasure 1 Z').points).toHaveLength(3)
  })
})
