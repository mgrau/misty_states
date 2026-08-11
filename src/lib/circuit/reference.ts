/**
 * A second, deliberately different way to work out what a circuit does.
 *
 * This exists only to disagree with `simulate.ts`. That one maps bit strings to
 * bit strings and keeps everything in integers; this one builds a dense
 * 2ⁿ × 2ⁿ matrix per gate out of Kronecker products of one-qubit operators and
 * multiplies floating-point vectors through them. Controlled gates are assembled
 * from projectors — `CNOT = P₀⊗I + P₁⊗X` — rather than by flipping a bit, so a
 * mistake in one is unlikely to be mirrored in the other.
 *
 * It is not used by the app. Being quadratically slower and inexact is the
 * price of the independence, and only the tests pay it.
 */

import type { CircuitDoc, Gate } from './ast'
import { cx } from './complex'
import type { Amplitudes } from './simulate'

/** Row-major dense matrix. */
type Matrix = number[][]

const I2: Matrix = [[1, 0], [0, 1]]
const X2: Matrix = [[0, 1], [1, 0]]
const Z2: Matrix = [[1, 0], [0, -1]]
/** Unnormalised, matching the course's PETE box. */
const H2: Matrix = [[1, 1], [1, -1]]
/** |0⟩⟨0| and |1⟩⟨1|, the projectors a control selects with. */
const P0: Matrix = [[1, 0], [0, 0]]
const P1: Matrix = [[0, 0], [0, 1]]
/** |0⟩⟨1| and |1⟩⟨0|, the off-diagonal blocks a swap is built from. */
const S01: Matrix = [[0, 1], [0, 0]]
const S10: Matrix = [[0, 0], [1, 0]]

function kron(a: Matrix, b: Matrix): Matrix {
  const out: Matrix = []
  for (let i = 0; i < a.length; i++) {
    for (let k = 0; k < b.length; k++) {
      const row: number[] = []
      for (let j = 0; j < a[i].length; j++) {
        for (let l = 0; l < b[k].length; l++) row.push(a[i][j] * b[k][l])
      }
      out.push(row)
    }
  }
  return out
}

function sum(a: Matrix, b: Matrix): Matrix {
  return a.map((row, i) => row.map((v, j) => v + b[i][j]))
}

/** Spread one-qubit operators across `n` wires, the identity where unnamed. */
function embed(n: number, ops: Record<number, Matrix>): Matrix {
  let out: Matrix = [[1]]
  for (let q = 1; q <= n; q++) out = kron(out, ops[q] ?? I2)
  return out
}

function matrixOf(gate: Gate, n: number): Matrix | null {
  switch (gate.kind) {
    case 'identity':
    case 'view':
      return null

    case 'single':
      if (gate.label === 'H') return embed(n, { [gate.qubit]: H2 })
      if (gate.label === 'Z') return embed(n, { [gate.qubit]: Z2 })
      throw new Error(`reference: ${gate.label} is not real-valued`)

    case 'controlled': {
      const act = gate.targetGlyph === 'z' ? Z2 : X2
      // Every assignment of the controls, the acting one carrying the operator.
      // The projectors sum to the identity, so the pieces cover every case
      // exactly once.
      let out: Matrix | null = null
      const total = 1 << gate.controls.length
      for (let mask = 0; mask < total; mask++) {
        const ops: Record<number, Matrix> = {}
        gate.controls.forEach((c, i) => {
          ops[c] = mask & (1 << i) ? P1 : P0
        })
        if (mask === total - 1) ops[gate.target] = act
        out = out ? sum(out, embed(n, ops)) : embed(n, ops)
      }
      return out ?? embed(n, { [gate.target]: act })
    }

    case 'swap': {
      const [a, b] = gate.qubits
      return [
        embed(n, { [a]: P0, [b]: P0 }),
        embed(n, { [a]: P1, [b]: P1 }),
        embed(n, { [a]: S01, [b]: S10 }),
        embed(n, { [a]: S10, [b]: S01 }),
      ].reduce(sum)
    }

    case 'measure':
    case 'box':
      throw new Error('reference: not a unitary')
  }
}

const bitsOf = (index: number, n: number) => index.toString(2).padStart(n, '0')

/** Run the circuit from `input`, returning amplitudes keyed the same way. */
export function referenceSimulate(doc: CircuitDoc, input: Amplitudes): number[] {
  const n = doc.qubits
  let vector = new Array<number>(1 << n).fill(0)
  // Real parts only: this stands beside the exact simulator to disagree with
  // it, and it implements only the gates that keep a state on the real axis.
  for (const [bits, amp] of input) vector[parseInt(bits, 2)] = amp.re

  for (const layer of doc.layers) {
    for (const gate of layer.gates) {
      const m = matrixOf(gate, n)
      if (!m) continue
      const next = new Array<number>(1 << n).fill(0)
      for (let i = 0; i < next.length; i++) {
        let acc = 0
        for (let j = 0; j < vector.length; j++) acc += m[i][j] * vector[j]
        next[i] = acc
      }
      vector = next
    }
  }
  return vector
}

/** The same result as a map, for comparing against the integer simulator. */
export function referenceAmplitudes(doc: CircuitDoc, input: Amplitudes): Amplitudes {
  const vector = referenceSimulate(doc, input)
  const out: Amplitudes = new Map()
  vector.forEach((amp, i) => {
    if (Math.abs(amp) > 1e-9) out.set(bitsOf(i, doc.qubits), cx(amp))
  })
  return out
}
