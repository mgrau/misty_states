/**
 * Any gate made controlled by a C in front of its name: `CH 1 2`, `CCRZ(90)
 * 1 2 3`, `Cbox "U" 1 2-3`, and a definition's use, `Coracle 1 2-3`.
 *
 * The controls are written first, one wire for each C. A gate that already
 * has controls takes these as more of them — `CCNOT`, `CCCX`, `CCSWAP` — and
 * anything else carries them for itself. Worked out from the gate's own
 * matrix, normalised and with its true phase, since a factor that is overall
 * on a bare gate is not overall once only some terms get the gate.
 */

import { describe, expect, it } from 'vitest'
import { parseCircuit } from './parse'
import { amplitudesOf, simulate, type Amplitudes } from './simulate'
import { referenceAmplitudes } from './reference'
import { abs2, cx, mul, show, type Cx } from './complex'
import { addControl, asDroppable, moveGate, toggleControl } from './edit'
import { layoutCircuit } from './layout'
import { detectMode } from '../mode'
import { render } from '../index'
import { seededRandom } from '../svg'
import type { Gate } from './ast'

const gates = (src: string): Gate[] => parseCircuit(src).layers.flatMap((l) => l.gates)
const gate = (src: string) => gates(src)[0]

/** The state out, normalised, as `amp*bits` with two decimals. */
const out = (src: string) => {
  const doc = parseCircuit(src)
  const amps = simulate(doc, doc.layers.length)
  const norm = Math.sqrt([...amps.values()].reduce((s, a) => s + abs2(a), 0))
  const first = [...amps].sort(([a], [b]) => (a < b ? -1 : 1))[0][1]
  // The overall phase taken off the first term, as the drawing does.
  const unit = cx(first.re / Math.sqrt(abs2(first)), -first.im / Math.sqrt(abs2(first)))
  return [...amps]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([bits, a]) => {
      const v = mul(a, unit)
      return `${show(cx(Math.round((v.re / norm) * 100) / 100, Math.round((v.im / norm) * 100) / 100))}*${bits}`
    })
}

describe('writing a gate with controls', () => {
  it('puts the controls, written first, on a letter', () => {
    expect(gate('CH 1 2')).toMatchObject({ kind: 'single', label: 'H', qubit: 2, controls: [1] })
    expect(gate('CCRZ(90) 1 2 3')).toMatchObject({ kind: 'single', label: 'RZ', angle: 90, qubit: 3, controls: [1, 2] })
    expect(gate('CS 3=0 1')).toMatchObject({ qubit: 1, controls: [3], open: [3] })
  })

  it('reads a range across the controls and the gate alike', () => {
    expect(gate('CCH 1-3')).toMatchObject({ qubit: 3, controls: [1, 2] })
  })

  it('takes an arrow after the controls, and only there', () => {
    expect(gate('CH 3 -> 1')).toMatchObject({ qubit: 1, controls: [3] })
    expect(() => parseCircuit('CCH 1 -> 2 3')).toThrow(/arrow goes after them/)
  })

  it('takes a glued wire as any gate does', () => {
    expect(gate('CH2 3')).toMatchObject({ qubit: 3, controls: [2] })
  })

  it('gives a gate that has controls more of them', () => {
    expect(gate('CCCX 1 2 3 4')).toMatchObject({ kind: 'controlled', controls: [1, 2, 3], target: 4 })
    expect(gate('CCSWAP 1 2 3 4')).toMatchObject({ kind: 'swap', controls: [1, 2], qubits: [3, 4] })
    expect(gate('CCGATE "U" 1 2 3')).toMatchObject({ kind: 'controlled', custom: true, controls: [1, 2], target: 3 })
    expect(gate('CCCZ 1 2 3 4')).toMatchObject({ kind: 'controlled', phase: true, controls: [1, 2, 3], target: 4 })
  })

  it('leaves the names that were already gates as they were', () => {
    expect(gate('CNOT 1 2')).toMatchObject({ kind: 'controlled', controls: [1], target: 2, targetGlyph: 'not' })
    expect(gate('CZ 1 2 3')).toMatchObject({ kind: 'controlled', controls: [1, 2], target: 3 })
    expect(gate('CCX 1 2 3')).toMatchObject({ kind: 'controlled', controls: [1, 2], target: 3 })
  })

  it('puts controls on a box, outside it', () => {
    expect(gate('Cbox "U" 1 2-3')).toMatchObject({ kind: 'box', label: 'U', qubits: [2, 3], controls: [1] })
    expect(() => parseCircuit('Cbox "U" 2 1 3')).toThrow(/inside the box/)
  })

  it('fills in the wires of one written without them', () => {
    expect(gate('CH')).toMatchObject({ qubit: 2, controls: [1] })
    expect(gates('H CH')).toMatchObject([{ qubit: 1 }, { qubit: 3, controls: [2] }])
  })

  it('says what is wrong with one that cannot be', () => {
    expect(() => parseCircuit('CH 2')).toThrow(/needs the wire it acts on/)
    expect(() => parseCircuit('CH 1 1')).toThrow(/cannot be a control and part of/)
    expect(() => parseCircuit('CM 1 2')).toThrow(/measurement cannot be controlled/)
    expect(() => parseCircuit('CI 1 2')).toThrow(/nothing to control/)
    expect(() => parseCircuit('CCH 1 1 2')).toThrow(/same control twice/)
    expect(() => parseCircuit('M 1\nCH 2 3 if M1')).toThrow(/only a gate on one wire/)
  })

  it('reads as a circuit from its first word', () => {
    expect(detectMode('CH 1 2')).toBe('circuit')
    expect(detectMode('CCRZ(90) 1 2 3')).toBe('circuit')
    expect(detectMode('CH2 3')).toBe('circuit')
  })
})

