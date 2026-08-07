import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'

const LIBRARY_FILE = resolve(import.meta.dirname, 'library.yaml')

/**
 * Supplies `library.yaml` from the project root to the app.
 *
 * The file is deliberately not committed — it holds course problems and their
 * solutions — so it is read at build time rather than imported, and the module
 * resolves to nulls when it is absent. That is what lets the repository ship
 * with no library while a working copy still opens with one.
 *
 * The stamp is a hash of the contents. The app stores the stamp it last seeded
 * from, so editing the file replaces what the browser is holding while ordinary
 * edits made in the app survive a refresh.
 */
function projectLibrary(): Plugin {
  const id = 'virtual:misty-library'
  const resolved = '\0' + id

  const read = () => {
    if (!existsSync(LIBRARY_FILE)) return null
    return readFileSync(LIBRARY_FILE, 'utf8')
  }

  return {
    name: 'misty-library',
    resolveId: (source) => (source === id ? resolved : null),
    load(moduleId) {
      if (moduleId !== resolved) return null
      const text = read()
      const stamp = text ? createHash('sha256').update(text).digest('hex').slice(0, 16) : null
      return (
        `export const LIBRARY_YAML = ${JSON.stringify(text)}\n` +
        `export const LIBRARY_STAMP = ${JSON.stringify(stamp)}\n`
      )
    },
    configureServer(server) {
      server.watcher.add(LIBRARY_FILE)
      const reload = (file: string) => {
        if (resolve(file) !== LIBRARY_FILE) return
        const mod = server.moduleGraph.getModuleById(resolved)
        if (mod) server.moduleGraph.invalidateModule(mod)
        server.ws.send({ type: 'full-reload' })
      }
      server.watcher.on('add', reload)
      server.watcher.on('change', reload)
      server.watcher.on('unlink', reload)
    },
  }
}

export default defineConfig({
  plugins: [svelte({ hot: false }), tailwindcss(), projectLibrary()],
  base: './',
  test: {
    // jsdom only exposes web storage on a real origin, so pin one.
    environmentOptions: { jsdom: { url: 'http://localhost/' } },
    setupFiles: ['./src/test-setup.ts'],
  },
  resolve: {
    conditions: ['browser'],
  },
})
