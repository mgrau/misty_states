/**
 * Frames round runs of gates, and definitions used by name.
 *
 * A frame is only a drawing, so most of what is worth checking is that the
 * circuit inside it is exactly the circuit without it — and that the frame
 * covers what was written inside it, and nothing that was not.
 */

import { describe, expect, it } from 'vitest'
import { parseCircuit } from './parse'
import { amplitudesOf, simulate } from './simulate'
import { referenceAmplitudes } from './reference'
import { show } from './complex'
import { layoutCircuit } from './layout'
import { toggleFold } from './edit'
import { detectMode, render } from '../index'
import type { Gate } from './ast'
import type { Prim } from '../render/primitives'

const doc = (src: string) => parseCircuit(src)
const frames = (src: string) => doc(src).frames ?? []

/** The final state, written out, for comparing two ways of saying one circuit. */
const state = (src: string) => {
  const d = doc(src)
  return [...simulate(d, d.layers.length)]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([bits, amp]) => `${bits}:${show(amp)}`)
}

/** Each layer's gates, as a word per gate with its wires. */
const written = (src: string) =>
  doc(src).layers.map((l) => l.gates.map(wordFor).join('; '))

function wordFor(g: Gate): string {
  switch (g.kind) {
    case 'single': return `${g.label}${g.qubit}`
    case 'controlled': return `C${g.controls.join('')}>${g.target}`
    case 'box': return `[${g.label} ${g.qubits.join('')}]`
    case 'measure': return `M${g.qubit}`
    default: return g.kind
  }
}

describe('a frame round some gates', () => {
  it('covers the layers and wires of what is inside it', () => {
    const [f] = frames('in 000\nH 3\n"Prep" {\n  H 1\n  CNOT 1 -> 2\n}\nH 3')
    expect(f).toMatchObject({ label: 'Prep', qubits: [1, 2], layers: [1, 2], inner: 0 })
  })

  it('takes its colours and its label from the line that opens it', () => {
    const [f] = frames('"Oracle" fill=#fef3c7 border=#d97706 {\n  H 1\n}')
    expect(f).toMatchObject({ label: 'Oracle', fill: '#fef3c7', border: '#d97706' })
    expect(frames('{\n  H 1\n}')[0].label).toBeUndefined()
    expect(frames('border=none {\n  H 1\n}')[0].border).toBe('none')
  })

  it('takes in the wires it is given, even ones nothing inside touches', () => {
    const d = doc('"QFT" 1-3 {\n  H 2\n}')
    expect(d.frames![0].qubits).toEqual([1, 3])
    expect(d.qubits).toBe(3)
  })

  it('keeps out what was written outside it', () => {
    // Without the fence the H 3 after it would pack up into its first layer.
    expect(written('in 000\n"Prep" {\n  H 1\n  H 1\n}\nH 3')).toEqual(['H1', 'H1', 'H3'])
    // And the H 3 before it would be joined by the frame's first gate.
    expect(written('in 000\nH 3\n"Prep" {\n  H 1\n}')).toEqual(['H3', 'H1'])
  })

  it('still packs what is inside it', () => {
    expect(written('in 000\n"Prep" {\n  H 1\n  H 2\n}')).toEqual(['H1; H2'])
  })

  it('nests, the outer one taking in the inner one', () => {
    const fs = frames('in 000\n"Outer" {\n  H 1\n  "Inner" 2-3 {\n    H 2\n  }\n}')
    expect(fs.map((f) => f.label)).toEqual(['Outer', 'Inner'])
    expect(fs[0]).toMatchObject({ qubits: [1, 3], layers: [0, 1], inner: 1 })
    expect(fs[1]).toMatchObject({ qubits: [2, 3], layers: [1, 1], inner: 0 })
  })

  it('changes nothing about what the circuit does', () => {
    const bare = 'in 00\nH 1\nCNOT 1 -> 2\nH 2'
    expect(state('in 00\n"A" {\n  H 1\n  CNOT 1 -> 2\n}\nH 2')).toEqual(state(bare))
  })

  it('says what is wrong with one written wrongly', () => {
    expect(() => doc('"A" {\n  H 1')).toThrow(/never closed/)
    expect(() => doc('H 1\n}')).toThrow(/closes nothing/)
    expect(() => doc('"A" {\n}')).toThrow(/nothing in it/)
    expect(() => doc('"A" 1-2 {\n  H 3\n}')).toThrow(/outside 1-2/)
    expect(() => doc('"A" fill=nope {\n  H 1\n}')).toThrow(/not a colour/)
    expect(() => doc('in 0\n"A" {\n  H 1\n  tabulate\n}')).toThrow()
  })

  it('reads as a circuit from its first line', () => {
    expect(detectMode('"Prep" {\n  H 1\n}')).toBe('circuit')
    expect(detectMode('def f {\n  H 1\n}\nf')).toBe('circuit')
  })
})

