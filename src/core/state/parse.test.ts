import { describe, expect, it } from 'vitest'
import { parseState, ParseError } from './parse'
import { qubitWidth, type CloudNode } from './ast'

const row = (src: string) => parseState(src).rows[0]
const side = (src: string, i = 0) => row(src).sides[i]
const cloudOf = (src: string, i = 0) => side(src, i).factors[0] as CloudNode

describe('bare qubits and implicit clouds', () => {
  it('reads a single term as a plain product, not a cloud', () => {
    expect(side('00').factors.map((f) => f.kind)).toEqual(['qubit', 'qubit'])
  })

  it('wraps a top-level "|" in a cloud without needing parens', () => {
    const c = cloudOf('0|1')
    expect(c.kind).toBe('cloud')
    expect(c.terms).toHaveLength(2)
  })

  it('treats 00|11 as two two-qubit terms', () => {
    const c = cloudOf('00|11')
    expect(c.terms.map((t) => t.factors.length)).toEqual([2, 2])
  })
})

describe('term separators', () => {
  it('accepts "," as well as "|"', () => {
    expect(cloudOf('00,11').terms).toHaveLength(2)
    expect(cloudOf('00,11')).toEqual(cloudOf('00|11'))
  })

  it('allows the two to be mixed', () => {
    expect(cloudOf('0,1|0,1').terms).toHaveLength(4)
  })

  it('takes "," inside parentheses too', () => {
    expect(side('(00,11)(0,-1)').factors.map((f) => f.kind)).toEqual(['cloud', 'cloud'])
  })

  it('does not mistake a comma line for a caption', () => {
    expect(side('00,11').caption).toBeUndefined()
  })
})

describe('rule 2 — negative amplitudes', () => {
  it('parses a leading minus on a term', () => {
    const c = cloudOf('0|1|-1')
    expect(c.terms.map((t) => t.sign)).toEqual([1, 1, -1])
  })
})

describe('rule 4 — nested clouds', () => {
  it('allows a cloud as a term of another cloud', () => {
    const outer = cloudOf('(0|1)|(0|1)')
    expect(outer.terms).toHaveLength(2)
    const inner = outer.terms[0].factors[0] as CloudNode
    expect(inner.kind).toBe('cloud')
    expect(inner.terms).toHaveLength(2)
  })
})

describe('rule 5 — a bare qubit beside a cloud', () => {
  it('parses 0(0|1) as a product of a qubit and a cloud', () => {
    const s = side('0(0|1)')
    expect(s.factors.map((f) => f.kind)).toEqual(['qubit', 'cloud'])
  })
})

describe('rule 6 — a product of clouds', () => {
  it('parses (0|1)(0|-1) as two adjacent clouds', () => {
    const s = side('(0|1)(0|-1)')
    expect(s.factors.map((f) => f.kind)).toEqual(['cloud', 'cloud'])
    const second = s.factors[1] as CloudNode
    expect(second.terms[1].sign).toBe(-1)
  })
})

describe('coefficients', () => {
  it('reads N* as a coefficient', () => {
    const c = cloudOf('3*0|2*1')
    expect(c.terms.map((t) => t.coeff)).toEqual([3, 2])
  })

  it('reads N( as a coefficient', () => {
    const c = cloudOf('3(0)|2(1)')
    expect(c.terms.map((t) => t.coeff)).toEqual([3, 2])
  })

  it('does not mistake 00 or 11 for a coefficient', () => {
    const c = cloudOf('00|11')
    expect(c.terms.every((t) => t.coeff === undefined)).toBe(true)
    expect(c.terms[1].factors).toHaveLength(2)
  })
})

