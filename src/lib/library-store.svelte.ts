/**
 * The library currently in use.
 *
 * There is no built-in one: the app starts empty and the picker stays hidden
 * until something is loaded. A library arrives either by importing a YAML file
 * or, in development, by being seeded from `library.yaml` in the project root —
 * which is not committed, so course problems and solutions stay out of the
 * repository.
 *
 * Whatever is loaded lives in localStorage and survives a refresh, including
 * diagrams saved from the editor. Reseeding is keyed on a stamp of the file's
 * contents: edit `library.yaml` and the next load replaces what the browser is
 * holding, which is what makes rebuilding the library take effect.
 */

import { DEFAULT_GROUP, LIBRARY, type LibraryEntry } from './library'
import { fromYaml, type LibraryDocument } from './library-yaml'

const STORE = 'misty.library.v1'
const STAMP = 'misty.library.stamp.v1'

function empty(): LibraryDocument {
  return structuredClone({ groups: LIBRARY })
}

function load(): LibraryDocument {
  try {
    const raw = localStorage.getItem(STORE)
    if (!raw) return empty()
    const parsed = JSON.parse(raw) as LibraryDocument
    if (!Array.isArray(parsed?.groups)) return empty()
    return parsed
  } catch {
    // Unreadable storage just means no library.
    return empty()
  }
}

export const libraryStore = $state({
  doc: load(),
})

export function entryCount(): number {
  return libraryStore.doc.groups.reduce((n, g) => n + g.entries.length, 0)
}

/** Whether there is anything to show — the picker hides when there is not. */
export function hasLibrary(): boolean {
  return entryCount() > 0
}

function persist() {
  try {
    if (hasLibrary()) localStorage.setItem(STORE, JSON.stringify(libraryStore.doc))
    else localStorage.removeItem(STORE)
  } catch {
    // Private browsing or a full quota — it just will not persist.
  }
}

export function replaceLibrary(doc: LibraryDocument) {
  libraryStore.doc = doc
  persist()
}

export function resetLibrary() {
  libraryStore.doc = empty()
  try {
    localStorage.removeItem(STAMP)
  } catch {
    // As above.
  }
  persist()
}

/** Flat lookup across whatever library is loaded. */
export function findEntry(id: string): LibraryEntry | undefined {
  for (const group of libraryStore.doc.groups) {
    const hit = group.entries.find((e) => e.id === id)
    if (hit) return hit
  }
  return undefined
}

/** The entry with this name, wherever it sits. Names are the user-facing key. */
export function findByTitle(title: string): LibraryEntry | undefined {
  const wanted = title.trim().toLowerCase()
  if (!wanted) return undefined
  for (const group of libraryStore.doc.groups) {
    const hit = group.entries.find((e) => e.title.trim().toLowerCase() === wanted)
    if (hit) return hit
  }
  return undefined
}

function slug(title: string): string {
  return title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'diagram'
}

/**
 * Save a diagram under `title`, replacing any entry of that name in place.
 *
 * Replacing where it already sits — rather than moving it to the default group
 * — is what makes this an edit of the library rather than an addition to it: a
 * figure keeps its place among its neighbours when its source is corrected.
 */
export function saveEntry(title: string, source: string): LibraryEntry {
  const name = title.trim()
  if (!name) throw new Error('A diagram needs a name before it can be saved')

  const existing = findByTitle(name)
  if (existing) {
    existing.title = name
    existing.source = source
    persist()
    return existing
  }

  const taken = new Set<string>()
  for (const group of libraryStore.doc.groups) for (const e of group.entries) taken.add(e.id)
  let id = slug(name)
  for (let n = 2; taken.has(id); n++) id = `${slug(name)}-${n}`

  const entry: LibraryEntry = { id, title: name, source }
  let group = libraryStore.doc.groups.find((g) => g.label === DEFAULT_GROUP)
  if (!group) {
    group = { label: DEFAULT_GROUP, entries: [] }
    libraryStore.doc.groups.push(group)
  }
  group.entries.push(entry)
  persist()
  return entry
}

