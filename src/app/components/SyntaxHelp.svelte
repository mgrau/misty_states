<script lang="ts">
  /**
   * The syntax reference.
   *
   * Grouped by what you are trying to do rather than by when each piece was
   * added, because that is how it gets read: someone writing a circuit wants
   * *controlled gates*, not the fourteenth row of a flat list. The two tabs are
   * the top-level split — a source is a state or a circuit, never both — and
   * inside each, headed groups keep any one of them short enough to scan.
   *
   * Every entry is a line you could type as it stands.
   *
   * The third tab draws instead of describing. A gate's name says nothing about
   * what it looks like on the page, and half of writing one of these figures is
   * knowing which glyph you are after — so the gallery renders each one with
   * the app's own renderer, in the theme the drawing is using, and puts the
   * line that produces it underneath.
   */
  import { render } from '../../core/index'
  import type { ThemeId } from '../../core/render/theme'
  import type { Droppable } from '../../core/circuit/edit'
  import { GATE_GALLERY, type Swatch } from '../../core/gates'

  const {
    theme = 'solid',
    dark = false,
    onpick,
  }: {
    theme?: ThemeId
    dark?: boolean
    /**
     * A gate has been picked up off the palette.
     *
     * Pointer events rather than HTML5 drag-and-drop: this has to work under a
     * finger as well as a mouse, and the drawing wants to follow the pointer
     * continuously rather than at whatever rate `dragover` chooses to fire.
     */
    onpick?: (gate: Droppable, event: PointerEvent) => void
  } = $props()

  interface Row {
    code: string
    text: string
  }

  interface Group {
    heading: string
    rows: Row[]
  }

  const stateGroups: Group[] = [
    {
      heading: 'Qubits and superpositions',
      rows: [
        { code: '0  1', text: 'A white (0) and a black (1) qubit' },
        { code: '00|11', text: 'Superposition — "," works too: 00,11' },
        { code: '000|-111', text: 'A leading "-" gives the term a negative amplitude' },
        { code: '3*0|2*1', text: 'Numeric amplitudes — same as 0|0|0|1|1' },
      ],
    },
    {
      heading: 'Products and clouds',
      rows: [
        { code: '0(0|1)', text: 'A bare qubit beside a cloud (a factored state)' },
        { code: '(0|1)(0|1)', text: 'Two adjacent clouds — a product of separable states' },
        { code: '(0|1) x (0|1)', text: 'An explicit × between factors ("*" is for coefficients)' },
        { code: '(0|1)|(0|1)', text: 'Clouds nested inside a cloud' },
      ],
    },
    {
      heading: 'Leaving something out',
      rows: [
        { code: '0?1', text: 'Each "?" is a qubit of unknown value' },
        { code: '("???")', text: 'Quoted text inside a cloud — any caption, not just ???' },
      ],
    },
    {
      heading: 'Equations',
      rows: [{ code: '0|1|-1 = 0', text: '"=" chains expressions into an equation — and is checked' }],
    },
    {
      heading: 'Shapes',
      rows: [
        { code: 'shape os^', text: 'Set the register: o s ^ d v * p h' },
        { code: '0@3', text: 'Force this qubit to use shape 3' },
      ],
    },
  ]

  const circuitGroups: Group[] = [
    {
      heading: 'The register',
      rows: [
        { code: 'qubits 3', text: 'Declare the register (otherwise inferred)' },
        { code: 'shape s^o', text: 'Which shape each wire draws with' },
        { code: 'header on', text: 'Label the columns with qubit shapes (off by default)' },
      ],
    },
    {
      heading: 'Gates',
      rows: [
        { code: 'H 2', text: 'Single-qubit gate — also X Y Z S T' },
        { code: 'H', text: 'No wire given means the first: same as H 1' },
        { code: 'HZT', text: 'A row of one-letter gates, one per wire' },
        { code: 'I 2', text: 'Identity — plain pipe, just holds a slot in the layer' },
        { code: 'SWAP 1 2', text: 'Swap two qubits' },
        { code: 'RZ(90) 1', text: 'A rotation in degrees — also RX, RY and P' },
        { code: 'P(45) 1', text: 'Odd angles chart and write out, but cannot be drawn' },
      ],
    },
    {
      heading: 'Controlled gates',
      rows: [
        { code: 'CNOT 3 -> 2', text: 'Control 3, target 2' },
        { code: 'CNOT 3 2', text: 'The arrow is optional — the last wire is the target' },
        { code: 'TOFFOLI 1 2 -> 3', text: 'Two controls' },
        { code: 'CZ 1 2', text: 'Controlled-Z' },
        { code: 'CNOT "Oracle" 1 2', text: 'A name before the wires stands on the target' },
        { code: 'CNOT 1 2 "Tiger?"', text: 'A name after them labels the link' },
      ],
    },
    {
      heading: 'Boxes and measurement',
      rows: [
        { code: 'measure 2 Z', text: 'Measurement in a basis ("M" too)' },
        { code: 'box "Oracle" 1-3', text: 'Custom box spanning a range; add fill=#e3efe3' },
        { code: 'blank 1-2', text: 'Empty frame for students to fill in' },
      ],
    },
    {
      heading: 'Layers',
      rows: [
        { code: 'H 1; H 2', text: '";" pins gates into the same layer' },
        { code: '---', text: 'Force a new layer' },
      ],
    },
    {
      heading: 'States along the way',
      rows: [
        { code: 'in 00|11', text: 'The state above the circuit' },
        { code: 'out 00|11', text: 'The state below it — and it is checked' },
        { code: '000', text: 'A bare state line: input above the gates, output below' },
        { code: '0(0|1)0', text: 'Between gates it is a view — the state at that point' },
        { code: 'view 2-3 00|11', text: 'A view of some qubits; the rest flow past' },
        { code: 'window 010', text: 'The same, framed with a pane; fill= colours the pane' },
        { code: 'I 2 0', text: 'An identity that shows what its qubit holds' },
      ],
    },
  ]

  /**
   * Everything that is about the figure rather than about the physics.
   *
   * Annotations, what a figure works out and shows, whether it holds an answer
   * back, whether it moves. None of it is a state or a gate, and leaving it
   * scattered through the other two made the Circuits list twice as long as it
   * needed to be — and documented annotations in both places at once, since
   * states and gate lines take them the same way.
   */
  const figureGroups: Group[] = [
    {
      heading: 'Annotations',
      rows: [
        { code: '50%: 0(0|1)', text: 'Text before ":" is an annotation on the left' },
        { code: '0(0|1) : note', text: 'Text after ":" is one on the right' },
        { code: 'after H: 0(0|1)', text: 'A state inside a circuit takes them too' },
        { code: 'step: H 1 : note', text: 'And so does a gate line' },
      ],
    },
    {
      heading: 'Working it out',
      rows: [
        { code: 'out calculate', text: 'Work the state out from the input ("calc" too)' },
        { code: 'in calculate', text: 'Work the input back from a state written later' },
        { code: 'after H: calc', text: 'Calculated part-way through, with a caption' },
        { code: 'measure 1 Z', text: 'calculate draws every outcome, with its odds' },
      ],
    },
    {
      heading: 'Tables and charts',
      rows: [
        { code: 'tabulate', text: 'The outcomes as a table ("table" too)' },
        { code: 'tabulate(state, amp, p)', text: 'Which columns, and p="Chance" renames one' },
        { code: 'chart', text: 'A bar per basis state — signed amplitudes ("plot" too)' },
        { code: 'chart(probability)', text: 'The chances instead, all positive and uncoloured' },
      ],
    },
    {
      heading: 'Questions and answers',
      rows: [
        { code: 'answer 010', text: 'What the question asks for — hidden until "Show answer"' },
        { code: 'answer', text: 'On its own: the state worked out, and hidden' },
      ],
    },
    {
      heading: 'Animation',
      rows: [
        { code: 'animate', text: 'The state travels through; a superposition a term at a time' },
        { code: 'animate speed=1.5', text: 'Also dwell=, hold= and loop=off' },
        { code: 'animate inside=off', text: 'Gates as closed boxes: qubits in, qubits out' },
      ],
    },
  ]

  /**
   * Drawn small, and in the theme in use — a swatch in the wrong style would be
   * a picture of a different app.
   */
  function drawn(item: Swatch): string {
    try {
      return render(item.source ?? `qubits 1\n${item.code}`, {
        theme,
        dark,
        check: false,
        // Its own id namespace, so these never lend their gradients to the
        // drawing beside them — nor borrow its.
        idPrefix: 'ref',
        // A wider column gap than the drawing uses: at this size a name on a
        // target comes within a few pixels of the control beside it, which
        // reads as a collision even though it is not one.
        metrics: { qubit: 13, pipeWidth: 16, colGap: 16, gateHeight: 28, fontSize: 12 },
      }).svg
    } catch {
      return ''
    }
  }

  const tabs = [
    { id: 'state', label: 'States', groups: stateGroups },
    { id: 'circuit', label: 'Circuits', groups: circuitGroups },
    { id: 'gates', label: 'Gates', groups: [] },
    { id: 'figure', label: 'Figures', groups: figureGroups },
  ] as const

  let active = $state<'state' | 'circuit' | 'gates' | 'figure'>('state')
  const groups = $derived(tabs.find((t) => t.id === active)!.groups)

  /** Left/right arrows move between tabs, as a tablist is expected to. */
  function onKey(event: KeyboardEvent) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const i = tabs.findIndex((t) => t.id === active)
    active = tabs[(i + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length].id
  }
