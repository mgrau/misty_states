// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { colourHex, colourSwatches, findColours, openColourPicker, pickerRange } from './colours'
import { hexToHsv, hsvToHex } from './picker'

describe('colours in the source', () => {
  it('finds a hex value after an option, with where it sits', () => {
    const text = 'BOX "Oracle" 1-2 fill=#e6f0e6'
    const [c] = findColours(text)
    expect(text.slice(c.from, c.to)).toBe('#e6f0e6')
    expect(c.hex).toBe('#e6f0e6')
  })

  it('reads the short and alpha forms as the colour underneath', () => {
    expect(colourHex('#abc')).toBe('#aabbcc')
    expect(colourHex('#AABBCC80')).toBe('#aabbcc')
  })

  it('leaves alone what is not a colour', () => {
    expect(findColours('I 3 shift=2')).toEqual([])
    expect(findColours('BOX 1 border=none')).toEqual([])
    expect(findColours('H 1 # fill=#ff0000')).toEqual([])
    expect(findColours('BOX "fill=#ff0000" 1')).toEqual([])
  })

  it('counts its place across lines', () => {
    const text = 'H 1\n"P" 1-2 fill=#fef3c7 {'
    const [c] = findColours(text)
    expect(text.slice(c.from, c.to)).toBe('#fef3c7')
  })
})

describe('the picker', () => {
  const editor = (doc: string) => {
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    return new EditorView({ parent, state: EditorState.create({ doc, extensions: [colourSwatches()] }) })
  }

  it('opens under the colour, inside the editor', () => {
    const view = editor('BOX 1 fill=#fef3c7')
    openColourPicker(view, 13)
    expect(view.dom.querySelector('.ms-picker')).not.toBeNull()
    expect(pickerRange(view)).toEqual({ from: 11, to: 18 })
    view.destroy()
  })

  it('writes what is picked over the colour, again and again', () => {
    const view = editor('BOX 1 fill=#add8e6 {')
    openColourPicker(view, 13)
    const tints = view.dom.querySelectorAll<HTMLButtonElement>('.ms-picker-tint')
    tints[0].click()
    tints[2].click()
    expect(view.state.doc.toString()).toBe(`BOX 1 fill=${tints[2].title} {`)
    expect(pickerRange(view)).toEqual({ from: 11, to: 18 })
    view.destroy()
  })

  it('keeps the alpha it cannot show', () => {
    const view = editor('BOX 1 fill=#ff000080')
    openColourPicker(view, 13)
    view.dom.querySelector<HTMLButtonElement>('.ms-picker-tint')!.click()
    expect(view.state.doc.toString()).toMatch(/fill=#[0-9a-f]{6}80$/)
    view.destroy()
  })

  it('closes on Escape', () => {
    const view = editor('BOX 1 fill=#fef3c7')
    openColourPicker(view, 13)
    view.dom.querySelector('.ms-picker')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(pickerRange(view)).toBeNull()
    expect(view.dom.querySelector('.ms-picker')).toBeNull()
    view.destroy()
  })

  it('goes from hex to hue and back unchanged', () => {
    for (const hex of ['#fef3c7', '#1b3fae', '#000000', '#ffffff', '#ef5f5b']) {
      expect(hsvToHex(hexToHsv(hex))).toBe(hex)
    }
  })
})
