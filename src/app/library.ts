/**
 * The shape of a diagram library.
 *
 * The app ships with none. A library is a YAML file you import — or that the
 * dev server seeds from `library.yaml` in the project root, which is
 * deliberately not committed, so course problems and solutions stay out of the
 * repository. See `library-yaml.ts` for the file format and `library-store` for
 * where the loaded one lives.
 *
 * Distinct from `examples.ts`, which is a small curated tour of the syntax and
 * is always present.
 */

export interface LibraryEntry {
  id: string
  title: string
  /** Filename of the original, for a figure transcribed from somewhere else. */
  origin?: string
  note?: string
  source: string
}

export interface LibraryGroup {
  label: string
  entries: LibraryEntry[]
}

/** Where a diagram saved from the editor goes when nothing else claims it. */
export const DEFAULT_GROUP = 'My diagrams'

/** No built-in figures: an empty library until one is imported or seeded. */
export const LIBRARY: LibraryGroup[] = []
