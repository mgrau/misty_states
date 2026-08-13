/**
 * The project's own library, if this working copy has one.
 *
 * `library.yaml` is not committed — it holds course problems and their
 * solutions — so these checks are skipped on a fresh clone and run whenever the
 * file is there. The format itself is covered by `library-yaml.test.ts`, which
 * needs no such file.
 *
 * What can be checked mechanically is that every entry still renders and is
 * described honestly. Whether it *matches* its original is an eyeball job.
 */

import { describe, expect, it } from 'vitest'
import { LIBRARY_YAML } from 'virtual:misty-library'
import { fromYaml, type LibraryDocument } from './library-yaml'
import { LIBRARY } from './library'
import { render } from '../core/index'
import { EXAMPLES } from '../core/examples'

// The same module the app seeds from, so this checks the real path rather than
// a second reading of the file.
const present = LIBRARY_YAML !== null

describe('the app ships without a library', () => {
  it('starts empty, so the picker has nothing to show', () => {
    expect(LIBRARY).toEqual([])
  })
})

describe.skipIf(!present)('library.yaml', () => {
  let doc: LibraryDocument
  let entries: LibraryDocument['groups'][number]['entries']

  it('parses', async () => {
    doc = await fromYaml(LIBRARY_YAML!)
    entries = doc.groups.flatMap((g) => g.entries)
    expect(entries.length).toBeGreaterThan(0)
  })

  it('renders every entry', () => {
    for (const entry of entries) {
      const out = render(entry.source)
      expect(out.svg.startsWith('<svg'), entry.id).toBe(true)
      expect(out.svg, entry.id).not.toContain('NaN')
      expect(out.width, entry.id).toBeGreaterThan(0)
    }
  })

  it('has unique ids', () => {
    const ids = entries.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has no empty groups', () => {
    for (const g of doc.groups) expect(g.entries.length, g.label).toBeGreaterThan(0)
  })

  it('names the original of anything transcribed from one', () => {
    for (const e of entries) {
      if (e.origin !== undefined) expect(e.origin, e.id).toMatch(/\.(png|svg|pdf)$/)
    }
  })

  it('stays separate from the curated examples', () => {
    // The Examples dropdown is a syntax tour; the library is the course archive.
    const exampleIds = new Set(EXAMPLES.map((e) => e.id))
    for (const e of entries) expect(exampleIds.has(e.id), e.id).toBe(false)
  })
})
