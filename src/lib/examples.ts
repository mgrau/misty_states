export interface Example {
  id: string
  title: string
  note: string
  source: string
}

export const EXAMPLES: Example[] = [
  {
    id: 'basics',
    title: 'Basic superposition',
    note: 'A bare "|" makes a cloud — no parentheses needed.',
    source: '0|1',
  },
  {
    id: 'two-qubit',
    title: 'Two-qubit entangled state',
    note: 'Position sets the shape: first qubit circle, second square.',
    source: '00|11',
  },
  {
    id: 'coefficients',
    title: 'Weighted amplitudes',
    note: '(3|0⟩+2|1⟩)/√13, written either by repetition or with coefficients.',
    source: '0|0|0|1|1\n3*0|2*1',
  },
  {
    id: 'rule1',
    title: 'Rule 1 — term order does not matter',
    note: '',
    source: '00|01 = 01|00',
  },
  {
    id: 'rule2',
    title: 'Rule 2 — opposite amplitudes cancel',
    note: '',
    source: '0|1|-1 = 0',
  },
  {
    id: 'rule3',
    title: 'Rule 3 — repeated terms reduce',
    note: '',
    source: '0|1|0|1 = 0|1',
  },
  {
    id: 'rule4',
    title: 'Rule 4 — nested clouds flatten',
    note: 'Clouds can sit inside clouds to any depth.',
    source: '(0|1)|(0|1) = 0|1|0|1',
  },
  {
    id: 'rule5',
    title: 'Rule 5 — a common qubit factors out',
    note: 'A bare qubit can sit beside a cloud.',
    source: '00|01 = 0(0|1)',
  },
  {
    id: 'rule6',
    title: 'Rule 6 — adjacent clouds distribute',
    note: '',
    source: '(0|1)(0|-1) = 00|-01|10|-11',
  },
  {
    id: 'ps5-1',
    title: 'PS5 §1 — separable vs entangled',
    note: 'The three-qubit state, then its factored form.',
    source: '000|-111|110|-001\n(00|11)(0|-1)',
  },
  {
    id: 'ps5-collapse',
    title: 'PS5 §1.3 — measuring the circle qubit',
    note: 'Captions before a colon are drawn in a left gutter.',
    source: '50%: 00(0|-1)\n50%: 11(0|-1)',
  },
  {
    id: 'ps5-collapse-2',
    title: 'PS5 §1.4 — measuring the triangle qubit',
    note: '',
    source: '50%: (00|11)0\n50%: (00|11)1',
  },
  {
    id: 'mystery',
    title: 'Unknown values',
    note: 'Each "?" is one unknown qubit. Quoted text inside a cloud says the rest is unknown.',
    source: '0?1\n("???")',
  },
  {
    id: 'ghz',
    title: 'Circuit — entanglement generator (PS5 §2)',
    note: 'Time runs downward. "header on" labels the columns with their shapes.',
    source: [
      'qubits 3',
      'header on',
      'H 3',
      'CNOT 3 -> 2',
      'CNOT 2 -> 1',
      'out 000|111',
    ].join('\n'),
  },
  {
    id: 'views',
    title: 'Circuit — following the state through',
    note: 'A state line is the input above the gates, the output below, and a view in between.',
    source: [
      '001',
      'SWAP 2 3',
      'after the swap: 010',
      'CNOT 2 -> 1; X 3',
      '111',
    ].join('\n'),
  },
  {
    id: 'partial-view',
    title: 'Circuit — a view of some of the qubits',
    note: '"view 2-3" covers two wires; "I 1 0" holds the third and shows what it has.',
    source: [
      'qubits 3',
      'H 2',
      'CNOT 2 -> 3',
      'view 2-3 00|11; I 1 0',
      'measure 1 Z',
    ].join('\n'),
  },
  {
    id: 'calculate',
    title: 'Circuit — work the state out',
    note: '"calculate" computes the state from the input and the gates above it. Settings chooses factored or flat.',
    source: [
      'in 000',
      'H 1',
      'after the Hadamard: calculate',
      'CNOT 1 -> 2',
      'CNOT 2 -> 3',
      'out calculate',
    ].join('\n'),
  },
  {
    id: 'window',
    title: 'Circuit — a framed window',
    note: '"window" frames the state in a box plumbed into the circuit, rather than breaking it.',
    source: [
      '001',
      'SWAP 2 3',
      'window 010',
      'CNOT 2 -> 1; X 3',
      '111',
    ].join('\n'),
  },
  {
    id: 'bell-test',
    title: 'Circuit — Bell test (PS5 §3)',
    note: '";" pins gates into the same layer.',
    source: [
      'qubits 2',
      'in 3*00|01|10|-11',
      'H 1; H 2',
      'measure 1 Z; measure 2 Z',
    ].join('\n'),
  },
  {
    id: 'oracle',
    title: 'Circuit — oracle box',
    note: 'A custom box spans a qubit range and takes a fill colour.',
    source: [
      'qubits 2',
      'header on',
      'H 1; H 2',
      'box "Oracle" 1-2 fill=#e3efe3',
      '---',
      'measure 1; measure 2',
    ].join('\n'),
  },
  {
    id: 'blank',
    title: 'Circuit — fill in the blank',
    note: 'BLANK draws an empty frame for students to complete.',
    source: ['qubits 2', 'in ("???")', 'blank 1-2', 'out 00|11'].join('\n'),
  },
  {
    id: 'lone-gate',
    title: 'Circuit — a gate on its own',
    note: 'The default: just the gate, with short input and output pipe stubs.',
    source: 'CNOT 1 -> 2',
  },
  {
    id: 'zoo',
    title: 'Circuit — gate zoo',
    note: 'SWAP, Toffoli, controlled-Z and measurement.',
    source: [
      'qubits 4',
      'header on',
      'H 1',
      'SWAP 1 2',
      'TOFFOLI 1 2 -> 4',
      'CZ 2 3',
      'measure 4 X',
    ].join('\n'),
  },
]

export const DEFAULT_EXAMPLE = EXAMPLES.find((e) => e.id === 'ps5-1')!
