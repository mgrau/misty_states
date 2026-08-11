/**
 * Test environment shims.
 *
 * Node 26 exposes a `localStorage` global that is inert unless the runtime is
 * started with --localstorage-file, and it shadows jsdom's. Browsers always
 * provide a working one, so install an in-memory equivalent to match.
 */

class MemoryStorage implements Storage {
  #map = new Map<string, string>()

  get length(): number {
    return this.#map.size
  }
  clear(): void {
    this.#map.clear()
  }
  getItem(key: string): string | null {
    return this.#map.get(key) ?? null
  }
  key(index: number): string | null {
    return [...this.#map.keys()][index] ?? null
  }
  removeItem(key: string): void {
    this.#map.delete(key)
  }
  setItem(key: string, value: string): void {
    this.#map.set(key, String(value))
  }
}

function install(target: object) {
  Object.defineProperty(target, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  })
}

if (typeof window !== 'undefined' && !window.localStorage) install(window)
if (!(globalThis as { localStorage?: Storage }).localStorage) install(globalThis)

/**
 * jsdom implements no SVG layout, so `getBBox` is missing. svg2pdf calls it
 * when placing text.
 *
 * This stub only lets the PDF code path run end to end so its wiring and
 * cleanup can be tested; it does NOT reproduce real text metrics, so nothing
 * should assert on glyph positions in a PDF produced under jsdom.
 */
/**
 * jsdom has no blob URL support, which every download path goes through.
 * The stub hands back a unique fake URL and forgets it again.
 */
if (typeof URL !== 'undefined' && !URL.createObjectURL) {
  let n = 0
  URL.createObjectURL = () => `blob:misty/${++n}`
  URL.revokeObjectURL = () => {}
}

/**
 * jsdom implements no Web Animations API, which `animate:flip` relies on.
 *
 * The stub records nothing and finishes immediately — enough for the reorder
 * logic under test to run. It does NOT verify that anything actually animates;
 * that needs a real browser.
 */
if (typeof Element !== 'undefined' && !Element.prototype.animate) {
  Element.prototype.animate = function () {
    const animation = {
      onfinish: null as (() => void) | null,
      cancel() {},
      finish() {},
      play() {},
      pause() {},
      currentTime: 0,
      startTime: 0,
      effect: null,
    }
    // After the caller has had a chance to attach onfinish.
    queueMicrotask(() => animation.onfinish?.())
    return animation as unknown as Animation
  }
}

/**
 * `animate:flip` asks a row for its running animations before replacing them,
 * which happens whenever a keyed list loses a member. jsdom has no animations
 * to report, and saying so is enough.
 */
if (typeof Element !== 'undefined' && !Element.prototype.getAnimations) {
  Element.prototype.getAnimations = () => []
}

if (typeof SVGElement !== 'undefined') {
  const proto = SVGElement.prototype as SVGElement & { getBBox?: () => DOMRect }
  if (!proto.getBBox) {
    proto.getBBox = () => ({ x: 0, y: 0, width: 0, height: 0 }) as DOMRect
  }
}

/**
 * jsdom only provides `requestAnimationFrame` when asked to pretend to be
 * visual, which this environment does not. Playback drives its clock from it,
 * so without a stand-in the animation silently never advances — and a test that
 * cannot tell "not running" from "not implemented" is worth less than none.
 *
 * The stamp is taken from the same clock the callback would see in a browser,
 * which is the point: mixing two clocks is what broke this once already.
 */
if (typeof globalThis.requestAnimationFrame !== 'function') {
  let next = 1
  const pending = new Map<number, ReturnType<typeof setTimeout>>()
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    const id = next++
    pending.set(id, setTimeout(() => {
      pending.delete(id)
      cb(performance.now())
    }, 16))
    return id
  }
  globalThis.cancelAnimationFrame = (id: number): void => {
    const timer = pending.get(id)
    if (timer !== undefined) clearTimeout(timer)
    pending.delete(id)
  }
}
