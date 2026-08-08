/**
 * Working out what a circuit does to a state.
 *
 * The arithmetic is **exact integers**, which is not a shortcut but the whole
 * reason this is worth doing. Take the PETE box unnormalised — `0 → 0|1` and
 * `1 → 0|-1` — and the course's gates all map integer amplitudes to integer
 * amplitudes. `H·H = 2I`, and the factor of two divides straight back out. So
 * there is no floating point anywhere, nothing to round, and the answer lands
 * in the notation already drawn: reduce the terms by their common factor and
 * `3*0|2*1` falls out on its own.
 *
 * A state is a map from bit string to amplitude, the bit string reading left to
 * right as qubit 1 upward. Amplitudes of zero are dropped rather than stored.
 * A circuit that writes no input starts from every wire white.
 *
 * What it will not do, it says so about rather than guessing: `S`, `T` and `Y`
 * need complex amplitudes that the notation cannot draw, `BOX` and `BLANK` are
 * pictures rather than operations, and `?` has no value to propagate.
 */

import type { CircuitDoc, Gate } from './ast'
import { gateQubits } from './ast'
import type { CloudNode, Factor, QubitNode, StateRow, Term } from '../state/ast'

/** Bit string → amplitude. Zero amplitudes are absent, not stored. */
export type Amplitudes = Map<string, number>

/** Something the notation can express but the arithmetic cannot follow. */
export class SimulationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SimulationError'
  }
}

/* -- Reading a state in -------------------------------------------------- */

function scale(amps: Amplitudes, by: number): Amplitudes {
  const out: Amplitudes = new Map()
  if (by === 0) return out
  for (const [bits, amp] of amps) out.set(bits, amp * by)
  return out
}

function add(into: Amplitudes, from: Amplitudes) {
  for (const [bits, amp] of from) {
    const sum = (into.get(bits) ?? 0) + amp
    if (sum === 0) into.delete(bits)
    else into.set(bits, sum)
  }
}

/** Tensor product: every combination, bit strings concatenated. */
function tensor(a: Amplitudes, b: Amplitudes): Amplitudes {
  const out: Amplitudes = new Map()
  for (const [aBits, aAmp] of a) {
    for (const [bBits, bAmp] of b) {
      const bits = aBits + bBits
      const sum = (out.get(bits) ?? 0) + aAmp * bAmp
      if (sum === 0) out.delete(bits)
      else out.set(bits, sum)
    }
  }
  return out
}

function factorAmplitudes(factor: Factor): Amplitudes {
  switch (factor.kind) {
    case 'qubit':
      if (factor.value === 'unknown') {
        throw new SimulationError('“?” has no value, so there is nothing to calculate from')
      }
      return new Map([[String(factor.value), 1]])
    case 'cloud': {
      const out: Amplitudes = new Map()
      for (const term of factor.terms) add(out, termAmplitudes(term))
      return out
    }
    case 'label':
      throw new SimulationError(`“${factor.text}” is a label, not a state`)
    case 'op':
      throw new SimulationError('“×” cannot be calculated through')
  }
}

function productAmplitudes(factors: Factor[]): Amplitudes {
  let out: Amplitudes = new Map([['', 1]])
  for (const factor of factors) out = tensor(out, factorAmplitudes(factor))
  return out
}

function termAmplitudes(term: Term): Amplitudes {
  return scale(productAmplitudes(term.factors), term.sign * (term.coeff ?? 1))
}

/**
 * Read a written state as amplitudes over `qubits` wires.
 *
 * A state narrower than the register describes the wires it names and leaves
 * the rest in |0⟩, which is the usual convention and the only reading available.
 */
export function amplitudesOf(row: StateRow, qubits: number): Amplitudes {
  if (row.sides.length !== 1 || row.relations.length) {
    throw new SimulationError('an equation is not a state to calculate from')
  }
  const amps = productAmplitudes(row.sides[0].factors)
  const width = amps.size ? [...amps.keys()][0].length : 0
  if (width > qubits) {
    throw new SimulationError(`this state describes ${width} qubits but the circuit has ${qubits}`)
  }
  if (width === qubits) return amps
  const pad = '0'.repeat(qubits - width)
  return new Map([...amps].map(([bits, amp]) => [bits + pad, amp]))
}

/* -- Applying gates ------------------------------------------------------ */

const flip = (bits: string, q: number) =>
  bits.slice(0, q - 1) + (bits[q - 1] === '0' ? '1' : '0') + bits.slice(q)

