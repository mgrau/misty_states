import { describe, expect, it } from 'vitest'
import { editorUrl, fromSearchParams, imageUrl, renderOptionsFrom, toSearchParams } from './url'
import { render } from './index'

const round = (src: string, extra: Record<string, unknown> = {}) =>
  fromSearchParams(new URLSearchParams(toSearchParams({ source: src, ...extra }).toString()))

describe('round-tripping through a query string', () => {
  it('preserves the source verbatim, including newlines and pipes', () => {
    const source = '50%: 00(0|-1)\n50%: 11(0|-1)'
    expect(round(source)?.source).toBe(source)
  })

  it('preserves a circuit with arrows and semicolons', () => {
    const source = 'qubits 3\nH 3\nCNOT 3 -> 2; H 1\nout 000|111'
    expect(round(source)?.source).toBe(source)
  })

  it('omits defaults so short links stay short', () => {
    const sp = toSearchParams({ source: '0|1', theme: 'solid', scale: 1 })
    expect([...sp.keys()]).toEqual(['src'])
  })

  it('carries non-default options', () => {
    const p = round('0|1', { theme: 'isometric', dark: true, qubit: 40 })
    expect(p).toMatchObject({ theme: 'isometric', dark: true, qubit: 40 })
  })
})

describe('validation', () => {
  it('returns null when there is no source', () => {
    expect(fromSearchParams(new URLSearchParams('theme=flat'))).toBeNull()
  })

  it('accepts an empty source rather than treating it as missing', () => {
    expect(fromSearchParams(new URLSearchParams('src='))?.source).toBe('')
  })

  it('ignores an unknown theme instead of trusting it', () => {
    expect(fromSearchParams(new URLSearchParams('src=0&theme=evil'))?.theme).toBeUndefined()
  })

  it('clamps out-of-range numbers', () => {
    expect(fromSearchParams(new URLSearchParams('src=0&scale=9999'))?.scale).toBe(20)
    expect(fromSearchParams(new URLSearchParams('src=0&qubit=-5'))?.qubit).toBe(8)
  })

  it('drops values that are not numbers', () => {
    expect(fromSearchParams(new URLSearchParams('src=0&scale=abc'))?.scale).toBeUndefined()
  })
})

describe('link building', () => {
  it('encodes the source into the query string', () => {
    expect(editorUrl('http://x.test/', { source: '00|11' })).toBe('http://x.test/?src=00|11')
  })

  it('keeps the document path, including index.html', () => {
    expect(editorUrl('http://x.test/misty/index.html', { source: '0' })).toBe(
      'http://x.test/misty/index.html?src=0',
    )
  })

  it('works for a file:// base', () => {
    expect(editorUrl('file:///tmp/dist/index.html', { source: '0' })).toBe(
      'file:///tmp/dist/index.html?src=0',
    )
  })

  it('replaces any existing query and fragment on the base', () => {
    expect(editorUrl('http://x.test/?stale=1#frag', { source: '0' })).toBe('http://x.test/?src=0')
  })

  it('marks image links with the format', () => {
    expect(imageUrl('http://x.test/', 'svg', { source: '0' })).toBe(
      'http://x.test/?format=svg&src=0',
    )
    expect(imageUrl('http://x.test/', 'png', { source: '0' })).toBe(
      'http://x.test/?format=png&src=0',
    )
  })

  it('strips format and download from an editor link', () => {
    const url = editorUrl('http://x.test/', { source: '0', format: 'png', download: true })
    expect(url).toBe('http://x.test/?src=0')
  })

  it('survives a full round trip', () => {
    const source = 'qubits 2\nH 1; H 2\nout 00|11'
    const url = new URL(imageUrl('http://x.test/', 'png', { source, theme: 'isometric' }))
    expect(fromSearchParams(url.searchParams)).toMatchObject({
      source,
      theme: 'isometric',
      format: 'png',
    })
  })
})

describe('readable links', () => {
  const src = (url: string) => new URLSearchParams(new URL(url).search).get('src')

  it('leaves | literal instead of %7C', () => {
    expect(editorUrl('http://x.test/', { source: '00|11' })).toBe('http://x.test/?src=00|11')
  })

  it('leaves parentheses literal', () => {
    expect(editorUrl('http://x.test/', { source: '(00|11)(0|-1)' })).toBe(
      'http://x.test/?src=(00|11)(0|-1)',
    )
  })

  it('keeps circuit arrows and semicolons readable', () => {
    const url = editorUrl('http://x.test/', { source: 'H 1; CNOT 1 -> 2' })
    expect(url).toContain('H+1;+CNOT+1+->+2')
  })

  it('still parses back to the exact source', () => {
    for (const source of [
      '00|11',
      '(00|11)(0|-1)',
      '50%: 00(0|-1)',
      'qubits 3\nH 3\nCNOT 3 -> 2; H 1',
      '???',
      '3*0|2*1',
      "a&b=c+d#e",
    ]) {
      expect(src(editorUrl('http://x.test/', { source }))).toBe(source)
    }
  })

  it('never decodes the structural characters', () => {
    // A literal & = + # or % in the source must stay escaped, or it would
    // split the query or change another parameter.
    const url = editorUrl('http://x.test/', { source: 'a&b=c+d#e%f' })
    expect(url).toContain('%26')
    expect(url).toContain('%3D')
    expect(url).toContain('%23')
    expect(url).toContain('%25')
    expect(new URL(url).searchParams.get('src')).toBe('a&b=c+d#e%f')
  })

  it('does not collapse an escaped percent sequence', () => {
    // "%7C" written literally in the source must not come back as "|".
    expect(src(editorUrl('http://x.test/', { source: '%7C' }))).toBe('%7C')
  })

  it('keeps every example round-tripping', async () => {
    const { EXAMPLES } = await import('./examples')
    for (const ex of EXAMPLES) {
      expect(src(editorUrl('http://x.test/', { source: ex.source }))).toBe(ex.source)
    }
  })
})

describe('format parameter', () => {
  it('reads svg, png and pdf', () => {
    for (const f of ['svg', 'png', 'pdf'] as const) {
      expect(fromSearchParams(new URLSearchParams(`src=0&format=${f}`))?.format).toBe(f)
    }
  })

  it('ignores an unknown format rather than trusting it', () => {
    expect(fromSearchParams(new URLSearchParams('src=0&format=exe'))?.format).toBeUndefined()
  })

  it('is absent for a plain editor link', () => {
    expect(fromSearchParams(new URLSearchParams('src=0'))?.format).toBeUndefined()
  })
})

describe('decoded parameters drive the renderer', () => {
  it('produces the same SVG as rendering the options directly', () => {
    const params = round('00|11', { theme: 'flat', qubit: 30 })!
    const viaUrl = render(params.source, renderOptionsFrom(params)).svg
    const direct = render('00|11', { theme: 'flat', metrics: { qubit: 30 } }).svg
    expect(viaUrl).toBe(direct)
  })

  it('round-trips every example', async () => {
    const { EXAMPLES } = await import('./examples')
    for (const ex of EXAMPLES) {
      expect(round(ex.source)?.source).toBe(ex.source)
    }
  })
})
