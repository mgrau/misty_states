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

describe('the syntax reference', () => {
  const openWith = (label: string) => {
    const btn = [...host.querySelectorAll('button')].find(
      (b) => b.getAttribute('aria-label') === label,
    )!
    btn.click()
    flushSync()
    return btn
  }
  const drawer = () => host.querySelector('aside[aria-label="Syntax"]')
  const rows = () => host.querySelector('[data-syntax-rows]')

  it('stays out of the way until it is asked for', () => {
    boot()
    expect(drawer()).toBeNull()
    expect(rows()).toBeNull()
  })

  it('opens in the drawer on the right, and lists the syntax', () => {
    boot()
    openWith('Syntax reference')
    expect(drawer()).not.toBeNull()
    expect(rows()!.querySelectorAll('dt').length).toBeGreaterThan(10)
  })

  it('groups the entries under headings rather than one flat list', () => {
    boot()
    openWith('Syntax reference')
    const headings = [...rows()!.querySelectorAll('h3')].map((h) => h.textContent!.trim())
    expect(headings.length).toBeGreaterThan(2)
    expect(headings).toContain('Qubits and superpositions')
  })

  it('keeps the two grammars on their own tabs', () => {
    boot()
    openWith('Syntax reference')
    const tab = (label: string) =>
      [...host.querySelectorAll<HTMLElement>('[role="tab"]')].find(
        (t) => t.textContent?.trim() === label,
      )!
    expect(rows()!.textContent).toContain('Superposition')
    tab('Circuits').click()
    flushSync()
    expect([...rows()!.querySelectorAll('h3')].map((h) => h.textContent!.trim()))
      .toContain('Controlled gates')
    expect(rows()!.textContent).not.toContain('Superposition')
  })

  it('scrolls its body while the tabs stay put', () => {
    boot()
    openWith('Syntax reference')
    // The reference is far longer than the panel, so the panel gives it a
    // scrolling region rather than growing past the bottom of the window.
    const body = drawer()!.querySelector('.overflow-y-auto')!
    expect(body.contains(rows())).toBe(true)
    expect(drawer()!.querySelector('[role="tablist"]')!.className).toMatch(/sticky/)
  })

  it('closes again from the same button', () => {
    boot()
    const btn = openWith('Syntax reference')
    expect(btn.getAttribute('aria-pressed')).toBe('true')
    btn.click()
    flushSync()
    expect(drawer()).toBeNull()
  })

  it('gives way to settings rather than sharing the drawer', () => {
    boot()
    openWith('Syntax reference')
    openWith('Settings')
    expect(drawer()).toBeNull()
    expect(host.querySelector('aside[aria-label="Settings"]')).not.toBeNull()
    openWith('Syntax reference')
    expect(host.querySelector('aside[aria-label="Settings"]')).toBeNull()
    expect(drawer()).not.toBeNull()
  })
})

describe('PNG resolution', () => {
  const openSettings = () => {
    const btn = [...host.querySelectorAll('button')].find(
      (b) => b.getAttribute('aria-label') === 'Settings',
    )!
    btn.click()
    flushSync()
  }
  const buttons = () =>
    [...host.querySelectorAll<HTMLButtonElement>('aside button')].filter((b) =>
      /dpi$/.test(b.textContent!.trim()),
    )

  it('offers real print resolutions, not multipliers', () => {
    boot()
    openSettings()
    expect(buttons().map((b) => b.textContent!.trim())).toEqual(['150 dpi', '300 dpi', '600 dpi'])
  })

  it('starts at 300, the usual print requirement', () => {
    boot()
    openSettings()
    const on = buttons().find((b) => b.getAttribute('aria-pressed') === 'true')
    expect(on!.textContent!.trim()).toBe('300 dpi')
  })

  it('rasterises at the scale that dpi implies', () => {
    boot()
    openSettings()
    // 96 CSS pixels to the inch, so 600 dpi is 6.25x actual size.
    buttons().find((b) => b.textContent!.trim() === '600 dpi')!.click()
    flushSync()
    expect(host.querySelector('aside')!.textContent).toContain('6.25× actual size')
  })

  it('says the resolution in the export menus too', () => {
    boot()
    const caret = [...host.querySelectorAll('button')].find(
      (b) => b.getAttribute('aria-label') === 'Save: more options',
    )!
    caret.click()
    flushSync()
    expect(host.textContent).toContain('Raster at 300 dpi')
  })
})

