<script lang="ts">
  /**
   * One qubit's state as a point on a sphere.
   *
   * Drawn by hand rather than with a 3D library: it is one circle, two ellipses
   * and an arrow, and an orthographic projection of those is a few lines of
   * arithmetic. The far half of every line is dashed, which is the whole of
   * what makes a flat drawing read as a ball.
   *
   * The arrow is wherever `at` says — a number of layers, fractional part-way
   * through a gate — and the faint trail behind it is the way it came, which is
   * what makes a turn about a tilted axis look like one. Drag to look at it from
   * another side.
   */
  import { blochAt, tintColour as tintOf, type BlochPath, type Vec3 } from '../../core/bloch'
  import { render } from '../../core/index'
  import { LIGHT_PALETTE, type ThemeId } from '../../core/render/theme'
  import type { ShapeName } from '../../core/shapes'

  const {
    path,
    at,
    theme,
    shapeOrder,
  }: { path: BlochPath; at: number; theme: ThemeId; shapeOrder: ShapeName[] } = $props()

  /** Where it is looked at from, in radians: round the vertical axis, and up from the equator. */
  let azimuth = $state((35 * Math.PI) / 180)
  let elevation = $state((18 * Math.PI) / 180)

  const R = 100
  const SIZE = 280
  const C = SIZE / 2

  const view = $derived.by(() => {
    const [ca, sa, ce, se] = [Math.cos(azimuth), Math.sin(azimuth), Math.cos(elevation), Math.sin(elevation)]
    const right: Vec3 = [-sa, ca, 0]
    const up: Vec3 = [-se * ca, -se * sa, ce]
    const toward: Vec3 = [ce * ca, ce * sa, se]
    const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    return (p: Vec3) => ({ x: C + R * dot(p, right), y: C - R * dot(p, up), front: dot(p, toward) >= -1e-9 })
  })

  /** A curve on the sphere as two paths: the near half solid, the far half dashed. */
  function halves(points: Vec3[]): { near: string; far: string } {
    let near = ''
    let far = ''
    let was: boolean | null = null
    for (const p of points) {
      const s = view(p)
      const move = s.front !== was
      const seg = `${move ? 'M' : 'L'}${s.x.toFixed(1)},${s.y.toFixed(1)}`
      if (s.front) near += seg
      else far += seg
      // Carry the join across, so the two halves meet rather than leave a gap.
      if (move && was !== null) {
        if (s.front) far += `L${s.x.toFixed(1)},${s.y.toFixed(1)}`
        else near += `L${s.x.toFixed(1)},${s.y.toFixed(1)}`
      }
      was = s.front
    }
    return { near, far }
  }

  const ring = (f: (a: number) => Vec3) =>
    halves(Array.from({ length: 97 }, (_, i) => f((i / 96) * 2 * Math.PI)))

  const equator = $derived(ring((a) => [Math.cos(a), Math.sin(a), 0]))
  const meridian = $derived(ring((a) => [Math.sin(a), 0, Math.cos(a)]))
  const axes = $derived(
    ([[1, 0, 0], [0, 1, 0], [0, 0, 1]] as Vec3[]).map((e) =>
      halves(Array.from({ length: 21 }, (_, i) => e.map((x) => x * (i / 10 - 1)) as Vec3)),
    ),
  )

  /**
   * The four even superpositions round the equator, drawn as the states they
   * are — clouds, in the drawing's own style — rather than spelled out. Light,
   * like the drawer they sit in.
   */
  const EQUATOR: { p: Vec3; source: string }[] = [
    { p: [1.3, 0, 0], source: '0|1' },
    { p: [-1.3, 0, 0], source: '0|-1' },
    { p: [0, 1.32, 0], source: '0|i*1' },
    { p: [0, -1.32, 0], source: '0|-i*1' },
  ]
  /** How wide one is drawn, in the sphere's units; tall in proportion. */
  const GLYPH_W = 46
  const glyphs = $derived(
    EQUATOR.flatMap(({ p, source }) => {
      try {
        const r = render(source, { theme, shapeOrder, dark: false, background: false })
        const href = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(r.svg)}`
        return [{ p, source, href, w: GLYPH_W, h: (GLYPH_W * r.height) / r.width }]
      } catch {
        return []
      }
    }),
  )

  /** A gate's colour, as its chip is drawn: the sphere sits on light paper whatever the theme. */
  const tintColour = (key: string | null): string => tintOf(key, LIGHT_PALETTE)

  const point = $derived(blochAt(path, at))
  const tip = $derived(view(point))
  const foot = $derived(view([point[0], point[1], 0]))
  const origin = $derived(view([0, 0, 0]))
  const top = $derived(view([0, 0, 1.18]))
  const bottom = $derived(view([0, 0, -1.18]))

  /**
   * The way it came, a piece per gate in that gate's colour, sampled finely
   * enough that a turn reads as a curve.
   */
  const trail = $derived.by(() => {
    const pieces: { d: string; colour: string }[] = []
    for (let k = 0; k < path.moves.length && k < at; k++) {
      if (path.moves[k].kind === 'still') continue
      const end = Math.min(at, k + 1)
      const n = Math.max(2, Math.ceil((end - k) * 40))
      const d = Array.from({ length: n + 1 }, (_, i) => {
        const s = view(blochAt(path, k + ((end - k) * i) / n))
        return `${i ? 'L' : 'M'}${s.x.toFixed(1)},${s.y.toFixed(1)}`
      }).join('')
      pieces.push({ d, colour: tintColour(path.tints[k]) })
    }
    return pieces
  })

  /** The tip takes the colour of the gate that last moved it. */
  const tipColour = $derived.by(() => {
    for (let k = Math.min(Math.ceil(at), path.moves.length) - 1; k >= 0; k--) {
      if (path.moves[k].kind !== 'still') return tintColour(path.tints[k])
    }
    return '#ffffff'
  })

  const length = $derived(Math.hypot(...point))
  const white = $derived((1 + point[2]) / 2)
  // One place, since a chance worked out from an angle often lands on a half
  // (62.5%) that the drawing's whole percentages round one way and float noise
  // could round the other.
  const pct = (x: number) => `${(Math.max(0, Math.min(1, x)) * 100).toFixed(1).replace(/\.0$/, '')}%`
  const deg = (x: number) => `${Math.round((x * 180) / Math.PI)}°`
  const polar = $derived(length > 1e-6 ? Math.acos(Math.max(-1, Math.min(1, point[2] / length))) : 0)
  const turn = $derived(Math.hypot(point[0], point[1]) > 1e-6 ? Math.atan2(point[1], point[0]) : 0)

  let dragging: { x: number; y: number; az: number; el: number } | null = null
  function down(e: PointerEvent) {
    dragging = { x: e.clientX, y: e.clientY, az: azimuth, el: elevation }
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }
  function move(e: PointerEvent) {
    if (!dragging) return
    azimuth = dragging.az - (e.clientX - dragging.x) * 0.01
    elevation = Math.max(-1.4, Math.min(1.4, dragging.el + (e.clientY - dragging.y) * 0.01))
  }
</script>

<div class="flex flex-col items-center gap-3 p-4">
  <svg
    viewBox="0 0 {SIZE} {SIZE}"
    class="w-full max-w-[18rem] cursor-grab touch-none select-none active:cursor-grabbing"
    role="img"
    aria-label="Bloch sphere"
    onpointerdown={down}
    onpointermove={move}
    onpointerup={() => (dragging = null)}
    onpointercancel={() => (dragging = null)}
    ondblclick={() => {
      azimuth = (35 * Math.PI) / 180
      elevation = (18 * Math.PI) / 180
    }}
  >
    <circle cx={C} cy={C} r={R} fill="#f8fafc" stroke="#94a3b8" stroke-width="1.2" />

    {#each [equator, meridian] as curve, i (i)}
      <path d={curve.far} fill="none" stroke="#cbd5e1" stroke-width="1" stroke-dasharray="3 3" />
      <path d={curve.near} fill="none" stroke="#94a3b8" stroke-width="1" />
    {/each}
    {#each axes as axis, i (i)}
      <path d={axis.far} fill="none" stroke="#cbd5e1" stroke-width="1" stroke-dasharray="2 3" />
      <path d={axis.near} fill="none" stroke="#94a3b8" stroke-width="1" />
    {/each}

    {#each glyphs as glyph (glyph.source)}
      {@const s = view(glyph.p)}
      <image
        href={glyph.href}
        x={s.x - glyph.w / 2}
        y={s.y - glyph.h / 2}
        width={glyph.w}
        height={glyph.h}
        opacity={s.front ? 1 : 0.45}
      >
        <title>{glyph.source}</title>
      </image>
    {/each}
    <!-- The poles in the course's own colours: white on top, black below. -->
    <circle cx={top.x} cy={top.y} r="7" fill="white" stroke="#0f172a" stroke-width="1.5" />
    <circle cx={bottom.x} cy={bottom.y} r="7" fill="#0f172a" stroke="#0f172a" stroke-width="1.5" />

    {#each trail as piece, i (i)}
      <path d={piece.d} fill="none" stroke={piece.colour} stroke-width="2.2" stroke-linecap="round" opacity="0.85" />
    {/each}

    <!-- A drop to the equator, so where the arrow points in depth can be read. -->
    <line x1={tip.x} y1={tip.y} x2={foot.x} y2={foot.y} stroke="#64748b" stroke-width="1" stroke-dasharray="2 2" />
    <line x1={origin.x} y1={origin.y} x2={foot.x} y2={foot.y} stroke="#64748b" stroke-width="1" stroke-dasharray="2 2" />

    <line x1={origin.x} y1={origin.y} x2={tip.x} y2={tip.y} stroke="#0f172a" stroke-width="2.5" stroke-linecap="round" />
    <circle cx={tip.x} cy={tip.y} r="5" fill={tipColour} stroke="#0f172a" stroke-width="1.5" opacity={tip.front ? 1 : 0.6} />
  </svg>

  <dl class="grid w-full grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-slate-600">
    <dt class="text-slate-500">White</dt>
    <dd class="tabular-nums">{pct(white)}</dd>
    <dt class="text-slate-500">Black</dt>
    <dd class="tabular-nums">{pct(1 - white)}</dd>
    <dt class="text-slate-500">θ, φ</dt>
    <dd class="tabular-nums">{deg(polar)}, {deg(turn)}</dd>
  </dl>
  <p class="text-[11px] leading-snug text-slate-400">Drag to turn it; double-click to put it back.</p>
</div>
