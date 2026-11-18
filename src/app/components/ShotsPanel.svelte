<script lang="ts">
  /**
   * The tally of shots taken so far, beside what it should come to.
   *
   * One row per record a shot can come out with: the record drawn as the
   * measured wires' shapes, a bar for how often it has come out, and a tick
   * where the Born rule says that bar is heading. Watching the bars settle
   * onto their ticks as the shots go in is the point of the panel.
   *
   * Beside the shapes, the record written out in bits and read as a number,
   * the first wire the most significant — so a search that should land on 13
   * can be seen to.
   *
   * Horizontal, so a record's shapes sit on its own row however many wires it
   * has and the narrow drawer still has room for the bars.
   */
  import { shapePath, type ShapeName } from '../../core/shapes'
  import type { ShotOutcome } from '../../core/circuit/shots'
  import Icon from './Icon.svelte'

  const {
    shapes,
    odds,
    tally,
    total,
    last,
    running,
    runSize,
    blocked,
    onshot,
    onrun,
    onreset,
  }: {
    /** The shape of each wire a shot reads, in the order its record is written. */
    shapes: ShapeName[]
    odds: ShotOutcome[]
    tally: Record<string, number>
    total: number
    /** The record the latest shot came out with. */
    last: string | null
    running: boolean
    runSize: number
    /** Why no shot can be taken, or null when one can. */
    blocked: string | null
    onshot: () => void
    onrun: () => void
    onreset: () => void
  } = $props()

  /** Past this many rows the panel lists the likeliest and says how many it left out. */
  const MAX_ROWS = 32

  const rows = $derived.by(() => {
    const expected = new Map(odds.map((o) => [o.record, o.probability]))
    const records = new Set([...expected.keys(), ...Object.keys(tally)])
    const all = [...records].map((record) => ({
      record,
      expected: expected.get(record) ?? 0,
      count: tally[record] ?? 0,
    }))
    all.sort((a, b) => (a.record < b.record ? -1 : 1))
    if (all.length <= MAX_ROWS) return { shown: all, hidden: 0 }
    const kept = new Set(
      [...all].sort((a, b) => b.expected + b.count / Math.max(1, total) - (a.expected + a.count / Math.max(1, total)))
        .slice(0, MAX_ROWS)
        .map((r) => r.record),
    )
    return { shown: all.filter((r) => kept.has(r.record)), hidden: all.length - MAX_ROWS }
  })

  /** The scale the bars are drawn on: the larger of the likeliest record and the commonest so far. */
  const top = $derived(
    Math.max(
      1e-9,
      ...rows.shown.map((r) => Math.max(r.expected, total ? r.count / total : 0)),
    ),
  )

  const pct = (p: number) => (p === 0 ? '0%' : p < 0.001 ? '<0.1%' : `${(p * 100).toFixed(p < 0.1 ? 1 : 0)}%`)

  /** The record read as a binary number, wire 1 the most significant bit. */
  const decimal = (record: string) => (record ? parseInt(record, 2) : 0)
  /** Room for the widest number a record of this many wires can be, so the column lines up. */
  const digits = $derived(String(2 ** shapes.length - 1).length)

  /** One wire's outcome drawn as its shape, white or black, as the drawing draws a qubit. */
  const SIZE = 13
  const GAP = 3
</script>

