<script lang="ts">
  import { ICONS, type IconName } from './icons'

  const { name, class: klass = 'h-3.5 w-3.5' }: { name: IconName; class?: string } = $props()
</script>

<svg viewBox="0 0 20 20" class={klass} aria-hidden="true">
  <path
    d={ICONS[name]}
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
  />
</svg>
