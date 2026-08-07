// @vitest-environment jsdom
/**
 * The library the app is holding.
 *
 * It starts empty, survives a refresh, and is edited by saving a diagram under
 * a name — which is the only way in besides importing a file, so it has to
 * behave like an edit rather than an append.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  addGroup, entryCount, findByTitle, findEntry, hasLibrary, libraryName, libraryStore, moveEntry,
  removeEntry, removeGroup, renameEntry, renameGroup, renameLibrary, replaceLibrary, reorderGroups,
  resetLibrary, saveEntry, seedFromProject,
} from './library-store.svelte'
import { DEFAULT_GROUP } from './library'

// A stand-in for the project's library.yaml, so this runs the same whether or
// not the working copy has one.
const YAML = `groups:
  - label: Problem Set 2
    entries:
      - { id: ps2.1, title: "§1 Swap", source: "in 001" }
`
let file: { LIBRARY_YAML: string | null; LIBRARY_STAMP: string | null } = {
  LIBRARY_YAML: YAML,
  LIBRARY_STAMP: 'aaaa',
}
vi.mock('virtual:misty-library', () => ({
  get LIBRARY_YAML() {
    return file.LIBRARY_YAML
  },
  get LIBRARY_STAMP() {
    return file.LIBRARY_STAMP
  },
}))

beforeEach(() => {
  localStorage.clear()
  resetLibrary()
  file = { LIBRARY_YAML: YAML, LIBRARY_STAMP: 'aaaa' }
})

describe('seeding from the project file', () => {
  it('loads it when the browser is holding nothing', async () => {
    expect(await seedFromProject()).toBe(true)
    expect(findByTitle('§1 Swap')?.source).toBe('in 001')
  })

  it('does nothing when there is no such file', async () => {
    file = { LIBRARY_YAML: null, LIBRARY_STAMP: null }
    expect(await seedFromProject()).toBe(false)
    expect(hasLibrary()).toBe(false)
  })

  it('leaves edits alone on the next load, so work in the app survives', async () => {
    await seedFromProject()
    saveEntry('Mine', '00|11')
    expect(await seedFromProject()).toBe(false)
    expect(findByTitle('Mine')).toBeDefined()
  })

  it('reseeds when the file has changed, which is what a rebuild does', async () => {
    await seedFromProject()
    saveEntry('Mine', '00|11')
    file = {
      LIBRARY_YAML: YAML.replace('§1 Swap', '§1 Swap, revised'),
      LIBRARY_STAMP: 'bbbb',
    }
    expect(await seedFromProject()).toBe(true)
    expect(findByTitle('§1 Swap, revised')).toBeDefined()
    // The file is the source of truth on a rebuild; anything else goes.
    expect(findByTitle('Mine')).toBeUndefined()
  })

  it('seeds again after the library has been cleared', async () => {
    await seedFromProject()
    resetLibrary()
    expect(await seedFromProject()).toBe(true)
    expect(hasLibrary()).toBe(true)
  })
})

describe('starting empty', () => {
  it('holds nothing until something is loaded', () => {
    expect(entryCount()).toBe(0)
    expect(hasLibrary()).toBe(false)
  })

  it('writes nothing to storage while it is empty', () => {
    expect(localStorage.getItem('misty.library.v1')).toBeNull()
  })
})

describe('saving a diagram', () => {
  it('creates a library where there was none', () => {
    saveEntry('Bell pair', '00|11')
    expect(hasLibrary()).toBe(true)
    expect(findByTitle('Bell pair')?.source).toBe('00|11')
  })

  it('puts a new diagram in a group of its own kind', () => {
    saveEntry('Bell pair', '00|11')
    expect(libraryStore.doc.groups.map((g) => g.label)).toEqual([DEFAULT_GROUP])
  })

  it('persists, so a refresh keeps it', () => {
    saveEntry('Bell pair', '00|11')
    expect(localStorage.getItem('misty.library.v1')).toContain('Bell pair')
  })

  it('overwrites an entry of the same name rather than adding a second', () => {
    saveEntry('Bell pair', '00|11')
    saveEntry('Bell pair', '00|-11')
    expect(entryCount()).toBe(1)
    expect(findByTitle('Bell pair')?.source).toBe('00|-11')
  })

  it('matches a name regardless of case or surrounding space', () => {
    saveEntry('Bell pair', '00|11')
    saveEntry('  bell PAIR  ', '01|10')
    expect(entryCount()).toBe(1)
    expect(findByTitle('Bell pair')?.source).toBe('01|10')
  })

  it('replaces an imported figure where it already sits', () => {
    // An edit should leave a figure among its neighbours, not move it to the
    // default group — that is what makes this editing rather than appending.
    replaceLibrary({
      groups: [{ label: 'Problem Set 2', entries: [{ id: 'ps2.1', title: '§1', source: '0' }] }],
    })
    saveEntry('§1', '1')
    expect(libraryStore.doc.groups.map((g) => g.label)).toEqual(['Problem Set 2'])
    expect(findEntry('ps2.1')?.source).toBe('1')
  })

  it('gives every entry an id of its own', () => {
    replaceLibrary({
      groups: [{ label: 'X', entries: [{ id: 'bell-pair', title: 'Something else', source: '0' }] }],
    })
    const entry = saveEntry('Bell pair', '00|11')
    expect(entry.id).not.toBe('bell-pair')
    expect(entryCount()).toBe(2)
  })

  it('refuses a diagram with no name', () => {
    expect(() => saveEntry('   ', '00|11')).toThrow(/needs a name/)
    expect(hasLibrary()).toBe(false)
  })
})

describe('arranging the library', () => {
  const layout = () =>
    libraryStore.doc.groups.map((g) => `${g.label}: ${g.entries.map((e) => e.title).join(',')}`)

  beforeEach(() => {
    replaceLibrary({
      name: 'PHYS 137T',
      groups: [
        {
          label: 'Problem Set 2',
          entries: [
            { id: 'a', title: 'A', source: '0' },
            { id: 'b', title: 'B', source: '1' },
            { id: 'c', title: 'C', source: '0|1' },
          ],
        },
        { label: 'Problem Set 5', entries: [{ id: 'd', title: 'D', source: '00|11' }] },
      ],
    })
  })

  it('names the library, and forgets the name when it is cleared', () => {
    expect(libraryName()).toBe('PHYS 137T')
    renameLibrary('  Fall 2025  ')
    expect(libraryName()).toBe('Fall 2025')
    renameLibrary('   ')
    expect(libraryName()).toBe('')
    expect('name' in libraryStore.doc).toBe(false)
  })

  it('renames a diagram, which is how the editor finds it again', () => {
    renameEntry('a', 'A, revised')
    expect(findByTitle('A, revised')?.id).toBe('a')
    expect(renameEntry('a', '  ')).toBe(false)
  })

  it('renames and reorders groups', () => {
    renameGroup(1, 'Problem Set 5 — Entanglement')
    reorderGroups(1, 0)
    expect(libraryStore.doc.groups.map((g) => g.label)).toEqual([
      'Problem Set 5 — Entanglement',
      'Problem Set 2',
    ])
  })

  it('reorders diagrams within a group', () => {
    moveEntry({ group: 0, index: 2 }, { group: 0, index: 0 })
    expect(layout()[0]).toBe('Problem Set 2: C,A,B')
  })

  it('drags a diagram into another group, at the position it was dropped', () => {
    moveEntry({ group: 0, index: 1 }, { group: 1, index: 0 })
    expect(layout()).toEqual(['Problem Set 2: A,C', 'Problem Set 5: B,D'])
  })

  it('leaves a group standing when the last diagram is dragged out of it', () => {
    // Unlike a delete: a group emptied by hand is one you are still arranging.
    moveEntry({ group: 1, index: 0 }, { group: 0, index: 0 })
    expect(layout()).toEqual(['Problem Set 2: D,A,B,C', 'Problem Set 5: '])
  })

  it('clamps a drop past the end of its new group', () => {
    moveEntry({ group: 0, index: 0 }, { group: 1, index: 99 })
    expect(layout()[1]).toBe('Problem Set 5: D,A')
  })

  it('adds a group, but not a second one of the same name', () => {
    expect(addGroup('Midterm')).toBe(true)
    expect(addGroup('Midterm')).toBe(false)
    expect(addGroup('   ')).toBe(false)
    expect(libraryStore.doc.groups).toHaveLength(3)
  })

  it('deletes a group and everything in it', () => {
    removeGroup(0)
    expect(layout()).toEqual(['Problem Set 5: D'])
  })

  it('persists every one of those', () => {
    renameLibrary('Fall 2025')
    moveEntry({ group: 0, index: 0 }, { group: 1, index: 0 })
    const saved = localStorage.getItem('misty.library.v1')!
    expect(saved).toContain('Fall 2025')
    expect(JSON.parse(saved).groups[1].entries[0].id).toBe('a')
  })
})

describe('removing a diagram', () => {
  it('drops the entry', () => {
    const entry = saveEntry('Bell pair', '00|11')
    expect(removeEntry(entry.id)).toBe(true)
    expect(findByTitle('Bell pair')).toBeUndefined()
  })

  it('drops the group it emptied, so no blank headings are left', () => {
    const entry = saveEntry('Bell pair', '00|11')
    removeEntry(entry.id)
    expect(libraryStore.doc.groups).toEqual([])
    expect(hasLibrary()).toBe(false)
  })

  it('clears storage once the last entry is gone', () => {
    const entry = saveEntry('Bell pair', '00|11')
    removeEntry(entry.id)
    expect(localStorage.getItem('misty.library.v1')).toBeNull()
  })

  it('says so when there is nothing of that id', () => {
    expect(removeEntry('nope')).toBe(false)
  })
})
