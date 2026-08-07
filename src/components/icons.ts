/** Icon path data, on a 20×20 grid, stroked with `currentColor`. */
export const ICONS = {
  copy:
    'M7 7V4.5A1.5 1.5 0 0 1 8.5 3h7A1.5 1.5 0 0 1 17 4.5v7a1.5 1.5 0 0 1-1.5 1.5H13 ' +
    'M4.5 7h7A1.5 1.5 0 0 1 13 8.5v7A1.5 1.5 0 0 1 11.5 17h-7A1.5 1.5 0 0 1 3 15.5v-7A1.5 1.5 0 0 1 4.5 7Z',
  download: 'M10 3v8.5m0 0 3-3m-3 3-3-3M3.5 14v1.5A1.5 1.5 0 0 0 5 17h10a1.5 1.5 0 0 0 1.5-1.5V14',
  link:
    'M8.6 11.4a3 3 0 0 0 4.24 0l2.12-2.12a3 3 0 1 0-4.24-4.24l-.7.7 ' +
    'M11.4 8.6a3 3 0 0 0-4.24 0L5.04 10.7a3 3 0 1 0 4.24 4.25l.7-.71',
  chevron: 'm6 8.5 4 4 4-4',
  /** An arrow coming up out of a tray: reopen a saved figure. */
  open: 'M10 12.5V4m0 0 3 3m-3-3-3 3M3.5 13v2.5A1.5 1.5 0 0 0 5 17h10a1.5 1.5 0 0 0 1.5-1.5V13',
} as const

export type IconName = keyof typeof ICONS
