<script lang="ts">
  interface Row {
    code: string
    text: string
  }

  const stateRows: Row[] = [
    { code: '0  1', text: 'A white (0) and a black (1) qubit' },
    { code: '00|11', text: 'Superposition — "," works too: 00,11' },
    { code: '000|-111', text: 'A leading "-" gives the term a negative amplitude' },
    { code: '0(0|1)', text: 'A bare qubit beside a cloud (a factored state)' },
    { code: '(0|1)(0|1)', text: 'Two adjacent clouds — a product of separable states' },
    { code: '(0|1) x (0|1)', text: 'An explicit × between factors ("*" is for coefficients)' },
    { code: '(0|1)|(0|1)', text: 'Clouds nested inside a cloud' },
    { code: '3*0|2*1', text: 'Numeric amplitudes — same as 0|0|0|1|1' },
    { code: '0|1|-1 = 0', text: '"=" chains expressions into an equation — and is checked' },
    { code: '50%: 0(0|1)', text: 'Text before ":" is an annotation on the left' },
    { code: '0(0|1) : note', text: 'Text after ":" is an annotation on the right' },
    { code: '0?1', text: 'Each "?" is a qubit of unknown value' },
    { code: '("???")', text: 'Quoted text inside a cloud — any caption, not just ???' },
    { code: 'shape os^', text: 'Set the register: o s ^ d v * p h' },
    { code: '0@3', text: 'Force this qubit to use shape 3' },
  ]

  const circuitRows: Row[] = [
    { code: 'qubits 3', text: 'Declare the register (otherwise inferred)' },
    { code: 'shape s^o', text: 'Which shape each wire draws with' },
    { code: 'H 2', text: 'Single-qubit gate — also X Y Z S T' },
    { code: 'H', text: 'No wire given means the first: same as H 1' },
    { code: 'HZT', text: 'A row of one-letter gates, one per wire' },
    { code: 'I 2', text: 'Identity — plain pipe, just holds a slot in the layer' },
    { code: 'CNOT 3 -> 2', text: 'Control 3, target 2' },
    { code: 'TOFFOLI 1 2 -> 3', text: 'Two controls' },
    { code: 'CZ 1 2', text: 'Controlled-Z' },
    { code: 'SWAP 1 2', text: 'Swap two qubits' },
    { code: 'measure 2 Z', text: 'Measurement in a basis' },
    { code: 'box "Oracle" 1-3', text: 'Custom box spanning a range; add fill=#e3efe3' },
    { code: 'blank 1-2', text: 'Empty frame for students to fill in' },
    { code: 'H 1; H 2', text: '";" pins gates into the same layer' },
    { code: '---', text: 'Force a new layer' },
    { code: '000', text: 'A state line: above the gates it is the input, below it the output' },
    { code: '0(0|1)0', text: 'Between gates it is a view — the state at that point' },
    { code: 'view 2-3 00|11', text: 'A view of some qubits; the rest flow past' },
    { code: 'out calculate', text: 'Work the state out from the input ("calc" too)' },
    { code: 'in calculate', text: 'Work the input back from a state written later' },
    { code: 'after H: calc', text: 'Calculated part-way through, with a caption' },
    { code: 'measure 1 Z', text: 'calculate draws every outcome, with its odds' },
    { code: 'tabulate', text: 'The outcomes as a table instead ("table" too)' },
    { code: 'tabulate(state, amp, p)', text: 'Which columns, and p="Chance" renames one' },
    { code: 'window 010', text: 'The same, framed with a pane; fill= colours the pane' },
    { code: 'I 2 0', text: 'An identity that shows what its qubit holds' },
    { code: 'after H: 0(0|1)', text: 'An annotation on the left; ": note" for the right' },
    { code: 'step: H 1 : note', text: 'A gate line takes annotations the same way' },
    { code: 'in 00|11', text: 'Names the input explicitly (out for below)' },
    { code: 'out 00|11', text: 'A written output is checked against the circuit' },
    { code: 'answer 010', text: 'What the question asks for — hidden until "Show answer"' },
    { code: 'answer', text: 'On its own: the state worked out, and hidden' },
    { code: 'animate', text: 'The state travels through the circuit; a superposition a term at a time' },
    { code: 'animate speed=1.5', text: 'Also dwell=, hold= and loop=off; the toolbar plays and steps it' },
    { code: 'animate inside=off', text: 'Gates as closed boxes: qubits in, qubits out' },
    { code: 'header on', text: 'Label the columns with qubit shapes (off by default)' },
  ]

  const tabs = [
    { id: 'state', label: 'States', rows: stateRows },
    { id: 'circuit', label: 'Circuits', rows: circuitRows },
  ] as const

  const {
    open = true,
    onopenchange,
    collapsible = true,
  }: {
    open?: boolean
    onopenchange?: (open: boolean) => void
    /** In the side column it folds away; in a dialog there is nothing to fold. */
    collapsible?: boolean
  } = $props()

  const shown = $derived(collapsible ? open : true)

  let active = $state<'state' | 'circuit'>('state')
  const rows = $derived(tabs.find((t) => t.id === active)!.rows)

  /** Left/right arrows move between tabs, as a tablist is expected to. */
  function onKey(event: KeyboardEvent) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const i = tabs.findIndex((t) => t.id === active)
    active = tabs[(i + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length].id
  }
</script>

<div class="flex min-h-0 flex-col">
  {#if collapsible}
  <button
    type="button"
    onclick={() => onopenchange?.(!open)}
    aria-expanded={open}
    class="flex items-center gap-1.5 py-1 text-xs font-medium text-slate-500
           hover:text-slate-800"
  >
    <svg
      viewBox="0 0 16 16"
      class="h-3.5 w-3.5 transition-transform {open ? '' : '-rotate-90'}"
      aria-hidden="true"
    >
      <path
        d="M4 6l4 4 4-4"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
    Syntax
  </button>
  {/if}

  {#if shown}
    <div role="tablist" aria-label="Syntax reference" class="flex border-b border-slate-200">
      {#each tabs as tab (tab.id)}
        <button
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          tabindex={active === tab.id ? 0 : -1}
          onclick={() => (active = tab.id)}
          onkeydown={onKey}
          class="-mb-px border-b-2 px-3 py-1.5 text-xs font-medium transition-colors
                 {active === tab.id
            ? 'border-slate-800 text-slate-900'
            : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'}"
        >
          {tab.label}
        </button>
      {/each}
    </div>

    <!--
      Capped and scrolled in its own right. The reference is far longer than
      the editor above it, and without a ceiling it pushes the source box off
      the top of the column.
    -->
    <dl
      data-syntax-rows
      class="divide-y divide-slate-100 {collapsible ? 'max-h-72 overflow-y-auto' : ''}"
    >
      {#each rows as row (row.code)}
        <div class="grid grid-cols-[minmax(0,9rem)_1fr] gap-3 px-1 py-1.5 text-xs">
          <dt class="font-mono whitespace-pre text-slate-800">{row.code}</dt>
          <dd class="text-slate-500">{row.text}</dd>
        </div>
      {/each}
    </dl>
  {/if}
</div>