/** Rebuild the map one bit string at a time, dropping anything that cancels. */
function mapStates(
  amps: Amplitudes,
  each: (bits: string, amp: number, emit: (bits: string, amp: number) => void) => void,
): Amplitudes {
  const out: Amplitudes = new Map()
  const emit = (bits: string, amp: number) => {
    if (amp === 0) return
    const sum = (out.get(bits) ?? 0) + amp
    if (sum === 0) out.delete(bits)
    else out.set(bits, sum)
  }
  for (const [bits, amp] of amps) each(bits, amp, emit)
  return out
}

function applyGate(amps: Amplitudes, gate: Gate): Amplitudes {
  switch (gate.kind) {
    // Neither of these does anything to the state; both are drawings.
    case 'identity':
    case 'view':
      return amps

    case 'single':
      if (gate.label === 'H') {
        // Unnormalised, which is what keeps every amplitude an integer:
        // white in gives white plus black, black in gives white minus black.
        return mapStates(amps, (bits, amp, emit) => {
          const zero = bits.slice(0, gate.qubit - 1) + '0' + bits.slice(gate.qubit)
          const one = bits.slice(0, gate.qubit - 1) + '1' + bits.slice(gate.qubit)
          emit(zero, amp)
          emit(one, bits[gate.qubit - 1] === '0' ? amp : -amp)
        })
      }
      if (gate.label === 'Z') {
        return mapStates(amps, (bits, amp, emit) =>
          emit(bits, bits[gate.qubit - 1] === '1' ? -amp : amp),
        )
      }
      throw new SimulationError(
        `${gate.label} needs complex amplitudes, which this notation cannot draw`,
      )

    case 'controlled': {
      const on = (bits: string) => gate.controls.every((c) => bits[c - 1] === '1')
      if (gate.targetGlyph === 'z') {
        return mapStates(amps, (bits, amp, emit) =>
          emit(bits, on(bits) && bits[gate.target - 1] === '1' ? -amp : amp),
        )
      }
      return mapStates(amps, (bits, amp, emit) =>
        emit(on(bits) ? flip(bits, gate.target) : bits, amp),
      )
    }

    case 'swap': {
      const [a, b] = gate.qubits
      return mapStates(amps, (bits, amp, emit) => {
        const chars = [...bits]
        ;[chars[a - 1], chars[b - 1]] = [chars[b - 1], chars[a - 1]]
        emit(chars.join(''), amp)
      })
    }

    case 'measure':
      throw new SimulationError(
        `calculate cannot pass the measurement on wire ${gate.qubit}`,
      )

    case 'box':
      throw new SimulationError(
        gate.label
          ? `“${gate.label}” is a drawing, so there is no operation to apply`
          : 'a blank box has no operation to apply',
      )
  }
}

/* -- Writing a state back out -------------------------------------------- */

function gcd(a: number, b: number): number {
  a = Math.abs(a)
  b = Math.abs(b)
  while (b) [a, b] = [b, a % b]
  return a
}

/**
 * Divide out the common factor and settle the overall sign.
 *
 * Both are unobservable — the notation is unnormalised, so `6*0|4*1` and
 * `3*0|2*1` are the same state, as are `-00|01` and `00|-01`. Fixing them
 * makes the answer deterministic: smallest whole numbers, leading term
 * positive.
 */
export function canonical(amps: Amplitudes): [string, number][] {
  const terms = [...amps].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  if (!terms.length) return terms
  const divisor = terms.reduce((g, [, amp]) => gcd(g, amp), 0) || 1
  const sign = terms[0][1] < 0 ? -1 : 1
  return terms.map(([bits, amp]) => [bits, (amp / divisor) * sign])
}

const qubitsOf = (bits: string, from: number): QubitNode[] =>
  [...bits].map((bit, i) => ({
    kind: 'qubit',
    value: bit === '0' ? 0 : 1,
    shapeIndex: from + i,
  }))

/** One block of wires as a drawable factor: a bare run, or a cloud of terms. */
function blockFactor(amps: Amplitudes, from: number): Factor[] {
  const terms = canonical(amps)
  if (terms.length === 1 && terms[0][1] === 1) return qubitsOf(terms[0][0], from)
  const cloud: CloudNode = {
    kind: 'cloud',
    terms: terms.map(([bits, amp]): Term => ({
      sign: amp < 0 ? -1 : 1,
      coeff: Math.abs(amp) === 1 ? undefined : Math.abs(amp),
      factors: qubitsOf(bits, from),
    })),
  }
  return [cloud]
}

