// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { MistyStates } from './api'
import { render } from './index'

const BASE = 'https://x.test/app/'

describe('rendering', () => {
  it('returns SVG markup', () => {
    const svg = MistyStates.svg('000|-111|110|-001')
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg.endsWith('</svg>')).toBe(true)
  })

  it('matches the internal renderer exactly', () => {
    expect(MistyStates.svg('00|11', { theme: 'flat' })).toBe(
      render('00|11', { theme: 'flat' }).svg,
    )
  })

  it('exposes size and detected kind through render()', () => {
    const out = MistyStates.render('qubits 2\nH 1')
    expect(out.kind).toBe('circuit')
    expect(out.width).toBeGreaterThan(0)
    expect(out.height).toBeGreaterThan(0)
  })

  it('honours render options', () => {
    expect(MistyStates.svg('0|1', { theme: 'flat' })).not.toContain('linearGradient')
    expect(MistyStates.svg('0|1', { theme: 'solid' })).toContain('linearGradient')
  })

  it('propagates parse errors to the caller', () => {
    expect(() => MistyStates.svg('(0|1')).toThrow(/unclosed/)
  })

  it('reports the detected mode', () => {
    expect(MistyStates.detectMode('00|11')).toBe('state')
    expect(MistyStates.detectMode('qubits 2\nH 1')).toBe('circuit')
  })
})

describe('data URLs', () => {
  it('builds an SVG data URL', () => {
    expect(MistyStates.svgDataUrl('0|1').startsWith('data:image/svg+xml;base64,')).toBe(true)
  })
})

describe('links', () => {
  it('builds an editor link, keeping "|" readable', () => {
    expect(MistyStates.editorUrl('00|11', { base: BASE })).toBe(`${BASE}?src=00|11`)
  })

  it('builds bare-image links carrying the format', () => {
    expect(MistyStates.imageUrl('00|11', 'svg', { base: BASE })).toBe(
      `${BASE}?format=svg&src=00|11`,
    )
    expect(MistyStates.imageUrl('00|11', 'png', { base: BASE, scale: 4 })).toBe(
      `${BASE}?format=png&src=00|11&scale=4`,
    )
  })

  it('defaults to svg', () => {
    expect(MistyStates.imageUrl('0', undefined, { base: BASE })).toContain('format=svg')
  })

  it('never leaves a format on an editor link', () => {
    const url = MistyStates.editorUrl('0|1', { base: `${BASE}?format=png&src=old` })
    expect(url).not.toContain('format=')
  })

  it('carries render settings into the link', () => {
    const url = MistyStates.imageUrl('0|1', 'svg', { base: BASE, theme: 'isometric', qubit: 40 })
    expect(url).toContain('theme=isometric')
    expect(url).toContain('qubit=40')
  })

  it('falls back to the current document when no base is given', () => {
    expect(MistyStates.editorUrl('0|1')).toContain('src=0|1')
  })
})

describe('introspection', () => {
  it('lists themes and shapes', () => {
    expect(MistyStates.themes).toContain('isometric')
    expect(MistyStates.shapes).toContain('triangle')
  })

  it('hands out copies, so callers cannot mutate internals', () => {
    MistyStates.themes.push('bogus' as never)
    expect(MistyStates.themes).not.toContain('bogus')
  })
})