<div class="flex flex-col gap-4 p-4 text-sm">
  <div class="flex flex-wrap items-center gap-2">
    <button
      type="button"
      onclick={onshot}
      disabled={!!blocked || running}
      title={blocked ?? 'Run the circuit once: each measurement shows what it read'}
      class="flex items-center gap-1.5 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700
             enabled:hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Icon name="shot" />
      One shot
    </button>
    <button
      type="button"
      onclick={onrun}
      disabled={!!blocked}
      aria-pressed={running}
      title={blocked ?? (running ? 'Stop the run' : `Take ${runSize} shots, one after another`)}
      class="flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs transition-colors
             disabled:cursor-not-allowed disabled:opacity-40
             {running
        ? 'border-slate-800 bg-slate-800 text-white hover:bg-slate-700'
        : 'border-slate-300 bg-white text-slate-700 enabled:hover:bg-slate-50'}"
    >
      <Icon name={running ? 'stop' : 'shots'} />
      {running ? 'Stop' : `${runSize} shots`}
    </button>
    <button
      type="button"
      onclick={onreset}
      disabled={!total || running}
      class="ml-auto rounded px-2 py-1 text-xs text-slate-500 enabled:hover:bg-slate-100 enabled:hover:text-slate-800
             disabled:cursor-not-allowed disabled:opacity-40"
    >
      Reset
    </button>
  </div>

  {#if blocked}
    <p class="text-slate-500">{blocked}</p>
  {:else}
    <div class="flex items-baseline justify-between text-xs text-slate-500">
      <span><span class="text-base font-semibold text-slate-800 tabular-nums">{total}</span> shot{total === 1 ? '' : 's'}</span>
      <span class="flex items-center gap-3">
        <span class="flex items-center gap-1"><span class="inline-block h-2 w-3 rounded-sm bg-blue-700"></span>so far</span>
        <span class="flex items-center gap-1"><span class="inline-block h-3 w-0.5 bg-slate-900"></span>expected</span>
      </span>
    </div>

    <ul class="flex flex-col gap-1.5" aria-label="Shot tally">
      {#each rows.shown as row (row.record)}
        {@const seen = total ? row.count / total : 0}
        {@const width = shapes.length * (SIZE + GAP) - GAP + 4}
        <li
          class="group grid grid-cols-[auto_auto_minmax(0,1fr)_3.5rem] items-center gap-2 rounded px-1 py-0.5
                 {last === row.record ? 'bg-amber-50' : 'hover:bg-slate-50'}"
          title="{row.record} = {decimal(row.record)} · {row.count} of {total} · {pct(seen)} so far · {pct(row.expected)} expected"
        >
          <svg
            width={width}
            height={SIZE + 4}
            viewBox="-2 -2 {width} {SIZE + 4}"
            aria-label="{row.record} ({decimal(row.record)})"
            role="img"
          >
            {#each [...row.record] as bit, i (i)}
              <path
                d={shapePath(shapes[i] ?? 'circle', SIZE)}
                transform="translate({i * (SIZE + GAP) + SIZE / 2} {SIZE / 2})"
                fill={bit === '1' ? '#1e293b' : '#ffffff'}
                stroke="#1e293b"
                stroke-width="1.2"
                stroke-linejoin="round"
              />
            {/each}
          </svg>

          <span class="flex items-baseline gap-1.5 font-mono text-xs tabular-nums" aria-hidden="true">
            <span class="text-slate-500">{row.record}</span>
            <span class="text-right text-slate-800" style="min-width: {digits}ch">{decimal(row.record)}</span>
          </span>

          <div class="relative h-4">
            <div class="absolute inset-y-0 left-0 w-full rounded-sm bg-slate-100"></div>
            <div
              class="absolute inset-y-0 left-0 rounded-r bg-blue-700 transition-[width] duration-150"
              style="width: {(seen / top) * 100}%"
            ></div>
            {#if row.expected > 0}
              <div
                class="absolute -inset-y-0.5 w-0.5 -translate-x-1/2 bg-slate-900"
                style="left: {(row.expected / top) * 100}%"
              ></div>
            {/if}
          </div>

          <span class="text-right text-xs tabular-nums text-slate-700">
            {row.count}
            <span class="text-slate-400">{pct(row.expected)}</span>
          </span>
        </li>
      {/each}
    </ul>
    {#if rows.hidden}
      <p class="text-xs text-slate-500">{rows.hidden} less likely outcomes not shown.</p>
    {/if}
  {/if}
</div>
