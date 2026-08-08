/**
 * The simulator against answers a person worked out.
 *
 * Every figure in the project's library that carries both an input and a
 * written output is a case where someone did the algebra by hand. Reproducing
 * those is the only evidence here that does not come from the same head as the
 * implementation.
 *
 * `library.yaml` is not committed, so this skips itself on a fresh clone. It
 * reports what it covered either way, since a suite that silently checks
 * nothing is worse than no suite at all.
 */

import { describe, expect, it } from 'vitest'
import { LIBRARY_YAML } from 'virtual:misty-library'
import { fromYaml } from '../library-yaml'
import { parseCircuit } from './parse'
import { amplitudesOf, canonical, simulate, SimulationError } from './simulate'
import { detectMode } from '../index'

const present = LIBRARY_YAML !== null

describe.skipIf(!present)('calculating the library’s worked answers', () => {
  interface Case {
    id: string
    got: [string, number][]
    want: [string, number][]
  }

  let checked: Case[] = []
  let skipped: { id: string; why: string }[] = []

  it('works every figure that has both an input and an output', async () => {
    const doc = await fromYaml(LIBRARY_YAML!)
    for (const group of doc.groups) {
      for (const entry of group.entries) {
        if (detectMode(entry.source) !== 'circuit') continue

        let circuit
        try {
          circuit = parseCircuit(entry.source)
        } catch (err) {
          skipped.push({ id: entry.id, why: `does not parse — ${(err as Error).message}` })
          continue
        }
        if (!circuit.input || !circuit.output) continue

        try {
          checked.push({
            id: entry.id,
            got: canonical(simulate(circuit, circuit.layers.length)),
            want: canonical(amplitudesOf(circuit.output, circuit.qubits)),
          })
        } catch (err) {
          if (err instanceof SimulationError) {
            skipped.push({ id: entry.id, why: err.message })
            continue
          }
          throw err
        }
      }
    }

    // Worth knowing how much this actually covered.
    // eslint-disable-next-line no-console
    console.log(
      `library cross-check: ${checked.length} figures calculated, ${skipped.length} skipped` +
        skipped.map((s) => `\n  - ${s.id}: ${s.why}`).join(''),
    )
    expect(checked.length).toBeGreaterThan(0)
  })

  it('agrees with every one of them', () => {
    const wrong = checked.filter((c) => JSON.stringify(c.got) !== JSON.stringify(c.want))
    const detail = wrong.map(
      (c) =>
        `${c.id}\n    calculated ${JSON.stringify(c.got)}\n    written    ${JSON.stringify(c.want)}`,
    )
    expect(detail, `disagreed on ${wrong.length} of ${checked.length}`).toEqual([])
  })
})