describe('a definition', () => {
  const ORACLE = 'def oracle fill=#fef3c7 {\n  CNOT 1 -> 2\n  H 2\n}\n'

  it('puts its gates on the wires it is used on, in order', () => {
    expect(written(`${ORACLE}in 000\noracle 2-3`)).toEqual(['C2>3', 'H3'])
    expect(written(`${ORACLE}in 000\noracle 3 1`)).toEqual(['C3>1', 'H1'])
  })

  it('leaves them where they were written when given none', () => {
    expect(written(`${ORACLE}in 00\noracle`)).toEqual(['C1>2', 'H2'])
  })

  it('is framed, labelled with its name, in its own colours', () => {
    const [f] = frames(`${ORACLE}in 000\noracle 2-3`)
    expect(f).toMatchObject({ label: 'oracle', fill: '#fef3c7', qubits: [2, 3], layers: [0, 1] })
    expect(frames('def f "U_f" {\n  H 1\n}\nf')[0].label).toBe('U_f')
  })

  it('stamps its gates with the line that used it', () => {
    const d = doc(`${ORACLE}in 00\noracle`)
    expect(d.layers.flatMap((l) => l.gates.map((g) => g.line))).toEqual([6, 6])
    expect(d.layers.map((l) => l.lines)).toEqual([[6], [6]])
  })

  it('can be written below where it is used, and use another', () => {
    const src = 'in 000\nboth 1-3\ndef pair {\n  CNOT 1 -> 2\n}\ndef both {\n  pair 1-2\n  pair 2-3\n}'
    expect(written(src)).toEqual(['C1>2', 'C2>3'])
    expect(frames(src).map((f) => f.label)).toEqual(['both', 'pair', 'pair'])
    expect(frames(src)[0].inner).toBe(1)
  })

  it('collapsed, is one box that does what its gates do', () => {
    const src = `${ORACLE}in 100\noracle 1-2 collapsed\noracle 2-3`
    expect(written(src)[0]).toBe('[oracle 12]')
    expect(frames(src)).toHaveLength(1)
    expect(state(src)).toEqual(state(`${ORACLE}in 100\noracle 1-2\noracle 2-3`))
    expect(render(`${src}\ncalculate`).svg).toContain('oracle')
  })

  it('collapsed, agrees with the reference simulator', () => {
    for (const src of [
      `${ORACLE}in 101\noracle 3 1 collapsed`,
      'def f {\n  H 1\n  T 1\n  CNOT 1 -> 2\n  SWAP 1 2\n}\nin 01\nf collapsed',
    ]) {
      const d = doc(src)
      const ours = simulate(d, d.layers.length)
      const theirs = referenceAmplitudes(d, amplitudesOf(d.input!, d.qubits))
      const norm = (m: Map<string, { re: number; im: number }>) => {
        const total = Math.sqrt([...m.values()].reduce((s, a) => s + a.re ** 2 + a.im ** 2, 0))
        return [...m].sort().map(([b, a]) => [b, +(a.re / total).toFixed(6), +(a.im / total).toFixed(6)])
      }
      expect(norm(ours), src).toEqual(norm(theirs))
    }
  })

  it('says what is wrong with one used or written wrongly', () => {
    expect(() => doc(`${ORACLE}oracle 1-3`)).toThrow(/written on 2 wires, so it needs 2 here, not 3/)
    expect(() => doc(`${ORACLE}oracle 2 2`)).toThrow(/different wires/)
    expect(() => doc(`${ORACLE}oracle; H 3`)).toThrow(/line of its own/)
    expect(() => doc('def f {\n  H 1\n')).toThrow(/never closed/)
    expect(() => doc('def f {\n}')).toThrow(/nothing in it/)
    expect(() => doc('def f H 1')).toThrow(/needs a "\{"/)
    expect(() => doc('def h {\n  X 1\n}')).toThrow(/already means something/)
    expect(() => doc('def f {\n  H 1\n}\ndef f {\n  X 1\n}')).toThrow(/already defined on line 1/)
    expect(() => doc('def f {\n  g\n}\ndef g {\n  f\n}\nf')).toThrow(/uses itself/)
    expect(() => doc('def f {\n  def g {\n  }\n}')).toThrow(/cannot hold another/)
    expect(() => doc('def f {\n  00\n}\nf')).toThrow(/a state goes outside it/)
    expect(() => doc('def f {\n  measure 1 Z\n}\nf collapsed')).toThrow(/cannot be one box/)
  })
})

