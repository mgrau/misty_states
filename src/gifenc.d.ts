/**
 * `gifenc` ships no types. Only the three functions used here are declared,
 * which is enough to keep the encoder honest at the call site.
 */
declare module 'gifenc' {
  export function quantize(rgba: Uint8ClampedArray | Uint8Array, colours: number): number[][]
  export function applyPalette(
    rgba: Uint8ClampedArray | Uint8Array,
    palette: number[][],
  ): Uint8Array
  export function GIFEncoder(): {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      opts: { palette: number[][]; delay: number; repeat?: number },
    ): void
    finish(): void
    bytes(): Uint8Array
  }
}