/** The sub-state on `width` leading wires, and on the rest, if it splits. */
function split(amps: Amplitudes, width: number): [Amplitudes, Amplitudes] | null {
  const head = new Set<string>()
  const tail = new Set<string>()
  for (const bits of amps.keys()) {
    head.add(bits.slice(0, width))
    tail.add(bits.slice(width))
  }
  const at = (h: string, t: string) => amps.get(h + t) ?? 0

  // The state splits exactly when this matrix has rank one, which is every
  // 2×2 minor vanishing — checked against one non-zero entry rather than all
  // pairs, since a rank-one matrix is determined by any row and column
  // through a non-zero pivot.
  const [pivot] = canonical(amps)
  if (!pivot) return null
  const [ph, pt] = [pivot[0].slice(0, width), pivot[0].slice(width)]
  const scaleBy = at(ph, pt)
  for (const h of head) {
    for (const t of tail) {
      if (at(h, t) * scaleBy !== at(h, pt) * at(ph, t)) return null
    }
  }

  const first: Amplitudes = new Map()
  for (const h of head) if (at(h, pt)) first.set(h, at(h, pt))
  const rest: Amplitudes = new Map()
  for (const t of tail) if (at(ph, t)) rest.set(t, at(ph, t))
  return [first, rest]
}

/**
 * Break a state into the widest product the notation can draw.
 *
 * Only *contiguous* runs of wires are tried, which is not a simplification but
 * the constraint the drawing imposes: factors sit side by side over the wires
 * they describe, so a state separable into wires 1,3 against 2 has no product
 * form to draw. Splitting off the shortest leading run that separates gives the
 * finest such product.
 */
function factorise(amps: Amplitudes, width: number): Amplitudes[] {
  for (let head = 1; head < width; head++) {
    const parts = split(amps, head)
    if (parts) return [parts[0], ...factorise(parts[1], width - head)]
  }
  return [amps]
}

export interface PresentOptions {
  /** Draw the answer as a product where it separates, rather than one cloud. */
  factor?: boolean
}

/** Turn computed amplitudes into a state row ready to be drawn. */
export function stateFrom(amps: Amplitudes, qubits: number, opts: PresentOptions = {}): StateRow {
  if (!amps.size) {
    throw new SimulationError('the terms all cancel, leaving no state to draw')
  }
  const blocks = opts.factor ? factorise(amps, qubits) : [amps]
  const factors: Factor[] = []
  let at = 0
  for (const block of blocks) {
    const width = [...block.keys()][0].length
    factors.push(...blockFactor(block, at))
    at += width
  }
  return { sides: [{ factors }], relations: [] }
}

/**
 * The state after `layers` layers of the circuit.
 *
 * Views are skipped, so a snapshot never disturbs what it is looking at.
 */
export function simulate(doc: CircuitDoc, layers: number): Amplitudes {
  return simulateFrom(doc, layers)
}

function simulateFrom(doc: CircuitDoc, layers: number): Amplitudes {
  // A circuit with no input written starts where a circuit conventionally does:
  // every wire white. It is also the only reading available, since an unwritten
  // input cannot mean anything else.
  let amps = doc.input
    ? amplitudesOf(doc.input, doc.qubits)
    : new Map([['0'.repeat(doc.qubits), 1]])
  for (const layer of doc.layers.slice(0, layers)) {
    // Sorted so the answer cannot depend on the order gates were written in
    // within a layer; they act on disjoint wires, so they commute.
    const gates = [...layer.gates].sort(
      (a, b) => Math.min(...gateQubits(a)) - Math.min(...gateQubits(b)),
    )
    for (const gate of gates) amps = applyGate(amps, gate)
  }
  return amps
}

/**
 * Fill in every `calculate` in a circuit.
 *
 * A snapshot shows the state as it enters its own layer, which is what a view
 * means: the moment between the gates above it and the gates below.
 */
/** Hang a caption on a state that had none until it was worked out. */
function captioned(row: StateRow, caption?: string): StateRow {
  if (!caption) return row
  return { ...row, sides: row.sides.map((s, i) => (i ? s : { ...s, caption })) }
}

export function resolveCalculations(doc: CircuitDoc, opts: PresentOptions = {}): CircuitDoc {
  const wanted = doc.layers.some((l) =>
    l.gates.some((g) => g.kind === 'view' && g.calculate),
  )
  if (!wanted && !doc.calculateOutput) return doc

  const layers = doc.layers.map((layer, at) => ({
    ...layer,
    gates: layer.gates.map((gate) =>
      gate.kind === 'view' && gate.calculate
        ? { ...gate, row: captioned(stateFrom(simulateFrom(doc, at), doc.qubits, opts), gate.caption) }
        : gate,
    ),
  }))

  const output = doc.calculateOutput
    ? captioned(
        stateFrom(simulateFrom(doc, doc.layers.length), doc.qubits, opts),
        doc.calculateCaption,
      )
    : doc.output

  return { ...doc, layers, output }
}
