<script lang="ts">
  /**
   * The source box.
   *
   * CodeMirror rather than a textarea, for what a textarea cannot do at all:
   * colour, and folding a frame or a definition away. Indenting a block and
   * commenting one out come with it.
   *
   * Undo is deliberately left out. The app keeps the history itself, because
   * the document also changes by dragging, by dials, by picking an example —
   * none of which an editor's own undo could see — so ⌘Z here falls through to
   * the window, where the app's history answers it.
   */
  import { onMount } from 'svelte'
  import { EditorState, Annotation } from '@codemirror/state'
  import {
    EditorView, keymap, drawSelection, highlightActiveLine,
    highlightActiveLineGutter, highlightSpecialChars, lineNumbers,
  } from '@codemirror/view'
  import { defaultKeymap, indentWithTab } from '@codemirror/commands'
  import {
    bracketMatching, codeFolding, foldGutter, foldKeymap, indentOnInput, indentUnit,
    syntaxHighlighting,
  } from '@codemirror/language'
  import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
  import { colourSwatches } from '../editor/colours'
  import { braceFolding, gateColourVars, mistyHighlighter, mistyLanguage } from '../editor/language'
  import { LIGHT_PALETTE, withAccent } from '../../core/render/theme'

  let {
    value = $bindable(''),
    accent = '',
    oninput,
  }: {
    value?: string
    accent?: string
    /** A change made in the box, as opposed to one written into `value`. */
    oninput?: () => void
  } = $props()

  let host: HTMLDivElement
  let view: EditorView | undefined

  /** Marks a write that came from `value`, so it is not echoed back as typing. */
  const external = Annotation.define<boolean>()

  /** The box's chrome is always light, so the gates are painted as on paper. */
  const vars = $derived(gateColourVars(withAccent(LIGHT_PALETTE, accent)))

  onMount(() => {
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          foldGutter({ openText: '▾', closedText: '▸' }),
          codeFolding({ placeholderText: '…' }),
          drawSelection(),
          highlightActiveLine(),
          indentUnit.of('  '),
          EditorState.tabSize.of(2),
          mistyLanguage,
          braceFolding,
          syntaxHighlighting(mistyHighlighter),
          colourSwatches(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          keymap.of([...closeBracketsKeymap, ...foldKeymap, indentWithTab, ...defaultKeymap]),
          EditorView.contentAttributes.of({ spellcheck: 'false', 'aria-label': 'Source' }),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged || u.transactions.some((tr) => tr.annotation(external))) return
            value = u.state.doc.toString()
            oninput?.()
          }),
        ],
      }),
    })
    return () => view?.destroy()
  })

  /**
   * Written from outside — a drag, an example, undo — the change goes in as
   * the smallest edit that makes the two agree, so the caret and any folds
   * away from it stay where they were.
   */
  $effect(() => {
    const next = value
    if (!view) return
    const was = view.state.doc.toString()
    if (next === was) return
    let a = 0
    while (a < next.length && a < was.length && next[a] === was[a]) a++
    let b = 0
    while (b < next.length - a && b < was.length - a && next[next.length - 1 - b] === was[was.length - 1 - b]) b++
    view.dispatch({
      changes: { from: a, to: was.length - b, insert: next.slice(a, next.length - b) },
      annotations: external.of(true),
    })
  })

  /** Put the caret at `offset`, if the box has the focus. */
  export function place(offset: number) {
    if (!view || !view.hasFocus) return
    const at = Math.min(offset, view.state.doc.length)
    view.dispatch({ selection: { anchor: at }, scrollIntoView: true })
  }
</script>

<!--
  The box is the whole of its drawer, edge to edge: the drawer is there only
  to hold it, so it needs no frame of its own and no handle to drag.
-->
<div
  bind:this={host}
  style={vars}
  class="source-editor min-h-0 w-full flex-1 overflow-hidden bg-white"
></div>

