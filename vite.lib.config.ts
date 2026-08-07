import { defineConfig } from 'vite'
import { resolve } from 'node:path'

/**
 * Builds the standalone API bundle, separate from the app.
 *
 *   npm run build:lib  ->  dist/lib/misty-states.js   (global MistyStates)
 *                          dist/lib/misty-states.mjs  (ES module)
 */
export default defineConfig({
  build: {
    outDir: 'dist/lib',
    emptyOutDir: true,
    lib: {
      entry: resolve(import.meta.dirname, 'src/lib/global.ts'),
      name: 'MistyStates',
      formats: ['umd', 'es'],
      fileName: (format) => (format === 'es' ? 'misty-states.mjs' : 'misty-states.js'),
    },
  },
})
