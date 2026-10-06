/**
 * The two buttons in the corner of the drawing: Calculate and Animate.
 *
 * Both are edits to the source, written the way a person would type them, so
 * what the button did is there to read afterwards and ⌘Z takes it back like
 * any other change. Nothing here draws; the drawing follows the source.
 */

/** The statement a line holds, without its comment or surrounding space. */
function statement(line: string): string {
  const hash = line.indexOf('#')
  return (hash === -1 ? line : line.slice(0, hash)).trim()
}

/** Where the last line that says anything is, or -1 if none does. */
function lastStatementIndex(lines: string[]): number {
  for (let i = lines.length - 1; i >= 0; i--) if (statement(lines[i])) return i
  return -1
}

const CALCULATED = /^(?:(?:out|window)\s+)?calc(?:ulate)?$/

/**
 * Whether the circuit already ends on its worked-out state.
 *
 * A second `calculate` straight after the first would draw the same state
 * twice, so the button has nothing to add.
 */
export function endsCalculated(source: string): boolean {
  const lines = source.split('\n')
  const i = lastStatementIndex(lines)
  return i !== -1 && CALCULATED.test(statement(lines[i]))
}

/**
 * The source with its final state worked out.
 *
 * Ordinarily that is a `calculate` on a line of its own at the end. Where the
 * circuit already ends in an `out` line — `out ??`, a blank for a student —
 * a `calculate` after it would draw the answer *above* the blank, so the
 * blank itself becomes `out calculate` instead: the answer goes where the
 * question was.
 */
export function withCalculate(source: string): string {
  if (endsCalculated(source)) return source
  const lines = source.split('\n')
  const i = lastStatementIndex(lines)
  if (i !== -1 && /^out\b/.test(statement(lines[i]))) {
    const indent = lines[i].match(/^\s*/)![0]
    lines[i] = `${indent}out calculate`
    return lines.join('\n')
  }
  return `${source.replace(/\s+$/, '')}\ncalculate`
}

const ANIMATE = /^animate$/

/** Whether the source asks to be animated. */
export function isAnimated(source: string): boolean {
  return source.split('\n').some((line) => ANIMATE.test(statement(line)))
}

/** The source with `animate` added at the end, or taken out if it is there. */
export function toggleAnimate(source: string): string {
  if (!isAnimated(source)) return `${source.replace(/\s+$/, '')}\nanimate`
  return source
    .split('\n')
    .filter((line) => !ANIMATE.test(statement(line)))
    .join('\n')
    .replace(/\s+$/, '')
}