<style>
  .source-editor :global(.cm-editor) {
    height: 100%;
    font-size: 0.875rem;
    line-height: 1.625;
  }
  .source-editor :global(.cm-scroller) {
    overflow: auto;
  }
  .source-editor :global(.cm-editor.cm-focused) {
    outline: none;
  }
  .source-editor :global(.cm-scroller) {
    font-family: var(--font-mono);
  }
  .source-editor :global(.cm-content) {
    padding: 0.5rem 0;
  }
  .source-editor :global(.cm-line) {
    padding: 0 0.625rem 0 0.25rem;
  }
  .source-editor :global(.cm-gutters) {
    background: #f8fafc;
    border-right: 1px solid #e2e8f0;
    color: #94a3b8;
    font-size: 0.75rem;
  }
  .source-editor :global(.cm-foldGutter .cm-gutterElement) {
    padding: 0 0.25rem;
    cursor: pointer;
    color: #64748b;
  }
  .source-editor :global(.cm-activeLine) {
    background: rgb(241 245 249 / 0.6);
  }
  .source-editor :global(.cm-activeLineGutter) {
    background: #eef2f7;
    color: #475569;
  }
  .source-editor :global(.cm-foldPlaceholder) {
    background: #f1f5f9;
    border: 1px solid #cbd5e1;
    color: #64748b;
    padding: 0 0.25rem;
    margin: 0 0.125rem;
  }
  .source-editor :global(.cm-matchingBracket) {
    background: #e2e8f0;
    outline: 1px solid #cbd5e1;
  }

  /* The notation. Gates take the colour they are drawn in, and the weight that
     says they are what the line is for. */
  .source-editor :global(.ms-gate) {
    font-weight: 700;
  }
  .source-editor :global(.ms-gate-H) { color: var(--ms-gate-H); }
  .source-editor :global(.ms-gate-Z) { color: var(--ms-gate-Z); }
  .source-editor :global(.ms-gate-S) { color: var(--ms-gate-S); }
  .source-editor :global(.ms-gate-T) { color: var(--ms-gate-T); }
  .source-editor :global(.ms-gate-Y) { color: var(--ms-gate-Y); }
  .source-editor :global(.ms-gate-P) { color: var(--ms-gate-P); }
  .source-editor :global(.ms-gate-RX) { color: var(--ms-gate-RX); }
  .source-editor :global(.ms-gate-RY) { color: var(--ms-gate-RY); }
  .source-editor :global(.ms-gate-RZ) { color: var(--ms-gate-RZ); }
  .source-editor :global(.ms-gate-accent) { color: var(--ms-gate-accent); }
  .source-editor :global(.ms-gate-measure) { color: var(--ms-gate-measure); }
  .source-editor :global(.ms-gate-plain) { color: var(--ms-gate-plain); }

  .source-editor :global(.ms-keyword) { color: #334155; font-weight: 600; }
  .source-editor :global(.ms-modifier) { color: #475569; font-style: italic; }
  .source-editor :global(.ms-def) { color: #111111; font-weight: 700; text-decoration: underline; text-decoration-color: #cbd5e1; text-underline-offset: 3px; }
  .source-editor :global(.ms-def-use) { color: #111111; font-weight: 700; }
  .source-editor :global(.ms-string) { color: #a16207; }
  .source-editor :global(.ms-number) { color: #0f172a; }
  .source-editor :global(.ms-comment) { color: #94a3b8; font-style: italic; }
  .source-editor :global(.ms-caption) { color: #64748b; font-style: italic; }
  .source-editor :global(.ms-attr) { color: #64748b; }
  .source-editor :global(.ms-value) { color: #0e7490; }
  .source-editor :global(.ms-op) { color: #94a3b8; }

  /* A colour value, painted with itself. Clicked, it opens the picker. */
  .source-editor :global(.ms-colour) {
    border-radius: 3px;
    padding: 0 2px;
    cursor: pointer;
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.15);
  }
  .source-editor :global(.ms-colour),
  .source-editor :global(.ms-colour *) {
    color: var(--ms-colour-ink) !important;
  }

  /* The picker that opens under a colour. */
  .source-editor :global(.cm-tooltip:has(> .ms-picker)) {
    border: none;
    background: transparent;
  }
  .source-editor :global(.ms-picker) {
    width: 13rem;
    margin-top: 4px;
    padding: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    background: #fff;
    border: 1px solid #cbd5e1;
    border-radius: 0.375rem;
    box-shadow: 0 8px 24px rgb(15 23 42 / 0.16);
    font-family: var(--font-sans);
  }
  .source-editor :global(.ms-picker-sv) {
    position: relative;
    height: 8rem;
    border-radius: 0.25rem;
    background-image: linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent);
    cursor: crosshair;
    touch-action: none;
  }
  .source-editor :global(.ms-picker-hue) {
    position: relative;
    height: 0.75rem;
    border-radius: 999px;
    background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
    cursor: ew-resize;
    touch-action: none;
  }
  .source-editor :global(.ms-picker-knob) {
    position: absolute;
    width: 0.75rem;
    height: 0.75rem;
    border-radius: 999px;
    border: 2px solid #fff;
    box-shadow: 0 0 0 1px rgb(0 0 0 / 0.4);
    transform: translate(-50%, -50%);
    pointer-events: none;
  }
  .source-editor :global(.ms-picker-hue .ms-picker-knob) {
    top: 50%;
  }
  .source-editor :global(.ms-picker-tints) {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 0.25rem;
  }
  .source-editor :global(.ms-picker-tint) {
    aspect-ratio: 1;
    border-radius: 0.25rem;
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.15);
    cursor: pointer;
  }
  .source-editor :global(.ms-picker-tint:hover) {
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.15), 0 0 0 2px #94a3b8;
  }
  .source-editor :global(.ms-picker-row) {
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }
  .source-editor :global(.ms-picker-chip) {
    width: 1.5rem;
    height: 1.5rem;
    flex-shrink: 0;
    border-radius: 0.25rem;
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.15);
  }
  .source-editor :global(.ms-picker-hex) {
    min-width: 0;
    flex: 1;
    padding: 0.125rem 0.375rem;
    border: 1px solid #cbd5e1;
    border-radius: 0.25rem;
    font: 0.75rem var(--font-mono);
    color: #0f172a;
  }
  .source-editor :global(.ms-picker-hex:focus) {
    outline: none;
    border-color: #64748b;
  }
  .source-editor :global(.ms-bracket) { color: #64748b; }
</style>
