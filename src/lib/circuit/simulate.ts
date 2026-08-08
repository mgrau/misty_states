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

import type { CircuitDoc, Gate, TableLine } from './ast'
import { gateQubits } from './ast'
import type { CloudNode, Factor, Product, QubitNode, StateRow, Term } from '../state/ast'

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

/**
 * One side of an equation, as amplitudes over exactly the wires it names.
 *
 * Unlike `amplitudesOf` this neither rejects a row with relations nor pads to a
 * register — an equation's two sides are compared with each other, and how wide
 * they are is part of what is being checked.
 */
export function sideAmplitudes(side: Product): Amplitudes {
  return productAmplitudes(side.factors)
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
      // Handled by the branch loop, which is where one state becomes several.
      return amps

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
 *
 * `keepSign` does only the first of the two. Every comparison in the codebase
 * wants the default — two states differing by an overall sign really are the
 * same state, and both the checker and the library cross-check depend on that —
 * so this is a presentation choice, never a comparison one.
 */
/** Terms in bit-string order, so nothing downstream depends on insertion order. */
const sorted = (amps: Amplitudes): [string, number][] =>
  [...amps].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

export function canonical(
  amps: Amplitudes,
  opts: { keepSign?: boolean } = {},
): [string, number][] {
  const terms = sorted(amps)
  if (!terms.length) return terms
  const divisor = terms.reduce((g, [, amp]) => gcd(g, amp), 0) || 1
  const sign = !opts.keepSign && terms[0][1] < 0 ? -1 : 1
  return terms.map(([bits, amp]) => [bits, (amp / divisor) * sign])
}

/**
 * Qubits for one bit string.
 *
 * No shape is pinned. Layout numbers them from their position, and that is what
 * lets a circuit's `shapes` override reach a calculated state as well as a
 * written one — pinning here would silently win over it.
 */
const qubitsOf = (bits: string): QubitNode[] =>
  [...bits].map((bit) => ({ kind: 'qubit', value: bit === '0' ? 0 : 1 }))

/** One block of wires as a drawable factor: a bare run, or a cloud of terms. */
function blockFactor(amps: Amplitudes, keepSign = false): Factor[] {
  const terms = canonical(amps, { keepSign })
  if (terms.length === 1 && terms[0][1] === 1) return qubitsOf(terms[0][0])
  const cloud: CloudNode = {
    kind: 'cloud',
    terms: terms.map(([bits, amp]): Term => ({
      sign: amp < 0 ? -1 : 1,
      coeff: Math.abs(amp) === 1 ? undefined : Math.abs(amp),
      factors: qubitsOf(bits),
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
  /**
   * Write a branch's likelihood exactly where a percentage would have to round
   * — `9/13` rather than `69%`. An even split still reads `50%`.
   */
  exactOdds?: boolean
  /**
   * Draw an overall minus sign rather than normalising it away.
   *
   * It is unobservable, so the default is right for a state standing alone. It
   * is worth seeing when the figure exists to show a phase flip happening —
   * `1 / H / X / H` lands on `-1`, and the minus *is* the answer.
   */
  keepSign?: boolean
}

/* -- Measurement --------------------------------------------------------- */

/** An exact probability. Amplitudes are integers, so odds are always rational. */
interface Frac {
  n: number
  d: number
}

const ONE: Frac = { n: 1, d: 1 }

function frac(n: number, d: number): Frac {
  const g = gcd(n, d) || 1
  return { n: n / g, d: d / g }
}

const times = (a: Frac, b: Frac): Frac => frac(a.n * b.n, a.d * b.d)

/** Sum of squared amplitudes — the weight the Born rule divides through. */
function weight(amps: Amplitudes): number {
  let total = 0
  for (const amp of amps.values()) total += amp * amp
  return total
}

/**
 * One possible history: a state, and how likely the measurements were to have
 * left it that way.
 */
export interface Branch {
  amps: Amplitudes
  odds: Frac
}

/** How a branch's likelihood is written above it. */
export function oddsLabel(odds: Frac, exact = false): string {
  const percent = (odds.n * 100) / odds.d
  if (Number.isInteger(percent)) return `${percent}%`
  return exact ? `${odds.n}/${odds.d}` : `${Math.round(percent)}%`
}

/**
 * Split a branch on measuring one wire.
 *
 * The Born rule in its plainest form: gather the terms in which the wire is
 * white and those in which it is black, and weigh each by the squared
 * amplitudes it holds. Each outcome keeps its own terms, which is what leaves
 * the measured qubit fixed and the rest still in superposition.
 */
function measureWire(branch: Branch, qubit: number): Branch[] {
  const total = weight(branch.amps)
  if (!total) return []

  const out: Branch[] = []
  for (const value of ['0', '1']) {
    const kept: Amplitudes = new Map()
    for (const [bits, amp] of branch.amps) if (bits[qubit - 1] === value) kept.set(bits, amp)
    if (!kept.size) continue
    out.push({ amps: kept, odds: times(branch.odds, frac(weight(kept), total)) })
  }
  return out
}

/** Turn computed amplitudes into a state row ready to be drawn. */
export function stateFrom(amps: Amplitudes, qubits: number, opts: PresentOptions = {}): StateRow {
  if (!amps.size) {
    throw new SimulationError('the terms all cancel, leaving no state to draw')
  }
  // A product has no overall sign of its own — it belongs to the whole state,
  // and each block is canonicalised separately, so left alone it would be
  // normalised away inside one of them and vanish. It is carried on the first
  // block by convention: any single one would do, and doubling it would cancel.
  const negative = !!opts.keepSign && canonical(amps, { keepSign: true })[0][1] < 0

  let blocks = opts.factor ? factorise(amps, qubits) : [amps]

  // Factoring earns its keep by removing brackets. Where every block is a bare
  // run, carrying a sign would instead *add* one — `(-1)1` where the course
  // writes `(-11)` — so the product is given up and the state drawn whole.
  if (negative && blocks.every((block) => block.size === 1)) blocks = [amps]

  if (negative) {
    blocks = blocks.map((block, i) =>
      i === 0 ? new Map(canonical(block).map(([bits, amp]) => [bits, -amp])) : block,
    )
  }

  const factors = blocks.flatMap((block, i) => blockFactor(block, negative && i === 0))
  return { sides: [{ factors }], relations: [] }
}

/**
 * The state after `layers` layers of the circuit.
 *
 * Views are skipped, so a snapshot never disturbs what it is looking at.
 */
/** The single state a circuit with no measurement produces. */
export function simulate(doc: CircuitDoc, layers: number): Amplitudes {
  const { branches } = simulateFrom(doc, layers)
  if (branches.length !== 1) {
    throw new SimulationError('this circuit measures, so it has more than one outcome')
  }
  return branches[0].amps
}

/**
 * Every history the circuit can produce, and how likely each is.
 *
 * `measured` says whether any measurement happened at all, which is what
 * decides if the results want labelling: one outcome at 100% is worth saying
 * after a measurement and worth nothing before one.
 */
export function simulateBranches(
  doc: CircuitDoc,
  layers: number,
): { branches: Branch[]; measured: boolean } {
  return simulateFrom(doc, layers)
}

function simulateFrom(doc: CircuitDoc, layers: number) {
  // A circuit with no input written starts where a circuit conventionally does:
  // every wire white. It is also the only reading available, since an unwritten
  // input cannot mean anything else.
  const start = doc.input
    ? amplitudesOf(doc.input, doc.qubits)
    : new Map([['0'.repeat(doc.qubits), 1]])

  let branches: Branch[] = [{ amps: start, odds: ONE }]
  let measured = false

  for (const layer of doc.layers.slice(0, layers)) {
    // Sorted so the answer cannot depend on the order gates were written in
    // within a layer; they act on disjoint wires, so they commute.
    const gates = [...layer.gates].sort(
      (a, b) => Math.min(...gateQubits(a)) - Math.min(...gateQubits(b)),
    )
    for (const gate of gates) {
      if (gate.kind === 'measure') {
        if (gate.basis !== 'Z') {
          throw new SimulationError(
            `a ${gate.basis} measurement has no white-or-black outcome to draw`,
          )
        }
        measured = true
        branches = branches.flatMap((b) => measureWire(b, gate.qubit))
        continue
      }
      branches = branches.map((b) => ({ ...b, amps: applyGate(b.amps, gate) }))
    }
    // A term that cancelled to nothing takes its branch with it.
    branches = branches.filter((b) => b.amps.size)
  }

  return { branches, measured }
}

/**
 * Fill in every `calculate` in a circuit.
 *
 * A snapshot shows the state as it enters its own layer, which is what a view
 * means: the moment between the gates above it and the gates below.
 */
/** Hang annotations on a state that had none until it was worked out. */
function captioned(row: StateRow, caption?: string, note?: string): StateRow {
  if (!caption && !note) return row
  return { ...row, sides: row.sides.map((s, i) => (i ? s : { ...s, caption, note })) }
}

/**
 * The rows a `calculate` draws: one per outcome.
 *
 * Only labelled once a measurement has happened. A written caption keeps its
 * place and the odds join it, since both want the same gutter.
 */
function calculated(
  doc: CircuitDoc,
  layers: number,
  caption: string | undefined,
  note: string | undefined,
  opts: PresentOptions,
): StateRow[] {
  const { branches, measured } = simulateFrom(doc, layers)
  if (!branches.length) {
    throw new SimulationError('the terms all cancel, leaving no state to draw')
  }
  return branches.map((branch) => {
    const odds = measured ? oddsLabel(branch.odds, opts.exactOdds) : undefined
    const label = [caption, odds].filter(Boolean).join(' — ') || undefined
    return captioned(stateFrom(branch.amps, doc.qubits, opts), label, note)
  })
}

/* -- Tabulating ---------------------------------------------------------- */

/** One line of a table: a state, and the numbers that go with it. */
export interface TableEntry {
  /** The state itself, ready to be drawn in the possibility column. */
  state: StateRow
  /** How likely this line is, once there is a measurement to make it a chance. */
  odds?: Frac
  /** The amplitude this line carries, in front of the state as drawn. */
  amplitude: number
}

/**
 * The amplitude in front of a state as it is drawn.
 *
 * A branch left in superposition by a partial measurement has an amplitude per
 * term, so there is no one term to read it off. It still has a single amplitude
 * as *written*, though: the drawing reduces each block by its common factor, so
 * `01|-11` is drawn `(0|-1)1` and what stands in front of it is that factor.
 * Reading the whole state as a sum over its outcomes,
 *
 *     00|01|00|-11  =  2*(00) | 1*((0|-1)1)
 *
 * those factors are the amplitudes, and every line has one.
 *
 * Note it is the notation's amplitude, not a normalised one: the drawn states
 * have different lengths, so squaring this does not by itself give the
 * probability beside it.
 */
function coefficient(amps: Amplitudes): number {
  const size = [...amps.values()].reduce((g, amp) => gcd(g, amp), 0) || 1
  return sorted(amps)[0][1] < 0 ? -size : size
}

/**
 * What a table has one line per.
 *
 * The unit follows the circuit rather than being chosen: a measurement makes
 * the outcomes the interesting thing, and without one there is a single outcome
 * and the terms of it are what there is to say. That is also what makes an
 * amplitude column meaningful — the terms of a state each have one, whereas a
 * measured branch only has one if it came out of the measurement alone.
 */
export function tabulate(
  doc: CircuitDoc,
  layers: number,
  opts: PresentOptions = {},
): { entries: TableEntry[]; measured: boolean } {
  const { branches, measured } = simulateFrom(doc, layers)
  if (!branches.length) {
    throw new SimulationError('the terms all cancel, leaving no state to draw')
  }

  // Amplitudes are scaled by the arithmetic — H·H is 2I, not I — so the whole
  // set is reduced together. Per-line reduction would flatten exactly the
  // difference the column exists to show, turning 2 and 3 into 1 and 1.
  const all = branches.flatMap((b) => [...b.amps.values()])
  const divisor = all.reduce((g, amp) => gcd(g, amp), 0) || 1
  const flip = !opts.keepSign && all.length && sorted(branches[0].amps)[0][1] < 0 ? -1 : 1
  const scale = (amp: number) => (amp / divisor) * flip

  if (measured) {
    return {
      measured,
      entries: branches.map((branch) => ({
        state: stateFrom(branch.amps, doc.qubits, opts),
        odds: branch.odds,
        amplitude: scale(coefficient(branch.amps)),
      })),
    }
  }

  // One branch, so the lines are its terms. Each is a single basis state, which
  // is what gives it both an amplitude and a probability of its own.
  const amps = branches[0].amps
  const total = weight(amps)
  return {
    measured,
    entries: sorted(amps).map(([bits, amp]) => ({
      state: stateFrom(new Map([[bits, 1]]), doc.qubits, opts),
      odds: frac(amp * amp, total),
      amplitude: scale(amp),
    })),
  }
}

/** The table's lines with their numbers written out, ready to be drawn. */
function tableLines(doc: CircuitDoc, opts: PresentOptions): TableLine[] {
  const { entries } = tabulate(doc, doc.layers.length, opts)
  return entries.map((entry) => ({
    state: entry.state,
    // Unlike a stack of calculated states, this is written whether or not a
    // measurement happened: before one, it is what the terms of a superposition
    // mean, which is the other half of what a table is for.
    probability: entry.odds ? oddsLabel(entry.odds, opts.exactOdds) : undefined,
    amplitude: String(entry.amplitude),
  }))
}

export function resolveCalculations(doc: CircuitDoc, opts: PresentOptions = {}): CircuitDoc {
  const wanted = doc.layers.some((l) =>
    l.gates.some((g) => g.kind === 'view' && g.calculate),
  )
  if (!wanted && !doc.calculateOutput && !doc.table) return doc

  const layers = doc.layers.map((layer, at) => ({
    ...layer,
    gates: layer.gates.map((gate) =>
      gate.kind === 'view' && gate.calculate
        ? { ...gate, rows: calculated(doc, at, gate.caption, gate.note, opts) }
        : gate,
    ),
  }))

  const output = doc.calculateOutput
    ? calculated(doc, doc.layers.length, doc.calculateCaption, doc.calculateNote, opts)
    : doc.output

  // Refuses the same way `calculate` does when the arithmetic cannot be
  // followed — a table of nothing would be worse than being told why.
  const table = doc.table ? { ...doc.table, lines: tableLines(doc, opts) } : undefined

  return { ...doc, layers, output, table }
}