describe('drawing a frame', () => {
  const laid = (src: string) => layoutCircuit(doc(src))
  const ofKind = (prims: Prim[], t: Prim['t']) => prims.filter((p) => p.t === t)

  it('goes down first, so the pipes and gates stand on it', () => {
    const { prims } = laid('in 00\n"Prep" {\n  H 1\n  CNOT 1 -> 2\n}')
    expect(prims[0]).toMatchObject({ t: 'frame' })
    expect(prims.findIndex((p) => p.t === 'pipe')).toBeGreaterThan(0)
  })

  it('holds every gate inside it', () => {
    const { prims } = laid('in 000\n"Prep" {\n  H 1\n  CNOT 1 -> 2\n}\nH 3')
    const frame = ofKind(prims, 'frame').find((p) => p.t === 'frame' && !p.tab)! as Extract<Prim, { t: 'frame' }>
    const gates = ofKind(prims, 'gatebox') as Extract<Prim, { t: 'gatebox' }>[]
    const inside = gates.filter((g) => g.box.y < frame.box.y + frame.box.h)
    expect(inside).toHaveLength(2)
    for (const g of inside) {
      expect(g.box.x).toBeGreaterThan(frame.box.x)
      expect(g.box.x + g.box.w).toBeLessThan(frame.box.x + frame.box.w)
      expect(g.box.y).toBeGreaterThan(frame.box.y)
    }
    // The H 3 after it starts below it.
    const after = gates.find((g) => g.box.y > frame.box.y + frame.box.h)
    expect(after).toBeDefined()
  })

  it('writes its label on a tab laid over the pipes', () => {
    const { prims } = laid('in 00\n"Prep" {\n  H 1\n}')
    const tab = prims.findIndex((p) => p.t === 'frame' && p.tab)
    const lastPipe = prims.map((p) => p.t).lastIndexOf('pipe')
    expect(tab).toBeGreaterThan(lastPipe)
    expect(prims.some((p) => p.t === 'text' && p.text === 'Prep')).toBe(true)
  })

  it('draws no tab when it has no label', () => {
    const { prims } = laid('in 0\n{\n  H 1\n}')
    expect(prims.filter((p) => p.t === 'frame')).toHaveLength(1)
  })

  it('draws in every theme, in an animation too', () => {
    for (const theme of ['solid', 'flat', 'isometric'] as const) {
      expect(render('in 00\n"Prep" border=#d97706 {\n  H 1\n}', { theme }).svg).toContain('#d97706')
    }
    expect(render('in 10\n"Prep" {\n  CNOT 1 -> 2\n}\nanimate').animation).toBeDefined()
  })
})

