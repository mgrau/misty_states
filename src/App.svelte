<script lang="ts">
  import { render } from './lib/index'
  import type { ThemeId } from './lib/render/theme'
  import { DEFAULT_SHAPE_ORDER, SHAPE_NAMES, type ShapeName } from './lib/shapes'
  import { EXAMPLES, DEFAULT_EXAMPLE } from './lib/examples'
  import {
    libraryStore, findByTitle, findEntry, saveEntry, seedFromProject,
  } from './lib/library-store.svelte'
  import LibraryEditor from './components/LibraryEditor.svelte'
  import {
    canCopyImages, copyPNG, copySVGImage, copyText, downloadPDF, downloadPNG,
    downloadSVG, pdfDataUrl, pngDataUrl, readSourceFile, svgDataUrl,
  } from './lib/export'
  import { embedSvgMeta } from './lib/metadata'
  import Icon from './components/Icon.svelte'
  import { editorUrl, fromSearchParams, imageUrl, type DiagramParams } from './lib/url'
  import SyntaxHelp from './components/SyntaxHelp.svelte'
  import SettingsPanel from './components/SettingsPanel.svelte'
  import MenuButton from './components/MenuButton.svelte'
  import MenuItems from './components/MenuItems.svelte'
  import type { MenuItem } from './components/menu'

  const STORE = 'misty.v1'

  interface Saved {
    source: string
    name: string
    theme: ThemeId
    dark: boolean
    shapeOrder: ShapeName[]
    qubitSize: number
    separator: 'bar' | 'comma'
    cloudFluff: number
    cloudPad: number
    factorCalculated: boolean
    exactOdds: boolean
    helpOpen: boolean
  }

  function load(): Saved {
    const fallback: Saved = {
      source: DEFAULT_EXAMPLE.source,
      name: '',
      theme: 'solid',
      dark: false,
      shapeOrder: [...DEFAULT_SHAPE_ORDER],
      qubitSize: 26,
      separator: 'bar',
      cloudFluff: 1,
      cloudPad: 14,
      factorCalculated: true,
      exactOdds: false,
      helpOpen: true,
    }

    // A ?src= deep link wins over the saved session, so a shared link always
    // opens what the sender saw.
    const shared =
      typeof location !== 'undefined' ? fromSearchParams(new URLSearchParams(location.search)) : null

    const withShared = (base: Saved): Saved =>
      shared
        ? {
            ...base,
            source: shared.source,
            theme: shared.theme ?? base.theme,
            dark: shared.dark ?? base.dark,
            qubitSize: shared.qubit ?? base.qubitSize,
          }
        : base

    try {
      const raw = localStorage.getItem(STORE)
      if (!raw) return withShared(fallback)
      const parsed = JSON.parse(raw) as Partial<Saved>
      return withShared({
        ...fallback,
        ...parsed,
        // Guard against a stale or hand-edited shape list.
        shapeOrder:
          Array.isArray(parsed.shapeOrder) &&
          parsed.shapeOrder.length === DEFAULT_SHAPE_ORDER.length &&
          parsed.shapeOrder.every((s) => SHAPE_NAMES.includes(s))
            ? parsed.shapeOrder
            : fallback.shapeOrder,
      })
    } catch {
      return withShared(fallback)
    }
  }

  const initial = load()

  let source = $state(initial.source)
  let name = $state(initial.name)
  let theme = $state<ThemeId>(initial.theme)
  let dark = $state(initial.dark)
  let shapeOrder = $state<ShapeName[]>(initial.shapeOrder)
  let qubitSize = $state(initial.qubitSize)
  let separator = $state<'bar' | 'comma'>(initial.separator)
  let cloudFluff = $state(initial.cloudFluff)
  let cloudPad = $state(initial.cloudPad)
  let factorCalculated = $state(initial.factorCalculated)
  let exactOdds = $state(initial.exactOdds)
  let helpOpen = $state(initial.helpOpen)
  let zoom = $state(1)
  let pngScale = $state(3)
  let settingsOpen = $state(false)
  let libraryOpen = $state(false)
  let toast = $state('')

  const result = $derived.by(() => {
    try {
      const r = render(source, {
        theme,
        dark,
        shapeOrder,
        factorCalculated,
        exactOdds,
        metrics: {
          qubit: qubitSize,
          separator,
          cloudFluff,
          cloudPadX: cloudPad,
          // Kept in the default proportion, so one slider moves both sensibly.
          cloudPadY: cloudPad * (11 / 14),
        },
      })
      return { ok: true as const, ...r }
    } catch (err) {
      return { ok: false as const, message: (err as Error).message }
    }
  })

  /**
   * Keep the last good drawing on screen while the source is mid-edit — along
   * with the text that produced it, since that is what gets embedded in an
   * export. Pairing them means a figure saved during a broken edit still
   * carries the source it was actually drawn from.
   */
  let lastGood = $state({ svg: '', source: '', name: '' })
  $effect(() => {
    if (result.ok) lastGood = { svg: result.svg, source, name }
  })

  $effect(() => {
    const snapshot: Saved = {
      source, name, theme, dark, shapeOrder, qubitSize, separator, cloudFluff, cloudPad,
      factorCalculated, exactOdds, helpOpen,
    }
    try {
      localStorage.setItem(STORE, JSON.stringify(snapshot))
    } catch {
      // Private browsing or a full quota — settings just will not persist.
    }
  })

  // Everything downstream — preview, clipboard, files, data URLs — uses the
  // SVG with its source attached, so there is one thing to keep track of and no
  // way to export a figure that has lost it.
  const svg = $derived.by(() => {
    const drawing = result.ok ? result.svg : lastGood.svg
    if (!drawing) return drawing
    const meta = result.ok ? { source, name } : lastGood
    return embedSvgMeta(drawing, { source: meta.source, name: meta.name.trim() || undefined })
  })
  const filename = $derived(result.ok && result.kind === 'circuit' ? 'circuit' : 'misty-state')

  function flash(message: string) {
    toast = message
    setTimeout(() => (toast = ''), 1800)
  }

  async function guard(action: () => Promise<void> | void, ok: string) {
    try {
      await action()
      flash(ok)
    } catch (err) {
      flash((err as Error).message || 'Something went wrong')
    }
  }

  /** Shown under the picker: what the original drawing does not say by itself. */
  let libraryNote = $state('')

  let examplePick = $state('')
  let libraryPick = $state('')
  /** What a picker last put in the box, so anything else can clear the picker. */
  let pickedSource = $state('')

  /**
   * The pickers name what is in the source box. The moment it holds something
   * else — an edit, or a figure opened from a file — they stop being true, so
   * they go back to their placeholder.
   */
  $effect(() => {
    if (source === pickedSource) return
    examplePick = ''
    libraryPick = ''
    libraryNote = ''
  })

  function useExample(id: string) {
    const ex = EXAMPLES.find((e) => e.id === id)
    if (!ex) return
    source = ex.source
    name = ex.title
    pickedSource = ex.source
    libraryPick = ''
    libraryNote = ''
  }

  function useLibrary(id: string) {
    const entry = findEntry(id)
    if (!entry) return
    source = entry.source
    name = entry.title
    pickedSource = entry.source
    examplePick = ''
    libraryNote = [entry.origin, entry.note].filter(Boolean).join(' — ')
  }

  /* -- The library ------------------------------------------------------- */

  // Nothing ships with the app; the dev server seeds from library.yaml when
  // there is one. Until then the picker has nothing to show, so it stays away.
  const libraryCount = $derived(
    libraryStore.doc.groups.reduce((n, g) => n + g.entries.length, 0),
  )

  $effect(() => {
    void seedFromProject().catch(() => {
      // A malformed library.yaml should not stop the editor from opening.
      flash('Could not read library.yaml')
    })
  })

  const savedEntry = $derived(name.trim() ? findByTitle(name) : undefined)

  function saveToLibrary() {
    const title = name.trim()
    if (!title) {
      flash('Give the diagram a name first')
      return
    }
    const known = !!findByTitle(title)
    try {
      const entry = saveEntry(title, source)
      libraryPick = entry.id
      pickedSource = source
      examplePick = ''
      libraryNote = ''
      flash(known ? `Updated “${title}”` : `Saved “${title}” to the library`)
    } catch (err) {
      flash((err as Error).message)
    }
  }


  const shareParams = $derived<DiagramParams>({
    source,
    theme,
    dark,
    qubit: qubitSize,
    scale: pngScale,
  })

  /** This document's URL, so links work behind a sub-path or off the filesystem. */
  const shareBase = $derived(typeof location !== 'undefined' ? location.href : '/')

  const copyItem = (key: string, label: string, hint: string, get: () => Promise<string> | string) =>
    ({ key, label, hint, run: () => guard(async () => copyText(await get()), `${label} copied`) })

  // The first item is the split button's default, so PNG leads: it is what
  // pastes reliably into slides, docs and mail.
  const copyItems = $derived<MenuItem[]>([
    ...(canCopyImages()
      ? [
          {
            key: 'png-image',
            label: 'PNG image',
            hint: `Onto the clipboard at ${pngScale}× — paste into slides`,
            run: () => guard(() => copyPNG(svg, pngScale), 'PNG copied'),
          },
          {
            key: 'svg-image',
            label: 'SVG image',
            hint: 'Onto the clipboard as a picture, kept vector',
            run: async () => {
              try {
                const flavor = await copySVGImage(svg)
                // Say what actually happened: not every browser will put a real
                // SVG on the clipboard, and the fallback pastes differently.
                flash(
                  flavor === 'image'
                    ? 'SVG image copied'
                    : 'Copied as HTML — this browser blocks SVG on the clipboard',
                )
              } catch (err) {
                flash((err as Error).message || 'Could not copy')
              }
            },
          },
        ]
      : []),
    copyItem('svg-markup', 'SVG markup', 'The <svg> element itself, as text', () => svg),
    copyItem('svg-data', 'SVG data URL', 'Self-contained — works in <img src>', () =>
      svgDataUrl(svg),
    ),
    copyItem('png-data', 'PNG data URL', `Self-contained, at ${pngScale}×`, () =>
      pngDataUrl(svg, pngScale),
    ),
    copyItem('pdf-data', 'PDF data URL', 'Vector PDF — paste into the address bar', () =>
      pdfDataUrl(svg),
    ),
  ])

  // PDF leads: these figures are bound for problem sets and exams, which are
  // built in LaTeX.
  const saveItems = $derived<MenuItem[]>([
    {
      key: 'pdf',
      label: 'PDF',
      hint: 'Vector, page cropped to the figure — for LaTeX',
      run: () => guard(() => downloadPDF(svg, filename), 'PDF saved'),
    },
    {
      key: 'svg',
      label: 'SVG',
      hint: 'Vector, and editable in Inkscape or Illustrator',
      run: () => guard(() => downloadSVG(svg, filename), 'SVG saved'),
    },
    {
      key: 'png',
      label: 'PNG',
      hint: `Raster at ${pngScale}×`,
      run: () => guard(() => downloadPNG(svg, filename, pngScale), 'PNG saved'),
    },
  ])

  const linkItems = $derived<MenuItem[]>([
    copyItem('editor', 'Editor link', 'Reopens this diagram in the editor', () =>
      editorUrl(shareBase, { ...shareParams, scale: undefined }),
    ),
    copyItem('svg-page', 'SVG link', '?format=svg — the diagram alone', () =>
      imageUrl(shareBase, 'svg', { ...shareParams, scale: undefined }),
    ),
    copyItem('png-page', 'PNG link', `?format=png — the diagram alone, at ${pngScale}×`, () =>
      imageUrl(shareBase, 'png', shareParams),
    ),
    copyItem('pdf-page', 'PDF link', '?format=pdf — opens in the browser’s PDF viewer', () =>
      imageUrl(shareBase, 'pdf', { ...shareParams, scale: undefined }),
    ),
  ])

  /** Right-click menu over the preview: the copy and save actions together. */
  const contextItems = $derived<MenuItem[]>([...copyItems, ...saveItems.map((i) => ({
    ...i,
    key: `save-${i.key}`,
    label: `Save as ${i.label}`,
  }))])

  /* -- Reopening a saved figure ------------------------------------------ */

  let fileInput = $state<HTMLInputElement | null>(null)
  /** Nesting depth of dragenter/dragleave, which fire for every child element. */
  let dragDepth = $state(0)

  async function openFile(file: File | null | undefined) {
    if (!file) return
    try {
      const meta = await readSourceFile(file)
      source = meta.source
      name = meta.name ?? ''
      libraryNote = ''
      flash(`Opened ${file.name}`)
    } catch (err) {
      flash((err as Error).message || 'Could not open that file')
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault()
    dragDepth = 0
    void openFile(event.dataTransfer?.files?.[0])
  }

  let menu = $state<{ x: number; y: number } | null>(null)

  function openContextMenu(event: MouseEvent) {
    event.preventDefault()
    // Keep the menu inside the viewport when right-clicking near an edge.
    menu = {
      x: Math.min(event.clientX, window.innerWidth - 260),
      y: Math.min(event.clientY, window.innerHeight - 300),
    }
  }

</script>

<!-- Dropping a saved figure anywhere in the window reopens it. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="relative flex h-full flex-col bg-slate-50 text-slate-900"
  ondragenter={(e) => {
    if (e.dataTransfer?.types.includes('Files')) dragDepth += 1
  }}
  ondragleave={() => (dragDepth = Math.max(0, dragDepth - 1))}
  ondragover={(e) => {
    if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
  }}
  ondrop={onDrop}
>
  <header class="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
    <div class="flex items-baseline gap-2">
      <h1 class="text-base font-semibold tracking-tight">Misty States</h1>
      <span class="hidden text-xs text-slate-500 sm:inline">
        quantum state &amp; circuit diagrams
      </span>
    </div>

    <button
      type="button"
      onclick={() => (settingsOpen = true)}
      aria-label="Settings"
      class="ml-auto flex items-center gap-1.5 rounded border border-slate-300 bg-white
             px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
    >
      <svg viewBox="0 0 20 20" class="h-3.5 w-3.5" aria-hidden="true">
        <circle cx="10" cy="10" r="2.6" fill="none" stroke="currentColor" stroke-width="1.6" />
        <path
          d="M10 2.6v2M10 15.4v2M17.4 10h-2M4.6 10h-2M15.2 4.8l-1.4 1.4M6.2 13.8l-1.4 1.4M15.2 15.2l-1.4-1.4M6.2 6.2L4.8 4.8"
          fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"
        />
      </svg>
      Settings
    </button>
  </header>

  <main class="grid min-h-0 flex-1 grid-cols-1 gap-0 lg:grid-cols-[minmax(0,26rem)_1fr]">
    <!-- Editor ------------------------------------------------------------ -->
    <section class="flex min-h-0 flex-col gap-3 overflow-y-auto border-slate-200 p-4 lg:border-r">
      <label class="flex flex-col gap-1">
        <span class="text-xs font-medium text-slate-500">Example</span>
        <select
          bind:value={examplePick}
          onchange={(e) => useExample((e.currentTarget as HTMLSelectElement).value)}
          class="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
        >
          <option value="">Choose an example…</option>
          {#each EXAMPLES as ex (ex.id)}
            <option value={ex.id}>{ex.title}</option>
          {/each}
        </select>
      </label>

      <!-- Hidden until there is a library: an empty picker says nothing. -->
      {#if libraryCount > 0}
        <label class="flex flex-col gap-1">
          <span class="text-xs font-medium text-slate-500">Library</span>
          <select
            bind:value={libraryPick}
            onchange={(e) => useLibrary((e.currentTarget as HTMLSelectElement).value)}
            class="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
          >
            <!-- The library says what it is; failing that, how big it is. -->
            <option value="">{libraryStore.doc.name || `${libraryCount} figures`}…</option>
            {#each libraryStore.doc.groups as group (group.label)}
              <optgroup label={group.label}>
                {#each group.entries as entry (entry.id)}
                  <option value={entry.id}>{entry.title}</option>
                {/each}
              </optgroup>
            {/each}
          </select>
        </label>
      {/if}

      {#if libraryNote}
        <p class="rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-500">
          {libraryNote}
        </p>
      {/if}

      <label class="flex min-h-0 flex-col gap-1">
        <span class="text-xs font-medium text-slate-500">Source</span>
        <textarea
          bind:value={source}
          spellcheck="false"
          rows="9"
          class="w-full resize-y rounded border border-slate-300 bg-white p-2.5 font-mono
                 text-sm leading-relaxed focus:border-slate-500 focus:outline-none"
        ></textarea>
      </label>

      {#if !result.ok}
        <p
          class="rounded border border-red-200 bg-red-50 px-2.5 py-2 font-mono text-xs text-red-700"
        >
          {result.message}
        </p>
      {/if}

      <SyntaxHelp open={helpOpen} onopenchange={(v) => (helpOpen = v)} />
    </section>

    <!-- Preview ----------------------------------------------------------- -->
    <section class="flex min-h-0 flex-col">
      <div
        class="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2 text-xs"
      >
        <div class="flex items-center gap-1.5">
          <span class="text-slate-500">Zoom</span>
          <input type="range" min="0.25" max="3" step="0.05" bind:value={zoom} class="w-28" />
          <span class="w-10 font-mono text-slate-500">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            onclick={() => (zoom = 1)}
            class="rounded border border-slate-300 px-1.5 py-0.5 text-slate-600 hover:bg-slate-50"
          >
            Reset
          </button>
        </div>

        <div class="flex items-center gap-1.5">
          <span class="text-slate-500">Qubit size</span>
          <input type="range" min="16" max="44" step="1" bind:value={qubitSize} class="w-24" />
          <span class="w-5 font-mono text-slate-500">{qubitSize}</span>
        </div>

        <div class="ml-auto flex flex-wrap items-center gap-1.5">
          <input
            bind:this={fileInput}
            type="file"
            accept=".svg,.png,.pdf,.txt,image/svg+xml,image/png,application/pdf,text/plain"
            class="hidden"
            onchange={(e) => {
              const input = e.currentTarget as HTMLInputElement
              void openFile(input.files?.[0])
              // Clear it, so picking the same file twice fires again.
              input.value = ''
            }}
          />
          <button
            type="button"
            onclick={() => fileInput?.click()}
            title="Open a figure saved from this app — its source travels inside the file"
            class="flex items-center gap-1.5 rounded border border-slate-300 bg-white px-2 py-1
                   text-slate-700 hover:bg-slate-50"
          >
            <Icon name="open" />
            Open
          </button>

          <MenuButton label="Copy" icon="copy" items={copyItems} width="w-72" />
          <MenuButton label="Save" icon="download" items={saveItems} width="w-72" />
          <MenuButton
            label="Link"
            icon="link"
            items={linkItems}
            width="w-72"
            footer="Links open a page; the data URLs above are the image itself."
          />
        </div>
      </div>

      <div
        class="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2 text-xs"
      >
        <label class="flex flex-1 items-center gap-1.5">
          <span class="text-slate-500">Name</span>
          <input
            bind:value={name}
            placeholder="Untitled"
            spellcheck="false"
            aria-label="Diagram name"
            class="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-slate-800
                   focus:border-slate-500 focus:outline-none"
          />
        </label>

        <button
          type="button"
          onclick={saveToLibrary}
          disabled={!name.trim()}
          title={savedEntry
            ? 'Replace this diagram in the library'
            : 'Add this diagram to the library'}
          class="rounded border border-slate-300 bg-white px-2 py-1 text-slate-700
                 hover:bg-slate-50 disabled:opacity-40"
        >
          {savedEntry ? 'Update in Library' : 'Save to Library'}
        </button>
      </div>

      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div
        role="img"
        aria-label="Rendered diagram. Right-click for copy and save options."
        oncontextmenu={openContextMenu}
        class="flex min-h-0 flex-1 items-center justify-center overflow-auto p-8
               {dark ? 'checkerboard-dark' : 'checkerboard'}"
      >
        <div data-preview style="transform: scale({zoom}); transform-origin: center;">
          <!-- Generated by our own renderer; all values are escaped in svg.ts. -->
          {@html svg}
        </div>
      </div>
    </section>
  </main>

  {#if dragDepth > 0}
    <div
      class="pointer-events-none absolute inset-3 z-50 flex items-center justify-center rounded-lg
             border-2 border-dashed border-slate-400 bg-white/80 text-sm font-medium text-slate-600"
    >
      Drop an SVG, PNG or PDF saved from this app to keep editing it
    </div>
  {/if}

  {#if menu}
    <!-- Click-away backdrop; sits under the menu. -->
    <button
      type="button"
      aria-label="Close menu"
      onclick={() => (menu = null)}
      oncontextmenu={(e) => {
        e.preventDefault()
        menu = null
      }}
      class="fixed inset-0 z-30 cursor-default"
    ></button>
    <div class="fixed z-40 w-64" style="left: {menu.x}px; top: {menu.y}px;">
      <MenuItems
        items={contextItems}
        onpick={(item) => {
          menu = null
          void item.run()
        }}
      />
    </div>
  {/if}

  <SettingsPanel
    open={settingsOpen}
    {theme}
    {dark}
    {pngScale}
    {separator}
    {cloudFluff}
    {cloudPad}
    {factorCalculated}
    {exactOdds}
    {shapeOrder}
    onclose={() => (settingsOpen = false)}
    oneditlibrary={() => {
      settingsOpen = false
      libraryOpen = true
    }}
    onthemechange={(t) => (theme = t)}
    ondarkchange={(d) => (dark = d)}
    onpngscalechange={(s) => (pngScale = s)}
    onseparatorchange={(v) => (separator = v)}
    oncloudfluffchange={(v) => (cloudFluff = v)}
    oncloudpadchange={(v) => (cloudPad = v)}
    onfactorchange={(v) => (factorCalculated = v)}
    onexactoddschange={(v) => (exactOdds = v)}
    onshapeorderchange={(o) => (shapeOrder = o)}
  />

  {#if libraryOpen}
    <LibraryEditor onclose={() => (libraryOpen = false)} />
  {/if}

  {#if toast}
    <div
      class="pointer-events-none fixed bottom-5 left-1/2 -translate-x-1/2 rounded-full
             bg-slate-900 px-3.5 py-1.5 text-xs font-medium text-white shadow-lg"
    >
      {toast}
    </div>
  {/if}
</div>
