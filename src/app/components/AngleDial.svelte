<script lang="ts">
  import { untrack } from 'svelte'
  import { piLabel } from '../angle'

  /**
   * The angle of a rotation, as something to turn rather than something to type.
   *
   * An angle is the one thing about a rotation its drawing cannot show — the
   * gate looks the same at 30° as at 300° — and it is the one edit dragging
   * cannot make. A list of preset angles covered the common cases and made the
   * rest feel unavailable; a dial makes the whole circle equally reachable and,
   * more to the point, makes the *shape* of the angle visible while you choose
   * it.
   *
   * Marked in π, because that is how the mathematics is written. Nobody says a
   * rotation of two hundred and seventy degrees; they say 3π/2. Degrees are what
   * the source holds, so both are shown, but the ring is labelled the way the
   * subject is spoken.
   *
   * The quarter turns are marked heavily and everything else lightly. That is
   * not decoration: at a multiple of 90° every amplitude stays a whole number
   * and the state is one the notation can draw, and anywhere else there are
   * cosines in the arithmetic and it is not. The dial should say which side of
   * that line you are on before you let go, not after.
   */
  const {
    angle,
    at,
    onpreview,
    oncommit,
    onclose,
  }: {
    /** The angle it has now, in degrees. */
    angle: number
    /** Where on screen the gate was tapped. */
    at: { x: number; y: number }
    /** Turning, but not finished: draw this without writing it. */
    onpreview: (angle: number) => void
    /** Let go: write it. */
    oncommit: (angle: number) => void
    onclose: () => void
  } = $props()

  const SIZE = 188
  const R = 66
  const MID = SIZE / 2

  /** Eight labelled marks: the quarter turns, and the eighths between them. */
  const MARKS = [
    { deg: 0, label: '0' },
    { deg: 45, label: 'π/4' },
    { deg: 90, label: 'π/2' },
    { deg: 135, label: '3π/4' },
    { deg: 180, label: 'π' },
    { deg: 225, label: '5π/4' },
    { deg: 270, label: '3π/2' },
    { deg: 315, label: '7π/4' },
  ]

  /** Into 0–360, since the source is free to hold −90 and a dial is not. */
  const wrap = (d: number) => ((d % 360) + 360) % 360

  // Read once, on purpose: the dial opens at the angle the gate has and then
  // owns it. Following the prop afterwards would fight the hand mid-turn, since
  // what the source says is a moment behind what is being dragged.
  let turning = $state(untrack(() => wrap(angle)))
  let dragging = $state(false)

  /**
   * Zero at the top and clockwise, which is how a turn is drawn and how the
   * ring below is laid out. Screen y grows downward, so the usual `atan2`
   * arrangement comes out clockwise without being negated.
   */
  const pointAt = (deg: number, r: number) => {
    const t = ((deg - 90) * Math.PI) / 180
    return { x: MID + r * Math.cos(t), y: MID + r * Math.sin(t) }
  }

  /**
   * What the pointer is asking for.
   *
   * Rounded to a degree, then pulled onto a quarter turn when it is within a
   * few of one. The exact angles are the ones worth hitting and the hardest to
   * land on by hand; everything else is free.
   */
  const SNAP = 5
  function angleFrom(event: PointerEvent, el: SVGSVGElement): number {
    const box = el.getBoundingClientRect()
    const dx = event.clientX - (box.left + box.width / 2)
    const dy = event.clientY - (box.top + box.height / 2)
    const deg = wrap(Math.round((Math.atan2(dy, dx) * 180) / Math.PI) + 90)
    const quarter = Math.round(deg / 90) * 90
    return Math.abs(deg - quarter) <= SNAP ? wrap(quarter) : deg
  }

  let ring = $state<SVGSVGElement | undefined>()

  function grab(event: PointerEvent) {
    if (!ring || event.button !== 0) return
    event.preventDefault()
    dragging = true
    turning = angleFrom(event, ring)
    onpreview(turning)
    const move = (e: PointerEvent) => {
      if (!ring) return
      turning = angleFrom(e, ring)
      onpreview(turning)
    }
    const stop = () => {
      dragging = false
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      // Committed on release rather than on every degree, so the source takes
      // one edit for the turn instead of the two hundred that drew it.
      oncommit(turning)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  /**
   * Escape closes it wherever the focus is.
   *
   * On the window rather than on the panel, because opening the dial does not
   * take focus off whatever had it — usually the source box — and a dismissal
   * that only works when you happen to have clicked the right thing first is
   * not a dismissal.
   */
  $effect(() => {
    const shut = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onclose()
    }
    window.addEventListener('keydown', shut)
    return () => window.removeEventListener('keydown', shut)
  })

  /** Arrow keys nudge; holding shift takes it a quarter turn at a time. */
  function onKey(event: KeyboardEvent) {
    const step = event.shiftKey ? 90 : 1
    const by = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? step
      : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -step
      : 0
    if (!by) return
    event.preventDefault()
    turning = wrap(event.shiftKey ? Math.round((turning + by) / 90) * 90 : turning + by)
    oncommit(turning)
  }

  const set = (deg: number) => {
    turning = wrap(deg)
    oncommit(turning)
  }

  const inPi = $derived(piLabel(turning))

  const exact = $derived(turning % 90 === 0)
  const hand = $derived(pointAt(turning, R - 8))

  // Kept clear of the edges, since a gate near the bottom of the pane would
  // otherwise open the dial off the screen.
  const left = $derived(Math.min(Math.max(8, at.x - SIZE / 2), window.innerWidth - SIZE - 8))
  const top = $derived(Math.min(Math.max(8, at.y + 18), window.innerHeight - SIZE - 74))
</script>

<!-- Anything outside closes it, the way the menus behave. -->
<div
  class="fixed inset-0 z-40"
  role="presentation"
  onpointerdown={onclose}
  oncontextmenu={(e) => {
    e.preventDefault()
    onclose()
  }}
></div>

<div
  class="fixed z-50 rounded-lg border border-slate-300 bg-white p-2 shadow-xl select-none"
  style="left: {left}px; top: {top}px; width: {SIZE + 16}px;"
  role="dialog"
  aria-label="Rotation angle"
  tabindex="-1"
  onpointerdown={(e) => e.stopPropagation()}
  onkeydown={onKey}
>
  <svg
    bind:this={ring}
    width={SIZE}
    height={SIZE}
    viewBox="0 0 {SIZE} {SIZE}"
    class="cursor-pointer touch-none"
    onpointerdown={grab}
    role="slider"
    aria-label="Angle in degrees"
    aria-valuemin="0"
    aria-valuemax="360"
    aria-valuenow={turning}
    tabindex="0"
  >
    <circle cx={MID} cy={MID} r={R} fill="#f8fafc" stroke="#cbd5e1" stroke-width="1" />

    <!-- The turn so far, drawn as the arc it is. -->
    {#if turning > 0}
      <path
        d="M {MID} {MID} L {pointAt(0, R).x} {pointAt(0, R).y}
           A {R} {R} 0 {turning > 180 ? 1 : 0} 1 {pointAt(turning, R).x} {pointAt(turning, R).y} Z"
        fill={exact ? '#dbeafe' : '#fef3c7'}
        stroke="none"
      />
    {/if}

    {#each MARKS as mark (mark.deg)}
      {@const quarter = mark.deg % 90 === 0}
      {@const a = pointAt(mark.deg, quarter ? R - 11 : R - 7)}
      {@const b = pointAt(mark.deg, R)}
      {@const t = pointAt(mark.deg, R + 15)}
      <line
        x1={a.x} y1={a.y} x2={b.x} y2={b.y}
        stroke={quarter ? '#475569' : '#cbd5e1'}
        stroke-width={quarter ? 2 : 1}
      />
      <!-- Clickable labels: the eight named angles are most of what anyone wants. -->
      <text
        x={t.x} y={t.y}
        text-anchor="middle"
        dominant-baseline="middle"
        font-size="11"
        fill={quarter ? '#334155' : '#94a3b8'}
        role="button"
        aria-label="{mark.deg} degrees"
        tabindex="-1"
        class="cursor-pointer"
        onpointerdown={(e) => {
          e.stopPropagation()
          set(mark.deg)
        }}
      >{mark.label}</text>
    {/each}

    <line
      x1={MID} y1={MID} x2={hand.x} y2={hand.y}
      stroke={exact ? '#1d4ed8' : '#b45309'}
      stroke-width="2.5"
      stroke-linecap="round"
    />
    <circle cx={MID} cy={MID} r="3" fill={exact ? '#1d4ed8' : '#b45309'} />
    <circle
      cx={pointAt(turning, R).x} cy={pointAt(turning, R).y} r={dragging ? 7 : 5.5}
      fill="#ffffff" stroke={exact ? '#1d4ed8' : '#b45309'} stroke-width="2.5"
    />
  </svg>

  <div class="px-1 pb-0.5 text-center">
    <div class="font-mono text-sm text-slate-700">{turning}° <span class="text-slate-400">=</span> {inPi}</div>
    <!--
      Said plainly, because it decides whether the figure downstream can be
      drawn at all — not a matter of taste about the angle.
    -->
    <div class="text-[11px] leading-tight {exact ? 'text-slate-500' : 'text-amber-700'}">
      {exact
        ? 'a right angle, so every amplitude stays whole'
        : 'leaves cosines, which a state cannot be drawn with'}
    </div>
  </div>
</div>
