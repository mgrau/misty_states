/**
 * Two independent checks on the simulator: algebraic identities that must hold
 * for every input, and agreement with a dense floating-point implementation
 * over randomly generated circuits.
 *
 * Neither depends on anyone having worked out the right answer by hand, which
 * is what makes them worth having alongside the examples.
 */

import { describe, expect, it } from 'vitest'
import { parseCircuit } from './parse'
import { amplitudesOf, simulate, type Amplitudes } from './simulate'
import { referenceAmplitudes } from './reference'
import { seededRandom } from '../svg'

/** Amplitudes as a sorted list, so two runs can be compared directly. */
const listed = (amps: Amplitudes) =>
  [...amps].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

const run = (src: string) => {
  const doc = parseCircuit(src)
  return listed(simulate(doc, doc.layers.length))
}

/* -- Identities ---------------------------------------------------------- */

/** Every basis state of `n` wires, written as an input line. */
const basisStates = (n: number) =>
  Array.from({ length: 1 << n }, (_, i) => i.toString(2).padStart(n, '0'))

describe('identities that must hold for every input', () => {
  const isSelfInverse = (n: number, body: string, scale = 1) => {
    for (const bits of basisStates(n)) {
      const once = run(`in ${bits}\n${body}`)
      const twice = run(`in ${bits}\n${body}\n---\n${body}`)
      // Applying it twice returns the input, up to the scale the gate carries.
      expect(twice, `${body} on ${bits}`).toEqual([[bits, scale]])
      expect(once.length, `${body} on ${bits}`).toBeGreaterThan(0)
    }
  }

  it('X·X = I', () => isSelfInverse(2, 'X 1'))
  it('Z·Z = I', () => isSelfInverse(2, 'Z 1'))
  it('CNOT·CNOT = I', () => isSelfInverse(2, 'CNOT 1 -> 2'))
  it('CZ·CZ = I', () => isSelfInverse(2, 'CZ 1 2'))
  it('SWAP·SWAP = I', () => isSelfInverse(2, 'SWAP 1 2'))
  it('TOFFOLI·TOFFOLI = I', () => isSelfInverse(3, 'TOFFOLI 1 2 -> 3'))

  it('H·H = 2I — the factor of two the integers carry', () => isSelfInverse(2, 'H 1', 2))

  it('X = H·Z·H', () => {
    for (const bits of basisStates(1)) {
      const direct = run(`in ${bits}\nX 1`)
      const long = run(`in ${bits}\nH 1\n---\nZ 1\n---\nH 1`)
      // The long way round picks up H·H's factor of two.
      expect(long).toEqual(direct.map(([b, a]) => [b, a * 2]))
    }
  })

  it('Z = H·X·H', () => {
    for (const bits of basisStates(1)) {
      const direct = run(`in ${bits}\nZ 1`)
      const long = run(`in ${bits}\nH 1\n---\nX 1\n---\nH 1`)
      expect(long).toEqual(direct.map(([b, a]) => [b, a * 2]))
    }
  })

  it('CZ is a CNOT with Hadamards around the target', () => {
    for (const bits of basisStates(2)) {
      const direct = run(`in ${bits}\nCZ 1 2`)
      const long = run(`in ${bits}\nH 2\n---\nCNOT 1 -> 2\n---\nH 2`)
      expect(long, bits).toEqual(direct.map(([b, a]) => [b, a * 2]))
    }
  })

  it('SWAP is three CNOTs', () => {
    for (const bits of basisStates(2)) {
      expect(run(`in ${bits}\nSWAP 1 2`), bits).toEqual(
        run(`in ${bits}\nCNOT 1 -> 2\n---\nCNOT 2 -> 1\n---\nCNOT 1 -> 2`),
      )
    }
  })

  it('control and target of a CZ are interchangeable', () => {
    for (const bits of basisStates(2)) {
      expect(run(`in ${bits}\nCZ 1 2`), bits).toEqual(run(`in ${bits}\nCZ 2 1`))
    }
  })

  it('gates on different wires commute', () => {
    for (const bits of basisStates(3)) {
      expect(run(`in ${bits}\nH 1\n---\nX 3`), bits).toEqual(
        run(`in ${bits}\nX 3\n---\nH 1`),
      )
    }
  })
})

