<script lang="ts">
  /**
   * Shots on their way down the circuit, as a purple glow running through the
   * pipes.
   *
   * Not the state — a shot has no one state to show until it is over — only
   * the sign that something is going through. The glow is a band across the
   * whole drawing, seen only through a mask cut to the pipes the drawing
   * shows, so it lights the plumbing and nothing else: not the gates, not the
   * paper between. Laid over the drawing in its own coordinates, so it moves
   * and zooms with it, and ignores the pointer so the drawing underneath can
   * still be picked up.
   */
  import type { CircuitGeometry } from '../../core/circuit/layout'

  const {
    pulses,
    geometry,
    svg,
  }: {
    /** Each pulse: how far down, 0 at the top of the pipes to 1 at the bottom, and how bright. */
    pulses: { at: number; fade: number }[]
    geometry: CircuitGeometry
    /** The drawing it lies over, for its viewBox. */
    svg: string
  } = $props()

  /** Purple, and set apart from the drawing's blues and the gates' chips: the glow of something passing through. */
  const GLOW = '#9b30ff'
  const CORE = '#ead6ff'

  const viewBox = $derived(/viewBox="([^"]+)"/.exec(svg)?.[1] ?? '0 0 100 100')
  const box = $derived(viewBox.split(/\s+/).map(Number))

  /** The wire spacing, which sizes the glow's length. */
  const pitch = $derived.by(() => {
    const c = geometry.columns
    return c.length > 1 ? Math.abs(c[1] - c[0]) : 48
  })

  /**
   * Each pipe as the line down its middle, stroked at the pipe's own width.
   * Round its bends as the pipe goes: at height `y` it turns through an elbow
   * of radius `r`, runs across, and turns back down through another — traced
   * as curves, since straight corners would light a square outside the elbow.
   */
  const runs = $derived(
    geometry.pipes.map((p) => {
      let x = p.cx
      let d = `M${x} ${p.y0}`
      for (const t of p.turns ?? []) {
        const s = Math.sign(t.x - x) || 1
        d += `L${x} ${t.y - t.r}Q${x} ${t.y} ${x + s * t.r} ${t.y}`
        d += `L${t.x - s * t.r} ${t.y}Q${t.x} ${t.y} ${t.x} ${t.y + t.r}`
        x = t.x
      }
      d += `L${x} ${p.y1}`
      return { d, w: p.w }
    }),
  )

  const lit = $derived(
    pulses.map((p) => {
      const y = geometry.pipeTop + p.at * (geometry.pipeBottom - geometry.pipeTop)
      // In over the first tenth and out over the last, so a pulse arrives and
      // leaves rather than switching on and off at the ends of the pipes.
      const ramp = Math.min(1, p.at / 0.1, (1 - p.at) / 0.1)
      return { y, opacity: Math.max(0, ramp) * p.fade }
    }),
  )

  /** Unique per instance, so two drawings on one page do not share a mask. */
  const id = `shot-${Math.random().toString(36).slice(2, 8)}`
</script>

<svg
  class="pointer-events-none absolute inset-0 h-full w-full"
  {viewBox}
  aria-hidden="true"
>
  <defs>
    <linearGradient id="{id}-glow" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color={GLOW} stop-opacity="0" />
      <stop offset="0.5" stop-color={GLOW} stop-opacity="0.95" />
      <stop offset="1" stop-color={GLOW} stop-opacity="0" />
    </linearGradient>
    <linearGradient id="{id}-core" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color={CORE} stop-opacity="0" />
      <stop offset="0.5" stop-color={CORE} stop-opacity="0.9" />
      <stop offset="1" stop-color={CORE} stop-opacity="0" />
    </linearGradient>
    <mask id="{id}-pipes" maskUnits="userSpaceOnUse" x={box[0]} y={box[1]} width={box[2]} height={box[3]}>
      {#each runs as r, i (i)}
        <path d={r.d} fill="none" stroke="white" stroke-width={r.w} stroke-linejoin="round" />
      {/each}
    </mask>
  </defs>

  <g mask="url(#{id}-pipes)">
    {#each lit as p, i (i)}
      <g opacity={p.opacity}>
        <rect x={box[0]} y={p.y - pitch * 0.9} width={box[2]} height={pitch * 1.8} fill="url(#{id}-glow)" />
        <rect x={box[0]} y={p.y - pitch * 0.35} width={box[2]} height={pitch * 0.7} fill="url(#{id}-core)" />
      </g>
    {/each}
  </g>
</svg>