describe('what it does', () => {
  it('does the gate only where the controls hold what they act on', () => {
    expect(out('in 00\nCH 1 2')).toEqual(['1*00'])
    expect(out('in 10\nCH 1 2')).toEqual(['0.71*10', '0.71*11'])
    expect(out('in 00\nCH 1=0 2')).toEqual(['0.71*00', '0.71*01'])
  })

  it('keeps the √2 an H carries off the terms it does not touch', () => {
    // (|0⟩ + |1⟩)/√2 ⊗ |0⟩, then H on the second where the first is black:
    // |00⟩/√2 + |10⟩/2 + |11⟩/2. Unnormalised, the last two would be as big
    // as the first.
    expect(out('in 00\nH 1\nCH 1 2')).toEqual(['0.71*00', '0.5*10', '0.5*11'])
  })

  it('is a controlled RZ, not a controlled phase', () => {
    // Bare, the two differ by an overall phase and are the same gate.
    // Controlled, that phase is relative: RZ(180) is diag(-i, i), so the
    // black target picks up i where P(180) gives it a minus.
    expect(out('in 00\nH 1\nX 2\nCRZ(180) 1 2')).toEqual(['0.71*01', '0.71i*11'])
    expect(out('in 00\nH 1\nX 2\nCP(180) 1 2')).toEqual(['0.71*01', '-0.71*11'])
  })

  it('is a Toffoli for CCX, however it is spelled', () => {
    for (const bits of ['000', '010', '100', '110', '111']) {
      expect(out(`in ${bits}\nCCCX 1 2 3`.replace('CCCX', 'CCX'))).toEqual(out(`in ${bits}\nTOFFOLI 1 2 3`))
      expect(out(`in ${bits}\nCCNOT 1 2 3`)).toEqual(out(`in ${bits}\nTOFFOLI 1 2 3`))
    }
  })
})

