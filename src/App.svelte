<script lang="ts">
  import { untrack } from 'svelte'
  import { render } from './core/index'
  import type { ThemeId } from './core/render/theme'
  import { DEFAULT_SHAPE_ORDER, SHAPE_NAMES, type ShapeName } from './core/shapes'
  import { EXAMPLES, DEFAULT_EXAMPLE } from './core/examples'
  import {
    libraryStore, findByTitle, findEntry, saveEntry, seedFromProject,
  } from './app/library-store.svelte'
  import LibraryEditor from './app/components/LibraryEditor.svelte'
  import {
    canCopyImages, copyPNG, copySVGImage, copyText, downloadPDF, downloadPNG,
    downloadSVG, pdfDataUrl, pngDataUrl, readSourceFile, svgDataUrl, triggerDownload,
  } from './app/export'
  import { embedSvgMeta } from './core/metadata'
  import { canMakeMp4, toGif, toMp4 } from './app/movie'
  import Icon from './app/components/Icon.svelte'
  import { editorUrl, fromSearchParams, imageUrl, type DiagramParams } from './core/url'
  import SyntaxHelp from './app/components/SyntaxHelp.svelte'
  import SettingsPanel from './app/components/SettingsPanel.svelte'
  import SidePanel from './app/components/SidePanel.svelte'
  import GatePalette from './app/components/GatePalette.svelte'
  import MenuButton from './app/components/MenuButton.svelte'
  import MenuItems from './app/components/MenuItems.svelte'
  import type { MenuItem } from './app/components/menu'
  import { asDroppable, gateAt, setAngle, type Edit } from './core/circuit/edit'
  import { parseCircuit } from './core/circuit/parse'
  import { createBoard, type CarryState } from './core/ui/board'
  import type { CircuitDoc, Gate } from './core/circuit/ast'

  const STORE = 'misty.v1'

  interface Saved {
    source: string
    name: string
    theme: ThemeId
    dark: boolean
    shapeOrder: ShapeName[]
    qubitSize: number
    paneWidth: number
    separator: 'bar' | 'comma'
    cloudFluff: number
    cloudPad: number
    factorCalculated: boolean
    exactOdds: boolean
    keepSign: boolean
    animateInside: boolean
    movieFps: number
    checking: boolean
  }

  function load(): Saved {
    const fallback: Saved = {
      source: DEFAULT_EXAMPLE.source,
      name: '',
      theme: 'solid',
      dark: false,
      shapeOrder: [...DEFAULT_SHAPE_ORDER],
      qubitSize: 26,
      paneWidth: 320,
      separator: 'bar',
      cloudFluff: 1,
      cloudPad: 14,
      factorCalculated: true,
      exactOdds: false,
      keepSign: false,
      animateInside: true,
      movieFps: 30,
      checking: true,
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

  /**
   * How wide the editing column is, in pixels.
   *
   * Dragged rather than fixed: how much room the source wants depends entirely
   * on what is being written — a one-line state and a twenty-line circuit are
   * not the same job — and the drawing wants whatever is left.
   */
  let paneWidth = $state(initial.paneWidth)
  const PANE_MIN = 240
  const PANE_MAX = 640

  function resizePane(event: PointerEvent) {
    event.preventDefault()
    const from = event.clientX
    const was = paneWidth
    const move = (e: PointerEvent) => {
      paneWidth = Math.min(PANE_MAX, Math.max(PANE_MIN, was + e.clientX - from))
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }
  let separator = $state<'bar' | 'comma'>(initial.separator)
  let cloudFluff = $state(initial.cloudFluff)
  let cloudPad = $state(initial.cloudPad)
  let factorCalculated = $state(initial.factorCalculated)
  let exactOdds = $state(initial.exactOdds)
  let keepSign = $state(initial.keepSign)
  let animateInside = $state(initial.animateInside)
  let movieFps = $state(initial.movieFps)
  let checking = $state(initial.checking)
  let zoom = $state(1)

  /**
   * Whether the answer is on show.
   *
   * A figure that marks something with `answer` is a question until it is
   * asked, so this starts off — and starts off again for the next diagram,
   * since having seen one answer says nothing about wanting to see the next.
   */
  let answers = $state(false)
  let answersFor = $state('')

  /**
   * Reading a circuit a layer at a time, and reading its state as text.
   *
   * Both are ways of looking rather than parts of the figure, so neither is
   * saved with it and neither is on to begin with: the drawing is the point,
   * and a row of controls over it that nobody asked for is in the way.
   */
  /**
   * A gate being dragged in from the palette.
   *
   * The drag never touches `source`. It works out what the source *would* be,
   * draws that, and writes it only on release — so the preview is produced by
   * the very function that will commit, and the two cannot disagree.
   *
   * Everything the hit-test reads is frozen at pick-up: the document, its
   * geometry and the mapping from screen to diagram. The drawing shifts as the
   * preview grows, and measuring it while it moves would feed the animation
   * back into the aim that drives it — the same reason the shape list freezes
   * its row bands.
   */
  /**
   * What is in the air: a new gate off the palette, or one already in the
   * drawing that is being moved. The difference is only which patch is used —
   * both preview the same way and commit the same way.
   */
  /**
   * `$state.raw`, and it matters. Plain `$state` hands back a deep proxy of
   * whatever is assigned to it, and a gate taken out of the frozen document
   * would then no longer *be* one of that document's gates — the patch would
   * look for it, fail to find it, and quietly do nothing. Nothing here is
   * mutated in place, so there is nothing to gain by proxying it.
   */
  let carry = $state.raw<CarryState>({ carrying: null, at: null, removing: false })
  let dragPreview = $state.raw<Edit | null>(null)
  /** The element the anchor compensation is applied to. */
  let anchorEl = $state<HTMLElement | undefined>()
  let previewEl = $state<HTMLElement | undefined>()

  let stepOn = $state(false)
  let stepAt = $state(0)
  let diracOn = $state(false)

  /** Everything that decides how a source is drawn, in one place. */
  const renderOptions = $derived({
    theme,
    dark,
    shapeOrder,
    factorCalculated,
    exactOdds,
    keepSign,
    animateInside,
    answers,
    metrics: {
      qubit: qubitSize,
      separator,
      cloudFluff,
      cloudPadX: cloudPad,
      // Kept in the default proportion, so one slider moves both sensibly.
      cloudPadY: cloudPad * (11 / 14),
    },
  })

  const result = $derived.by(() => {
    try {
      const r = render(dragPreview?.source ?? source, {
        ...renderOptions,
        step: stepOn ? stepAt : undefined,
        highlight: dragPreview?.line,
        check: checking,
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
      source, name, theme, dark, shapeOrder, qubitSize, paneWidth, separator, cloudFluff, cloudPad,
      factorCalculated, exactOdds, keepSign, animateInside, movieFps, checking,
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
  /**
   * The drawing a rasteriser should be handed.
   *
   * An animation is CSS inside the SVG, and a rasteriser goes through an
   * `<img>` — which catches whatever frame the browser happens to be on, so a
   * PNG of one used to be whatever moment it was asked at. A still has to be a
   * decided moment, and its first instant is the one that means something.
   * Saving the SVG itself still saves the animation, which is the point of that
   * format.
   */
  const stillSvg = $derived.by(() => {
    if (!animation) return svg
    try {
      const drawn = render(source, { ...renderOptions, still: true })
      return embedSvgMeta(drawn.svg, { source, name: name.trim() || undefined })
    } catch {
      return svg
    }
  })

  const filename = $derived(result.ok && result.kind === 'circuit' ? 'circuit' : 'misty-state')

  /** 300 dpi at 96 CSS pixels to the inch — the usual print requirement. */
  let pngScale = $state(300 / 96)
  /**
   * Which drawer is open, if any.
   *
   * One at a time: settings and the reference are both things you consult
   * beside the drawing, and two panels covering it at once would leave nothing
   * to consult them about.
   */
  let panel = $state<'settings' | 'syntax' | null>(null)
  const show = (which: 'settings' | 'syntax') => (panel = panel === which ? null : which)
  let libraryOpen = $state(false)
  let toast = $state('')

  /* -- Playback ----------------------------------------------------------- */

  /**
   * Where the animation is, and whether it is running.
   *
   * The clock is ours rather than the browser's. Letting CSS free-run and only
   * seeking on pause looks fine until you touch a control: `at` would still say
   * nought while the picture was a second in, so pausing or stepping jumped
   * backwards before going anywhere. Driving `--misty-at` every frame keeps the
   * number and the picture the same thing, which is what makes stepping from
   * mid-play land where it looks like it should.
   *
   * The file itself is untouched by this — its defaults still play it
   * unattended anywhere else.
   */
  let playing = $state(true)
  let at = $state(0)
  let frame = 0
  /** Whether to run round again. Starts from what the source asked for. */
  let repeat = $state(true)

  const animation = $derived(result.ok ? result.animation : undefined)

  /**
   * When the motion is over.
   *
   * Short of `duration`, which also covers the pause before it runs round
   * again. That pause is worth having when it loops and worth nothing to look
   * at, so the scrubber ends here and the clock keeps going past it.
   */
  const finishAt = $derived(animation?.steps[animation.steps.length - 1]?.t ?? 0)

  const halt = () => {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
  }

  /**
   * Run on from wherever it is, wrapping at the end.
   *
   * Timed from the first frame's own stamp rather than from `performance.now()`
   * — the two need not share an origin, and subtracting one from the other ran
   * the clock backwards, which the drawing shows as nothing happening at all.
   */
  function play() {
    halt()
    playing = true
    const from = at
    const span = animation?.duration ?? 0
    const end = finishAt
    let began: number | null = null
    const tick = (now: number) => {
      began ??= now
      const t = from + (now - began) / 1000
      // Without repeat there is nothing to wait for, so it stops where the
      // motion does rather than sitting through the pause.
      if (!repeat && t >= end) {
        at = end
        playing = false
        frame = 0
        return
      }
      at = span > 0 ? t % span : t
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
  }

  function pause() {
    halt()
    playing = false
  }

  /**
   * Turn repeating on or off.
   *
   * Switching it on when the run has already finished starts it again, rather
   * than waiting to be told to play as well: asking for it to repeat while
   * looking at the end of it can only mean one thing.
   */
  function toggleRepeat() {
    repeat = !repeat
    if (!repeat) return
    if (playing) play()
    else if (at >= finishAt - 1e-3) {
      at = 0
      play()
    }
  }

  /**
   * Travel to `target` at the animation's own speed.
   *
   * A step is a piece of the run, not a slide: cutting to it would skip the
   * qubits moving, which is the thing being shown.
   */
  function playTo(target: number) {
    halt()
    playing = false
    const from = at
    const seconds = Math.abs(target - from)
    if (seconds < 1e-3) {
      at = target
      return
    }
    let began: number | null = null
    const tick = (now: number) => {
      began ??= now
      const u = Math.min(1, (now - began) / (seconds * 1000))
      at = from + (target - from) * u
      frame = u < 1 ? requestAnimationFrame(tick) : 0
    }
    frame = requestAnimationFrame(tick)
  }

  /** The source the clock is currently running for. */
  let runFor = $state('')

  /**
   * Start a new diagram's animation from its own beginning.
   *
   * A position part-way through one run means nothing in another. The guard is
   * on the *source* rather than on the effect firing: `animation` is a fresh
   * object whenever the drawing is rebuilt, so this effect re-runs far more
   * often than the diagram actually changes, and restarting each time would
   * hold the clock at nought — running, but never getting anywhere.
   *
   * `untrack` for the body as well, since `play()` reads `at` to know where to
   * run on from, and depending on the clock it starts is the same trap again.
   */
  $effect(() => {
    const key = result.ok && result.animation ? source : ''
    if (key === runFor) return
    untrack(() => {
      runFor = key
      halt()
      at = 0
      repeat = result.ok ? (result.animation?.loop ?? true) : true
      playing = !!key
      if (key) play()
    })
  })

  $effect(() => halt)

  // A different diagram is a different question.
  $effect(() => {
    if (source === answersFor) return
    untrack(() => {
      answersFor = source
      answers = false
    })
  })

  const hasAnswer = $derived(result.ok ? !!result.hasAnswer : false)

  /** How many layers there are to step through; 0 when there is nothing to. */
  const layerCount = $derived(result.ok ? (result.layers ?? 0) : 0)
  const dirac = $derived(result.ok ? result.dirac : undefined)

  /**
   * Stepping only makes sense on a still circuit with gates in it, and an
   * animation is already a way of walking one. Rather than leaving a control
   * that does nothing, the row goes away — and the position resets, so the next
   * circuit does not open part-way through.
   */
  const canStep = $derived(layerCount > 0 && !animation)
  $effect(() => {
    if (!canStep) {
      stepOn = false
      stepAt = 0
    } else if (stepAt > layerCount) {
      stepAt = layerCount
    }
  })

  /** What the slider is pointing at, in words. */
  const stepLabelFor = $derived.by(() => {
    if (stepAt === 0) return 'before any gate'
    if (stepAt >= layerCount) return 'after the last gate'
    return `after ${stepAt} of ${layerCount}`
  })


  /** The step at or before `at`, so stepping resumes from where a scrub left off. */
  const stepNow = $derived.by(() => {
    const marks = animation?.steps ?? []
    let found = 0
    marks.forEach((step, i) => {
      if (at >= step.t - 1e-6) found = i
    })
    return found
  })

  /**
   * Pull a scrubbed value onto a nearby keyframe.
   *
   * The marks under the slider are the moments worth landing on, so the slider
   * should catch on them rather than merely point at them. The tolerance is a
   * fraction of the whole run, so it stays the same distance under the thumb
   * whatever the circuit's length.
   */
  function snap(value: number): number {
    const marks = animation?.steps ?? []
    const reach = (animation?.duration ?? 0) * 0.02
    const near = marks.find((step) => Math.abs(step.t - value) <= reach)
    return near ? near.t : value
  }

  function goToStep(delta: number) {
    const marks = animation?.steps ?? []
    if (!marks.length) return
    // Stepping back from between two marks returns to the one just passed
    // rather than skipping over it, so a step from mid-play goes where it looks.
    const adrift = at > marks[stepNow].t + 1e-6
    const from = delta < 0 && adrift ? stepNow + 1 : stepNow
    playTo(marks[Math.min(marks.length - 1, Math.max(0, from + delta))].t)
  }

  /** What the current step is showing, for the label beside the buttons. */
  const stepLabel = $derived.by(() => {
    const step = animation?.steps[stepNow]
    if (!step) return ''
    const gate = `gate ${step.layer + 1}`
    const Gate = `${gate[0].toUpperCase()}${gate.slice(1)}`
    return {
      before: `Before ${gate}`,
      at: `At ${gate}`,
      acting: `${Gate} acting`,
      landed: `Out of ${gate}`,
      after: `After ${gate}`,
      flatten: 'Brackets dropped',
      merge: 'Added up',
      reduce: 'Tidied',
    }[step.phase]
  })

  /* -- Does the diagram check out? --------------------------------------- */

  /**
   * The source a verdict was waved away for.
   *
   * Dismissal is deliberate rather than sticky: a figure that is wrong on
   * purpose stays dismissed while you look at it, and the verdict returns the
   * moment the diagram changes, because then it is about something else.
   */
  let dismissed = $state<string | null>(null)

  const check = $derived(result.ok ? result.check : undefined)
  // Nothing is being claimed while a gate is in mid-air, so there is nothing
  // to give a verdict on.
  const showCheck = $derived(!!check && dismissed !== source && !dragPreview)

  /**
   * The drag layer, which is no longer here.
   *
   * Everything between a finger and an edit — the press that becomes a drag,
   * the document frozen at pick-up, the slide of the gates that moved, the
   * figure held still while it grows — lives in `core/ui/board` now, so that
   * something other than this editor can put a circuit board on screen. What
   * is left is the four sentences it needs from a host: what is on screen,
   * where to draw a preview, what to write, and that the carry changed.
   */
  const board = createBoard({
    preview: () => previewEl,
    anchor: () => anchorEl,
    view: () =>
      result.ok ? { source, geometry: result.geometry, qubits: result.qubits } : null,
    onpreview: (edit) => (dragPreview = edit),
    oncommit: (edit) => (source = edit.source),
    onchange: (state) => (carry = state),
  })

  // The board has to be told when the drawing is about to be replaced and when
  // it has been, because it measures both sides of the swap. Svelte says so
  // precisely; another host would say it its own way.
  $effect.pre(() => {
    svg
    board.beforeRender()
  })
  $effect(() => {
    svg
    board.afterRender()
  })

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

  /**
   * Step a picker with the arrow keys instead of opening it.
   *
   * A native select opens its menu on an arrow press, so browsing a list means
   * open, move, commit, repeat. Flicking through figures one at a time is the
   * common thing to want here, so the arrows do that directly and the menu
   * stays a click — or Alt+Arrow, which is why that case is let through.
   */
  function stepPicker(
    event: KeyboardEvent,
    ids: string[],
    current: string,
    use: (id: string) => void,
  ) {
    if (event.altKey || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return
    // Stopped at either end rather than wrapping, and the menu is kept shut
    // even then: an arrow that sometimes opens it would be worse than one that
    // never does.
    event.preventDefault()
    if (!ids.length) return

    const at = ids.indexOf(current)
    const down = event.key === 'ArrowDown'
    // From the placeholder there is no position to move from, so an arrow
    // enters the list at the end it came from.
    if (at < 0) return use(down ? ids[0] : ids[ids.length - 1])

    const next = at + (down ? 1 : -1)
    if (next >= 0 && next < ids.length) use(ids[next])
  }

  const exampleIds = EXAMPLES.map((e) => e.id)

  /* -- The library ------------------------------------------------------- */

  // Nothing ships with the app; the dev server seeds from library.yaml when
  // there is one. Until then the picker has nothing to show, so it stays away.
  const libraryCount = $derived(
    libraryStore.doc.groups.reduce((n, g) => n + g.entries.length, 0),
  )

  /** Every entry in drawn order, so the arrows run straight across groups. */
  const libraryIds = $derived(
    libraryStore.doc.groups.flatMap((g) => g.entries.map((e) => e.id)),
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

  const pngDpi = $derived(Math.round(pngScale * 96))

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
            hint: `Onto the clipboard at ${pngDpi} dpi — paste into slides`,
            run: () => guard(() => copyPNG(stillSvg, pngScale), 'PNG copied'),
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
    copyItem('png-data', 'PNG data URL', `Self-contained, at ${pngDpi} dpi`, () =>
      pngDataUrl(svg, pngScale),
    ),
    copyItem('pdf-data', 'PDF data URL', 'Vector PDF — paste into the address bar', () =>
      pdfDataUrl(svg),
    ),
  ])

  // PDF leads: these figures are bound for problem sets and exams, which are
  // built in LaTeX.
  /**
   * Encode the animation and hand it over.
   *
   * Every frame is drawn and read back, so a long one takes a moment; the toast
   * says what is happening rather than leaving the button looking dead.
   */
  async function makeMovie(kind: 'gif' | 'mp4') {
    if (making) return
    making = true
    toast = `Drawing frames…`
    try {
      const opts = {
        theme,
        dark,
        shapeOrder,
        factorCalculated,
        exactOdds,
        keepSign,
        animateInside,
        scale: 2,
        background: true,
        fps: movieFps,
        metrics: {
          qubit: qubitSize,
          separator,
          cloudFluff,
          cloudPadX: cloudPad,
          cloudPadY: cloudPad * (11 / 14),
        },
        onProgress: (done: number) => {
          toast = `Drawing frames… ${Math.round(done * 100)}%`
        },
      }
      const blob = kind === 'gif' ? await toGif(source, opts) : await toMp4(source, opts)
      triggerDownload(blob, `${filename}.${kind}`)
      flash(`${kind.toUpperCase()} saved`)
    } catch (err) {
      flash((err as Error).message || 'Could not save it')
    } finally {
      making = false
    }
  }

  let making = $state(false)

  const saveItems = $derived<MenuItem[]>([
    {
      key: 'pdf',
      label: 'PDF',
      hint: 'Vector, page cropped to the figure — for LaTeX',
      run: () => guard(() => downloadPDF(stillSvg, filename), 'PDF saved'),
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
      hint: `Raster at ${pngDpi} dpi`,
      run: () => guard(() => downloadPNG(stillSvg, filename, pngScale), 'PNG saved'),
    },
    // Only where there is something moving to save. The SVG above plays on its
    // own; these are for everywhere that will not take one.
    ...(animation
      ? [
          {
            key: 'gif',
            label: 'Animated GIF',
            hint: `${movieFps} fps, loops by itself — plays anywhere`,
            run: () => makeMovie('gif'),
          },
          ...(canMakeMp4()
            ? [{
                key: 'mp4',
                label: 'MP4 video',
                hint: `${movieFps} fps, smaller and full colour`,
                run: () => makeMovie('mp4'),
              }]
            : []),
        ]
      : []),
  ])

  const linkItems = $derived<MenuItem[]>([
    copyItem('editor', 'Editor link', 'Reopens this diagram in the editor', () =>
      editorUrl(shareBase, { ...shareParams, scale: undefined }),
    ),
    copyItem('svg-page', 'SVG link', '?format=svg — the diagram alone', () =>
      imageUrl(shareBase, 'svg', { ...shareParams, scale: undefined }),
    ),
    copyItem('png-page', 'PNG link', `?format=png — the diagram alone, at ${pngDpi} dpi`, () =>
      imageUrl(shareBase, 'png', shareParams),
    ),
    copyItem('pdf-page', 'PDF link', '?format=pdf — opens in the browser’s PDF viewer', () =>
      imageUrl(shareBase, 'pdf', { ...shareParams, scale: undefined }),
    ),
  ])

  /** Right-click menu over the preview: the copy and save actions together. */
  /**
   * The angles a rotation is offered, and the one it already has.
   *
   * A short list of the ones anybody actually writes. The rest of the circle is
   * still available by typing, which is what the source box is for.
   */
  const ANGLES = [30, 45, 60, 90, 120, 180, 270, 360]

  /**
   * The rotation the menu was opened on, with the document it came from.
   *
   * Both, and `$state.raw`, for the same reason a drag freezes what it holds: a
   * gate is identified by *being* one of a document's gates, so it has to be
   * kept beside the parse it came out of — and plain `$state` would hand back a
   * proxy of it, which is not one of them.
   */
  let turning = $state.raw<{ doc: CircuitDoc; gate: Gate; angle: number } | null>(null)

  const contextItems = $derived<MenuItem[]>(
    turning
      ? ANGLES.map((angle) => ({
          key: `angle-${angle}`,
          label: `${angle}°`,
          hint:
            angle === turning!.angle
              ? 'the angle it has now'
              : angle % 90 === 0
                ? 'a right angle, so every amplitude stays whole'
                : 'leaves cosines, which a state cannot be drawn with',
          run: () => {
            const held = turning!
            const edit = setAngle(source, held.doc, held.gate, angle)
            if (edit) source = edit.source
          },
        }))
      : [
          ...copyItems,
          ...saveItems.map((i) => ({ ...i, key: `save-${i.key}`, label: `Save as ${i.label}` })),
        ],
  )

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

  const ZOOM_MIN = 0.25
  const ZOOM_MAX = 3

  /**
   * Scrolling over the drawing zooms it.
   *
   * Multiplicative, so a step feels the same size at 30% as at 300%, and the
   * default is passed through only when a modifier is held — otherwise a
   * trackpad swipe meant for the page would zoom instead.
   */
  const clampZoom = (v: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v))

  function onWheel(event: WheelEvent) {
    // A trackpad pinch arrives as a wheel with ctrl held, and the browser would
    // otherwise zoom the whole page rather than the drawing.
    if (event.metaKey || event.altKey) return
    event.preventDefault()
    const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015))
    zoom = clampZoom(zoom * factor)
  }

  /**
   * Pinching the drawing.
   *
   * Two fingers on the pane are a zoom, and one is not — so the pointers are
   * counted rather than the gesture being guessed at. `touch-action` on the
   * pane keeps one-finger scrolling with the browser and leaves the two-finger
   * case to us, which is the only part the browser would get wrong: its own
   * pinch zooms the page, and what is wanted is a bigger diagram.
   */
  const touching = new Map<number, { x: number; y: number }>()
  let pinch: { apart: number; zoom: number } | null = null

  const apart = () => {
    const [a, b] = [...touching.values()]
    return Math.hypot(a.x - b.x, a.y - b.y)
  }

  function trackTouch(event: PointerEvent) {
    if (event.pointerType === 'mouse') return
    touching.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (touching.size === 2) {
      // A second finger turns a drag into a zoom: nobody places a gate with two.
      board.destroy()
      pinch = { apart: apart(), zoom }
    }
  }

  function onPinchMove(event: PointerEvent) {
    if (!touching.has(event.pointerId)) return
    touching.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (!pinch || touching.size !== 2) return
    event.preventDefault()
    zoom = clampZoom((pinch.zoom * apart()) / pinch.apart)
  }

  function endTouch(event: PointerEvent) {
    touching.delete(event.pointerId)
    if (touching.size < 2) pinch = null
  }

  let menu = $state<{ x: number; y: number } | null>(null)

  function openContextMenu(event: MouseEvent) {
    event.preventDefault()

    // A right-click on a rotation is about that rotation; anywhere else it is
    // about the drawing as a whole.
    turning = null
    const svg = previewEl?.querySelector('svg') as SVGSVGElement | null
    const screen = svg?.getScreenCTM()
    if (svg && screen && result.ok && result.geometry) {
      try {
        const doc = parseCircuit(source)
        const at = new DOMPoint(event.clientX, event.clientY).matrixTransform(screen.inverse())
        const gate = gateAt(doc, result.geometry, at)
        if (gate?.kind === 'single' && gate.angle !== undefined) {
          turning = { doc, gate, angle: gate.angle }
        }
      } catch {
        // An unparseable source has no gate to have clicked on.
      }
    }

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

    <div class="ml-auto flex items-center gap-1.5">
      <button
        type="button"
        onclick={() => show('syntax')}
        aria-label="Syntax reference"
        aria-pressed={panel === 'syntax'}
        class="flex items-center gap-1.5 rounded border px-2 py-1 text-xs transition-colors
               {panel === 'syntax'
          ? 'border-slate-800 bg-slate-800 text-white'
          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}"
      >
        <Icon name="help" />
        Syntax
      </button>

      <button
        type="button"
        onclick={() => show('settings')}
        aria-label="Settings"
        aria-pressed={panel === 'settings'}
        class="flex items-center gap-1.5 rounded border px-2 py-1 text-xs transition-colors
               {panel === 'settings'
          ? 'border-slate-800 bg-slate-800 text-white'
          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}"
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
    </div>

  </header>

  <!--
    Stacked on a narrow screen, side by side once there is room. Stacked, the
    editor takes only the height it needs and the drawing gets the rest — with
    the reference hidden there is nothing else competing for the column, so
    handing the leftover space to the preview is the whole point.
  -->
  <!--
    The drawer is a column of this row, not a sheet over it: opening one takes
    width from the editor and the drawing rather than hiding them. A phone has
    no width to give, so there the panel is the page while it is open — the
    header stays, and the same button puts it away.
  -->
  <div class="flex min-h-0 flex-1">
  <main
    style="--misty-pane: {paneWidth}px;"
    class="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] gap-0
           lg:grid-cols-[var(--misty-pane)_minmax(0,1fr)] lg:grid-rows-none
           {panel ? 'hidden sm:grid' : ''}"
  >
    <!-- Editor ------------------------------------------------------------ -->
    <!--
      A frame rather than one long scroll: the writing scrolls in the top of it
      and the palette takes whatever is left, so the gates stay in view however
      much source there is above them.
    -->
    <section
      class="flex max-h-[42vh] min-h-0 flex-col overflow-hidden border-slate-200
             lg:max-h-none lg:border-r"
    >
      <div class="flex min-h-0 flex-col gap-3 overflow-y-auto p-3 sm:p-4">

      <!--
        Side by side while the column is the whole page, so the two pickers cost
        one row's height rather than two and the drawing keeps the difference.
      -->
      <div class="grid gap-3 {libraryCount > 0 ? 'grid-cols-2' : 'grid-cols-1'} lg:grid-cols-1">
      <label class="flex flex-col gap-1">
        <span class="text-xs font-medium text-slate-500">Example</span>
        <select
          bind:value={examplePick}
          onchange={(e) => useExample((e.currentTarget as HTMLSelectElement).value)}
          onkeydown={(e) =>
            stepPicker(e, exampleIds, examplePick, (id) => {
              examplePick = id
              useExample(id)
            })}
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
            onkeydown={(e) =>
              stepPicker(e, libraryIds, libraryPick, (id) => {
                libraryPick = id
                useLibrary(id)
              })}
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
      </div>

      {#if libraryNote}
        <p class="rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-500">
          {libraryNote}
        </p>
      {/if}

      <!--
        Over the source rather than under it: what a figure is called and
        whether it is in the library belong with the writing of it. No label —
        a text box with "Untitled" in it beside a Save button says what it is.
      -->
      <div class="flex shrink-0 items-center gap-2 text-xs">
        <input
          bind:value={name}
          placeholder="Untitled"
          spellcheck="false"
          aria-label="Diagram name"
          class="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-slate-800
                 focus:border-slate-500 focus:outline-none"
        />
        <button
          type="button"
          onclick={saveToLibrary}
          disabled={!name.trim()}
          title={savedEntry
            ? 'Replace this diagram in the library'
            : 'Add this diagram to the library'}
          class="shrink-0 rounded border border-slate-300 bg-white px-2 py-1 text-slate-700
                 hover:bg-slate-50 disabled:opacity-40"
        >
          <!-- Short, because the tooltip carries the sentence and the button
               sits beside the name it is acting on. -->
          {savedEntry ? 'Update' : 'Add'}
        </button>
      </div>

      <!--
        `shrink-0`: the box has a minimum height, and a flex item that is
        allowed to shrink below its content would let the reference below it
        ride up over the box in a short window. The column scrolls instead.
      -->
      <label class="flex shrink-0 flex-col gap-1">
        <span class="text-xs font-medium text-slate-500">Source</span>
        <textarea
          bind:value={source}
          spellcheck="false"
          rows="5"
          class="field-sizing-content min-h-24 w-full resize-y rounded border
                 border-slate-300 bg-white p-2.5 font-mono text-sm leading-relaxed
                 focus:border-slate-500 focus:outline-none lg:min-h-40"
        ></textarea>
      </label>

      {#if !result.ok}
        <p
          class="rounded border border-red-200 bg-red-50 px-2.5 py-2 font-mono text-xs text-red-700"
        >
          {result.message}
        </p>
      {/if}


      </div>

      <!--
        The space the reference used to take, given to the gates themselves.
        Only where there is room for it: on a phone the column is capped and
        every row of it competes with the drawing. `min-h-32` so a very tall
        source cannot squeeze it away entirely — past that the writing scrolls
        instead.
      -->
      <div class="hidden min-h-32 flex-1 flex-col px-3 pb-3 sm:px-4 sm:pb-4 lg:flex">
        <GatePalette {theme} {dark} onpick={board.carryNew} />
      </div>
    </section>

    <!-- Preview ----------------------------------------------------------- -->
    <section class="relative flex min-h-0 flex-col">
      <!--
        The divider, on this side of the line because the column opposite
        scrolls and would clip anything hanging off its edge. Wide enough to
        catch a pointer without being wide enough to see, and only where the
        columns are side by side — stacked, there is no width to trade.
      -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        onpointerdown={resizePane}
        class="absolute top-0 left-0 z-20 hidden h-full w-2 -translate-x-1/2 cursor-col-resize
               hover:bg-slate-300/60 lg:block"
      ></div>
      <div
        class="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2 text-xs"
      >
        <!--
          At the near end of the bar, away from the file actions: it says how
          the drawing is being looked at, not what is being done to it. Only
          where there is room — on a phone a slider across the bar costs more
          than the drawing can spare, and Settings has one. Pinch and scroll
          work everywhere regardless.
        -->
        <div class="hidden items-center gap-1.5 lg:flex">
          <button
            type="button"
            onclick={() => (zoom = 1)}
            disabled={zoom === 1}
            title="Back to 100%"
            class="rounded px-1 py-0.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800
                   disabled:hover:bg-transparent disabled:hover:text-slate-500"
          >
            Zoom
          </button>
          <input
            type="range"
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            step="0.05"
            bind:value={zoom}
            class="w-24"
            aria-label="Zoom"
          />
          <span class="w-9 font-mono text-slate-500">{Math.round(zoom * 100)}%</span>
        </div>

        {#if hasAnswer}
          <button
            type="button"
            onclick={() => (answers = !answers)}
            aria-pressed={answers}
            title={answers ? 'Hide the answer' : 'Show the answer'}
            class="flex shrink-0 items-center gap-1.5 rounded border px-2 py-1 transition-colors
                   {answers
              ? 'border-slate-800 bg-slate-800 text-white'
              : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}"
          >
            <Icon name="eye" />
            <!--
              Both labels occupy one grid cell, so the button is as wide as the
              longer of them and does not resize as it is pressed — a control
              that moves under the pointer invites a second, unmeant click.
            -->
            <span class="grid">
              <span aria-hidden="true" class="invisible col-start-1 row-start-1">Show answer</span>
              <span class="col-start-1 row-start-1 text-center">
                {answers ? 'Answer' : 'Show answer'}
              </span>
            </span>
          </button>
        {/if}

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

      <!--
        Stepping and the written state get contextual rows of the same kind as
        playback: on only when asked for, and immediately above the drawing they
        describe rather than buried in the settings panel.
      -->
      {#if stepOn && canStep}
        <div
          class="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-1.5 text-xs"
        >
          <button
            type="button"
            onclick={() => (stepAt = Math.max(0, stepAt - 1))}
            disabled={stepAt === 0}
            aria-label="Back a layer"
            class="rounded p-1 text-slate-600 hover:bg-slate-200 hover:text-slate-900
                   disabled:text-slate-300 disabled:hover:bg-transparent"
          >
            <Icon name="stepBack" class="h-4 w-4" />
          </button>
          <input
            type="range"
            min="0"
            max={layerCount}
            step="1"
            bind:value={stepAt}
            class="min-w-20 flex-1"
            aria-label="Step through the circuit"
          />
          <button
            type="button"
            onclick={() => (stepAt = Math.min(layerCount, stepAt + 1))}
            disabled={stepAt === layerCount}
            aria-label="On a layer"
            class="rounded p-1 text-slate-600 hover:bg-slate-200 hover:text-slate-900
                   disabled:text-slate-300 disabled:hover:bg-transparent"
          >
            <Icon name="stepNext" class="h-4 w-4" />
          </button>
          <span class="shrink-0 whitespace-nowrap text-slate-500">{stepLabelFor}</span>
        </div>
      {/if}

      {#if diracOn && dirac?.length}
        <!-- Selectable, and one click copies the lot: the point of writing it
             out is to take it somewhere else. -->
        <button
          type="button"
          onclick={() => guard(() => copyText(dirac.join('\n')), 'State copied')}
          title="Copy"
          class="block w-full select-text overflow-x-auto border-b border-slate-200 bg-slate-50
                 px-4 py-1.5 text-left text-sm whitespace-nowrap text-slate-700
                 hover:bg-slate-100"
        >
          {#each dirac as line, i (i)}
            <span class="mr-4 inline-block whitespace-nowrap">{line}</span>
          {/each}
        </button>
      {/if}

      <!--
        Playback gets a row of its own rather than a corner of the zoom bar:
        it is what you are doing while looking at an animation, not a setting,
        and it appears only when there is something to play.
      -->
      {#if animation}
        <div
          class="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-slate-50
                 px-4 py-1.5 text-xs"
        >
          <div class="flex items-center gap-1">
            <button
              type="button"
              onclick={() => {
                pause()
                at = 0
              }}
              disabled={at === 0}
              title="Back to the start"
              class="rounded p-1.5 text-slate-600 hover:bg-slate-200 hover:text-slate-900
                     disabled:text-slate-300 disabled:hover:bg-transparent"
            >
              <Icon name="rewind" class="h-5 w-5" />
            </button>
            <button
              type="button"
              onclick={() => goToStep(-1)}
              disabled={stepNow === 0}
              title="Previous step"
              class="rounded p-1.5 text-slate-600 hover:bg-slate-200 hover:text-slate-900
                     disabled:text-slate-300 disabled:hover:bg-transparent"
            >
              <Icon name="stepBack" class="h-5 w-5" />
            </button>
            <button
              type="button"
              onclick={() => (playing ? pause() : play())}
              title={playing ? 'Pause' : 'Play'}
              class="rounded p-1.5 text-slate-700 hover:bg-slate-200 hover:text-slate-900"
            >
              <Icon name={playing ? 'pause' : 'play'} class="h-6 w-6" />
            </button>
            <button
              type="button"
              onclick={() => goToStep(1)}
              disabled={stepNow === animation.steps.length - 1}
              title="Next step"
              class="rounded p-1.5 text-slate-600 hover:bg-slate-200 hover:text-slate-900
                     disabled:text-slate-300 disabled:hover:bg-transparent"
            >
              <Icon name="stepNext" class="h-5 w-5" />
            </button>
            <button
              type="button"
              onclick={toggleRepeat}
              aria-pressed={repeat}
              title={repeat ? 'Repeating — click to play once' : 'Play once — click to repeat'}
              class="ml-1 flex items-center gap-1 rounded border px-1.5 py-1 transition-colors
                     {repeat
                ? 'border-slate-800 bg-slate-800 text-white'
                : 'border-slate-300 bg-white text-slate-500 hover:border-slate-400'}"
            >
              <Icon name="repeat" class="h-4 w-4" />
              <span class="text-[11px]">{repeat ? 'Repeat' : 'Once'}</span>
            </button>
          </div>

          <input
            type="range"
            list="misty-keyframes"
            min="0"
            max={finishAt}
            step="0.01"
            value={at}
            oninput={(e) => {
              pause()
              at = snap(Number((e.currentTarget as HTMLInputElement).value))
            }}
            class="min-w-24 flex-1"
            aria-label="Scrub the animation"
          />
          <!--
            Ticks under the slider, one per step, drawn by the browser at the
            positions the thumb travels through. The values are rounded onto the
            slider's own grid: a tick off the grid is silently not drawn, which
            is why only the one at nought used to appear. Snapping still uses
            the exact time, the two differing by less than a hundredth of a
            second.
          -->
          <datalist id="misty-keyframes">
            {#each animation.steps as step, i (i)}
              <option value={step.t.toFixed(2)}></option>
            {/each}
          </datalist>

          <span class="w-40 shrink-0 whitespace-nowrap text-right text-slate-500">
            {stepLabel}
            <span class="font-mono text-slate-400">
              {stepNow + 1}/{animation.steps.length}
            </span>
          </span>
        </div>
      {/if}

      <!--
        The verdict reads across the top of the drawing rather than sitting in
        the toolbar: it is about what is below it, and given a whole line it can
        say *what* did not check out instead of hiding that in a tooltip.

        Subtle by design even so — a verdict, not an error. A figure that does
        not check out still draws, because drawing a wrong one is sometimes the
        exercise, which is also why it can be waved away.
      -->
      {#if showCheck && check}
        <div
          role="status"
          class="flex items-center gap-2 border-b px-4 py-1.5 text-xs
                 {check.ok
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
            : 'border-red-200 bg-red-50 text-red-800'}"
        >
          <svg viewBox="0 0 20 20" class="h-3.5 w-3.5 shrink-0" aria-hidden="true">
            {#if check.ok}
              <path
                d="M4.5 10.5l3.5 3.5 7.5-8"
                fill="none"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            {:else}
              <path
                d="M5 5l10 10M15 5L5 15"
                fill="none"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
              />
            {/if}
          </svg>
          <span class="shrink-0 font-medium">
            {check.ok ? 'Checks out' : "Doesn't check out"}
          </span>
          <span class="min-w-0 flex-1 truncate opacity-80" title={check.problems.join('\n')}>
            {check.ok
              ? `${check.checked} claim${check.checked === 1 ? '' : 's'} in this diagram`
              : check.problems.join(' · ')}
          </span>
          <button
            type="button"
            onclick={() => (dismissed = source)}
            aria-label="Dismiss the check"
            class="-mr-1 shrink-0 rounded px-1 opacity-60 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      {/if}

      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div
        role="img"
        aria-label="Rendered diagram. Right-click for copy and save options."
        oncontextmenu={openContextMenu}
        onwheel={onWheel}
        bind:this={previewEl}
        onpointerdown={(e) => {
          trackTouch(e)
          if (!pinch) board.press(e)
        }}
        onpointermove={onPinchMove}
        onpointerup={endTouch}
        onpointercancel={endTouch}
        title="Scroll to zoom, or pinch"
        style="touch-action: pan-x pan-y;"
        class="flex min-h-0 flex-1 items-center justify-center overflow-auto p-8
               {dark ? 'checkerboard-dark' : 'checkerboard'}
               {carry.carrying ? 'ring-2 ring-slate-400 ring-inset' : ''}"
      >
        <div
          data-preview
          style="transform: scale({zoom}); transform-origin: center;
                 --misty-play: paused; --misty-at: -{at}s;"
        >
          <!-- A wrapper of its own, so the drag can hold the drawing still
               without the template overwriting the transform each render. -->
          <div bind:this={anchorEl} style="transform-origin: center;">
            <!-- Generated by our own renderer; all values are escaped in svg.ts. -->
            {@html svg}
          </div>
        </div>
      </div>
    </section>
  </main>

  <SettingsPanel
    open={panel === 'settings'}
    {theme}
    {dark}
    {pngScale}
    {separator}
    {cloudFluff}
    {cloudPad}
    {qubitSize}
    {factorCalculated}
    {exactOdds}
    {keepSign}
    {animateInside}
    {movieFps}
    {checking}
    {shapeOrder}
    {canStep}
    {stepOn}
    {diracOn}
    {zoom}
    zoomMin={ZOOM_MIN}
    zoomMax={ZOOM_MAX}
    onzoomchange={(v: number) => (zoom = v)}
    hasDirac={!!dirac?.length}
    onstepchange={(v: boolean) => (stepOn = v)}
    ondiracchange={(v: boolean) => (diracOn = v)}
    onclose={() => (panel = null)}
    oneditlibrary={() => {
      panel = null
      libraryOpen = true
    }}
    onthemechange={(t) => (theme = t)}
    ondarkchange={(d) => (dark = d)}
    onpngscalechange={(s) => (pngScale = s)}
    onseparatorchange={(v) => (separator = v)}
    oncloudfluffchange={(v) => (cloudFluff = v)}
    oncloudpadchange={(v) => (cloudPad = v)}
    onqubitsizechange={(v) => (qubitSize = v)}
    onfactorchange={(v) => (factorCalculated = v)}
    onexactoddschange={(v) => (exactOdds = v)}
    onkeepsignchange={(v) => (keepSign = v)}
    oninsidechange={(v) => (animateInside = v)}
    onfpschange={(v) => (movieFps = v)}
    oncheckingchange={(v) => (checking = v)}
    onshapeorderchange={(o) => (shapeOrder = o)}
  />

  {#if panel === 'syntax'}
    <SidePanel title="Syntax" onclose={() => (panel = null)}>
      <SyntaxHelp {theme} {dark} onpick={board.carryNew} />
    </SidePanel>
  {/if}
  </div>

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

  {#if libraryOpen}
    <LibraryEditor onclose={() => (libraryOpen = false)} />
  {/if}

  {#if carry.carrying && carry.at}
    <!--
      What you are holding, drawn under the pointer. Transparent to the pointer
      itself, or it would be the thing every move landed on.
    -->
    <div
      class="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-1/2 rounded border
             px-2 py-1 font-mono text-xs shadow-lg
             {carry.removing
        ? 'border-red-400 bg-red-50/95 text-red-700 line-through'
        : 'border-slate-400 bg-white/90 text-slate-700'}"
      style="left: {carry.at.x}px; top: {carry.at.y}px;"
    >
      {carry.carrying.from === 'palette'
        ? carry.carrying.gate.head
        : asDroppable(carry.carrying.gate).head}
    </div>
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