describe('folding', () => {
  const ORACLE = 'def oracle {\n  CNOT 1 -> 2\n  H 2\n}\n'

  it('folds a frame written inline into one box that does what it held', () => {
    const src = 'in 00\n"Prep" collapsed {\n  H 1\n  CNOT 1 -> 2\n}\nH 2'
    expect(written(src)).toEqual(['[Prep 12]', 'H2'])
    expect(frames(src)).toHaveLength(0)
    expect(state(src)).toEqual(state('in 00\nH 1\nCNOT 1 -> 2\nH 2'))
  })

  it('folds everything inside it, frames and definitions too', () => {
    const src = `${ORACLE}in 000\n"All" collapsed {\n  "Inner" {\n    H 3\n  }\n  oracle 1-2\n}`
    expect(written(src)).toEqual(['[All 123]'])
    expect(frames(src)).toHaveLength(0)
  })

  it('knows which line folds each frame and each box', () => {
    const d = doc(`${ORACLE}in 000\n"Prep" {\n  H 3\n}\noracle 1-2\noracle 2-3 collapsed`)
    expect(d.frames!.map((f) => f.fold)).toEqual([6, 9])
    const box = d.layers.flatMap((l) => l.gates).find((g) => g.kind === 'box')!
    expect(box).toMatchObject({ fold: 10, bound: true })
  })

  it('gives nothing written inside a definition a line of its own to fold', () => {
    const src = 'def outer {\n  "Inner" {\n    H 1\n  }\n  pair\n}\ndef pair {\n  CNOT 1 -> 2\n}\nouter'
    const fs = frames(src)
    expect(fs.map((f) => [f.label, f.fold])).toEqual([['outer', 10], ['Inner', undefined], ['pair', undefined]])
  })

  it('marks what a definition put there, so it is not carried off alone', () => {
    const gates = doc(`${ORACLE}in 00\noracle\nH 1`).layers.flatMap((l) => l.gates)
    expect(gates.map((g) => !!g.bound)).toEqual([true, true, false])
  })

  it('writes the word on the line, and takes it off again', () => {
    const fold = (src: string, line: number) => toggleFold(src, line)!.source
    expect(fold('in 0\n"Prep" fill=#fff {\n  H 1\n}', 2)).toBe('in 0\n"Prep" fill=#fff collapsed {\n  H 1\n}')
    expect(fold('in 0\n"Prep" fill=#fff collapsed {\n  H 1\n}', 2)).toBe('in 0\n"Prep" fill=#fff {\n  H 1\n}')
    expect(fold('{\n  H 1\n}', 1)).toBe('collapsed {\n  H 1\n}')
    expect(fold('collapsed {\n  H 1\n}', 1)).toBe('{\n  H 1\n}')
    expect(fold('  oracle 2-3  # the oracle', 1)).toBe('  oracle 2-3 collapsed # the oracle')
    expect(fold('oracle 2-3 collapsed', 1)).toBe('oracle 2-3')
    // A label that happens to say it is not the word.
    expect(fold('"collapsed" {\n  H 1\n}', 1)).toBe('"collapsed" collapsed {\n  H 1\n}')
  })

  it('round-trips: folding twice is where it started, and both parse', () => {
    const src = `${ORACLE}in 000\n"Prep" {\n  H 3\n}\noracle 1-2`
    for (const line of [6, 9]) {
      const once = toggleFold(src, line)!.source
      expect(() => doc(once)).not.toThrow()
      expect(state(once)).toEqual(state(src))
      expect(toggleFold(once, line)!.source).toBe(src)
    }
  })

  it('tells the board where each frame is and what folds it', () => {
    const { geometry } = layoutCircuit(doc('in 00\n"Prep" {\n  H 1\n}'))
    expect(geometry.frames).toHaveLength(1)
    expect(geometry.frames![0].fold).toBe(2)
    expect(geometry.frames![0].box.w).toBeGreaterThan(0)
  })
})
