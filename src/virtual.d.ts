/**
 * The project's `library.yaml`, supplied by the `misty-library` Vite plugin.
 *
 * Both are null when the file is absent, which is the committed state of the
 * repository — see the plugin in `vite.config.ts`.
 */
declare module 'virtual:misty-library' {
  /** The file's contents, or null when there is no such file. */
  export const LIBRARY_YAML: string | null
  /** A hash of those contents, so a rebuilt library can be detected. */
  export const LIBRARY_STAMP: string | null
}
