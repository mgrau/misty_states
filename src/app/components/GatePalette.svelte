<script lang="ts">
  /**
   * The gates, small, beside the source box.
   *
   * The same set the reference draws, with the words taken away — here they are
   * a tool rather than a description, and a tool wants to be within reach. The
   * reference lives in a drawer that takes width from the drawing, which is
   * exactly the width you want while placing a gate; this sits in the column
   * that is already there and costs nothing.
   *
   * Drawn by the real renderer in the theme in use, so what you pick up is what
   * you will get.
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
    onpick?: (gate: Droppable, event: PointerEvent) => void
  } = $props()

  /** Only what can actually be dropped; the rest is reading matter. */
  const gates = $derived(GATE_GALLERY.flatMap((group) => group.items.filter((i) => i.drop)))

  function drawn(item: Swatch): string {
    try {
      return render(item.source ?? `qubits 1\n${item.code}`, {
        theme,
        dark,
        check: false,
        // Its own id namespace, so these never lend their gradients to the
        // drawing beside them — nor borrow its.
        idPrefix: 'pal',
        metrics: { qubit: 17, pipeWidth: 20, colGap: 16, gateHeight: 34, fontSize: 15 },
      }).svg
    } catch {
      return ''
    }
  }
</script>

<div class="flex min-h-0 flex-1 flex-col gap-1">
  <span class="shrink-0 text-xs font-medium text-slate-500">Gates</span>
  <!--
    Takes the height it is given and scrolls inside it, rather than growing the
    column: the source box above has no ceiling any more, and whichever of the
    two is short should hand its room to the other.
  -->
  <div class="min-h-0 flex-1 overflow-y-auto">
    <ul class="flex flex-wrap gap-1">
      {#each gates as item (item.code)}
        <li
          data-palette-gate={item.code}
          title="{item.name} — {item.code}"
          onpointerdown={(e) => {
            if (!item.drop || e.button !== 0) return
            // Or the browser starts a text selection under the drag.
            e.preventDefault()
            onpick?.(item.drop, e)
          }}
          class="flex h-16 cursor-grab touch-none items-center justify-center overflow-hidden
                 rounded border border-slate-200 bg-white px-2 select-none
                 hover:border-slate-400 active:cursor-grabbing"
        >
          <!--
            Not a target itself: the tile takes the pointer. The drawing is held
            inside the tile, because a theme with depth to it — the isometric
            one — draws past the box the flat ones need, and a gate leaning out
            of its tile reads as a mistake rather than as perspective.
          -->
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
</div>
