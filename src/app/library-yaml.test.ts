/**
 * The YAML library format.
 *
 * The load-bearing property is the round trip: whatever leaves the app must
 * come back identical, because these files are meant to be kept alongside the
 * course materials and re-imported later.
 */

import { describe, expect, it } from 'vitest'
import { fromYaml, toYaml, LibraryFormatError } from './library-yaml'
import { render } from '../core/index'

/**
 * A fixture rather than the app's library, which is empty by design — the
 * project's own `library.yaml` is not committed, so the format has to be
 * checked against something that always exists.
 */
const DOC = {
  groups: [
    {
      label: 'Circuits',
      entries: [
        {
          id: 'swap',
          title: '§1 Swap, CNOT and NOT',
          origin: 'ps2.problem1.png',
          source: ['in 001', 'SWAP 2 3', '---', 'CNOT 2 -> 1; X 3', 'out 111'].join('\n'),
        },
        {
          id: 'ghz',
          title: 'Entanglement generator',
          note: 'Three qubits, one Hadamard and two CNOTs.',
          source: ['qubits 3', 'H 3', 'CNOT 3 -> 2', 'CNOT 2 -> 1', 'out 000|111'].join('\n'),
        },
      ],
    },
    {
      label: 'States',
      entries: [
        { id: 'bell', title: 'A Bell state', source: '00|11' },
        { id: 'factored', title: 'Factored', source: '000|-111|110|-001\n(00|11)(0|-1)' },
      ],
    },
  ],
}

const LIBRARY = DOC.groups

describe('round trip', () => {
  it('returns the built-in library unchanged', async () => {
    const back = await fromYaml(await toYaml(DOC))
    expect(back.groups).toEqual(DOC.groups)
  })

  it('carries nothing but the groups', async () => {
    // Figures that were deliberately not transcribed are a note in library.ts,
    // not data: they are of no use to anyone importing a library.
    expect(await toYaml(DOC)).not.toContain('skipped')
    expect(Object.keys(await fromYaml(await toYaml(DOC)))).toEqual(['groups'])
  })

  it('ignores a "skipped" list left over in an older file', async () => {
    const text = `skipped:
  - origin: old.png
    reason: no longer tracked
groups:
  - label: X
    entries:
      - { id: a, title: T, origin: f.png, source: "0" }
`
    const doc = await fromYaml(text)
    expect(doc.groups).toHaveLength(1)
    expect('skipped' in doc).toBe(false)
  })

  it('preserves multi-line sources exactly', async () => {
    const back = await fromYaml(await toYaml(DOC))
    for (const group of back.groups) {
      for (const entry of group.entries) {
        const original = LIBRARY.flatMap((g) => g.entries).find((e) => e.id === entry.id)!
        expect(entry.source, entry.id).toBe(original.source)
      }
    }
  })

  it('keeps every entry renderable after the trip', async () => {
    const back = await fromYaml(await toYaml(DOC))
    for (const group of back.groups) {
      for (const entry of group.entries) {
        expect(() => render(entry.source), entry.id).not.toThrow()
      }
    }
  })

  it('writes multi-line sources as block scalars, not escaped strings', async () => {
    const text = await toYaml(DOC)
    expect(text).toMatch(/source: \|/)
    expect(text).not.toContain('\\n')
  })

  it('carries a comment header explaining the file', async () => {
    expect(await toYaml(DOC)).toMatch(/^# Misty States library/)
  })
})

describe('reading a hand-written file', () => {
  const minimal = `
groups:
  - label: My figures
    entries:
      - id: one
        title: A Bell state
        origin: notes.png
        source: |-
          00|11
`

  it('accepts the minimum a person would write', async () => {
    const doc = await fromYaml(minimal)
    expect(doc.groups).toHaveLength(1)
    expect(doc.groups[0].entries[0]).toEqual({
      id: 'one',
      title: 'A Bell state',
      origin: 'notes.png',
      note: undefined,
      source: '00|11',
    })
  })

  it('keeps an optional note', async () => {
    const doc = await fromYaml(minimal.replace('source: |-', 'note: Careful\n        source: |-'))
    expect(doc.groups[0].entries[0].note).toBe('Careful')
  })
})

describe('rejecting a bad file, with a reason', () => {
  const cases: [string, string, RegExp][] = [
    ['not YAML at all', 'groups: [\n', /not valid YAML/i],
    ['empty', '', /empty|mapping/i],
    ['no groups list', 'something: else\n', /top-level "groups"/],
    ['a group with no label', 'groups:\n  - entries: []\n', /"label" is required/],
    ['a group with no entries', 'groups:\n  - label: X\n', /"entries" list/],
    [
      'an entry missing its source',
      'groups:\n  - label: X\n    entries:\n      - id: a\n        title: T\n        origin: f.png\n',
      /"source" is required/,
    ],
    [
      'duplicate ids',
      `groups:
  - label: X
    entries:
      - { id: a, title: T, origin: f.png, source: "0" }
      - { id: a, title: U, origin: g.png, source: "1" }
`,
      /Duplicate entry id "a"/,
    ],
  ]

  for (const [name, text, message] of cases) {
    it(`rejects ${name}`, async () => {
      await expect(fromYaml(text)).rejects.toThrow(message)
    })
  }

  it('reports format problems as a LibraryFormatError', async () => {
    await expect(fromYaml('something: else\n')).rejects.toBeInstanceOf(LibraryFormatError)
  })

  it('names the group so a problem can be found in a large file', async () => {
    const text = `groups:
  - label: Good
    entries:
      - { id: a, title: T, origin: f.png, source: "0" }
  - label: Bad one
    entries:
      - { id: b, title: T, origin: f.png }
`
    await expect(fromYaml(text)).rejects.toThrow(/Bad one/)
  })
})
