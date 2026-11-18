/**
 * A colour in the source, shown as the colour it is, and picked rather than
 * typed.
 *
 * `fill=#e6f0e6` says nothing to anyone who does not read hex, and the only
 * way to find the green you want by typing is to keep typing. So each colour
 * value is painted with itself, and a click on it opens a picker under it;
 * what is picked is written back in place, as hex.
 */

import { RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state'
import {
  Decoration, EditorView, ViewPlugin, keymap, showTooltip, type DecorationSet, type Tooltip, type ViewUpdate,
} from '@codemirror/view'
import { colourPicker } from './picker'

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

/**
 * `name=value` where the value could be a colour. The name is not checked: the
 * parser decides which options take a colour, and anything it would reject
 * is underlined there, not here. `shift=2` and `loop=on` fall out because
 * neither value is a colour.
 */
const OPTION = /(?:^|\s)[a-z]+=(#[0-9a-f]+|[a-z]+)(?=[\s{}]|$)/gi

/** The colour's own `#rrggbb`, or undefined if this is not a colour. */
export function colourHex(value: string): string | undefined {
  const m = HEX.exec(value)
  if (m) {
    const d = m[1].length <= 4 ? [...m[1].slice(0, 3)].map((c) => c + c).join('') : m[1].slice(0, 6)
    return `#${d.toLowerCase()}`
  }
  if (value === 'none' || value === 'transparent') return undefined
  return namedHex(value)
}

let probe: CanvasRenderingContext2D | null | undefined

/** What the browser makes of a colour name, as hex: it knows the list better. */
function namedHex(name: string): string | undefined {
  if (typeof CSS === 'undefined' || !CSS.supports?.('color', name)) return undefined
  if (probe === undefined) {
    try {
      probe = document.createElement('canvas').getContext('2d')
    } catch {
      probe = null
    }
  }
  if (!probe) return undefined
  probe.fillStyle = '#000000'
  probe.fillStyle = name
  const out = String(probe.fillStyle)
  return HEX.test(out) ? out.toLowerCase() : undefined
}

/** Black or white, whichever reads on top of `hex`. */
function inkOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  return lum > 0.35 ? '#111111' : '#ffffff'
}

/** A line with its comment and quoted text blanked out, columns kept. */
function bare(line: string): string {
  let out = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') quoted = !quoted
    else if (!quoted && c === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      return out + ' '.repeat(line.length - i)
    }
    out += quoted || c === '"' ? ' ' : c
  }
  return out
}

/** Each colour value in `text`, with where it sits and what it is. */
export function findColours(text: string): { from: number; to: number; hex: string }[] {
  const out: { from: number; to: number; hex: string }[] = []
  let at = 0
  for (const line of text.split('\n')) {
    for (const m of bare(line).matchAll(OPTION)) {
      const hex = colourHex(m[1])
      if (!hex) continue
      const from = at + m.index! + m[0].length - m[1].length
      out.push({ from, to: from + m[1].length, hex })
    }
    at += line.length + 1
  }
  return out
}

function decorate(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  for (const { from, to } of view.visibleRanges) {
    const start = view.state.doc.lineAt(from).from
    const text = view.state.doc.sliceString(start, view.state.doc.lineAt(to).to)
    for (const c of findColours(text)) {
      builder.add(start + c.from, start + c.to, Decoration.mark({
        class: 'ms-colour',
        attributes: {
          style: `background-color: ${c.hex}; --ms-colour-ink: ${inkOn(c.hex)}`,
          title: 'Click to pick a colour',
        },
      }))
    }
  }
  return builder.finish()
}

/** Where the open picker is writing, or null when there is none. */
interface Open {
  from: number
  to: number
  /** `80` of `#rrggbb80`: the picker has no alpha, so what was there is kept. */
  alpha: string
  tooltip: Tooltip
}

const openPicker = StateEffect.define<{ from: number; to: number; alpha: string; hex: string }>()
const closePicker = StateEffect.define<null>()
/** The picker's own write: where its colour now sits, said outright. */
const movePicker = StateEffect.define<{ from: number; to: number }>()

/**
 * The picker, as a tooltip under the colour it edits.
 *
 * A tooltip so the editor places it — under the word, flipped above it near
 * the bottom of the window, moving with it as the box scrolls — and so it goes
 * away with the editor rather than being left behind on the page.
 */
