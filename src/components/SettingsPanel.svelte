<script lang="ts">
  /**
   * Dismissable settings, slid in from the right.
   *
   * Everything here changes how a diagram looks rather than what it says, so it
   * is kept out of the editing column entirely. It shares the drawer with the
   * syntax reference — see `SidePanel` — so only one ever covers the drawing.
   */
  import { render } from '../core/index'
  import { THEMES, THEME_IDS } from '../core/render/themes'
  import type { ThemeId } from '../core/render/theme'
  import { DEFAULT_SHAPE_ORDER, type ShapeName } from '../core/shapes'
  import ShapeOrderList from './ShapeOrderList.svelte'
  import { libraryStore, entryCount, replaceLibrary, resetLibrary } from '../lib/library-store.svelte'
  import { fromYaml, toYaml, LibraryFormatError } from '../lib/library-yaml'
  import { downloadText } from '../lib/export'
  import SidePanel from './SidePanel.svelte'

  interface Props {
    open: boolean
    theme: ThemeId
    dark: boolean
    pngScale: number
    separator: 'bar' | 'comma'
    cloudFluff: number
    cloudPad: number
    qubitSize: number
    factorCalculated: boolean
    exactOdds: boolean
    keepSign: boolean
    animateInside: boolean
    movieFps: number
    checking: boolean
    shapeOrder: ShapeName[]
    /** Whether the drawing has layers to step through, and text to write out. */
    canStep: boolean
    hasDirac: boolean
    stepOn: boolean
    diracOn: boolean
    zoom: number
    zoomMin: number
    zoomMax: number
    onclose: () => void
    oneditlibrary: () => void
    onthemechange: (theme: ThemeId) => void
    ondarkchange: (dark: boolean) => void
    onpngscalechange: (scale: number) => void
    onseparatorchange: (separator: 'bar' | 'comma') => void
    oncloudfluffchange: (value: number) => void
    oncloudpadchange: (value: number) => void
    onqubitsizechange: (value: number) => void
    onfactorchange: (factor: boolean) => void
    onexactoddschange: (exact: boolean) => void
    onkeepsignchange: (keep: boolean) => void
    oninsidechange: (inside: boolean) => void
    onfpschange: (fps: number) => void
    oncheckingchange: (on: boolean) => void
    onshapeorderchange: (order: ShapeName[]) => void
    onstepchange: (on: boolean) => void
    ondiracchange: (on: boolean) => void
    onzoomchange: (zoom: number) => void
  }

  const {
    open,
    theme,
    dark,
    pngScale,
    separator,
    cloudFluff,
    cloudPad,
    qubitSize,
    factorCalculated,
    exactOdds,
    keepSign,
    animateInside,
    movieFps,
    checking,
    shapeOrder,
    canStep,
    hasDirac,
    stepOn,
    diracOn,
    zoom,
    zoomMin,
    zoomMax,
    onclose,
    oneditlibrary,
    onthemechange,
    ondarkchange,
    onpngscalechange,
    onseparatorchange,
    oncloudfluffchange,
    oncloudpadchange,
    onqubitsizechange,
    onfactorchange,
    onexactoddschange,
    onkeepsignchange,
    oninsidechange,
    onfpschange,
    oncheckingchange,
    onshapeorderchange,
    onstepchange,
    ondiracchange,
    onzoomchange,
  }: Props = $props()

  /**
   * Each theme previews itself: a gate with its pipes shows the difference far
   * better than the word "isometric" does.
   */
  const SWATCH = 'H 1'
  function swatch(id: ThemeId): string {
    try {
      return render(SWATCH, {
        theme: id,
        dark,
        metrics: { qubit: 14, pipeWidth: 17, colGap: 10, gateHeight: 30, fontSize: 13 },
      }).svg
    } catch {
      return ''
    }
  }

