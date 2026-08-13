/**
 * The line between the library and the editor, as something that fails.
 *
 * `src/core` is the drawing library and `src/app` is the editor built on it.
 * The whole value of the split is that the dependency runs one way, and a
 * boundary that is merely observed decays — one convenient import at a time,
 * each of them reasonable on the day. So this runs in `npm run check`.
 *
 * Two things count as a crossing: reaching into `src/app`, and reaching for a
 * virtual module, since those are supplied by the editor's Vite config and a
 * library that needs a build step to resolve its imports is not portable.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const CROSSINGS = [
  [/(?:from|import\()\s*'[^']*\.\.\/app\//, 'imports from src/app'],
  [/(?:from|import\()\s*'virtual:/, 'imports a virtual module'],
]

const files = []
const walk = (dir) =>
  readdirSync(dir).forEach((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) walk(path)
    else if (/\.(ts|svelte)$/.test(path)) files.push(path)
  })
walk('src/core')

const found = []
for (const path of files) {
  readFileSync(path, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      for (const [pattern, what] of CROSSINGS) {
        if (pattern.test(line)) found.push(`${path}:${i + 1}  ${what}\n    ${line.trim()}`)
      }
    })
}

// The other half of the promise: the library is meant to be installable with
// nothing behind it. All five of this repo's third-party packages belong to
// the editor, which bundles them at build time, so none of them is a runtime
// dependency of anything a consumer imports.
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const deps = Object.keys(pkg.dependencies ?? {})
if (deps.length) {
  found.push(
    `package.json declares ${deps.length} runtime dependenc${deps.length === 1 ? 'y' : 'ies'}` +
      ` — ${deps.join(', ')}\n    a consumer installing this package would inherit them`,
  )
}

if (found.length) {
  console.error(`the library boundary is broken. ${found.length} crossing(s):\n`)
  console.error(found.join('\n'))
  process.exit(1)
}
console.log(
  `boundary holds: ${files.length} files in src/core, none reach outside it,` +
    ' and nothing a consumer installs brings a dependency with it',
)
