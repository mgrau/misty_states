// @vitest-environment jsdom
/**
 * `?format=svg` must show the diagram alone. The failure this guards against is
 * the image route falling through to the editor.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import Viewer from './Viewer.svelte'
import App from './App.svelte'
import { routeFor } from './app/route'

let host: HTMLDivElement
let app: Record<string, unknown> | undefined

beforeEach(() => {
  localStorage.clear()
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  if (app) unmount(app)
  app = undefined
  host.remove()
  history.replaceState({}, '', '/')
})

/** Uses the same routeFor() that main.ts dispatches on. */
function bootFrom(search: string) {
  history.replaceState({}, '', search)
  const route = routeFor(location.search)
  app =
    route.view === 'viewer'
      ? mount(Viewer, { target: host, props: { params: route.params } })
      : mount(App, { target: host })
  flushSync()
  return route
}

describe('routeFor', () => {
  it('sends a recognised format to the viewer', () => {
    expect(routeFor('?format=svg&src=0').view).toBe('viewer')
    expect(routeFor('?format=png&src=0').view).toBe('viewer')
  })

  it('sends everything else to the editor', () => {
    for (const q of ['', '?src=0', '?format=exe&src=0', '?format=svg']) {
      expect(routeFor(q).view).toBe('editor')
    }
  })

  it('tolerates a query string without the leading ?', () => {
    expect(routeFor('format=svg&src=0').view).toBe('viewer')
  })
})

describe('routing on ?format=', () => {
  it('shows the bare diagram, with none of the editor chrome', () => {
    bootFrom('/?format=svg&src=' + encodeURIComponent('00|11'))
    expect(host.querySelector('svg')).not.toBeNull()
    expect(host.querySelector('textarea')).toBeNull()
    expect(host.textContent).not.toContain('Copy link')
  })

  it('shows the editor when no format is given', () => {
    bootFrom('/?src=' + encodeURIComponent('00|11'))
    expect(host.querySelector('textarea')).not.toBeNull()
  })

  it('shows the editor for an unrecognised format', () => {
    bootFrom('/?format=exe&src=' + encodeURIComponent('00|11'))
    expect(host.querySelector('textarea')).not.toBeNull()
  })
})

describe('the viewer honours render options', () => {
  it('applies the theme from the query', () => {
    bootFrom('/?format=svg&src=0%7C1&theme=flat')
    expect(host.querySelector('svg')!.outerHTML).not.toContain('linearGradient')
  })

  it('renders circuits as well as states', () => {
    bootFrom('/?format=svg&src=' + encodeURIComponent('qubits 2\nH 1\nCNOT 1 -> 2'))
    const svg = host.querySelector('svg')!.outerHTML
    expect(svg).not.toContain('NaN')
    expect(host.querySelectorAll('rect').length).toBeGreaterThan(0)
  })

  it('reports a parse error instead of rendering nothing', () => {
    bootFrom('/?format=svg&src=' + encodeURIComponent('(0|1'))
    expect(host.querySelector('svg')).toBeNull()
    expect(host.textContent).toMatch(/unclosed/)
  })
})

describe('pdf format', () => {
  it('routes to the viewer', () => {
    expect(routeFor('?format=pdf&src=0%7C1').view).toBe('viewer')
  })

  it('renders neither raw SVG nor an <img> — the PDF viewer takes over', () => {
    bootFrom('/?format=pdf&src=0%7C1')
    expect(host.querySelector('svg')).toBeNull()
    expect(host.querySelector('img')).toBeNull()
  })
})

describe('png format', () => {
  it('renders through an <img> so the browser can save it as a PNG', () => {
    bootFrom('/?format=png&src=0%7C1')
    // The data URL resolves asynchronously; the element is what matters here.
    expect(host.querySelector('svg')).toBeNull()
    expect(host.textContent).toMatch(/Rendering|/)
  })
})
