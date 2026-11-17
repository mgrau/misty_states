<script lang="ts">
  /**
   * The definitions this source writes, as gates to pick up.
   *
   * A `def` is a gate the author has made, so it belongs within reach the same
   * way the built-in ones are — only it comes and goes with the text, and so
   * this row is there only while there is something in it.
   *
   * Each is drawn folded, as one box across the wires it takes — a name to
   * recognise, not the whole of it. One that cannot fold (it measures, or
   * moves a wire) is drawn open instead.
   */
  import { render } from '../../core/index'
  import type { ThemeId } from '../../core/render/theme'
  import { useDroppable, type Droppable } from '../../core/circuit/edit'
  import type { DefinitionEntry } from '../../core/circuit/parse'

  const {
    definitions,
    theme = 'solid',
    dark = false,
    accent = '',
    onpick,
  }: {
    definitions: DefinitionEntry[]
    theme?: ThemeId
    dark?: boolean
    accent?: string
    onpick?: (gate: Droppable, event: PointerEvent) => void
  } = $props()

  function drawn(item: DefinitionEntry): string {
    for (const use of [`${item.name} collapsed`, item.name]) {
      try {
        return render(`${item.defs}\n${use}`, {
          theme,
          dark,
          accent,
          check: false,
          idPrefix: 'defpal',
          metrics: { qubit: 17, pipeWidth: 20, colGap: 16, gateHeight: 34, fontSize: 15 },
        }).svg
      } catch {
        // Try it open.
      }
    }
    return ''
  }

  /**
   * Dropped folded, as drawn here; a click on it opens it. One that cannot
   * fold (it measures, or moves a wire) is dropped open instead.
   */
  function droppable(item: DefinitionEntry): Droppable {
    let collapsed = true
    try {
      render(`${item.defs}\n${item.name} collapsed`, { check: false })
    } catch {
      collapsed = false
    }
    return useDroppable({
      line: 0,
      name: item.name,
      wires: Array.from({ length: item.wires }, (_, i) => i + 1),
      collapsed,
    })
  }
</script>

<div class="flex shrink-0 flex-col gap-1">
  <span class="text-xs font-medium text-slate-500">Definitions</span>
  <ul class="flex max-h-40 flex-wrap gap-1 overflow-y-auto">
    {#each definitions as item (item.name)}
      <li
        data-palette-def={item.name}
        title="{item.name} — {item.wires} wire{item.wires === 1 ? '' : 's'}"
        onpointerdown={(e) => {
          if (e.button !== 0) return
          e.preventDefault()
          onpick?.(droppable(item), e)
        }}
        class="flex h-16 cursor-grab touch-none items-center justify-center overflow-hidden
               rounded border border-slate-200 bg-white px-2 select-none
               hover:border-slate-400 active:cursor-grabbing"
      >
        <span
          class="pointer-events-none flex h-full w-full items-center justify-center
                 [&>svg]:max-h-full [&>svg]:w-auto"
        >
          {@html drawn(item)}
        </span>
      </li>
    {/each}
  </ul>
</div>