describe('a definition used with controls', () => {
  const FLIP = 'def flip {\n  X 1\n  H 2\n}'

  it('is written as the use is, with the controls first', () => {
    const doc = parseCircuit(`${FLIP}\nqubits 3\nCflip 1 2-3`)
    expect(doc.uses).toEqual([{ line: 6, name: 'flip', wires: [2, 3], collapsed: false, controls: [1] }])
  })

  it('leaves its own wires where they were written, given only the controls', () => {
    expect(parseCircuit(`${FLIP}\nCflip 3`).uses?.[0]).toMatchObject({ wires: [1, 2], controls: [3] })
  })

  it('puts the controls on every gate it draws, each in a layer of its own', () => {
    const doc = parseCircuit(`${FLIP}\nqubits 3\nCflip 1 2-3`)
    // Written side by side in the definition, they share the control now.
    expect(parseCircuit(`${FLIP}\nqubits 3\nflip 2-3`).layers).toHaveLength(1)
    expect(doc.layers.map((l) => l.gates.map((g) => g.kind))).toEqual([['controlled'], ['single']])
    expect(doc.layers[1].gates[0]).toMatchObject({ controls: [1], qubit: 3, use: 'flip' })
    // The frame takes in the control's wire.
    expect(doc.frames?.[0].qubits).toEqual([1, 3])
  })

  it('splits gates its definition put side by side', () => {
    const doc = parseCircuit('def both {\n  H 1; H 2\n}\nCboth 3 1-2')
    expect(doc.layers.map((l) => l.gates.length)).toEqual([1, 1])
  })

  it('folds into one box with the controls on it', () => {
    expect(gate(`${FLIP}\nCflip 1 2-3 collapsed`)).toMatchObject({ kind: 'box', qubits: [2, 3], controls: [1] })
  })

  it('does the same thing folded or not', () => {
    for (const input of ['000', '100', '(0|1)00', '1(0|1)0']) {
      const open = out(`${FLIP}\nin ${input}\nCflip 1 2-3`)
      expect(out(`${FLIP}\nin ${input}\nCflip 1 2-3 collapsed`), input).toEqual(open)
    }
  })

  it('takes its controls through a use inside another definition', () => {
    const src = `${FLIP}\ndef outer {\n  Cflip 3 1-2\n}\nin 0011\nouter 2-4`
    // outer's 3 is the circuit's 4: black, so flip acts on 2 and 3.
    expect(out(src)).toEqual(out('in 0011\nX 2\nH 3'))
  })

  it('refuses a control on one of its own wires, and a measurement inside', () => {
    expect(() => parseCircuit(`${FLIP}\nCflip 2 2-3`)).toThrow(/cannot be a control and one of flip's own/)
    expect(() => parseCircuit('def look {\n  M 1\n}\nClook 2 1')).toThrow(/measurement cannot be controlled/)
    expect(() => parseCircuit(`${FLIP}\nCflip`)).toThrow(/needs its control written first/)
    expect(() => parseCircuit(`${FLIP}\nCflip 2 1 3 collapsed`)).toThrow(/would be inside it/)
    expect(gates(`${FLIP}\nCflip 2 1 3`)).toHaveLength(2)
  })

  it('still lets a definition be named like a controlled gate, and means the definition', () => {
    expect(gates('def cs {\n  X 1\n}\nqubits 2\ncs 2')).toMatchObject([{ kind: 'controlled', target: 2 }])
  })
})

describe('agreement with the dense reference', () => {
  /** Complex division, for the scale between the two. */
  const div = (a: Cx, b: Cx): Cx => {
    const d = abs2(b)
    return cx((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d)
  }
  const first = (amps: Amplitudes) => [...amps].sort(([a], [b]) => (a < b ? -1 : 1))[0][1]

  it('matches on 200 random circuits of controlled gates', () => {
    const rand = seededRandom('misty-controlled')
    const pick = (n: number) => 1 + Math.floor(rand() * n)
    const BODY = 'def u {\n  H 1\n  RY(60) 2\n  CNOT 1 2\n  S 2\n}'
    let checked = 0
    for (let i = 0; i < 200; i++) {
      const lines: string[] = ['qubits 4']
      for (let k = 0; k < 6; k++) {
        const [a, b, c, d] = [1, 2, 3, 4].sort(() => rand() - 0.5)
        const w = (q: number) => (rand() < 0.3 ? `${q}=0` : String(q))
        const choice = Math.floor(rand() * 8)
        lines.push('---')
        if (choice === 0) lines.push(`H ${a}`)
        else if (choice === 1) lines.push(`CH ${w(a)} ${b}`)
        else if (choice === 2) lines.push(`C${['RX', 'RY', 'RZ', 'P'][pick(4) - 1]}(${pick(23) * 15}) ${w(a)} ${b}`)
        else if (choice === 3) lines.push(`CC${['H', 'S', 'Y', 'T'][pick(4) - 1]} ${w(a)} ${w(b)} ${c}`)
        else if (choice === 4) lines.push(`Cu ${w(a)} ${b} ${c}`)
        else if (choice >= 5 && choice <= 6) {
          // Folded, its own wires side by side so no control is inside the box.
          const p = pick(3)
          const own = rand() < 0.5 ? [p, p + 1] : [p + 1, p]
          const rest = [1, 2, 3, 4].filter((q) => q !== p && q !== p + 1)
          lines.push(choice === 5
            ? `Cu ${w(rest[0])} ${own.join(' ')} collapsed`
            : `CCu ${w(rest[0])} ${w(rest[1])} ${own.join(' ')} collapsed`)
        }
        else lines.push(`CCCX ${w(a)} ${w(b)} ${c} ${d}`)
      }
      const src = `${BODY}\nin ${'01'[pick(2) - 1]}${'01'[pick(2) - 1]}(0|1)0\n${lines.join('\n')}`
      let doc: ReturnType<typeof parseCircuit>
      let mine: Amplitudes
      try {
        // A control falling inside a folded box is refused; that is tested
        // elsewhere, and here only means another circuit.
        doc = parseCircuit(src)
        mine = simulate(doc, doc.layers.length)
      } catch {
        continue
      }
      const theirs = referenceAmplitudes(doc, amplitudesOf(doc.input!, doc.qubits))
      expect([...mine.keys()].sort(), src).toEqual([...theirs.keys()].sort())
      const ratio = div(first(mine), first(theirs))
      for (const [bits, amp] of mine) {
        const want = mul(theirs.get(bits)!, ratio)
        expect(amp.re, `${src}\nat ${bits}`).toBeCloseTo(want.re, 6)
        expect(amp.im, `${src}\nat ${bits}`).toBeCloseTo(want.im, 6)
      }
      checked++
    }
    expect(checked).toBeGreaterThan(150)
  })
})

describe('how it is drawn', () => {
  const glyphs = (src: string) => layoutCircuit(parseCircuit(src)).prims

  it('draws a dot on each control and the letter on a chip at the target', () => {
    const prims = glyphs('CCH 1 2 3')
    expect(prims.filter((p) => p.t === 'control')).toHaveLength(2)
    expect(prims.find((p) => p.t === 'text' && p.chip)).toMatchObject({ text: 'H', tint: 'H' })
  })

  it('draws an open ring for a control that acts on white', () => {
    expect(glyphs('CH 1=0 2').find((p) => p.t === 'control')).toMatchObject({ open: true })
  })

  it('writes a rotation as R with its axis, and its angle under the chip', () => {
    const texts = glyphs('CRZ(90) 1 2').filter((p) => p.t === 'text')
    expect(texts).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: 'R', subscript: 'Z', chip: true }),
      expect.objectContaining({ text: '90°' }),
    ]))
  })

  it('stretches a box’s chip across its own wires', () => {
    const chip = glyphs('Cbox "U" 1 2-3').find((p) => p.t === 'text' && p.chip)
    expect(chip).toMatchObject({ text: 'U' })
    expect((chip as { minWidth?: number }).minWidth).toBeGreaterThan(0)
  })

  it('renders in every theme', () => {
    for (const theme of ['solid', 'flat', 'isometric'] as const) {
      expect(render('in 000\nCH 1 2\nCCRZ(45) 1 2 3\nCbox "U" 1 2-3', { theme }).svg).toContain('<svg')
    }
  })
})

