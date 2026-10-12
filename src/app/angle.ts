/**
 * An angle in degrees, said the way the mathematics says it.
 *
 * The source holds degrees, because that is what anybody types and what the
 * gate is drawn with. But nobody speaks of a rotation by two hundred and
 * seventy degrees; they say 3π/2, and a dial for choosing one should be
 * labelled in the language of the thing being chosen.
 *
 * Only twelfths of a turn get a fraction. Those cover every angle anyone names
 * — the quarters, the thirds, the sixths, the eighths of π that appear in a
 * course — and beyond them a fraction would be arithmetic rather than a label,
 * so the number of radians is given instead and rounded to something readable.
 */
export function piLabel(degrees: number): string {
  const twelfths = (degrees * 12) / 180
  if (Math.abs(twelfths - Math.round(twelfths)) > 1e-9) {
    return `${((degrees / 180) * Math.PI).toFixed(2)} rad`
  }
  const n = Math.round(twelfths)
  if (n === 0) return '0'
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)
  const by = gcd(Math.abs(n), 12)
  const num = n / by
  const den = 12 / by
  // `1π` and `π/1` both read as a mistake; `π` and `2π` are how it is written.
  return `${num === 1 ? '' : num === -1 ? '-' : num}π${den === 1 ? '' : `/${den}`}`
}

/**
 * An angle as typed, in degrees, or null when it is not one.
 *
 * Read either way it is said: as degrees (`30`, `22.5°`, `-90`), or as a
 * multiple of π (`π/4`, `3π/2`, `-pi/3`, `2pi`), since that is how the dial is
 * labelled and how a problem set writes it. Rounded to a few places, because
 * `3π/7` is a long decimal and the source only has to hold it, not recite it.
 */
export function readAngle(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, '').replace(/pi/g, 'π')
  const round = (x: number) => Math.round(x * 1e4) / 1e4
  const degrees = /^([-+]?(?:\d+\.?\d*|\.\d+))(?:°|deg)?$/.exec(t)
  if (degrees) return round(Number(degrees[1]))
  const pi = /^([-+]?)(\d+\.?\d*|\.\d+)?\*?π(?:\/(\d+\.?\d*))?$/.exec(t)
  if (pi) {
    const sign = pi[1] === '-' ? -1 : 1
    const times = pi[2] === undefined ? 1 : Number(pi[2])
    const over = pi[3] === undefined ? 1 : Number(pi[3])
    if (!over) return null
    return round((sign * times * 180) / over)
  }
  return null
}
