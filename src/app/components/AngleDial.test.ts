// @vitest-environment jsdom
/**
 * The angle dial: turned by hand, or typed into.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import AngleDial from './AngleDial.svelte'

let host: HTMLDivElement
let dial: Record<string, unknown> | undefined
let commit: ReturnType<typeof vi.fn>
let close: ReturnType<typeof vi.fn>

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  commit = vi.fn()
  close = vi.fn()
  dial = mount(AngleDial, {
    target: host,
    props: { angle: 45, at: { x: 100, y: 100 }, onpreview: () => {}, oncommit: commit, onclose: close },
  })
  flushSync()
})

afterEach(() => {
  if (dial) unmount(dial)
  host.remove()
})

const field = () => host.querySelector('input') as HTMLInputElement

function type(text: string, key = 'Enter') {
  const input = field()
  input.focus()
  input.value = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  flushSync()
}

describe('typing an angle', () => {
  it('shows the angle it opened at', () => {
    expect(field().value).toBe('45')
  })

  it('sets degrees on Enter', () => {
    type('22.5')
    expect(commit).toHaveBeenLastCalledWith(22.5)
    expect(field().value).toBe('22.5')
  })

  it('takes a multiple of π too', () => {
    type('3π/4')
    expect(commit).toHaveBeenLastCalledWith(135)
  })

  it('leaves the angle alone when what is typed is not one', () => {
    type('abc')
    expect(commit).not.toHaveBeenCalled()
  })

  it('keeps the arrow keys for the typing rather than nudging the dial', () => {
    field().focus()
    field().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    flushSync()
    expect(commit).not.toHaveBeenCalled()
  })

  it('gives up on Escape, writing nothing', () => {
    type('90', 'Escape')
    field().blur()
    flushSync()
    expect(commit).not.toHaveBeenCalled()
  })
})

describe('what it no longer says', () => {
  it('has no warning about cosines, now that they are drawn', () => {
    expect(host.textContent).not.toMatch(/cosines/)
  })
})