const picking = StateField.define<Open | null>({
  create: () => null,
  update(open, tr) {
    for (const e of tr.effects) {
      if (e.is(closePicker)) return null
      if (e.is(openPicker)) {
        const { from, to, alpha, hex } = e.value
        return {
          from, to, alpha,
          tooltip: {
            pos: from,
            above: false,
            create: (view) => {
              const dom = colourPicker(
                hex,
                (next) => write(view, next),
                () => {
                  view.dispatch({ effects: closePicker.of(null) })
                  view.focus()
                },
              )
              return { dom }
            },
          },
        }
      }
    }
    if (!open) return null
    const moved = tr.effects.find((e) => e.is(movePicker))?.value as { from: number; to: number } | undefined
    if (moved) open = { ...open, ...moved }
    else if (tr.docChanged) {
      // Typing just before the colour pushes it along; typing just after it
      // does not make the colour longer.
      const from = tr.changes.mapPos(open.from, 1)
      const to = Math.max(from, tr.changes.mapPos(open.to, -1))
      // Text before the colour moved it: the tooltip has to follow.
      const tooltip = from === open.from ? open.tooltip : { ...open.tooltip, pos: from }
      open = { ...open, from, to, tooltip }
    }
    // The caret going somewhere else is the editor's way of saying "done".
    if (tr.selection && !tr.docChanged) {
      const head = tr.selection.main.head
      if (head < open.from || head > open.to) return null
    }
    return open
  },
  provide: (f) => showTooltip.from(f, (open) => open?.tooltip ?? null),
})

/** Put `hex` where the open picker's colour is, keeping any alpha it had. */
function write(view: EditorView, hex: string) {
  const open = view.state.field(picking, false)
  if (!open) return
  const insert = hex + open.alpha
  if (view.state.sliceDoc(open.from, open.to) === insert) return
  view.dispatch({
    changes: { from: open.from, to: open.to, insert },
    effects: movePicker.of({ from: open.from, to: open.from + insert.length }),
    userEvent: 'input.colour',
  })
}

/** Open the picker on the colour at `pos`, if there is one there. */
function pick(view: EditorView, pos: number) {
  const line = view.state.doc.lineAt(pos)
  const hit = findColours(line.text).find((c) => line.from + c.from <= pos && pos <= line.from + c.to)
  if (!hit) return
  const original = line.text.slice(hit.from, hit.to)
  const alpha = /^#[0-9a-f]{8}$/i.test(original) ? original.slice(7)
    : /^#[0-9a-f]{4}$/i.test(original) ? original[4] + original[4] : ''
  view.dispatch({
    effects: openPicker.of({ from: line.from + hit.from, to: line.from + hit.to, alpha, hex: hit.hex }),
  })
}

export function colourSwatches(): Extension {
  return [
    picking,
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet
        constructor(view: EditorView) {
          this.decorations = decorate(view)
        }
        update(u: ViewUpdate) {
          if (u.docChanged || u.viewportChanged) this.decorations = decorate(u.view)
        }
      },
      { decorations: (v) => v.decorations },
    ),
    EditorView.domEventHandlers({
      click(event, view) {
        const el = (event.target as HTMLElement | null)?.closest?.('.ms-colour') as HTMLElement | null
        if (!el) return false
        pick(view, view.posAtDOM(el, 0))
        return false
      },
    }),
    keymap.of([{
      key: 'Escape',
      run: (view) => {
        if (!view.state.field(picking, false)) return false
        view.dispatch({ effects: closePicker.of(null) })
        return true
      },
    }]),
    // Pressed anywhere outside both the editor and the picker, it closes.
    ViewPlugin.define((view) => {
      const away = (e: PointerEvent) => {
        if (!view.state.field(picking, false)) return
        const t = e.target as Node
        if (view.dom.contains(t)) return
        view.dispatch({ effects: closePicker.of(null) })
      }
      document.addEventListener('pointerdown', away, true)
      return { destroy: () => document.removeEventListener('pointerdown', away, true) }
    }),
  ]
}

/** For tests: whether a picker is open, and on what. */
export const pickerRange = (view: EditorView) => {
  const open = view.state.field(picking, false)
  return open ? { from: open.from, to: open.to } : null
}
export { pick as openColourPicker }
