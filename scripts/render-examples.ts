/**
 * Dev utility: render every example to an SVG file for eyeballing.
 *
 *   npx vite-node scripts/render-examples.ts [outDir] [theme]
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { EXAMPLES } from '../src/lib/examples'
import { render } from '../src/lib/index'
import type { ThemeId } from '../src/lib/render/theme'

const outDir = process.argv[2] ?? 'out'
const theme = (process.argv[3] ?? 'solid') as ThemeId

mkdirSync(outDir, { recursive: true })

let failures = 0
for (const ex of EXAMPLES) {
  try {
    const { svg, kind, width, height } = render(ex.source, { theme, background: true })
    writeFileSync(join(outDir, `${ex.id}.svg`), svg)
    console.log(`ok   ${ex.id.padEnd(18)} ${kind.padEnd(8)} ${Math.round(width)}x${Math.round(height)}`)
  } catch (err) {
    failures++
    console.error(`FAIL ${ex.id.padEnd(18)} ${(err as Error).message}`)
  }
}

if (failures) {
  console.error(`\n${failures} example(s) failed`)
  process.exit(1)
}
