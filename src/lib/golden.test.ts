/**
 * Every drawing this codebase can make, held against a committed copy.
 *
 * The rest of the suite tests things one claim at a time: that a bracket sits
 * where it should, that a controlled gate spans the wires it names. This one
 * tests nothing in particular and everything at once — it renders each example
 * and each gate in the gallery, in all three themes, light and dark, and
 * insists the bytes have not moved.
 *
 * It exists for the library split. Moving several thousand lines between
 * directories is meant to change no output at all, and "meant to" is not a
 * guarantee; this is. A refactor that leaves these files untouched did what it
 * said, and one that does not, did not.
 *
 * So a diff here is a question rather than a failure. Where the output was
 * meant to change, the answer is to look at what moved — the snapshots are SVG,
 * openable in a browser — and commit it. Where nothing was meant to change,
 * something is wrong.
 */

import { describe, expect, it } from 'vitest'
import { render } from './index'
import { EXAMPLES } from './examples'
import { GATE_GALLERY } from './gates'
import { THEME_IDS } from './render/themes'

interface Case {
  id: string
  source: string
}

const cases: Case[] = [
  ...EXAMPLES.map((e) => ({ id: `example-${e.id}`, source: e.source })),
  // The gallery's `code` is a line of the notation, and a filename has to be
  // something a filesystem will take.
  ...GATE_GALLERY.flatMap((group) =>
    group.items.map((item) => ({
      id: `gate-${item.code.replace(/[^\w]+/g, '-').replace(/-$/, '')}`,
      source: item.source ?? `qubits 1\n${item.code}`,
    })),
  ),
]

const modes = THEME_IDS.flatMap((theme) =>
  [false, true].map((dark) => ({ theme, dark, dir: `${theme}-${dark ? 'dark' : 'light'}` })),
)

describe('every drawing, byte for byte', () => {
  it('has a case for each example and each gate in the gallery', () => {
    expect(cases.length).toBe(
      EXAMPLES.length + GATE_GALLERY.reduce((n, g) => n + g.items.length, 0),
    )
    // Two cases writing the same file would quietly test one of them twice.
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length)
  })

  for (const mode of modes) {
    describe(mode.dir, () => {
      it.each(cases)('$id', async ({ id, source }) => {
        // Checking is the editor's business and says nothing about the
        // drawing; leaving it out keeps this about the pixels.
        const { svg } = render(source, { theme: mode.theme, dark: mode.dark, check: false })
        await expect(svg).toMatchFileSnapshot(`__golden__/${mode.dir}/${id}.svg`)
      })
    })
  }
})
