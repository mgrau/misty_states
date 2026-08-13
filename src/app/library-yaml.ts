/**
 * The library as a YAML document, so it can be moved between machines, kept
 * under version control, or hand-edited outside the app.
 *
 * YAML rather than JSON because the interesting field is `source` — a
 * multi-line diagram — and a block scalar keeps it readable:
 *
 *     - id: ps2.1
 *       title: §1 Swap, CNOT and NOT
 *       source: |-
 *         in 001
 *         SWAP 2 3
 *
 * js-yaml is loaded on demand, so it costs nothing until a library is actually
 * imported or exported.
 */

import type { LibraryGroup, LibraryEntry } from './library'

export interface LibraryDocument {
  /** What this collection is called. Shown at the top of the picker. */
  name?: string
  groups: LibraryGroup[]
}

const HEADER = `# Misty States library
#
# Figures transcribed from course materials. Each entry's "source" is the
# diagram in the Misty States syntax; "origin" names the file it came from.
`

async function yaml() {
  return import('js-yaml')
}

export async function toYaml(doc: LibraryDocument): Promise<string> {
  const { dump } = await yaml()
  // Absent fields are dropped rather than written as `null`, which would come
  // back as a value and fail validation on the way in.
  // `name` first, so the file opens by saying what it is.
  const clean: LibraryDocument = {
    ...(doc.name?.trim() ? { name: doc.name.trim() } : {}),
    groups: doc.groups.map((group) => ({
      label: group.label,
      entries: group.entries.map((entry) =>
        Object.fromEntries(
          Object.entries(entry).filter(([, v]) => v !== undefined && v !== null),
        ) as LibraryEntry,
      ),
    })),
  }
  const body = dump(clean, {
    // Block scalars for multi-line sources; long titles are not wrapped.
    lineWidth: -1,
    noRefs: true,
  })
  return HEADER + body
}

/** Anything that went wrong reading a library file, phrased for the user. */
export class LibraryFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LibraryFormatError'
  }
}

function str(value: unknown, where: string, field: string): string {
  const v = (value as Record<string, unknown>)?.[field]
  if (typeof v !== 'string' || !v.trim()) {
    throw new LibraryFormatError(`${where}: "${field}" is required and must be text`)
  }
  return v
}

function optionalStr(value: unknown, field: string): string | undefined {
  const v = (value as Record<string, unknown>)?.[field]
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'string') return undefined
  return v
}

function parseEntry(raw: unknown, where: string): LibraryEntry {
  if (!raw || typeof raw !== 'object') {
    throw new LibraryFormatError(`${where}: each entry must be a mapping`)
  }
  return {
    id: str(raw, where, 'id'),
    title: str(raw, where, 'title'),
    // Optional: a diagram written in the editor has no original to point at.
    origin: optionalStr(raw, 'origin'),
    note: optionalStr(raw, 'note'),
    source: str(raw, where, 'source'),
  }
}

export async function fromYaml(text: string): Promise<LibraryDocument> {
  const { load } = await yaml()

  let parsed: unknown
  try {
    parsed = load(text)
  } catch (err) {
    throw new LibraryFormatError(`Not valid YAML — ${(err as Error).message}`)
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new LibraryFormatError('The file is empty, or is not a YAML mapping')
  }

  const doc = parsed as Record<string, unknown>
  if (!Array.isArray(doc.groups)) {
    throw new LibraryFormatError('Expected a top-level "groups" list')
  }

  const seen = new Set<string>()
  const groups: LibraryGroup[] = doc.groups.map((rawGroup, gi) => {
    const where = `group ${gi + 1}`
    if (!rawGroup || typeof rawGroup !== 'object') {
      throw new LibraryFormatError(`${where}: each group must be a mapping`)
    }
    const g = rawGroup as Record<string, unknown>
    const label = str(g, where, 'label')
    if (!Array.isArray(g.entries)) {
      throw new LibraryFormatError(`${where} ("${label}"): expected an "entries" list`)
    }
    const entries = g.entries.map((rawEntry, ei) => {
      const entry = parseEntry(rawEntry, `${where} ("${label}"), entry ${ei + 1}`)
      // Ids address entries in the picker, so a duplicate would shadow another.
      if (seen.has(entry.id)) {
        throw new LibraryFormatError(`Duplicate entry id "${entry.id}"`)
      }
      seen.add(entry.id)
      return entry
    })
    return { label, entries }
  })

  const name = optionalStr(doc, 'name')?.trim()
  return name ? { name, groups } : { groups }
}