describe('multiplication', () => {
  const kinds = (src: string) => side(src).factors.map((f) => f.kind)

  it('draws "x" between factors as a × operator', () => {
    expect(kinds('(0|1) x (0|1)')).toEqual(['cloud', 'op', 'cloud'])
  })

  it('accepts an uppercase X just the same', () => {
    expect(kinds('(0|1) X (0|1)')).toEqual(['cloud', 'op', 'cloud'])
  })

  it('works between bare qubits, and needs no spaces', () => {
    expect(kinds('0x1')).toEqual(['qubit', 'op', 'qubit'])
  })

  it('chains across more than two factors', () => {
    expect(kinds('0 x 1 x 0')).toEqual(['qubit', 'op', 'qubit', 'op', 'qubit'])
  })

  it('leaves juxtaposition alone — 01 is still two qubits', () => {
    expect(kinds('01')).toEqual(['qubit', 'qubit'])
  })

  it('takes up no shape slot, so numbering runs straight through', () => {
    const s = side('0 x 1')
    expect(s.factors.map(qubitWidth)).toEqual([1, 0, 1])
  })

  it('leaves "*" to coefficients, whatever the number', () => {
    expect(cloudOf('3*0|2*1').terms.map((t) => t.coeff)).toEqual([3, 2])
    expect(cloudOf('0*1|0').terms[0].coeff).toBe(0)
    expect(cloudOf('1*(0|1)|0').terms[0].coeff).toBe(1)
  })

  it('points at "x" when "*" turns up with no number in front of it', () => {
    expect(() => parseState('(0|1)*(0|1)')).toThrow(/write "x" to multiply/)
  })

  it('rejects an operator with nothing after it', () => {
    expect(() => parseState('(0|1) x')).toThrow(/needs something on both sides/)
    expect(() => parseState('0 x x 1')).toThrow(ParseError)
  })
})

describe('shape numbering width', () => {
  it('advances by the number of qubits inside a cloud', () => {
    const s = side('(00|11)0')
    expect(qubitWidth(s.factors[0])).toBe(2)
    expect(qubitWidth(s.factors[1])).toBe(1)
  })
})

describe('relations, captions and unknowns', () => {
  it('splits an = chain into sides', () => {
    const r = row('0|1|-1 = 0')
    expect(r.sides).toHaveLength(2)
    expect(r.relations).toEqual(['='])
  })

  it('reads a caption prefix', () => {
    expect(side('50%: 0(0|1)').caption).toBe('50%')
  })

  it('does not treat a colon-free line as captioned', () => {
    expect(side('0(0|1)').caption).toBeUndefined()
  })

  it('reads each ? as one unknown qubit', () => {
    expect(side('?').factors[0]).toMatchObject({ kind: 'qubit', value: 'unknown' })
    expect(side('???').factors).toHaveLength(3)
    // Mixed with known values, which is the point of the per-qubit spelling.
    expect(side('0?1').factors.map((f) => (f as { value: unknown }).value)).toEqual([
      0, 'unknown', 1,
    ])
    expect(side('??0').factors.map((f) => (f as { value: unknown }).value)).toEqual([
      'unknown', 'unknown', 0,
    ])
  })

  it('puts arbitrary text in a cloud with ("...")', () => {
    const c = cloudOf('("???")')
    expect(c.kind).toBe('cloud')
    expect(c.terms[0].factors[0]).toEqual({ kind: 'label', text: '???' })
    expect((cloudOf('("who knows")').terms[0].factors[0] as { text: string }).text).toBe(
      'who knows',
    )
  })

  it('honours an explicit @N shape override', () => {
    expect(side('0@3').factors[0]).toMatchObject({ shapeIndex: 2 })
  })

  it('stacks each input line as its own row', () => {
    expect(parseState('50%: 0\n50%: 1').rows).toHaveLength(2)
  })
})

describe('errors', () => {
  it('reports an unclosed paren', () => {
    expect(() => parseState('(0|1')).toThrow(ParseError)
  })

  it('reports an unexpected character', () => {
    expect(() => parseState('0 & 1')).toThrow(/unexpected/)
  })
})
