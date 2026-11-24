// Theme and dialog size rules shared by the main process and the tests.

import type { DialogSize, ResolvedTheme, ThemeSetting } from './api'

/** Start argument that carries the resolved theme to every page of a window. */
export const THEME_ARG = '--wax-theme='

export const THEME_SETTINGS: readonly ThemeSetting[] = ['system', 'dark', 'light']

/** Height of the title bar row of the main window (`--titlebar` in styles.css). */
export const TITLEBAR_HEIGHT = 40

/**
 * Window colours chosen before the page paints. Each value mirrors a token of
 * styles.css (dark: `:root`, light: `:root[data-theme="light"]`).
 */
export const WINDOW_COLORS: Record<ResolvedTheme, { chrome: string; content: string; text: string }> = {
  dark: {
    /** --bg-chrome */
    chrome: '#181818',
    /** --bg-content */
    content: '#1F1F1F',
    /** --text */
    text: '#E4E4E4'
  },
  light: {
    /** --bg-chrome */
    chrome: '#F3F3F3',
    /** --bg-content */
    content: '#FFFFFF',
    /** --text */
    text: '#1F1F1F'
  }
}

/** Dialog names: lower case words joined by dashes. */
export const DIALOG_NAME = /^[a-z][a-z0-9-]{0,39}$/
/** Smallest size a dialog can be dragged to. */
export const DIALOG_MIN: DialogSize = { width: 480, height: 240 }
const DIALOG_MAX_SIDE = 8000
const MAX_DIALOG_SIZES = 64

export function isThemeSetting(v: unknown): v is ThemeSetting {
  return typeof v === 'string' && (THEME_SETTINGS as readonly string[]).includes(v)
}

function sizeOf(v: unknown): DialogSize | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  if (Object.keys(o).sort().join(',') !== 'height,width') return null
  const ok = (n: unknown, min: number): n is number => Number.isInteger(n) && (n as number) >= min && (n as number) <= DIALOG_MAX_SIDE
  return ok(o.width, DIALOG_MIN.width) && ok(o.height, DIALOG_MIN.height) ? { width: o.width, height: o.height } : null
}

/** Stored dialog sizes as read from the settings file: anything malformed is dropped. */
export function cleanDialogSizes(v: unknown): Record<string, DialogSize> {
  const out: Record<string, DialogSize> = {}
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out
  for (const [name, raw] of Object.entries(v as Record<string, unknown>).slice(0, MAX_DIALOG_SIZES)) {
    const s = sizeOf(raw)
    if (DIALOG_NAME.test(name) && s) out[name] = s
  }
  return out
}

/** Validates a change of dialog sizes from the editor page; throws on anything malformed. */
export function parseDialogSizesPatch(v: unknown): Record<string, DialogSize | null> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('dialogSizes: object expected')
  const entries = Object.entries(v as Record<string, unknown>)
  if (entries.length === 0 || entries.length > 4) throw new Error('dialogSizes: one to four dialogs')
  const out: Record<string, DialogSize | null> = {}
  for (const [name, raw] of entries) {
    if (!DIALOG_NAME.test(name)) throw new Error('dialogSizes: bad dialog name')
    if (raw === null) {
      out[name] = null
      continue
    }
    const s = sizeOf(raw)
    if (!s) throw new Error('dialogSizes: width and height in whole pixels, at least 480 x 240')
    out[name] = s
  }
  return out
}

/** Applies a validated change to the stored sizes; keeps at most 64 dialogs. */
export function mergeDialogSizes(stored: Record<string, DialogSize>, patch: Record<string, DialogSize | null>): Record<string, DialogSize> {
  const out: Record<string, DialogSize> = { ...stored }
  for (const [name, s] of Object.entries(patch)) {
    if (s === null) delete out[name]
    else out[name] = s
  }
  const names = Object.keys(out)
  if (names.length > MAX_DIALOG_SIZES) for (const n of names.slice(0, names.length - MAX_DIALOG_SIZES)) delete out[n]
  return out
}

/** Reads the resolved theme from the start arguments of a page; dark unless exactly "light". */
export function themeFromArgv(argv: readonly string[]): ResolvedTheme {
  const a = argv.find((x) => x.startsWith(THEME_ARG))
  return a === `${THEME_ARG}light` ? 'light' : 'dark'
}
