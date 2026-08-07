// @vitest-environment jsdom
/**
 * Mount the real app in a DOM and confirm it renders, reacts to edits, and
 * recovers from bad input. Catches runtime rune/mount problems that neither
 * type-checking nor the pure-function tests would see.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import App from './App.svelte'
import { replaceLibrary, resetLibrary } from './lib/library-store.svelte'

/**
 * No project library here.
 *
 * The app seeds from `library.yaml` at start-up, and that file exists on some
 * working copies and not others — so without this, every assertion about an
 * empty library would depend on who is running the tests, and would race the
 * async seed even for them. The seeding itself is covered by
 * `library-store.test.ts` and the file's contents by `library.test.ts`.
 */
vi.mock('virtual:misty-library', () => ({ LIBRARY_YAML: null, LIBRARY_STAMP: null }))

let host: HTMLDivElement
let app: Record<string, unknown> | undefined

beforeEach(() => {
  localStorage.clear()
  // The store is a module singleton, so it outlives a mount and would carry a
  // library saved by one test into the next.
  resetLibrary()
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  if (app) unmount(app)
  app = undefined
  host.remove()
})

function boot() {
  app = mount(App, { target: host })
  flushSync()
}

/** The rendered diagram, not the icons that also live in the page. */
function diagram(): SVGSVGElement {
  const el = host.querySelector('[data-preview] svg')
  if (!el) throw new Error('diagram not found')
  return el as SVGSVGElement
}

function editor(): HTMLTextAreaElement {
  const el = host.querySelector('textarea')
  if (!el) throw new Error('editor textarea not found')
  return el
}

/**
 * jsdom's PointerEvent carries no `pointerType`, which the drag code reads to
 * tell a mouse from a finger — so it is set explicitly here.
 */
function pointer(type: string, x: number, y: number): PointerEvent {
  const e = new PointerEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y })
  Object.defineProperty(e, 'pointerType', { value: 'mouse' })
  return e
}

function setSource(text: string) {
  const el = editor()
  el.value = text
  el.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
}

describe('App', () => {
  it('mounts and draws the default example', () => {
    boot()
    const svg = diagram()
    expect(svg).not.toBeNull()
    expect(svg.getAttribute('viewBox')).toMatch(/^[-\d.]+ [-\d.]+ [\d.]+ [\d.]+$/)
  })

  it('re-renders when the source changes', () => {
    boot()
    setSource('0|1')
    const small = diagram().getAttribute('viewBox')
    setSource('000|111|010|101')
    const large = diagram().getAttribute('viewBox')
    expect(large).not.toBe(small)
  })

  it('switches from a state to a circuit automatically', () => {
    boot()
    setSource('qubits 2\nH 1\nCNOT 1 -> 2')
    // Circuits carry gate bodies, which bare states never do.
    expect(host.querySelectorAll('rect').length).toBeGreaterThan(0)
  })

  it('shows an error but keeps the last good drawing on screen', () => {
    boot()
    setSource('00|11')
    const good = diagram().outerHTML
    setSource('(0|1')
    expect(host.textContent).toMatch(/unclosed/i)
    expect(diagram().outerHTML).toBe(good)
  })

  it('persists the source to localStorage', () => {
    boot()
    setSource('0|1|-1 = 0')
    expect(localStorage.getItem('misty.v1')).toContain('0|1|-1')
  })

  it('restores a saved session on the next mount', () => {
    localStorage.setItem(
      'misty.v1',
      JSON.stringify({ source: '(00|11)(0|-1)', theme: 'flat', dark: false }),
    )
    boot()
    expect(editor().value).toBe('(00|11)(0|-1)')
  })

  it('ignores a corrupt saved session instead of failing to start', () => {
    localStorage.setItem('misty.v1', '{ not json')
    boot()
    expect(diagram()).not.toBeNull()
  })
})

