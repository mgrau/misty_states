<script lang="ts">
  import type { MenuItem } from './menu'

  const {
    items,
    onpick,
    footer,
  }: {
    items: MenuItem[]
    onpick: (item: MenuItem) => void
    footer?: string
  } = $props()
</script>

<div class="overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg">
  {#each items as item (item.key)}
    <button
      type="button"
      onclick={() => onpick(item)}
      class="block w-full border-b border-slate-100 px-3 py-2 text-left last:border-b-0
             hover:bg-slate-50"
    >
      <span class="block text-xs font-medium text-slate-800">{item.label}</span>
      {#if item.hint}
        <span class="block text-[11px] text-slate-500">{item.hint}</span>
      {/if}
    </button>
  {/each}
  {#if footer}
    <p class="bg-slate-50 px-3 py-1.5 text-[11px] text-slate-500">{footer}</p>
  {/if}
</div>
