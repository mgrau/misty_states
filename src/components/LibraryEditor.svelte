<script lang="ts">
  /**
   * Arranging the library: what it is called, what its groups are, and which
   * diagram sits where.
   *
   * Order carries meaning — a library reads like the problem sets it came from
   * — so rows are dragged rather than numbered, in the live-swap style the
   * shape list uses: pressing a grip picks a row up and moving the pointer
   * splices it through the list, with `animate:flip` sliding the rest into
   * place.
   *
   * A diagram can be dragged into another group, so every entry row in the
   * dialog is one target list regardless of which group it is currently in.
   * That rules out freezing the bands at pick-up the way the shape list does:
   * moving a row between groups changes every row's height offset, so the
   * bands are re-measured after each move. They are measured from `offsetTop`
   * rather than `getBoundingClientRect`, which is what makes that safe — layout
   * positions ignore the FLIP transforms still in flight, so the animation
   * cannot feed back into the hit-testing driving it.
   *
   * Everything here edits the store directly and persists as it goes. There is
   * no OK button because there is nothing to confirm — except deleting a group
   * that still holds diagrams, which asks once.
   */
  import { flip } from 'svelte/animate'
  import {
    addGroup, libraryStore, moveEntry, removeEntry, removeGroup, renameEntry,
    renameGroup, renameLibrary, reorderGroups, type EntrySlot,
  } from '../lib/library-store.svelte'
  import type { LibraryGroup } from '../lib/library'

  const { onclose }: { onclose: () => void } = $props()

  const flipMs =
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 0
      : 160

  const groups = $derived(libraryStore.doc.groups)
  const total = $derived(groups.reduce((n, g) => n + g.entries.length, 0))

  /** Which row is being dragged, and where it currently sits. */
  let drag = $state<{ kind: 'group' | 'entry'; slot: EntrySlot } | null>(null)
  let scroller = $state<HTMLElement | undefined>()
  let newGroup = $state('')
  /** The group a second click would delete along with its contents. */
  let confirmGroup = $state(-1)

  /**
   * Groups folded away, held by identity rather than by name or position —
   * both of which the editor lets you change.
   */
  let collapsed = $state<LibraryGroup[]>([])
  const isCollapsed = (group: LibraryGroup) => collapsed.includes(group)
  const toggle = (group: LibraryGroup) => {
    collapsed = isCollapsed(group) ? collapsed.filter((g) => g !== group) : [...collapsed, group]
  }

  interface Band extends EntrySlot {
    bottom: number
  }
  let bands: Band[] = []

  /**
   * Layout positions of every drop target, in document order.
   *
   * Entry rows across all groups form one list; an empty group contributes its
   * placeholder, which is what lets a diagram be dropped into a group that has
   * nothing in it yet.
   */
  function measure(kind: 'group' | 'entry') {
    if (!scroller) return
    const rows = scroller.querySelectorAll<HTMLElement>(
      kind === 'group' ? '[data-group-row]' : '[data-entry-row]',
    )
    bands = [...rows].map((el) => ({
      group: Number(el.dataset.group ?? 0),
      index: Number(el.dataset.index ?? 0),
      bottom: el.offsetTop + el.offsetHeight,
    }))
  }

  /** Pointer position in the scroller's own coordinates. */
  function localY(event: PointerEvent): number {
    if (!scroller) return 0
    return event.clientY - scroller.getBoundingClientRect().top + scroller.scrollTop
  }

  function startDrag(event: PointerEvent, kind: 'group' | 'entry', slot: EntrySlot) {
    event.preventDefault()
    drag = { kind, slot }
    measure(kind)
    document.body.classList.add('dragging')
  }

  function onPointerMove(event: PointerEvent) {
    if (!drag || !bands.length) return
    const y = localY(event)
    const target = bands.find((band) => y < band.bottom) ?? bands[bands.length - 1]
    if (target.group === drag.slot.group && target.index === drag.slot.index) return

    if (drag.kind === 'group') {
      if (!reorderGroups(drag.slot.index, target.index)) return
      drag = { kind: 'group', slot: { group: target.index, index: target.index } }
    } else {
      if (!moveEntry(drag.slot, target)) return
      // Where it landed is not always where it was aimed: an entry moved into
      // another group is clamped to that group's length.
      const group = libraryStore.doc.groups[target.group]
      drag = {
        kind: 'entry',
        slot: { group: target.group, index: Math.min(target.index, group.entries.length - 1) },
      }
    }
    // Row offsets have all shifted; the next hit test needs the new ones.
    measure(drag.kind)
  }

  function endDrag() {
    drag = null
    bands = []
    document.body.classList.remove('dragging')
  }

  function onGripKey(event: KeyboardEvent, kind: 'group' | 'entry', slot: EntrySlot) {
    const delta = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0
    if (!delta) return
    event.preventDefault()
    if (kind === 'group') reorderGroups(slot.index, slot.index + delta)
    else moveEntry(slot, { group: slot.group, index: slot.index + delta })
  }

  const dragging = (kind: 'group' | 'entry', group: number, index: number) =>
    drag?.kind === kind && drag.slot.group === group && drag.slot.index === index

  function deleteGroup(index: number) {
    if (groups[index].entries.length && confirmGroup !== index) {
      confirmGroup = index
      return
    }
    removeGroup(index)
    confirmGroup = -1
  }

  function submitGroup() {
    if (addGroup(newGroup)) newGroup = ''
  }
