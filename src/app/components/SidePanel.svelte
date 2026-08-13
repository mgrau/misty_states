<script lang="ts">
  /**
   * The drawer on the right, and the shell every drawer shares.
   *
   * There is only ever one open. Settings and the syntax reference are both
   * things you consult beside the drawing rather than parts of it, and putting
   * them in the same place — one at a time — means the drawing never has to
   * share the page with two panels at once.
   *
   * It sits *in* the layout rather than over it, so opening one narrows the
   * drawing instead of covering it: the whole reason to have the reference open
   * is to read it while looking at what you are writing. That is also why there
   * is no click-away backdrop — nothing is behind it to click away from.
   */
  import { slide } from 'svelte/transition'
  import type { Snippet } from 'svelte'

  const {
    title,
    children,
    onclose,
  }: {
    title: string
    children: Snippet
    onclose: () => void
  } = $props()
</script>

<!--
  Sliding is intro-only. Coming in, it explains where the panel came from;
  going out, waiting for it would just be a delay between asking for the space
  back and getting it.
-->
<aside
  in:slide={{ axis: 'x', duration: 160 }}
  class="flex h-full w-full shrink-0 flex-col border-l border-slate-200 bg-white sm:w-80"
  aria-label={title}
>
  <header class="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3">
    <h2 class="text-sm font-semibold text-slate-800">{title}</h2>
    <button
      type="button"
      onclick={onclose}
      aria-label="Close {title.toLowerCase()}"
      class="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
    >
      <svg viewBox="0 0 20 20" class="h-4 w-4" aria-hidden="true">
        <path
          d="M5 5l10 10M15 5L5 15"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
        />
      </svg>
    </button>
  </header>

  <!--
    The body scrolls, not the panel: the heading stays put, so a long reference
    never leaves you wondering what you are looking at.
  -->
  <div class="min-h-0 flex-1 overflow-y-auto">
    {@render children()}
  </div>
</aside>
