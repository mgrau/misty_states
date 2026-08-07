<script lang="ts">
  /**
   * A split button: the labelled half runs the most common action, the caret
   * opens the rest. The default is simply the first item, so the menu stays the
   * single place that defines what the button can do.
   */
  import MenuItems from './MenuItems.svelte'
  import Icon from './Icon.svelte'
  import type { IconName } from './icons'
  import type { MenuItem } from './menu'

  const {
    label,
    icon,
    items,
    footer,
    width = 'w-64',
  }: {
    label: string
    icon: IconName
    items: MenuItem[]
    footer?: string
    width?: string
  } = $props()

  let open = $state(false)
  const primary = $derived(items[0])
</script>

<div class="relative flex">
  <button
    type="button"
    onclick={() => void primary?.run()}
    disabled={!primary}
    title={primary ? `${label}: ${primary.label}` : label}
    class="flex items-center gap-1.5 rounded-l border border-r-0 border-slate-300 bg-white
           px-2 py-1 text-slate-700 hover:bg-slate-50 disabled:opacity-40"
  >
    <Icon name={icon} />
    {label}
  </button>

  <button
    type="button"
    onclick={() => (open = !open)}
    aria-expanded={open}
    aria-label="{label}: more options"
    class="rounded-r border border-slate-300 bg-white px-1 py-1 text-slate-500
           hover:bg-slate-50 hover:text-slate-800"
  >
    <Icon name="chevron" />
  </button>

  {#if open}
    <!-- Click-away backdrop; sits under the menu. -->
    <button
      type="button"
      aria-label="Close menu"
      onclick={() => (open = false)}
      class="fixed inset-0 z-10 cursor-default"
    ></button>

    <div class="absolute top-full right-0 z-20 mt-1 {width}">
      <MenuItems
        {items}
        {footer}
        onpick={(item) => {
          open = false
          void item.run()
        }}
      />
    </div>
  {/if}
</div>