</script>

<svelte:window onpointermove={onPointerMove} onpointerup={endDrag} onpointercancel={endDrag} />

<!-- Click-away backdrop; sits under the dialog. -->
<button
  type="button"
  aria-label="Close the library editor"
  onclick={onclose}
  class="fixed inset-0 z-40 cursor-default bg-slate-900/25"
></button>

<div
  role="dialog"
  aria-modal="true"
  aria-label="Library"
  class="fixed inset-x-4 top-8 bottom-8 z-50 mx-auto flex max-w-2xl flex-col overflow-hidden
         rounded-lg border border-slate-300 bg-white shadow-xl"
>
  <header class="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
    <h2 class="text-sm font-semibold">Library</h2>
    <span class="text-xs text-slate-400">
      {total} diagram{total === 1 ? '' : 's'} in {groups.length} group{groups.length === 1 ? '' : 's'}
    </span>
    <button
      type="button"
      onclick={onclose}
      aria-label="Close the library editor"
      class="ml-auto rounded px-1.5 py-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
    >
      ✕
    </button>
  </header>

  <div bind:this={scroller} class="relative flex flex-col gap-4 overflow-y-auto px-4 py-3">
    <label class="flex flex-col gap-1">
      <span class="text-xs font-medium text-slate-500">Name</span>
      <input
        value={libraryStore.doc.name ?? ''}
        oninput={(e) => renameLibrary((e.currentTarget as HTMLInputElement).value)}
        placeholder="Untitled library"
        aria-label="Library name"
        class="rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500
               focus:outline-none"
      />
    </label>

    {#if !groups.length}
      <p class="rounded border border-dashed border-slate-300 px-3 py-6 text-center text-xs text-slate-400">
        Nothing here yet. Name a diagram and use “Save to Library”, or import a file.
      </p>
    {/if}

    <!--
      Keyed by the group object, not its label: renaming one in place would
      otherwise re-key the row, tearing down the very input being typed into.
    -->
    <ul class="flex flex-col gap-3">
      {#each groups as group, gi (group)}
        <li
          animate:flip={{ duration: flipMs }}
          data-group-row
          data-group={gi}
          data-index={gi}
          class="rounded border {dragging('group', gi, gi)
            ? 'border-slate-800 shadow-md'
            : 'border-slate-200'}"
        >
          <div class="flex items-center gap-1.5 border-b border-slate-100 bg-slate-50 px-2 py-1.5">
            <button
              type="button"
              aria-label="{group.label}: drag to reorder the group, or use the arrow keys"
              onpointerdown={(e) => startDrag(e, 'group', { group: gi, index: gi })}
              onkeydown={(e) => onGripKey(e, 'group', { group: gi, index: gi })}
              class="shrink-0 cursor-grab touch-none rounded px-0.5 py-1 text-slate-300
                     hover:bg-slate-200 hover:text-slate-600 focus:ring-2 focus:ring-slate-400
                     focus:outline-none active:cursor-grabbing"
            >
              <svg viewBox="0 0 16 16" class="h-4 w-4" aria-hidden="true">
                {#each [4, 8, 12] as cy (cy)}
                  <circle cx="6" cy={cy} r="1.2" fill="currentColor" />
                  <circle cx="10" cy={cy} r="1.2" fill="currentColor" />
                {/each}
              </svg>
            </button>
            <button
              type="button"
              onclick={() => toggle(group)}
              aria-expanded={!isCollapsed(group)}
              aria-label="{isCollapsed(group) ? 'Expand' : 'Collapse'} {group.label}"
              class="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
            >
              <svg
                viewBox="0 0 16 16"
                class="h-3.5 w-3.5 transition-transform {isCollapsed(group) ? '-rotate-90' : ''}"
                aria-hidden="true"
              >
                <path
                  d="M4 6l4 4 4-4"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
            <input
              value={group.label}
              oninput={(e) => renameGroup(gi, (e.currentTarget as HTMLInputElement).value)}
              aria-label="Group name"
              class="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5
                     text-xs font-medium text-slate-700 hover:border-slate-300
                     focus:border-slate-400 focus:bg-white focus:outline-none"
            />
            <span class="shrink-0 text-[11px] tabular-nums text-slate-400">
              {group.entries.length}
            </span>
            <button
              type="button"
              onclick={() => deleteGroup(gi)}
              onblur={() => (confirmGroup = -1)}
              class="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-slate-400 hover:bg-red-50
                     hover:text-red-700"
            >
              {confirmGroup === gi ? `Delete ${group.entries.length}?` : 'Delete'}
            </button>
          </div>

          {#if isCollapsed(group)}
            <!--
              Still a drop target while folded away, so a diagram can be filed
              into a group without unfolding it first. It lands at the end.
            -->
            <ul class="flex flex-col">
              <li
                data-entry-row
                data-group={gi}
                data-index={group.entries.length}
                class="px-3 py-1.5 text-[11px] text-slate-400"
              >
                {group.entries.length} hidden — drop here to file one away
              </li>
            </ul>
          {:else}
          <ul class="flex flex-col">
            {#each group.entries as entry, ei (entry.id)}
              <li
                animate:flip={{ duration: flipMs }}
                data-entry-row
                data-group={gi}
                data-index={ei}
                class="flex items-center gap-1.5 border-b border-slate-100 px-2 py-1 last:border-b-0
                       {dragging('entry', gi, ei) ? 'z-10 bg-white shadow-md' : ''}"
              >
                <button
                  type="button"
                  aria-label="{entry.title}: drag to reorder or move between groups"
                  onpointerdown={(e) => startDrag(e, 'entry', { group: gi, index: ei })}
                  onkeydown={(e) => onGripKey(e, 'entry', { group: gi, index: ei })}
                  class="shrink-0 cursor-grab touch-none rounded px-0.5 py-1 text-slate-300
                         hover:bg-slate-100 hover:text-slate-600 focus:ring-2 focus:ring-slate-400
                         focus:outline-none active:cursor-grabbing"
                >
                  <svg viewBox="0 0 16 16" class="h-3.5 w-3.5" aria-hidden="true">
                    {#each [4, 8, 12] as cy (cy)}
                      <circle cx="6" cy={cy} r="1.2" fill="currentColor" />
                      <circle cx="10" cy={cy} r="1.2" fill="currentColor" />
                    {/each}
                  </svg>
                </button>
                <input
                  value={entry.title}
                  oninput={(e) => renameEntry(entry.id, (e.currentTarget as HTMLInputElement).value)}
                  aria-label="Diagram title"
                  class="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5
                         text-xs text-slate-700 hover:border-slate-300 focus:border-slate-400
                         focus:outline-none"
                />
                <button
                  type="button"
                  onclick={() => removeEntry(entry.id)}
                  aria-label="Delete {entry.title}"
                  class="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-slate-400 hover:bg-red-50
                         hover:text-red-700"
                >
                  ✕
                </button>
              </li>
            {/each}
            {#if !group.entries.length}
              <!-- A drop target, so a diagram can be dragged into a new group. -->
              <li
                data-entry-row
                data-group={gi}
                data-index="0"
                class="px-3 py-2 text-[11px] text-slate-400"
              >
                Empty — drag a diagram here
              </li>
            {/if}
          </ul>
          {/if}
        </li>
      {/each}
    </ul>

    <form
      onsubmit={(e) => {
        e.preventDefault()
        submitGroup()
      }}
      class="flex gap-1.5"
    >
      <input
        bind:value={newGroup}
        placeholder="New group…"
        aria-label="New group name"
        class="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-xs
               focus:border-slate-500 focus:outline-none"
      />
      <button
        type="submit"
        disabled={!newGroup.trim()}
        class="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50
               disabled:opacity-40"
      >
        Add group
      </button>
    </form>

    <p class="text-[11px] text-slate-400">
      Changes are kept as you make them. Export the library from Settings to keep a copy.
    </p>
  </div>
</div>