/**
   * Offered as real print resolutions rather than multipliers.
   *
   * Screen CSS pixels are 96 to the inch, so the scale a PNG is rasterised at
   * *is* a DPI once divided through — and a DPI is what a journal or a printer
   * asks for. 150 is draft, 300 the usual requirement, 600 for line art.
   */
  const SCREEN_DPI = 96
  const RESOLUTIONS = [150, 300, 600]

  let libraryMessage = $state('')
  let libraryError = $state(false)
  let fileInput = $state<HTMLInputElement | undefined>()

  function say(message: string, isError = false) {
    libraryMessage = message
    libraryError = isError
  }

  async function exportLibrary() {
    try {
      downloadText(await toYaml(libraryStore.doc), 'misty-library.yaml', 'text/yaml')
      say(`Exported ${entryCount()} figures`)
    } catch (err) {
      say((err as Error).message, true)
    }
  }

  async function importLibrary(file: File) {
    try {
      const doc = await fromYaml(await file.text())
      replaceLibrary(doc)
      say(`Loaded ${entryCount()} figures from ${file.name}`)
    } catch (err) {
      // A format error already reads as an explanation; anything else may not.
      say(
        err instanceof LibraryFormatError
          ? err.message
          : `Could not read that file — ${(err as Error).message}`,
        true,
      )
    }
  }
</script>

