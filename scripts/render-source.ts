/**
 * Dev utility: render one source string to an SVG file.
 *
 *   npx vite-node scripts/render-source.ts out.svg 'qubits 2\nH 1' [theme]
 */

import { writeFileSync } from 'node:fs'
import { render } from '../src/lib/index'
import type { ThemeId } from '../src/lib/render/theme'

const [out, raw, theme = 'solid'] = process.argv.slice(2)
if (!out || !raw) {
  console.error("usage: render-source.ts <out.svg> <source> [theme]")
  process.exit(1)
}

// Allow \n in a shell argument to mean a real newline.
const source = raw.replace(/\\n/g, '\n')
const result = render(source, { theme: theme as ThemeId, background: true })
writeFileSync(out, result.svg)
console.log(`${out}  ${result.kind}  ${Math.round(result.width)}x${Math.round(result.height)}`)
