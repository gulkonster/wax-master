// The program's theme: the setting (system / dark / light) drives
// nativeTheme.themeSource; the resolved theme (dark or light) goes to every
// window at creation as a start argument and again whenever it changes.

import { nativeTheme, type BrowserWindow } from 'electron'
import type { ResolvedTheme, ThemeSetting } from '../shared/api'
import { THEME_ARG, TITLEBAR_HEIGHT, WINDOW_COLORS } from '../shared/theme'

/** Which window background a window uses: the main window shows chrome first, the others content. */
type Surface = 'chrome' | 'content'

const windows = new Map<BrowserWindow, { surface: Surface; overlay: boolean }>()
let watching = false

export function resolvedTheme(): ResolvedTheme {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
}

/** Start arguments that carry the resolved theme to the pages of a new window. */
export function themeArgs(): string[] {
  return [`${THEME_ARG}${resolvedTheme()}`]
}

export function windowBackground(surface: Surface): string {
  return WINDOW_COLORS[resolvedTheme()][surface]
}

export function titleBarOverlay(): { color: string; symbolColor: string; height: number } {
  const c = WINDOW_COLORS[resolvedTheme()]
  return { color: c.chrome, symbolColor: c.text, height: TITLEBAR_HEIGHT }
}

function sendTheme(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  const theme = resolvedTheme()
  for (const frame of win.webContents.mainFrame.framesInSubtree) {
    try {
      frame.send('theme', theme)
    } catch {
      // A frame that is going away cannot receive; it gets the theme when it loads again.
    }
  }
}

function broadcast(): void {
  for (const [win, o] of windows) {
    if (win.isDestroyed()) continue
    win.setBackgroundColor(windowBackground(o.surface))
    if (o.overlay) win.setTitleBarOverlay(titleBarOverlay())
    sendTheme(win)
  }
}

/** Keeps a window's colours and pages on the current theme for as long as it is open. */
export function followTheme(win: BrowserWindow, surface: Surface, overlay = false): void {
  windows.set(win, { surface, overlay })
  win.on('closed', () => windows.delete(win))
  // A page or frame that loads (again) gets the current theme, also after a change since creation.
  win.webContents.on('did-frame-finish-load', () => sendTheme(win))
  if (!watching) {
    watching = true
    nativeTheme.on('updated', broadcast)
  }
}

/** Applies the theme setting; Windows' own parts (caption buttons, dialogs, frames) follow it too. */
export function applyThemeSetting(setting: ThemeSetting): void {
  nativeTheme.themeSource = setting
  broadcast()
}