/* -- Against an independent implementation -------------------------------- */

/**
 * Random circuits, generated from a fixed seed so a failure can be reproduced
 * exactly rather than being a story about a run that once went wrong.
 */
function randomCircuit(rand: () => number): { src: string; qubits: number } {
  const qubits = 1 + Math.floor(rand() * 4)
  const lines: string[] = [`qubits ${qubits}`]
  const pick = (n: number) => 1 + Math.floor(rand() * n)

  const depth = 1 + Math.floor(rand() * 8)
  for (let i = 0; i < depth; i++) {
    const choice = Math.floor(rand() * 6)
    const a = pick(qubits)
    let b = pick(qubits)
    while (qubits > 1 && b === a) b = pick(qubits)

    // A layer break between every gate, so the order written is the order run
    // and the two implementations are compared on the same sequence.
    lines.push('---')
    if (choice === 0) lines.push(`H ${a}`)
    else if (choice === 1) lines.push(`X ${a}`)
    else if (choice === 2) lines.push(`Z ${a}`)
    else if (qubits < 2) lines.push(`H ${a}`)
    else if (choice === 3) lines.push(`CNOT ${a} -> ${b}`)
    else if (choice === 4) lines.push(`CZ ${a} ${b}`)
    else lines.push(`SWAP ${a} ${b}`)
  }
  return { src: lines.join('\n'), qubits }
}

/** A random input: a basis state, or a small superposition of two. */
function randomInput(rand: () => number, qubits: number): string {
  const bits = () =>
    Array.from({ length: qubits }, () => (rand() < 0.5 ? '0' : '1')).join('')
  if (rand() < 0.5) return bits()
  const coeff = 1 + Math.floor(rand() * 3)
  const sign = rand() < 0.5 ? '-' : ''
  return `${coeff}*${bits()}|${sign}${bits()}`
}

describe('agreement with a dense floating-point implementation', () => {
  it('matches on 300 random circuits', () => {
    const rand = seededRandom('misty-crosscheck')
    let checked = 0

    for (let i = 0; i < 300; i++) {
      const { src, qubits } = randomCircuit(rand)
      const input = randomInput(rand, qubits)
      const doc = parseCircuit(`in ${input}\n${src}`)

      let mine: Amplitudes
      try {
        mine = simulate(doc, doc.layers.length)
      } catch {
        // A random input can cancel to nothing; nothing to compare.
        continue
      }
      const theirs = referenceAmplitudes(doc, amplitudesOf(doc.input!, doc.qubits))

      const where = `#${i}\n${input}\n${src}`
      expect([...mine.keys()].sort(), where).toEqual([...theirs.keys()].sort())
      for (const [bits, amp] of mine) {
        expect(theirs.get(bits), `${where}\nat ${bits}`).toBeCloseTo(amp, 6)
      }
      checked++
    }

    // Guard against the loop quietly skipping everything.
    expect(checked).toBeGreaterThan(250)
  })

  it('would notice if the simulator were wrong', () => {
    // The cross-check is only worth having if it can fail: a deliberately
    // wrong circuit must disagree with the reference.
    const doc = parseCircuit('in 10\nCNOT 1 -> 2')
    const wrong = parseCircuit('in 10\nCNOT 2 -> 1')
    const theirs = referenceAmplitudes(doc, amplitudesOf(doc.input!, doc.qubits))
    const mine = simulate(wrong, wrong.layers.length)
    expect([...mine.keys()]).not.toEqual([...theirs.keys()])
  })
})