</script>

<!--
  The tabs stay put while the entries scroll under them: which of the three you
  are reading is the thing you least want to lose track of.
-->
<div
  role="tablist"
  aria-label="Syntax reference"
  class="sticky top-0 z-10 flex border-b border-slate-200 bg-white px-2"
>
  {#each tabs as tab (tab.id)}
    <button
      type="button"
      role="tab"
      aria-selected={active === tab.id}
      tabindex={active === tab.id ? 0 : -1}
      onclick={() => (active = tab.id)}
      onkeydown={onKey}
      class="-mb-px border-b-2 px-2.5 py-2 text-xs font-medium transition-colors
             {active === tab.id
        ? 'border-slate-800 text-slate-900'
        : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'}"
    >
      {tab.label}
    </button>
  {/each}
</div>

{#if active === 'gates'}
  <!--
    Each swatch is the gate as it will actually be drawn, with the line that
    draws it underneath — so the gallery answers "what does that look like?"
    and "what do I type?" in the same glance.
  -->
  <div data-gate-gallery class="px-3 pt-1 pb-6">
    {#each GATE_GALLERY as group (group.heading)}
      <h3 class="mt-4 mb-1 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
        {group.heading}
      </h3>
      <ul class="grid grid-cols-2 gap-2">
        {#each group.items as item (item.code)}
          <li
            data-gate={item.drop ? item.code : undefined}
            onpointerdown={(e) => {
              if (!item.drop || e.button !== 0) return
              // Or the browser starts a text selection under the drag.
              e.preventDefault()
              onpick?.(item.drop, e)
            }}
            class="flex touch-none flex-col items-center gap-1 rounded border border-slate-200
                   bg-slate-50/60 px-2 py-2 text-center select-none
                   {item.drop ? 'cursor-grab active:cursor-grabbing hover:border-slate-400' : ''}"
          >
            <span class="flex h-14 items-center justify-center">
              <!-- Rendered by our own renderer; values are escaped in svg.ts. -->
              <!-- Not a drag target itself: the card takes the pointer. -->
              <span class="pointer-events-none">{@html drawn(item)}</span>
            </span>
            <span class="text-[11px] font-medium text-slate-700">{item.name}</span>
            <code class="text-[10px] break-all text-slate-500">{item.code}</code>
            {#if item.text}
              <span class="text-[10px] leading-snug text-slate-400">{item.text}</span>
            {/if}
          </li>
        {/each}
      </ul>
    {/each}
  </div>
{:else}
  <div data-syntax-rows class="px-3 pt-1 pb-6">
    {#each groups as group (group.heading)}
      <h3 class="mt-4 mb-1 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
        {group.heading}
      </h3>
      <dl class="divide-y divide-slate-100">
        {#each group.rows as row (row.code)}
          <div class="grid gap-0.5 py-1.5 text-xs">
            <dt class="font-mono whitespace-pre-wrap text-slate-800">{row.code}</dt>
            <dd class="text-slate-500">{row.text}</dd>
          </div>
        {/each}
      </dl>
    {/each}
  </div>
{/if}