{#if open}
  <SidePanel title="Settings" {onclose}>
    <div class="flex flex-col gap-6 p-4">
      <!-- This diagram ----------------------------------------------------- -->
      <!--
        How the figure on screen is read, rather than settings that outlive it.
        Zoom always applies; the other two appear only while there is something
        to step through or write out.
      -->
      <section class="flex flex-col gap-2">
        <h3 class="text-xs font-medium text-slate-500">This diagram</h3>

        <!--
          Scroll and pinch zoom the drawing directly, which is what anyone
          reaches for. The slider is here for when a figure wants a particular
          size rather than whatever the wheel landed on — and it is the only way
          on a phone, where a slider in the editing column costs a row that the
          drawing wants more.
        -->
        <label class="flex items-center gap-2 text-[11px] text-slate-500">
          <button
            type="button"
            onclick={() => onzoomchange(1)}
            disabled={zoom === 1}
            title="Back to 100%"
            class="w-12 shrink-0 text-left hover:text-slate-800 disabled:hover:text-slate-500"
          >
            Zoom
          </button>
          <input
            type="range"
            min={zoomMin}
            max={zoomMax}
            step="0.05"
            value={zoom}
            oninput={(e) => onzoomchange(Number((e.currentTarget as HTMLInputElement).value))}
            class="min-w-0 flex-1"
            aria-label="Zoom"
          />
          <span class="w-9 text-right font-mono">{Math.round(zoom * 100)}%</span>
        </label>

        {#if canStep}
          <label class="flex items-center gap-2 text-[11px] text-slate-500">
            <button
              type="button"
              onclick={() => onstepchange(!stepOn)}
              aria-pressed={stepOn}
              aria-label="Step through the circuit"
              class="relative h-5 w-9 shrink-0 rounded-full transition-colors
                     {stepOn ? 'bg-slate-800' : 'bg-slate-300'}"
            >
              <span
                class="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all
                       {stepOn ? 'left-4.5' : 'left-0.5'}"
              ></span>
            </button>
            Work through the circuit a layer at a time
          </label>
        {/if}

        {#if hasDirac}
          <label class="flex items-center gap-2 text-[11px] text-slate-500">
            <button
              type="button"
              onclick={() => ondiracchange(!diracOn)}
              aria-pressed={diracOn}
              aria-label="Write the state in Dirac notation"
              class="relative h-5 w-9 shrink-0 rounded-full transition-colors
                     {diracOn ? 'bg-slate-800' : 'bg-slate-300'}"
            >
              <span
                class="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all
                       {diracOn ? 'left-4.5' : 'left-0.5'}"
              ></span>
            </button>
            Write the state out as |ψ⟩
          </label>
        {/if}
      </section>

      <!-- Theme ------------------------------------------------------------ -->
      <section class="flex flex-col gap-2">
        <h3 class="text-xs font-medium text-slate-500">Style</h3>
        <div class="grid grid-cols-3 gap-2">
          {#each THEME_IDS as id (id)}
            <button
              type="button"
              onclick={() => onthemechange(id)}
              aria-pressed={theme === id}
              title={THEMES[id].description}
              class="flex flex-col items-center gap-1.5 rounded-md border p-2 transition-colors
                     {theme === id
                ? 'border-slate-800 bg-slate-50'
                : 'border-slate-200 hover:border-slate-400'}"
            >
              <span class="flex h-14 items-center justify-center">
                <!-- Rendered by our own renderer; values are escaped in svg.ts. -->
                {@html swatch(id)}
              </span>
              <span
                class="text-[11px] {theme === id
                  ? 'font-medium text-slate-900'
                  : 'text-slate-500'}"
              >
                {THEMES[id].label}
              </span>
            </button>
          {/each}
        </div>
      </section>

      <!-- Appearance ------------------------------------------------------- -->
      <section class="flex items-center justify-between">
        <h3 class="text-xs font-medium text-slate-500">Appearance</h3>
        <div class="flex rounded-md border border-slate-200 p-0.5">
          {#each [false, true] as isDark (isDark)}
            <button
              type="button"
              onclick={() => ondarkchange(isDark)}
              aria-pressed={dark === isDark}
              aria-label={isDark ? 'Dark' : 'Light'}
              class="rounded px-2.5 py-1 transition-colors
                     {dark === isDark
                ? 'bg-slate-800 text-white'
                : 'text-slate-500 hover:text-slate-800'}"
            >
              <svg viewBox="0 0 20 20" class="h-4 w-4" aria-hidden="true">
                {#if isDark}
                  <path
                    d="M16 12.2A6.5 6.5 0 017.8 4a6.5 6.5 0 108.2 8.2z"
                    fill="currentColor"
                  />
                {:else}
                  <circle cx="10" cy="10" r="3.6" fill="currentColor" />
                  {#each [0, 45, 90, 135, 180, 225, 270, 315] as a (a)}
                    <line
                      x1={10 + 5.6 * Math.cos((a * Math.PI) / 180)}
                      y1={10 + 5.6 * Math.sin((a * Math.PI) / 180)}
                      x2={10 + 7.6 * Math.cos((a * Math.PI) / 180)}
                      y2={10 + 7.6 * Math.sin((a * Math.PI) / 180)}
                      stroke="currentColor"
                      stroke-width="1.6"
                      stroke-linecap="round"
                    />
                  {/each}
                {/if}
              </svg>
            </button>
          {/each}
        </div>
      </section>

      <!-- Superposition ------------------------------------------------------ -->
      <section class="flex flex-col gap-2">
        <div class="flex items-baseline justify-between">
          <h3 class="text-xs font-medium text-slate-500">Superposition</h3>
          <span class="text-[11px] text-slate-400">Both are accepted as input</span>
        </div>
        <div class="flex rounded-md border border-slate-200 p-0.5">
          {#each [{ id: 'bar', label: '0 | 1' }, { id: 'comma', label: '0 , 1' }] as const as opt (opt.id)}
            <button
              type="button"
              onclick={() => onseparatorchange(opt.id)}
              aria-pressed={separator === opt.id}
              class="flex-1 rounded px-2 py-1 font-mono text-xs transition-colors
                     {separator === opt.id
                ? 'bg-slate-800 text-white'
                : 'text-slate-600 hover:text-slate-900'}"
            >
              {opt.label}
            </button>
          {/each}
        </div>
      </section>

      <!-- Calculated states -------------------------------------------------- -->
      <section class="flex flex-col gap-2">
        <div class="flex items-baseline justify-between">
          <h3 class="text-xs font-medium text-slate-500">Calculated states</h3>
          <span class="text-[11px] text-slate-400">What “calculate” draws</span>
        </div>
        <div class="flex rounded-md border border-slate-200 p-0.5">
          {#each [{ id: true, label: 'Factored' }, { id: false, label: 'Flat' }] as const as opt (opt.label)}
            <button
              type="button"
              onclick={() => onfactorchange(opt.id)}
              aria-pressed={factorCalculated === opt.id}
              class="flex-1 rounded px-2 py-1 text-xs transition-colors
                     {factorCalculated === opt.id
                ? 'bg-slate-800 text-white'
                : 'text-slate-600 hover:text-slate-900'}"
            >
              {opt.label}
            </button>
          {/each}
        </div>
        <p class="text-[11px] text-slate-400">
          Factored draws <span class="font-mono">(0|1)0</span> where the state separates;
          flat draws <span class="font-mono">00|10</span>.
        </p>

        <div class="flex rounded-md border border-slate-200 p-0.5">
          {#each [{ id: false, label: 'Percentage' }, { id: true, label: 'Exact odds' }] as const as opt (opt.label)}
            <button
              type="button"
              onclick={() => onexactoddschange(opt.id)}
              aria-pressed={exactOdds === opt.id}
              class="flex-1 rounded px-2 py-1 text-xs transition-colors
                     {exactOdds === opt.id
                ? 'bg-slate-800 text-white'
                : 'text-slate-600 hover:text-slate-900'}"
            >
              {opt.label}
            </button>
          {/each}
        </div>
        <p class="text-[11px] text-slate-400">
          How a measurement outcome's likelihood is written. An even split reads
          <span class="font-mono">50%</span> either way; uneven amplitudes give
          <span class="font-mono">69%</span> or <span class="font-mono">9/13</span>.
        </p>

        <div class="flex rounded-md border border-slate-200 p-0.5">
          {#each [{ id: false, label: 'Tidy sign' }, { id: true, label: 'Keep minus' }] as const as opt (opt.label)}
            <button
              type="button"
              onclick={() => onkeepsignchange(opt.id)}
              aria-pressed={keepSign === opt.id}
              class="flex-1 rounded px-2 py-1 text-xs transition-colors
                     {keepSign === opt.id
                ? 'bg-slate-800 text-white'
                : 'text-slate-600 hover:text-slate-900'}"
            >
              {opt.label}
            </button>
          {/each}
        </div>
        <p class="text-[11px] text-slate-400">
          An overall minus sign is unobservable, so it is normally tidied away.
          Keep it when the figure exists to show a phase flip:
          <span class="font-mono">1 / H / X / H</span> then reads
          <span class="font-mono">-1</span> rather than <span class="font-mono">1</span>.
        </p>
      </section>

      <!-- Animation ---------------------------------------------------------- -->
      <section class="flex flex-col gap-2">
        <div class="flex items-baseline justify-between">
          <h3 class="text-xs font-medium text-slate-500">Animation</h3>
          <span class="text-[11px] text-slate-400">What “animate” shows</span>
        </div>
        <div class="flex rounded-md border border-slate-200 p-0.5">
          {#each [{ id: true, label: 'Open the gates' }, { id: false, label: 'Closed boxes' }] as const as opt (opt.label)}
            <button
              type="button"
              onclick={() => oninsidechange(opt.id)}
              aria-pressed={animateInside === opt.id}
              class="flex-1 rounded px-2 py-1 text-xs transition-colors
                     {animateInside === opt.id
                ? 'bg-slate-800 text-white'
                : 'text-slate-600 hover:text-slate-900'}"
            >
              {opt.label}
            </button>
          {/each}
        </div>
        <p class="text-[11px] text-slate-400">
          Open, a gate goes clear and its working is visible: a term splits in two
          and the pair leaves together. Closed, qubits go in and qubits come out.
          A source's own <span class="font-mono">inside=off</span> overrides this.
        </p>

        <div class="flex rounded-md border border-slate-200 p-0.5">
          {#each [{ id: 25, label: '25 fps' }, { id: 30, label: '30 fps' }, { id: 50, label: '50 fps' }, { id: 60, label: '60 fps' }] as const as opt (opt.id)}
            <button
              type="button"
              onclick={() => onfpschange(opt.id)}
              aria-pressed={movieFps === opt.id}
              class="flex-1 rounded px-2 py-1 text-xs transition-colors
                     {movieFps === opt.id
                ? 'bg-slate-800 text-white'
                : 'text-slate-600 hover:text-slate-900'}"
            >
              {opt.label}
            </button>
          {/each}
        </div>
        <p class="text-[11px] text-slate-400">
          How smooth a saved GIF or MP4 is. Higher costs size and encoding time,
          and a GIF holds its timing in hundredths of a second, so it plays at
          the nearest rate it can express — 50 or 33⅓, not 60 or 30.
        </p>
      </section>

      <!-- Checking ----------------------------------------------------------- -->
      <section class="flex items-center justify-between gap-3">
        <div class="flex flex-col">
          <h3 class="text-xs font-medium text-slate-500">Check the diagram</h3>
          <p class="text-[11px] text-slate-400">
            Settle equations and circuit outputs against the arithmetic.
          </p>
        </div>
        <button
          type="button"
          onclick={() => oncheckingchange(!checking)}
          role="switch"
          aria-checked={checking}
          aria-label="Check the diagram"
          class="relative h-5 w-9 shrink-0 rounded-full transition-colors
                 {checking ? 'bg-slate-800' : 'bg-slate-300'}"
        >
          <span
            class="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all
                   {checking ? 'left-4.5' : 'left-0.5'}"
          ></span>
        </button>
      </section>

      <!-- Qubit size --------------------------------------------------------- -->
      <!--
        Lives here rather than over the drawing: it is how big the figure is
        drawn, which is settled once and then left alone, unlike zoom — and a
        toolbar with two sliders in it reads as two ways of doing the same
        thing.
      -->
      <section class="flex flex-col gap-2">
        <h3 class="text-xs font-medium text-slate-500">Qubit size</h3>
        <label class="flex items-center gap-2 text-[11px] text-slate-500">
          <span class="w-12 shrink-0">Glyph</span>
          <input
            type="range"
            min="16"
            max="44"
            step="1"
            value={qubitSize}
            oninput={(e) => onqubitsizechange(Number((e.currentTarget as HTMLInputElement).value))}
            class="flex-1"
          />
          <span class="w-6 text-right font-mono">{qubitSize}</span>
        </label>
      </section>

      <!-- Clouds ------------------------------------------------------------- -->
      <section class="flex flex-col gap-2">
        <h3 class="text-xs font-medium text-slate-500">Clouds</h3>
        <label class="flex items-center gap-2 text-[11px] text-slate-500">
          <span class="w-12 shrink-0">Fluffy</span>
          <input
            type="range"
            min="0.4"
            max="1.8"
            step="0.05"
            value={cloudFluff}
            oninput={(e) => oncloudfluffchange(Number((e.currentTarget as HTMLInputElement).value))}
            class="flex-1"
          />
          <span class="w-6 text-right font-mono">{cloudFluff.toFixed(1)}</span>
        </label>
        <label class="flex items-center gap-2 text-[11px] text-slate-500">
          <span class="w-12 shrink-0">Padding</span>
          <input
            type="range"
            min="4"
            max="30"
            step="1"
            value={cloudPad}
            oninput={(e) => oncloudpadchange(Number((e.currentTarget as HTMLInputElement).value))}
            class="flex-1"
          />
          <span class="w-6 text-right font-mono">{cloudPad}</span>
        </label>
      </section>

      <!-- PNG resolution --------------------------------------------------- -->
      <section class="flex flex-col gap-2">
        <div class="flex items-baseline justify-between">
          <h3 class="text-xs font-medium text-slate-500">PNG resolution</h3>
          <span class="font-mono text-[11px] text-slate-400">
            {Math.round(pngScale * 100) / 100}× actual size
          </span>
        </div>
        <div class="flex rounded-md border border-slate-200 p-0.5">
          {#each RESOLUTIONS as dpi (dpi)}
            <button
              type="button"
              onclick={() => onpngscalechange(dpi / SCREEN_DPI)}
              aria-pressed={Math.abs(pngScale - dpi / SCREEN_DPI) < 0.001}
              class="flex-1 rounded px-2 py-1 text-xs transition-colors
                     {Math.abs(pngScale - dpi / SCREEN_DPI) < 0.001
                ? 'bg-slate-800 text-white'
                : 'text-slate-600 hover:text-slate-900'}"
            >
              {dpi} dpi
            </button>
          {/each}
        </div>
      </section>

      <!-- Library ---------------------------------------------------------- -->
      <section class="flex flex-col gap-2">
        <div class="flex items-baseline justify-between">
          <h3 class="text-xs font-medium text-slate-500">
            {libraryStore.doc.name || 'Library'}
          </h3>
          <span class="text-[11px] text-slate-400">
            {entryCount()} figure{entryCount() === 1 ? '' : 's'}
          </span>
        </div>
        <p class="text-[11px] text-slate-400">
          Your diagrams, as a YAML file you can keep alongside your materials.
          The app ships with none.
        </p>
        <button
          type="button"
          onclick={oneditlibrary}
          class="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
        >
          Edit library…
        </button>
        <div class="flex gap-1.5">
          <button
            type="button"
            onclick={exportLibrary}
            class="flex-1 rounded border border-slate-300 px-2 py-1 text-xs text-slate-700
                   hover:bg-slate-50"
          >
            Export…
          </button>
          <button
            type="button"
            onclick={() => fileInput?.click()}
            class="flex-1 rounded border border-slate-300 px-2 py-1 text-xs text-slate-700
                   hover:bg-slate-50"
          >
            Import…
          </button>
          {#if entryCount() > 0}
            <button
              type="button"
              onclick={() => {
                resetLibrary()
                say('Cleared the library')
              }}
              title="Empty the library. Export first if you want to keep it."
              class="rounded border border-slate-300 px-2 py-1 text-xs text-slate-500
                     hover:bg-red-50 hover:text-red-700"
            >
              Clear
            </button>
          {/if}
        </div>
        <input
          bind:this={fileInput}
          type="file"
          accept=".yaml,.yml,text/yaml"
          class="hidden"
          onchange={(e) => {
            const input = e.currentTarget as HTMLInputElement
            const file = input.files?.[0]
            if (file) void importLibrary(file)
            // Cleared so re-picking the same file fires again.
            input.value = ''
          }}
        />
        {#if libraryMessage}
          <p
            class="rounded border px-2 py-1 text-[11px] {libraryError
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-slate-200 bg-slate-50 text-slate-500'}"
          >
            {libraryMessage}
          </p>
        {/if}
      </section>

      <!-- Shape order ------------------------------------------------------ -->
      <section class="flex flex-col gap-2">
        <div class="flex items-baseline justify-between">
          <h3 class="text-xs font-medium text-slate-500">Qubit shapes</h3>
          <button
            type="button"
            onclick={() => onshapeorderchange([...DEFAULT_SHAPE_ORDER])}
            class="text-[11px] text-slate-400 underline-offset-2 hover:text-slate-700 hover:underline"
          >
            Reset
          </button>
        </div>
        <p class="text-[11px] text-slate-400">
          Qubit 1 uses the first shape, qubit 2 the second. Drag to reorder.
        </p>
        <ShapeOrderList order={shapeOrder} onchange={onshapeorderchange} />
      </section>
    </div>
  </SidePanel>
{/if}
