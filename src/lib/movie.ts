/**
 * Turning an animation into a file that plays outside a browser.
 *
 * The drawing's own animation is CSS, which is exactly the right thing for a
 * page and useless to an encoder: it cannot be seeked from outside, so there is
 * no way to ask it what it looks like at a given moment. `renderFrames` samples
 * the timeline instead — the same timeline the CSS is generated from — and hands
 * back ordinary still drawings. This rasterises those and encodes them.
 *
 * GIF and MP4 are different trades. A GIF plays anywhere, loops by itself, and
 * quantises to 256 colours — which costs nothing on flat line art and shows as
 * banding on the isometric theme's gradients. MP4 keeps the colour and is far
 * smaller, but needs WebCodecs, so it is offered only where that exists.
 */

import { GIFEncoder, quantize, applyPalette } from 'gifenc'
import { Muxer, ArrayBufferTarget } from 'mp4-muxer'
import { renderFrames, type RenderOptions } from './index'

export interface MovieOptions extends RenderOptions {
  /** Frames a second. More is smoother and bigger; 30 reads well. */
  fps?: number
  /** Multiplier on the drawing's own size. */
  scale?: number
  /** Called with 0..1 as frames are drawn, for a progress indicator. */
  onProgress?: (done: number) => void
}

/** H.264 will not take an odd width or height, and a GIF is happier even too. */
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)

/**
 * Draw every frame onto one canvas and read the pixels back.
 *
 * One canvas rather than one per frame: the encoders want raw pixels in order,
 * and going through a PNG blob each time would be slower for no gain.
 */
async function rasterise(
  source: string,
  opts: MovieOptions,
): Promise<{ frames: ImageData[]; width: number; height: number; fps: number; loop: boolean }> {
  const shot = renderFrames(source, opts)
  const width = even(shot.width)
  const height = even(shot.height)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('canvas is unavailable')

  const frames: ImageData[] = []
  for (const [i, frame] of shot.frames.entries()) {
    const blob = new Blob([frame.svg], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    try {
      const img = new Image()
      img.decoding = 'sync'
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('could not rasterise a frame'))
        img.src = url
      })
      // Painted over white: a transparent frame would show whatever the last
      // one left behind, and neither format promises to clear between frames.
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, width, height)
      ctx.drawImage(img, 0, 0, width, height)
      frames.push(ctx.getImageData(0, 0, width, height))
    } finally {
      URL.revokeObjectURL(url)
    }
    opts.onProgress?.((i + 1) / shot.frames.length)
  }

  return { frames, width, height, fps: shot.fps, loop: shot.loop }
}

/**
 * A frame rate a GIF can actually hold.
 *
 * Its frame delay is in hundredths of a second and nothing finer, so most rates
 * are not expressible. Sampling at the nearest one that is — rather than
 * sampling at the asked-for rate and rounding the delay afterwards — is what
 * keeps the file the same length as the drawing it came from.
 */
function gifRate(fps: number): { fps: number; delayMs: number } {
  const cs = Math.max(2, Math.round(100 / fps))
  return { fps: 100 / cs, delayMs: cs * 10 }
}

/** The animation as a GIF. */
export async function toGif(source: string, opts: MovieOptions = {}): Promise<Blob> {
  const rate = gifRate(opts.fps ?? 30)
  const { frames, width, height, loop } = await rasterise(source, { ...opts, fps: rate.fps })
  const gif = GIFEncoder()
  const delay = rate.delayMs

  frames.forEach((frame, i) => {
    const palette = quantize(frame.data, 256)
    const index = applyPalette(frame.data, palette)
    // Whether it repeats is settled on the first frame and nowhere else: 0 is
    // forever, -1 is once. `loop=off` in the source has to reach the file, or a
    // figure meant to be read once would sit there restarting.
    gif.writeFrame(index, width, height, {
      palette,
      delay,
      ...(i === 0 ? { repeat: loop ? 0 : -1 } : {}),
    })
  })
  gif.finish()
  // Copied into a plain buffer: gifenc hands back a view whose backing store
  // TypeScript will not promise is an ArrayBuffer, which Blob insists on.
  const bytes = gif.bytes()
  return new Blob([new Uint8Array(bytes).buffer], { type: 'image/gif' })
}

/** Whether this browser can encode video at all. */
export const canMakeMp4 = (): boolean =>
  typeof VideoEncoder === 'function' && typeof VideoFrame === 'function'

/** The animation as an MP4, where the browser can encode one. */
export async function toMp4(source: string, opts: MovieOptions = {}): Promise<Blob> {
  if (!canMakeMp4()) {
    throw new Error('this browser cannot encode video — save a GIF instead')
  }
  const { frames, width, height, fps } = await rasterise(source, opts)

  const target = new ArrayBufferTarget()
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width, height },
    fastStart: 'in-memory',
  })

  // The encoder reports trouble on a callback of its own, and throwing from
  // there reaches nobody: the awaited flush simply never settles, which looks
  // exactly like a hang. Kept here instead, and checked at every step.
  let failed: Error | null = null
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => {
      failed = err instanceof Error ? err : new Error(String(err))
    },
  })
  const stop = () => {
    if (failed) throw new Error(`the video encoder gave up: ${(failed as Error).message}`)
  }
  encoder.configure({
    // Baseline profile: the widest thing that plays without asking questions.
    codec: 'avc1.42001f',
    width,
    height,
    framerate: fps,
    bitrate: Math.round(width * height * fps * 0.15),
  })

  // Every frame is handed over and `flush` waits for the lot. Metering it
  // against `encodeQueueSize` was tried and taken out again: the wait for a
  // `dequeue` event is not answered everywhere, and a queue that never drains
  // is a hang, where handing the encoder more work than it likes is at worst
  // some memory. An animation is seconds long, not minutes.
  const perFrame = 1e6 / fps
  const everySecond = Math.max(1, Math.round(fps))

  for (const [i, frame] of frames.entries()) {
    stop()
    const bitmap = new VideoFrame(frame.data, {
      format: 'RGBA',
      codedWidth: width,
      codedHeight: height,
      timestamp: i * perFrame,
      duration: perFrame,
    })
    // A keyframe every second, so seeking and scrubbing behave.
    encoder.encode(bitmap, { keyFrame: i % everySecond === 0 })
    bitmap.close()
  }

  // Bounded, because an encoder that stops answering would otherwise leave the
  // caller waiting for ever with nothing to show and nothing to say. Generous
  // enough that no real encode reaches it.
  await Promise.race([
    encoder.flush(),
    new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error('the video encoder did not finish — save a GIF instead')),
        20_000 + frames.length * 500,
      )
    }),
  ])
  stop()
  encoder.close()
  muxer.finalize()
  return new Blob([target.buffer], { type: 'video/mp4' })
}
