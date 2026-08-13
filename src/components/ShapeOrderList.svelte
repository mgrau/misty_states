<script lang="ts">
  /**
   * The qubit shape sequence, reorderable by dragging.
   *
   * Position is the whole meaning here — qubit N is drawn with the Nth shape —
   * so a list you rearrange says it better than eight dropdowns.
   *
   * Live reordering, as in the course scheduler's settings: pressing a grip
   * picks the row up, and moving the pointer splices it through the list so the
   * rows visibly shuffle under the cursor. `animate:flip` slides them into
   * place rather than snapping.
   *
   * Row bands are measured once at pick-up. That matters: hit-testing against
   * live positions would read the rows *mid-animation*, and the FLIP transition
   * would feed back into the very measurement driving it.
   */
  import { flip } from 'svelte/animate'
  import { shapePath, type ShapeName } from '../core/shapes'

  const {
    order,
    onchange,
  }: { order: ShapeName[]; onchange: (next: ShapeName[]) => void } = $props()

  const flipMs =
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 0
      : 160

  let list = $state<HTMLElement | undefined>()
  let dragIndex = $state(-1)
  /** Row bottoms relative to the list, frozen at pick-up. */
  let bands: number[] = []
  let listTop = 0

  function reorder(from: number, to: number) {
    if (from === to || to < 0 || to >= order.length) return
    const next = [...order]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    onchange(next)
  }

  function startDrag(event: PointerEvent, i: number) {
    if (!list) return
    event.preventDefault()
    const box = list.getBoundingClientRect()
    listTop = box.top
    bands = [...list.children].map((el) => el.getBoundingClientRect().bottom - box.top)
    dragIndex = i
    document.body.classList.add('dragging')
  }

  function onPointerMove(event: PointerEvent) {
    if (dragIndex < 0) return
    const y = event.clientY - listTop
    let target = bands.findIndex((bottom) => y < bottom)
    if (target === -1) target = bands.length - 1
    if (target !== dragIndex && target >= 0) {
      reorder(dragIndex, target)
      dragIndex = target
    }
  }

  function endDrag() {
    dragIndex = -1
    document.body.classList.remove('dragging')
  }

  function onGripKey(event: KeyboardEvent, i: number) {
    const delta = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0
    if (!delta) return
    event.preventDefault()
    reorder(i, i + delta)
  }
</script>

<svelte:window onpointermove={onPointerMove} onpointerup={endDrag} onpointercancel={endDrag} />

<ul bind:this={list} class="flex flex-col gap-1 {dragIndex >= 0 ? 'select-none' : ''}">
  {#each order as shape, i (shape)}
    <li
      animate:flip={{ duration: flipMs }}
      data-shape-row={i}
      class="flex items-center gap-1.5 rounded border px-1.5 py-1 text-xs
             {dragIndex === i
        ? 'relative z-10 border-slate-800 bg-white shadow-md'
        : 'border-slate-200 bg-white'}"
    >
      <button
        type="button"
        aria-label="{shape}: drag to reorder, or use the arrow keys"
        onpointerdown={(e) => startDrag(e, i)}
        onkeydown={(e) => onGripKey(e, i)}
        class="shrink-0 cursor-grab touch-none rounded px-0.5 py-1 text-slate-300
               hover:bg-slate-100 hover:text-slate-600 focus:ring-2 focus:ring-slate-400
               focus:outline-none active:cursor-grabbing"
      >
        <svg viewBox="0 0 16 16" class="h-4 w-4" aria-hidden="true">
          {#each [4, 8, 12] as cy (cy)}
            <circle cx="6" cy={cy} r="1.2" fill="currentColor" />
            <circle cx="10" cy={cy} r="1.2" fill="currentColor" />
          {/each}
        </svg>
      </button>
      <span class="w-3 text-right font-mono text-slate-400">{i + 1}</span>
      <svg viewBox="-11 -11 22 22" class="h-4 w-4 shrink-0 text-slate-700" aria-hidden="true">
        <path
          d={shapePath(shape, 17)}
          fill="none"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linejoin="round"
        />
      </svg>
      <span class="flex-1 text-slate-700">{shape}</span>
    </li>
  {/each}
</ul>