/** Drop an entry, and the group with it if that leaves the group empty. */
export function removeEntry(id: string): boolean {
  for (const group of libraryStore.doc.groups) {
    const at = group.entries.findIndex((e) => e.id === id)
    if (at < 0) continue
    group.entries.splice(at, 1)
    if (!group.entries.length) {
      libraryStore.doc.groups.splice(libraryStore.doc.groups.indexOf(group), 1)
    }
    persist()
    return true
  }
  return false
}

/* -- Editing the library ------------------------------------------------- */

export function libraryName(): string {
  return libraryStore.doc.name ?? ''
}

export function renameLibrary(name: string) {
  const trimmed = name.trim()
  if (trimmed) libraryStore.doc.name = trimmed
  else delete libraryStore.doc.name
  persist()
}

/** Rename a diagram. Names are how the editor finds an entry to overwrite. */
export function renameEntry(id: string, title: string): boolean {
  const trimmed = title.trim()
  if (!trimmed) return false
  const entry = findEntry(id)
  if (!entry) return false
  entry.title = trimmed
  persist()
  return true
}

export function renameGroup(index: number, label: string): boolean {
  const trimmed = label.trim()
  const group = libraryStore.doc.groups[index]
  if (!group || !trimmed) return false
  group.label = trimmed
  persist()
  return true
}

export function addGroup(label: string): boolean {
  const trimmed = label.trim()
  if (!trimmed || libraryStore.doc.groups.some((g) => g.label === trimmed)) return false
  libraryStore.doc.groups.push({ label: trimmed, entries: [] })
  persist()
  return true
}

/** Delete a group and everything in it. */
export function removeGroup(index: number): boolean {
  if (!libraryStore.doc.groups[index]) return false
  libraryStore.doc.groups.splice(index, 1)
  persist()
  return true
}

function move<T>(list: T[], from: number, to: number): boolean {
  if (from === to || from < 0 || from >= list.length || to < 0 || to >= list.length) return false
  const [item] = list.splice(from, 1)
  list.splice(to, 0, item)
  return true
}

export function reorderGroups(from: number, to: number): boolean {
  if (!move(libraryStore.doc.groups, from, to)) return false
  persist()
  return true
}

export function reorderEntries(groupIndex: number, from: number, to: number): boolean {
  const group = libraryStore.doc.groups[groupIndex]
  if (!group || !move(group.entries, from, to)) return false
  persist()
  return true
}

export interface EntrySlot {
  group: number
  index: number
}

/**
 * Move a diagram to a slot, in its own group or another.
 *
 * Empty groups are left standing, unlike after a delete: a group you have just
 * emptied by dragging out of it is one you are probably still arranging.
 */
export function moveEntry(from: EntrySlot, to: EntrySlot): boolean {
  const source = libraryStore.doc.groups[from.group]
  const target = libraryStore.doc.groups[to.group]
  if (!source || !target) return false
  if (from.group === to.group) return reorderEntries(from.group, from.index, to.index)

  const entry = source.entries[from.index]
  if (!entry) return false
  source.entries.splice(from.index, 1)
  target.entries.splice(Math.max(0, Math.min(to.index, target.entries.length)), 0, entry)
  persist()
  return true
}

/**
 * Seed from the project's `library.yaml`, if the build supplied one.
 *
 * Runs once at start-up. The file wins over what the browser is holding only
 * when its contents have changed since the last seed, so edits made in the app
 * survive a refresh but a rebuilt library is picked up.
 */
export async function seedFromProject(): Promise<boolean> {
  const { LIBRARY_YAML, LIBRARY_STAMP } = await import('virtual:misty-library')
  if (!LIBRARY_YAML || !LIBRARY_STAMP) return false

  let seen: string | null = null
  try {
    seen = localStorage.getItem(STAMP)
  } catch {
    // Storage unavailable; seed every time rather than not at all.
  }
  if (seen === LIBRARY_STAMP && hasLibrary()) return false

  replaceLibrary(await fromYaml(LIBRARY_YAML))
  try {
    localStorage.setItem(STAMP, LIBRARY_STAMP)
  } catch {
    // As above.
  }
  return true
}