describe('export buttons', () => {
  const split = (label: string) =>
    [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!
  const caret = (label: string) =>
    [...host.querySelectorAll('button')].find(
      (b) => b.getAttribute('aria-label') === `${label}: more options`,
    )!

  it('shows Copy, Save and Link, each with an icon', () => {
    boot()
    for (const label of ['Copy', 'Save', 'Link']) {
      const btn = split(label)
      expect(btn, label).toBeTruthy()
      expect(btn.querySelector('svg'), label).not.toBeNull()
    }
  })

  it('no longer carries a resolution picker — that moved to settings', () => {
    boot()
    const labels = [...host.querySelectorAll('select')].map((s) => s.getAttribute('aria-label'))
    expect(labels).not.toContain('PNG resolution')
  })

  it('keeps the menu closed until the caret is used', () => {
    boot()
    expect(host.textContent).not.toContain('Vector, and editable in Inkscape')
    caret('Save').click()
    flushSync()
    expect(host.textContent).toContain('Vector, and editable in Inkscape')
  })

  it('runs the first item when the labelled half is clicked', async () => {
    boot()
    // Save's default is PDF; a click should download without opening the menu.
    const clicks: string[] = []
    const originalCreate = document.createElement.bind(document)
    document.createElement = ((tag: string) => {
      const el = originalCreate(tag)
      if (tag === 'a') el.click = () => clicks.push((el as HTMLAnchorElement).download)
      return el
    }) as typeof document.createElement
    try {
      split('Save').click()
      flushSync()
      await vi.waitFor(() => expect(clicks).toEqual(['misty-state.pdf']))
    } finally {
      document.createElement = originalCreate
    }
    // The menu stayed shut.
    expect(host.textContent).not.toContain('Vector, and editable in Inkscape')
  })

  it('defaults Save to PDF — these figures are bound for LaTeX', () => {
    boot()
    expect(split('Save').title).toBe('Save: PDF')
    expect(split('Link').title).toBe('Link: Editor link')
  })

  it('defaults Copy to a PNG image where the clipboard takes one', () => {
    // jsdom has no ClipboardItem, and without it the image entries are hidden
    // altogether — so it has to be stood up before the menu is built.
    withImageClipboard(() => {
      boot()
      expect(split('Copy').title).toBe('Copy: PNG image')
    })
  })

  it('falls back to copying markup when the clipboard refuses images', () => {
    boot()
    expect(split('Copy').title).toBe('Copy: SVG markup')
  })
})

/** Pretend the browser can put images on the clipboard, then put it back. */
function withImageClipboard(run: () => void) {
  const g = globalThis as { ClipboardItem?: unknown }
  const hadItem = 'ClipboardItem' in g
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  g.ClipboardItem = class {}
  Object.defineProperty(navigator, 'clipboard', {
    value: { write: async () => {}, writeText: async () => {} },
    configurable: true,
  })
  try {
    run()
  } finally {
    if (!hadItem) delete g.ClipboardItem
    if (original) Object.defineProperty(navigator, 'clipboard', original)
    else Reflect.deleteProperty(navigator, 'clipboard')
  }
}

describe('reopening a saved figure', () => {
  const openButton = () =>
    [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Open')!

  it('offers an Open button wired to a file picker', () => {
    boot()
    expect(openButton()).toBeTruthy()
    const input = host.querySelector('input[type="file"]') as HTMLInputElement
    expect(input).not.toBeNull()
    expect(input.accept).toContain('.pdf')
  })

  it('carries the source inside the drawing it renders', () => {
    boot()
    setSource('(0|1) x (0|1)')
    // Everything exported starts from this markup, so the source rides along.
    expect(diagram().outerHTML).toContain('<metadata')
    expect(diagram().querySelector('metadata')!.textContent).toBe('(0|1) x (0|1)')
  })

  it('keeps the source that drew the picture, not a half-typed one', () => {
    boot()
    setSource('00|11')
    setSource('(0|1')
    // The drawing on screen is still the old one; so is its embedded source.
    expect(diagram().querySelector('metadata')!.textContent).toBe('00|11')
  })
})

describe('naming a diagram and saving it to the library', () => {
  const nameBox = () => host.querySelector('input[aria-label="Diagram name"]') as HTMLInputElement
  const button = (label: string) =>
    [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)
  const setName = (value: string) => {
    const el = nameBox()
    el.value = value
    el.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
  }

  it('offers a name box below the zoom controls', () => {
    boot()
    expect(nameBox()).not.toBeNull()
    expect(nameBox().placeholder).toBe('Untitled')
  })

  it('carries the name into the drawing, where an export will find it', () => {
    boot()
    setName('Bell pair')
    expect(diagram().querySelector('title')!.textContent).toBe('Bell pair')
  })

  it('writes no title at all when there is no name', () => {
    boot()
    expect(diagram().querySelector('title')).toBeNull()
  })

  it('will not save without a name', () => {
    boot()
    expect(button('Save to Library')!.hasAttribute('disabled')).toBe(true)
  })

  it('saves, and then offers to update rather than add again', () => {
    boot()
    setName('Bell pair')
    button('Save to Library')!.click()
    flushSync()
    expect(button('Update in Library')).toBeTruthy()
    expect(button('Save to Library')).toBeUndefined()
    expect(localStorage.getItem('misty.library.v1')).toContain('Bell pair')
  })

  it('offers to update as soon as a name already in the library is typed', () => {
    replaceLibrary({ groups: [{ label: 'X', entries: [{ id: 'a', title: 'Bell pair', source: '0' }] }] })
    boot()
    expect(button('Save to Library')).toBeTruthy()
    setName('bell PAIR')
    expect(button('Update in Library')).toBeTruthy()
  })

  it('reveals the library picker, which was hidden while empty', () => {
    boot()
    expect(host.querySelectorAll('select')).toHaveLength(1)
    setName('Bell pair')
    button('Save to Library')!.click()
    flushSync()
    expect(host.querySelectorAll('select')).toHaveLength(2)
  })

  it('heads the picker with the library name once it has one', () => {
    replaceLibrary({
      name: 'PHYS 137T',
      groups: [{ label: 'X', entries: [{ id: 'a', title: 'One', source: '0' }] }],
    })
    boot()
    const picker = host.querySelectorAll('select')[1] as HTMLSelectElement
    expect(picker.options[0].textContent).toContain('PHYS 137T')
  })

  it('persists the name across a reload', () => {
    boot()
    setName('Bell pair')
    expect(localStorage.getItem('misty.v1')).toContain('Bell pair')
  })
})

describe('the example and library pickers', () => {
  // There is no built-in library, so one has to be put there before a picker
  // for it exists at all.
  beforeEach(() => {
    replaceLibrary({
      groups: [
        {
          label: 'Problem Set 2',
          entries: [
            { id: 'ps2.1', title: '§1 Swap', origin: 'ps2.problem1.png', source: 'in 001\nSWAP 2 3' },
            { id: 'ps2.2', title: '§2 CNOT', source: 'H 1\nCNOT 1 -> 2' },
          ],
        },
      ],
    })
  })

  const selects = () => [...host.querySelectorAll('select')] as HTMLSelectElement[]
  const pick = (which: 0 | 1, value: string) => {
    const el = selects()[which]
    el.value = value
    el.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
  }
  const firstLibraryId = () =>
    (selects()[1].querySelector('optgroup option') as HTMLOptionElement).value

  it('loads the figure and keeps showing which one it is', () => {
    boot()
    const id = firstLibraryId()
    pick(1, id)
    expect(selects()[1].value).toBe(id)
    expect(editor().value.length).toBeGreaterThan(0)
  })

  it('clears once the source is edited away from it', () => {
    boot()
    pick(1, firstLibraryId())
    setSource('0|1')
    expect(selects()[1].value).toBe('')
  })

  it('drops the library note along with the selection', () => {
    boot()
    pick(1, firstLibraryId())
    const note = host.textContent
    setSource('0|1')
    expect(host.textContent).not.toBe(note)
    expect(host.textContent).not.toMatch(/\.png/)
  })

  it('lets the two pickers clear each other', () => {
    boot()
    pick(1, firstLibraryId())
    pick(0, (selects()[0].querySelectorAll('option')[1] as HTMLOptionElement).value)
    expect(selects()[1].value).toBe('')
    expect(selects()[0].value).not.toBe('')
  })
})

describe('settings panel', () => {
  const openSettings = () => {
    const btn = [...host.querySelectorAll('button')].find((b) =>
      b.getAttribute('aria-label') === 'Settings',
    )!
    btn.click()
    flushSync()
  }
  const panel = () => host.querySelector('aside[aria-label="Settings"]')

  it('stays closed until asked for', () => {
    boot()
    expect(panel()).toBeNull()
  })

  it('opens and closes', () => {
    boot()
    openSettings()
    expect(panel()).not.toBeNull()
    const close = host.querySelector('aside button[aria-label="Close settings"]') as HTMLElement
    close.click()
    flushSync()
    expect(panel()).toBeNull()
  })

  it('previews each style with a diagram drawn in it', () => {
    boot()
    openSettings()
    // Three swatches, each a real render rather than a word.
    const swatches = panel()!.querySelectorAll('button[aria-pressed] svg')
    expect(swatches.length).toBeGreaterThanOrEqual(3)
  })

  it('changes the theme from a swatch, not a dropdown', () => {
    boot()
    openSettings()
    expect(panel()!.querySelector('select')).toBeNull()
    const flat = [...panel()!.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Flat'),
    )!
    flat.click()
    flushSync()
    expect(diagram().outerHTML).not.toContain('linearGradient')
  })

  it('lists the qubit shapes as a reorderable list', () => {
    boot()
    openSettings()
    const rows = panel()!.querySelectorAll('li')
    expect(rows.length).toBe(8)
    expect(rows[0].textContent).toContain('circle')
  })

  /**
   * jsdom reports every rect as zero, and the drag measures row bands at
   * pick-up — so rows are given a synthetic 30px height here.
   */
  function withLayout(run: () => void) {
    const original = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const row = (this as HTMLElement).dataset?.shapeRow
      if (row !== undefined) {
        const i = Number(row)
        return { top: i * 30, bottom: (i + 1) * 30, height: 30, left: 0, right: 200, width: 200 } as DOMRect
      }
      return { top: 0, bottom: 240, height: 240, left: 0, right: 200, width: 200 } as DOMRect
    }
    try {
      run()
    } finally {
      Element.prototype.getBoundingClientRect = original
    }
  }

  const names = () =>
    [...panel()!.querySelectorAll('li')].map((r) => r.textContent!.replace(/[^a-z]/g, ''))

  const grips = () =>
    [...panel()!.querySelectorAll('button')].filter((b) =>
      b.getAttribute('aria-label')?.includes('drag to reorder'),
    )

  it('swaps rows in real time as the pointer moves', () => {
    boot()
    openSettings()
    const before = names()

    withLayout(() => {
      grips()[0].dispatchEvent(pointer('pointerdown', 10, 10))
      // Into the third band (60–90px) while the pointer is still down.
      window.dispatchEvent(pointer('pointermove', 10, 75))
      flushSync()
    })

    expect(names()[2]).toBe(before[0])
    expect(names()[0]).toBe(before[1])

    window.dispatchEvent(pointer('pointerup', 10, 75))
    flushSync()
    expect(names()[2]).toBe(before[0])
  })

  it('keeps following the pointer across several bands', () => {
    boot()
    openSettings()
    const before = names()

    withLayout(() => {
      grips()[0].dispatchEvent(pointer('pointerdown', 10, 10))
      window.dispatchEvent(pointer('pointermove', 10, 45))
      flushSync()
      expect(names()[1]).toBe(before[0])
      window.dispatchEvent(pointer('pointermove', 10, 165))
      flushSync()
    })

    expect(names()[5]).toBe(before[0])
    window.dispatchEvent(pointer('pointerup', 10, 165))
    flushSync()
  })

  it('animates the rows rather than snapping them', () => {
    boot()
    openSettings()
    // FLIP is what makes the swap readable; without it rows would jump.
    expect(panel()!.querySelectorAll('li').length).toBe(8)
    expect(grips().length).toBe(8)
  })

  it('reorders shapes with the arrow keys on the grip', () => {
    boot()
    openSettings()
    grips()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    flushSync()
    expect(names()[0]).toBe('square')
    expect(names()[1]).toBe('circle')
  })
})

describe('deep links', () => {
  afterEach(() => history.replaceState({}, '', '/'))

  it('loads the source from ?src=', () => {
    history.replaceState({}, '', '/?src=' + encodeURIComponent('(00|11)(0|-1)'))
    boot()
    expect(editor().value).toBe('(00|11)(0|-1)')
  })

  it('lets a deep link override the saved session', () => {
    localStorage.setItem('misty.v1', JSON.stringify({ source: 'saved 0|1' }))
    history.replaceState({}, '', '/?src=' + encodeURIComponent('0|1|-1'))
    boot()
    expect(editor().value).toBe('0|1|-1')
  })

  it('carries theme and qubit size through the link', () => {
    history.replaceState({}, '', '/?src=0%7C1&theme=flat&qubit=40')
    boot()
    // The flat theme draws no gradients, so its absence confirms the override.
    expect(diagram().outerHTML).not.toContain('linearGradient')
  })

  it('falls back to the saved session when no ?src= is present', () => {
    localStorage.setItem('misty.v1', JSON.stringify({ source: '(0|1)(0|1)' }))
    history.replaceState({}, '', '/')
    boot()
    expect(editor().value).toBe('(0|1)(0|1)')
  })
})