describe('the correctness badge', () => {
  const badge = () => host.querySelector('[role="status"]')
  const dismiss = () =>
    host.querySelector('button[aria-label="Dismiss the check"]') as HTMLElement

  it('stays away when the diagram claims nothing', () => {
    boot()
    setSource('00|11')
    expect(badge()).toBeNull()
  })

  it('says so quietly when an equation holds', () => {
    boot()
    setSource('00|01 = 0(0|1)')
    expect(badge()!.textContent).toContain('Checks out')
  })

  it('says so when it does not', () => {
    boot()
    setSource('00|01 = 0(0|-1)')
    expect(badge()!.textContent).toContain("Doesn't check out")
    // The line has room to say what went wrong, so it says it rather than
    // keeping it in a tooltip.
    expect(badge()!.textContent).toMatch(/not the same state/)
  })

  it('still draws the wrong diagram', () => {
    boot()
    setSource('00|01 = 0(0|-1)')
    expect(diagram()).not.toBeNull()
    expect(host.textContent).not.toMatch(/unclosed|unexpected/i)
  })

  it('can be waved away, for a figure that is wrong on purpose', () => {
    boot()
    setSource('00|01 = 0(0|-1)')
    dismiss().click()
    flushSync()
    expect(badge()).toBeNull()
  })

  it('comes back when the diagram changes, since it is about something else now', () => {
    boot()
    setSource('00|01 = 0(0|-1)')
    dismiss().click()
    flushSync()
    expect(badge()).toBeNull()
    setSource('00|01 = 0(0|-1)|0')
    expect(badge()).not.toBeNull()
  })

  it('turns off from settings', () => {
    boot()
    setSource('00|01 = 0(0|-1)')
    expect(badge()).not.toBeNull()
    const gear = [...host.querySelectorAll('button')].find(
      (b) => b.getAttribute('aria-label') === 'Settings',
    )!
    gear.click()
    flushSync()
    const toggle = host.querySelector(
      'button[aria-label="Check the diagram"]',
    ) as HTMLElement
    toggle.click()
    flushSync()
    expect(badge()).toBeNull()
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
    expect(button('Add')!.hasAttribute('disabled')).toBe(true)
  })

  it('saves, and then offers to update rather than add again', () => {
    boot()
    setName('Bell pair')
    button('Add')!.click()
    flushSync()
    expect(button('Update')).toBeTruthy()
    expect(button('Add')).toBeUndefined()
    expect(localStorage.getItem('misty.library.v1')).toContain('Bell pair')
  })

  it('offers to update as soon as a name already in the library is typed', () => {
    replaceLibrary({ groups: [{ label: 'X', entries: [{ id: 'a', title: 'Bell pair', source: '0' }] }] })
    boot()
    expect(button('Add')).toBeTruthy()
    setName('bell PAIR')
    expect(button('Update')).toBeTruthy()
  })

  it('reveals the library picker, which was hidden while empty', () => {
    boot()
    expect(host.querySelectorAll('select')).toHaveLength(1)
    setName('Bell pair')
    button('Add')!.click()
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

  /**
   * Arrow keys step the selection instead of opening the menu, since flicking
   * through figures one at a time is the common thing to want.
   */
  describe('arrow keys', () => {
    const arrow = (which: 0 | 1, key: 'ArrowDown' | 'ArrowUp', alt = false) => {
      const event = new KeyboardEvent('keydown', { key, altKey: alt, bubbles: true, cancelable: true })
      selects()[which].dispatchEvent(event)
      flushSync()
      return event
    }

    const libraryIds = () =>
      [...selects()[1].querySelectorAll('optgroup option')].map(
        (o) => (o as HTMLOptionElement).value,
      )

    it('enters the list from the placeholder', () => {
      boot()
      expect(selects()[1].value).toBe('')
      arrow(1, 'ArrowDown')
      expect(selects()[1].value).toBe(libraryIds()[0])
    })

    it('comes in at the far end going up', () => {
      boot()
      arrow(1, 'ArrowUp')
      expect(selects()[1].value).toBe(libraryIds().at(-1))
    })

    it('moves one at a time and loads as it goes', () => {
      boot()
      arrow(1, 'ArrowDown')
      const first = editor().value
      arrow(1, 'ArrowDown')
      expect(selects()[1].value).toBe(libraryIds()[1])
      expect(editor().value).not.toBe(first)
      arrow(1, 'ArrowUp')
      expect(selects()[1].value).toBe(libraryIds()[0])
      expect(editor().value).toBe(first)
    })

    it('stops at either end rather than wrapping', () => {
      boot()
      const ids = libraryIds()
      arrow(1, 'ArrowUp')
      expect(selects()[1].value).toBe(ids.at(-1))
      arrow(1, 'ArrowDown')
      expect(selects()[1].value).toBe(ids.at(-1))
    })

    it('keeps the menu shut, including at the ends', () => {
      boot()
      expect(arrow(1, 'ArrowDown').defaultPrevented).toBe(true)
      const ids = libraryIds()
      for (let i = 1; i < ids.length; i++) arrow(1, 'ArrowDown')
      expect(arrow(1, 'ArrowDown').defaultPrevented).toBe(true)
    })

    it('leaves Alt+Arrow alone, which is how the menu still opens', () => {
      boot()
      const event = arrow(1, 'ArrowDown', true)
      expect(event.defaultPrevented).toBe(false)
      expect(selects()[1].value).toBe('')
    })

    it('steps the examples too, and the two still clear each other', () => {
      boot()
      arrow(1, 'ArrowDown')
      arrow(0, 'ArrowDown')
      expect(selects()[0].value).not.toBe('')
      expect(selects()[1].value).toBe('')
    })
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

/**
 * Playing an animation.
 *
 * The controls drive the drawing through two CSS variables rather than through
 * the DOM, so what these check is that the right variables land on the right
 * element — the SVG itself is the same file that plays unattended elsewhere.
 */
describe('animation controls', () => {
  const ANIMATED = 'in 11\nCNOT 1 -> 2\nanimate'

  const bar = () =>
    [...host.querySelectorAll('button')].filter((b) =>
      [
        'Play', 'Pause', 'Next step', 'Previous step', 'Back to the start',
        'Repeating — click to play once', 'Play once — click to repeat',
      ].includes(
        b.getAttribute('title') ?? '',
      ),
    )
  const press = (title: string) => {
    const button = bar().find((b) => b.getAttribute('title') === title)!
    button.click()
    flushSync()
  }
  const stage = () => host.querySelector('[data-preview]') as HTMLElement
  const at = () => stage().style.getPropertyValue('--misty-at')
  /** The clock is ours, so what is running is a button label, not a CSS value. */
  const running = () => bar().some((b) => b.getAttribute('title') === 'Pause')

  it('appears only when the drawing is an animation', () => {
    boot()
    setSource('00|11')
    expect(bar()).toHaveLength(0)
    setSource(ANIMATED)
    expect(bar().length).toBeGreaterThan(0)
  })

  /** Let a handful of animation frames actually happen. */
  const frames = (ms = 140) => new Promise((done) => setTimeout(done, ms))

  /** Wait for the clock to get somewhere, rather than for a fixed spell. */
  const advanced = async () => {
    for (let i = 0; i < 25 && seconds() <= 0.03; i++) await frames(30)
    return seconds()
  }
  /** The clock, read back off the element. A sign slip here emits "--0.6s". */
  const seconds = () => {
    const raw = at()
    expect(raw, 'the seek must stay a single negative delay').toMatch(/^-\d/)
    return Math.abs(parseFloat(raw))
  }

  it('actually advances the clock while playing', async () => {
    // The clock is ours, so this is the one thing that proves it runs. It has
    // been broken twice by effects that reset it every frame — running, but
    // never getting anywhere.
    boot()
    setSource(ANIMATED)
    expect(seconds()).toBe(0)
    expect(await advanced()).toBeGreaterThan(0.03)
  })

  it('stops advancing once paused', async () => {
    boot()
    setSource(ANIMATED)
    await advanced()
    press('Pause')
    const held = seconds()
    await frames()
    expect(seconds()).toBe(held)
  })

  it('steps from where the run had got to, not from the start', async () => {
    // Cutting back to nought before stepping is what made the sequence look
    // out of order.
    boot()
    setSource(ANIMATED)
    const reached = await advanced()
    press('Next step')
    expect(seconds()).toBeGreaterThanOrEqual(reached - 1e-6)
  })

  it('starts playing from the beginning', () => {
    boot()
    setSource(ANIMATED)
    expect(running()).toBe(true)
    expect(at()).toBe('-0s')
  })

  it('pauses and resumes', () => {
    boot()
    setSource(ANIMATED)
    press('Pause')
    expect(running()).toBe(false)
    press('Play')
    expect(running()).toBe(true)
  })

  it('counts four stops for one gate, in the order they happen', () => {
    boot()
    setSource(ANIMATED)
    expect(host.textContent).toContain('1/4')
    expect(host.textContent).toContain('Before gate 1')
  })

  it('stepping pauses, so it does not run away from where it was put', () => {
    boot()
    setSource(ANIMATED)
    press('Next step')
    expect(running()).toBe(false)
  })

  it('rewinds at once rather than travelling back', async () => {
    // Every other move plays its motion; this one is a jump, because getting
    // back to the start is a thing you want done, not watched.
    boot()
    setSource(ANIMATED)
    await advanced()
    press('Back to the start')
    expect(seconds()).toBe(0)
    expect(running()).toBe(false)
  })

  const scrubber = () => host.querySelector('input[type=range][list]') as HTMLInputElement
  const scrubTo = (value: number) => {
    scrubber().value = String(value)
    scrubber().dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
  }

  const ON = 'Repeating — click to play once'
  const OFF = 'Play once — click to repeat'
  const repeats = () => bar().some((b) => b.getAttribute('title') === ON)

  it('plays once by default, and can be told to repeat', () => {
    boot()
    setSource(ANIMATED)
    expect(repeats()).toBe(false)
    press(OFF)
    expect(repeats()).toBe(true)
    press(ON)
    expect(repeats()).toBe(false)
  })

  it('follows what the source asked for', () => {
    boot()
    setSource('in 11\nCNOT 1 -> 2\nanimate loop=on')
    expect(repeats()).toBe(true)
    setSource(ANIMATED)
    expect(repeats()).toBe(false)
  })

  it('starts again when told to repeat at the end of a run', async () => {
    // Asking for it to repeat while looking at the last frame can only mean
    // one thing; waiting to be told to play as well is the button not working.
    boot()
    setSource('in 1\nX 1\nanimate speed=6')
    for (let i = 0; i < 25 && running(); i++) await frames(30)
    expect(running()).toBe(false)
    press(OFF)
    expect(running()).toBe(true)
    expect(seconds()).toBeLessThan(0.5)
  })

  it('ends the scrubber where the motion ends, not after the pause', () => {
    // The wait before running round again is worth having and worth nothing to
    // look at, so it is not part of the track.
    boot()
    setSource(ANIMATED)
    const marks = [...host.querySelectorAll('#misty-keyframes option')].map((o) =>
      Number((o as HTMLOptionElement).value),
    )
    expect(Number(scrubber().max)).toBeCloseTo(marks[marks.length - 1], 2)
    // And that really is short of the whole run, the pause being real.
    expect(Number(scrubber().max)).toBeLessThan(2.2)
  })

  it('stops at the end when it is not repeating', async () => {
    boot()
    setSource('in 1\nX 1\nanimate loop=off speed=6')
    for (let i = 0; i < 25 && running(); i++) await frames(30)
    expect(running()).toBe(false)
    expect(seconds()).toBeCloseTo(Number(scrubber().max), 2)
  })

  it('marks the keyframes on the scrubber', () => {
    boot()
    setSource(ANIMATED)
    const list = host.querySelector(`#${scrubber().getAttribute('list')}`)!
    expect(list.querySelectorAll('option')).toHaveLength(4)
  })

  it('catches on a keyframe when scrubbed near one', () => {
    boot()
    setSource(ANIMATED)
    const marks = [...host.querySelectorAll('#misty-keyframes option')].map((o) =>
      Number((o as HTMLOptionElement).value),
    )
    // The tick is rounded onto the slider's grid; the landing is the exact
    // keyframe, which is a hundredth of a second at most from it.
    const target = marks[2]
    scrubTo(target + 0.01)
    expect(seconds()).toBeCloseTo(target, 2)
    expect(seconds()).not.toBe(target + 0.01)
  })

  it('still scrubs freely between them', () => {
    boot()
    setSource(ANIMATED)
    const marks = [...host.querySelectorAll('#misty-keyframes option')].map((o) =>
      Number((o as HTMLOptionElement).value),
    )
    const between = (marks[1] + marks[2]) / 2
    scrubTo(between)
    expect(seconds()).toBeCloseTo(between, 6)
  })

  it('starts the next diagram from its own beginning', () => {
    // A position part-way through one run means nothing in another.
    boot()
    setSource(ANIMATED)
    press('Next step')
    setSource('in 001\nSWAP 2 3\nanimate')
    expect(at()).toBe('-0s')
    expect(running()).toBe(true)
    expect(host.textContent).toContain('1/4')
  })
})

/**
 * The two toggles that change how a figure is read rather than what it says.
 *
 * Both live beside the zoom, and both are off to begin with — a reader who has
 * not asked to step through a circuit should not be given a row of controls
 * over the drawing.
 */
describe('reading a circuit another way', () => {
  const STEPPED = 'in 001\nSWAP 2 3\nCNOT 2 -> 1; X 3'
  /**
   * The two view switches live in the settings drawer, so reaching one means
   * opening it. They are found by what they do rather than by their text, which
   * is a sentence there rather than a word on a button.
   */
  const toggle = (label: string) => {
    const settings = [...host.querySelectorAll('button')].find(
      (b) => b.getAttribute('aria-label') === 'Settings',
    )!
    if (!host.querySelector('aside[aria-label="Settings"]')) {
      settings.click()
      flushSync()
    }
    return [...host.querySelectorAll<HTMLButtonElement>('aside button')].find(
      (b) => b.getAttribute('aria-label') === label,
    )
  }
  const STEP = 'Step through the circuit'
  const DIRAC = 'Write the state in Dirac notation'
  const stepSlider = () =>
    host.querySelector('input[aria-label="Step through the circuit"]') as HTMLInputElement | null
  const stepTo = (value: number) => {
    const el = stepSlider()!
    el.value = String(value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
  }

  it('offers stepping only once there is a gate to step past', () => {
    boot()
    setSource('00|11')
    expect(toggle(STEP)).toBeUndefined()
    setSource(STEPPED)
    expect(toggle(STEP)).toBeTruthy()
  })

  it('shows no controls until asked, then a slider over the layers', () => {
    boot()
    setSource(STEPPED)
    expect(stepSlider()).toBeNull()
    toggle(STEP)!.click()
    flushSync()
    expect(stepSlider()!.max).toBe('2')
    expect(host.textContent).toContain('before any gate')
  })

  it('redraws as it is stepped, and says where it has got to', () => {
    boot()
    setSource(STEPPED)
    toggle(STEP)!.click()
    flushSync()
    const start = diagram().outerHTML
    stepTo(1)
    expect(diagram().outerHTML).not.toBe(start)
    expect(host.textContent).toContain('after 1 of 2')
    stepTo(2)
    expect(host.textContent).toContain('after the last gate')
  })

  it('puts the controls away when the next diagram has nothing to step', () => {
    boot()
    setSource(STEPPED)
    toggle(STEP)!.click()
    flushSync()
    setSource('00|11')
    expect(stepSlider()).toBeNull()
  })

  it('writes the state out in Dirac notation, following the step', () => {
    boot()
    setSource(STEPPED)
    toggle(DIRAC)!.click()
    flushSync()
    expect(host.textContent).toContain('|111⟩')

    toggle(STEP)!.click()
    flushSync()
    // The written state has to be the one drawn above it, not the last one.
    expect(host.textContent).toContain('|001⟩')
    stepTo(1)
    expect(host.textContent).toContain('|010⟩')
  })

  it('offers the writing for a bare state too', () => {
    boot()
    setSource('00|11')
    toggle(DIRAC)!.click()
    flushSync()
    expect(host.textContent).toContain('(|00⟩ + |11⟩)/√2')
  })
})

/**
 * The gallery of gates.
 *
 * A name says nothing about what a gate looks like on the page, and knowing
 * which glyph you are after is half of writing one of these figures — so this
 * tab draws each one rather than describing it.
 */
describe('the gate gallery', () => {
  const open = () => {
    const btn = [...host.querySelectorAll('button')].find(
      (b) => b.getAttribute('aria-label') === 'Syntax reference',
    )!
    btn.click()
    flushSync()
    const tab = [...host.querySelectorAll<HTMLElement>('[role="tab"]')].find(
      (t) => t.textContent?.trim() === 'Gates',
    )!
    tab.click()
    flushSync()
  }
  const gallery = () => host.querySelector('[data-gate-gallery]')

  it('is a third tab beside the two grammars', () => {
    boot()
    open()
    expect(gallery()).not.toBeNull()
    // The written reference gives way to it rather than sitting underneath.
    expect(host.querySelector('[data-syntax-rows]')).toBeNull()
  })

  it('draws every gate rather than describing it', () => {
    boot()
    open()
    const swatches = gallery()!.querySelectorAll('svg')
    expect(swatches.length).toBeGreaterThan(12)
    // Drawn by the real renderer, so a gate that stopped drawing shows up here.
    for (const svg of swatches) expect(svg.querySelector('rect, path, line')).not.toBeNull()
  })

  it('shows the line that draws each one', () => {
    boot()
    open()
    const codes = [...gallery()!.querySelectorAll('code')].map((c) => c.textContent!.trim())
    expect(codes).toContain('H 1')
    expect(codes).toContain('CNOT 1 2')
    expect(codes).toContain('TOFFOLI 1 2 3')
    expect(codes).toContain('CNOT "Oracle" 1 3')
    expect(codes).toContain('measure 1 Z')
  })

  it('groups by what a thing is, not by when it was added', () => {
    boot()
    open()
    const headings = [...gallery()!.querySelectorAll('h3')].map((h) => h.textContent!.trim())
    expect(headings).toEqual(['One wire', 'Two or more wires', 'Views', 'Boxes'])
  })

  it('draws in the theme the diagram is using', () => {
    boot()
    open()
    const before = gallery()!.innerHTML
    // The isometric theme projects its bodies, so the markup has to change.
    const btn = [...host.querySelectorAll('button')].find(
      (b) => b.getAttribute('aria-label') === 'Settings',
    )!
    btn.click()
    flushSync()
    const iso = [...host.querySelectorAll<HTMLElement>('aside button')].find((b) =>
      b.textContent?.includes('Isometric'),
    )!
    iso.click()
    flushSync()
    btn.click()
    flushSync()
    open()
    expect(gallery()!.innerHTML).not.toBe(before)
  })
})

/**
 * The palette beside the source box.
 *
 * The same gates the reference draws, with the words taken away. It exists so
 * that placing one does not mean opening a drawer that covers the drawing you
 * are placing it on.
 */
describe('the gate palette', () => {
  const tiles = () => [...host.querySelectorAll('[data-palette-gate]')]

  it('offers the gates without a panel having to be open', () => {
    boot()
    expect(host.querySelector('aside')).toBeNull()
    expect(tiles().length).toBeGreaterThan(10)
  })

  it('draws each one rather than naming it', () => {
    boot()
    for (const tile of tiles()) {
      expect(tile.querySelector('svg')).not.toBeNull()
      // Compact: the picture is the label, and the words are in the tooltip.
      // A gate's own lettering is part of the drawing, so only text *outside*
      // the drawing counts as naming it.
      const drawn = tile.querySelector('svg')!.textContent ?? ''
      expect(tile.textContent!.replace(drawn, '').trim()).toBe('')
      expect(tile.getAttribute('title')).toBeTruthy()
    }
  })

  it('offers only what can actually be dropped', () => {
    boot()
    const codes = tiles().map((t) => t.getAttribute('data-palette-gate'))
    expect(codes).toContain('H 1')
    expect(codes).toContain('CNOT 1 2')
    // A named gate needs a name, which is a decision to type rather than drag.
    expect(codes).not.toContain('CNOT 1 2 "Tiger?"')
  })

  it('shows the same set the reference does', () => {
    boot()
    const btn = [...host.querySelectorAll('button')].find(
      (b) => b.getAttribute('aria-label') === 'Syntax reference',
    )!
    btn.click()
    flushSync()
    const tab = [...host.querySelectorAll<HTMLElement>('[role="tab"]')].find(
      (t) => t.textContent?.trim() === 'Gates',
    )!
    tab.click()
    flushSync()
    const gallery = [...host.querySelectorAll('[data-gate]')].map((t) => t.getAttribute('data-gate'))
    // One list behind both, so a gate cannot appear in one and not the other.
    for (const code of tiles().map((t) => t.getAttribute('data-palette-gate'))) {
      expect(gallery).toContain(code)
    }
  })
})