describe('editing', () => {
  /** Drop a control on `wire` in layer `layer`; the line it lands on, or null. */
  const drop = (src: string, wire: number, layer = 0) => {
    const edit = addControl(src, parseCircuit(src), { wire, layer, where: 'in' })
    return edit ? edit.source : null
  }

  it('puts a C on the gate beside the wire it is dropped on', () => {
    expect(drop('qubits 2\nH 2', 1)).toBe('qubits 2\nCH 1 2')
    expect(drop('qubits 3\nRZ(90) 1', 3)).toBe('qubits 3\nCRZ(90) 3 1')
    expect(drop('qubits 3\nX 2', 1)).toBe('qubits 3\nCX 1 2')
    expect(drop('qubits 3\nGATE "U" 2', 1)).toBe('qubits 3\nCGATE "U" 1 2')
    expect(drop('qubits 3\nbox "U" 2-3', 1)).toBe('qubits 3\nCbox "U" 1 2-3')
    expect(drop('qubits 3\nSWAP 2 3', 1)).toBe('qubits 3\nCSWAP 1 2 3')
  })

  it('gives another to a gate that has some', () => {
    expect(drop('qubits 3\nCNOT 1 2', 3)).toBe('qubits 3\nCCNOT 3 1 2')
    expect(drop('qubits 3\nCH 1 2', 3)).toBe('qubits 3\nCCH 3 1 2')
    expect(drop('qubits 4\nCZ 1 2 3', 4)).toBe('qubits 4\nCZ 1 2 4 3')
  })

  it('makes a CNOT a Toffoli when dropped on the wire it reaches across', () => {
    expect(drop('CNOT 1 3', 2)).toBe('CCNOT 2 1 3')
  })

  it('keeps everything else written on the gate', () => {
    expect(drop('qubits 2\nH 2 fill=#ffe9c7 off', 1)).toBe('qubits 2\nCH 1 2 fill=#ffe9c7 off')
    expect(drop('qubits 2\nstep: H 2 : note', 1)).toBe('qubits 2\nstep: CH 1 2 : note')
  })

  it('writes in the wires of gates that left them out', () => {
    expect(drop('H H', 3)).toBe('H 1; CH 3 2')
  })

  it('goes on the use of a definition, for all it draws', () => {
    const def = 'def flip {\n  X 1\n  H 2\n}\nqubits 3\n'
    expect(drop(`${def}flip 2-3`, 1)).toBe(`${def}Cflip 1 2-3`)
    expect(drop(`${def}flip 2-3 collapsed # folded`, 1)).toBe(`${def}Cflip 1 2-3 collapsed # folded`)
    expect(drop(`${def}flip`, 3)).toBe(`${def}Cflip 3`)
  })

  it('does nothing where there is nothing to control', () => {
    expect(drop('qubits 2\nH 2', 2)).toBeNull()
    expect(drop('qubits 2\nM 2', 1)).toBeNull()
    expect(drop('qubits 2\nI 2', 1)).toBeNull()
    expect(drop('qubits 2\nH 2', 1, 5)).toBeNull()
  })

  it('turns a dot of a letter between black and white on a click', () => {
    const src = 'CCH 1 2 3 fill=#ffe9c7'
    const doc = parseCircuit(src)
    expect(toggleControl(src, doc, doc.layers[0].gates[0], 2)?.source).toBe('CCH 1 2=0 3 fill=#ffe9c7')
    expect(toggleControl(src, doc, doc.layers[0].gates[0], 3)).toBeNull()
  })

  it('carries its controls when it is moved', () => {
    const src = 'qubits 4\nCH 1 -> 3\nX 4'
    const doc = parseCircuit(src)
    const g = doc.layers[0].gates[0]
    expect(asDroppable(g)).toMatchObject({ head: 'CH', controlsAt: [0], targetAt: 2 })
    const moved = moveGate(src, doc, g, { wire: 2, layer: 1, where: 'after' })!.source
    expect(gates(moved).find((x) => x.kind === 'single')).toMatchObject({ qubit: 4, controls: [2] })
  })

  it('carries a controlled box and a controlled use when they are moved', () => {
    const box = 'qubits 4\nCbox "U" 1=0 2-3\nX 4'
    const doc = parseCircuit(box)
    const moved = moveGate(box, doc, doc.layers[0].gates[0], { wire: 2, layer: 1, where: 'after' })!.source
    expect(gates(moved).find((x) => x.kind === 'box')).toMatchObject({ qubits: [3, 4], controls: [2], open: [2] })

    const use = 'def flip {\n  X 1\n}\nqubits 4\nCflip 3 1 collapsed\nH 4'
    const used = parseCircuit(use)
    const carried = moveGate(use, used, used.layers[0].gates[0], { wire: 2, layer: 1, where: 'after' })!.source
    expect(parseCircuit(carried).uses?.[0]).toMatchObject({ controls: [4], wires: [2] })
  })
})
