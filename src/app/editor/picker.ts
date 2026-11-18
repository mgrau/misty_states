/**
 * A colour picker small enough to sit under a word.
 *
 * Built here rather than borrowed from `<input type="color">`, because the
 * browser decides where that one opens — on macOS, Safari and Firefox hand it
 * to the system colour panel, which lands in a corner of the screen far from
 * the text it is changing. This one opens under the colour it edits.
 *
 * A saturation and brightness square, a hue strip, a row of the pale tints a
 * frame is usually filled with, and the hex for anyone who knows what they want.
 */

/** Pale enough to sit behind gates and still let them read. */
const TINTS = [
  '#fef3c7', '#e6f0e6', '#dbeafe', '#ede9fe', '#fce7f3', '#fee2e2', '#ccfbf1', '#f1f5f9',
  '#f59e0b', '#16a34a', '#2563eb', '#7c3aed', '#db2777', '#dc2626', '#0d9488', '#475569',
]

interface Hsv { h: number; s: number; v: number }

export function hexToHsv(hex: string): Hsv {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  let h = 0
  if (d) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h = (h * 60 + 360) % 360
  }
  return { h, s: max ? d / max : 0, v: max }
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1))
  }
  return '#' + [f(5), f(3), f(1)].map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement) => {
  const node = document.createElement(tag)
  node.className = cls
  parent?.appendChild(node)
  return node
}

/** Follow a pointer across `area` from the press until it lets go. */
function track(area: HTMLElement, move: (x: number, y: number) => void) {
  area.addEventListener('pointerdown', (down) => {
    down.preventDefault()
    const at = (e: PointerEvent) => {
      const box = area.getBoundingClientRect()
      const clamp = (n: number) => Math.min(1, Math.max(0, n))
      move(clamp((e.clientX - box.left) / (box.width || 1)), clamp((e.clientY - box.top) / (box.height || 1)))
    }
    area.setPointerCapture?.(down.pointerId)
    at(down)
    const up = () => {
      area.removeEventListener('pointermove', at)
      area.removeEventListener('pointerup', up)
    }
    area.addEventListener('pointermove', at)
    area.addEventListener('pointerup', up)
  })
}

/**
 * The picker, starting at `hex`. `onpick` hears every change as it happens;
 * `ondone` is asked to close it (Enter, Escape).
 */
export function colourPicker(hex: string, onpick: (hex: string) => void, ondone: () => void): HTMLElement {
  let hsv = hexToHsv(hex)
  const root = el('div', 'ms-picker')
  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-label', 'Pick a colour')
  // Keep the editor's selection where it is while the picker is used.
  root.addEventListener('mousedown', (e) => {
    if (!(e.target instanceof HTMLInputElement)) e.preventDefault()
  })

  const sv = el('div', 'ms-picker-sv', root)
  const svKnob = el('div', 'ms-picker-knob', sv)
  const hue = el('div', 'ms-picker-hue', root)
  const hueKnob = el('div', 'ms-picker-knob', hue)
  const tints = el('div', 'ms-picker-tints', root)
  const row = el('div', 'ms-picker-row', root)
  const chip = el('div', 'ms-picker-chip', row)
  const field = el('input', 'ms-picker-hex', row)
  field.spellcheck = false
  field.setAttribute('aria-label', 'Hex colour')

  const paint = (from?: HTMLElement) => {
    const now = hsvToHex(hsv)
    sv.style.backgroundColor = `hsl(${hsv.h} 100% 50%)`
    svKnob.style.left = `${hsv.s * 100}%`
    svKnob.style.top = `${(1 - hsv.v) * 100}%`
    hueKnob.style.left = `${(hsv.h / 360) * 100}%`
    chip.style.backgroundColor = now
    if (from !== field) field.value = now
  }
  const set = (next: Hsv, from?: HTMLElement) => {
    hsv = next
    paint(from)
    onpick(hsvToHex(hsv))
  }

  track(sv, (x, y) => set({ ...hsv, s: x, v: 1 - y }))
  // Hue stops short of 360, which is red again and would jump the knob back.
  track(hue, (x) => set({ ...hsv, h: Math.min(359.9, x * 360) }))

  for (const t of TINTS) {
    const b = el('button', 'ms-picker-tint', tints)
    b.type = 'button'
    b.title = t
    b.style.backgroundColor = t
    b.addEventListener('click', () => set(hexToHsv(t)))
  }

  field.addEventListener('input', () => {
    const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(field.value.trim())
    if (!m) return
    const d = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
    set(hexToHsv(`#${d.toLowerCase()}`), field)
  })
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Enter') {
      e.preventDefault()
      ondone()
    }
  })

  paint()
  return root
}
