// @vitest-environment jsdom
/**
 * The library editor.
 *
 * The load-bearing behaviour is dragging: a diagram can be moved anywhere in
 * the library, including into another group, so all entry rows are one target
 * list. jsdom reports every layout position as zero, so rows are given
 * synthetic offsets here — see `withLayout`.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import LibraryEditor from './LibraryEditor.svelte'
import { libraryStore, replaceLibrary, resetLibrary } from '../library-store.svelte'

vi.mock('virtual:misty-library', () => ({ LIBRARY_YAML: null, LIBRARY_STAMP: null }))

let host: HTMLDivElement
let app: Record<string, unknown> | undefined

const LIBRARY = {
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
}

beforeEach(() => {
  localStorage.clear()
  resetLibrary()
  replaceLibrary(structuredClone(LIBRARY))
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  if (app) unmount(app)
  app = undefined
  host.remove()
})

function boot() {
  app = mount(LibraryEditor, { target: host, props: { onclose: () => {} } })
  flushSync()
}

/** jsdom has no PointerEvent.pointerType, which the drag code reads. */
function pointer(type: string, y: number): PointerEvent {
  const e = new PointerEvent(type, { bubbles: true, button: 0, clientY: y })
  Object.defineProperty(e, 'pointerType', { value: 'mouse' })
  return e
}

/**
 * jsdom lays nothing out, so every row is 30px tall in source order and the
 * scroller starts at the top of the viewport.
 */
function withLayout(run: () => void) {
  const rows = () => [...host.querySelectorAll<HTMLElement>('[data-entry-row], [data-group-row]')]
  const offsetTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop')
  const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
  Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
    configurable: true,
    get(this: HTMLElement) {
      return Math.max(0, rows().indexOf(this)) * 30
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 30 })
  try {
    run()
  } finally {
    if (offsetTop) Object.defineProperty(HTMLElement.prototype, 'offsetTop', offsetTop)
    if (offsetHeight) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight)
  }
}

const grip = (label: RegExp) =>
  [...host.querySelectorAll('button')].find((b) => label.test(b.getAttribute('aria-label') ?? ''))!

const layout = () =>
  libraryStore.doc.groups.map((g) => `${g.label}: ${g.entries.map((e) => e.title).join(',')}`)

describe('what it shows', () => {
  it('lists every group and diagram', () => {
    boot()
    expect(host.querySelectorAll('[data-group-row]')).toHaveLength(2)
    expect(host.querySelectorAll('[data-entry-row]')).toHaveLength(4)
  })

  it('offers the library name for editing', () => {
    boot()
    const field = host.querySelector('input[aria-label="Library name"]') as HTMLInputElement
    expect(field.value).toBe('PHYS 137T')
  })

  it('offers no group dropdown — dragging is how a diagram moves', () => {
    boot()
    expect(host.querySelectorAll('select')).toHaveLength(0)
  })
})

describe('editing names', () => {
  const type = (selector: string, value: string) => {
    const el = host.querySelector(selector) as HTMLInputElement
    el.value = value
    el.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
  }

  it('renames the library', () => {
    boot()
    type('input[aria-label="Library name"]', 'Fall 2025')
    expect(libraryStore.doc.name).toBe('Fall 2025')
  })

  it('renames a group', () => {
    boot()
    type('input[aria-label="Group name"]', 'PS2 — Circuits')
    expect(libraryStore.doc.groups[0].label).toBe('PS2 — Circuits')
  })

  it('renames a diagram', () => {
    boot()
    type('input[aria-label="Diagram title"]', 'A, revised')
    expect(libraryStore.doc.groups[0].entries[0].title).toBe('A, revised')
  })
})

