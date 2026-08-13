/** One row of a dropdown or context menu. */
export interface MenuItem {
  key: string
  label: string
  hint?: string
  run: () => Promise<void> | void
}