describe('dragging diagrams', () => {
  it('reorders within a group', () => {
    boot()
    withLayout(() => {
      // Row 0 is the first group header; entries follow at 30px each.
      grip(/^A:/).dispatchEvent(pointer('pointerdown', 0))
      window.dispatchEvent(pointer('pointermove', 100))
      flushSync()
    })
    window.dispatchEvent(pointer('pointerup', 100))
    expect(layout()[0]).toBe('Problem Set 2: B,C,A')
  })

  it('moves a diagram into another group', () => {
    boot()
    withLayout(() => {
      grip(/^A:/).dispatchEvent(pointer('pointerdown', 0))
      // Past the three entries of the first group and into the second.
      window.dispatchEvent(pointer('pointermove', 160))
      flushSync()
    })
    window.dispatchEvent(pointer('pointerup', 160))
    expect(layout()).toEqual(['Problem Set 2: B,C', 'Problem Set 5: A,D'])
  })

  it('leaves the source group standing when it empties', () => {
    boot()
    withLayout(() => {
      grip(/^D:/).dispatchEvent(pointer('pointerdown', 90))
      window.dispatchEvent(pointer('pointermove', 0))
      flushSync()
    })
    window.dispatchEvent(pointer('pointerup', 0))
    expect(libraryStore.doc.groups).toHaveLength(2)
    expect(layout()[1]).toBe('Problem Set 5: ')
  })

  it('takes a drop on an empty group, so a new group can be filled', () => {
    replaceLibrary({
      groups: [
        { label: 'Full', entries: [{ id: 'a', title: 'A', source: '0' }] },
        { label: 'Empty', entries: [] },
      ],
    })
    boot()
    expect(host.querySelectorAll('[data-entry-row]')).toHaveLength(2)
    withLayout(() => {
      grip(/^A:/).dispatchEvent(pointer('pointerdown', 0))
      window.dispatchEvent(pointer('pointermove', 100))
      flushSync()
    })
    window.dispatchEvent(pointer('pointerup', 100))
    expect(layout()).toEqual(['Full: ', 'Empty: A'])
  })

  it('reorders with the arrow keys on the grip', () => {
    boot()
    grip(/^A:/).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    flushSync()
    expect(layout()[0]).toBe('Problem Set 2: B,A,C')
  })
})

describe('collapsing groups', () => {
  const twisty = (label: string) =>
    [...host.querySelectorAll('button')].find((b) =>
      (b.getAttribute('aria-label') ?? '').endsWith(label),
    )!

  it('folds a group away', () => {
    boot()
    expect(host.querySelectorAll('[data-entry-row]')).toHaveLength(4)
    twisty('Problem Set 2').click()
    flushSync()
    // The three rows are gone; a single placeholder stands in for them.
    expect(host.querySelectorAll('[data-entry-row]')).toHaveLength(2)
    expect(host.textContent).toContain('3 hidden')
  })

  it('unfolds it again', () => {
    boot()
    twisty('Problem Set 2').click()
    flushSync()
    twisty('Problem Set 2').click()
    flushSync()
    expect(host.querySelectorAll('[data-entry-row]')).toHaveLength(4)
  })

  it('follows the group when it is renamed, not the name', () => {
    boot()
    twisty('Problem Set 2').click()
    flushSync()
    const field = host.querySelector('input[aria-label="Group name"]') as HTMLInputElement
    field.value = 'PS2'
    field.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    expect(host.textContent).toContain('3 hidden')
  })

  it('keeps typing in a group name from losing the field', () => {
    // The row is keyed by the group itself; keying by label would tear down
    // the input on every keystroke.
    boot()
    const field = host.querySelector('input[aria-label="Group name"]') as HTMLInputElement
    field.value = 'PS2'
    field.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    expect(host.querySelector('input[aria-label="Group name"]')).toBe(field)
  })

  it('takes a diagram dropped onto a folded group, at the end', () => {
    boot()
    twisty('Problem Set 5').click()
    flushSync()
    withLayout(() => {
      grip(/^A:/).dispatchEvent(pointer('pointerdown', 0))
      window.dispatchEvent(pointer('pointermove', 160))
      flushSync()
    })
    window.dispatchEvent(pointer('pointerup', 160))
    expect(layout()).toEqual(['Problem Set 2: B,C', 'Problem Set 5: D,A'])
  })
})

describe('groups', () => {
  it('reorders them', () => {
    boot()
    grip(/^Problem Set 5:/).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }),
    )
    flushSync()
    expect(libraryStore.doc.groups.map((g) => g.label)).toEqual(['Problem Set 5', 'Problem Set 2'])
  })

  it('adds one', () => {
    boot()
    const field = host.querySelector('input[aria-label="New group name"]') as HTMLInputElement
    field.value = 'Midterm'
    field.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    flushSync()
    expect(libraryStore.doc.groups.map((g) => g.label)).toContain('Midterm')
  })

  it('asks before deleting one that still holds diagrams', () => {
    boot()
    const del = () =>
      [...host.querySelectorAll('button')].find((b) => /^Delete/.test(b.textContent!.trim()))!
    del().click()
    flushSync()
    expect(del().textContent!.trim()).toBe('Delete 3?')
    expect(libraryStore.doc.groups).toHaveLength(2)
    del().click()
    flushSync()
    expect(libraryStore.doc.groups.map((g) => g.label)).toEqual(['Problem Set 5'])
  })

  it('deletes a diagram outright, since one row is no great loss', () => {
    boot()
    const remove = [...host.querySelectorAll('button')].find(
      (b) => b.getAttribute('aria-label') === 'Delete A',
    )!
    remove.click()
    flushSync()
    expect(layout()[0]).toBe('Problem Set 2: B,C')
  })
})
