// The separate key windows: native frame, no menu, their own sandboxed page
// (confirm.html) and only the calls of their mode. Private keys, the recovery
// code and the new password of the recovery path are seen only here and in the
// main process, never in the editor window.
//
// Modes: reveal (show or copy one key after the password), backup (write one
// key to a text file after the password), code (the recovery code, shown once),
// recover (forgotten password: recovery code and new password, or reset).

import { app, BrowserWindow, dialog, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { iconPath } from './paths'
import { APP_ORIGIN, isAllowedOrigin, secureWebPreferences } from './security'
import { followTheme, themeArgs, windowBackground } from './theme'

export type KeyWindowMode = 'reveal' | 'backup' | 'code' | 'recover'

export interface KeySession {
  mode: KeyWindowMode
  win: BrowserWindow
  /** reveal and backup: the key the window is for. */
  keyId?: string
  /** code: the recovery code to show (cleared when the window closes, on a lock and when a newer code exists). */
  code?: string
  /** code: the code was wiped by a lock; the page says so in its place. */
  hidden?: boolean
  /** backup: a file was written. */
  saved: boolean
  /** code: the user confirmed (or "I saved it") that the window may close. */
  closeOk: boolean
  onClosed?: (s: KeySession) => void
}

const SIZES: Record<KeyWindowMode, { width: number; height: number; minWidth: number; minHeight: number; title: string }> = {
  reveal: { width: 780, height: 420, minWidth: 640, minHeight: 360, title: 'Show private key' },
  backup: { width: 780, height: 560, minWidth: 640, minHeight: 460, title: 'Back up key' },
  code: { width: 720, height: 480, minWidth: 600, minHeight: 400, title: 'Vault recovery code' },
  recover: { width: 720, height: 620, minWidth: 600, minHeight: 500, title: 'Forgot password' }
}

/** The title bar text of a key window mode (the shared page's own title is not used). */
export function keyWindowTitle(mode: KeyWindowMode): string {
  return SIZES[mode].title
}

const sessions = new Map<number, KeySession>()

/** A native question from the main process; Cancel is the default and the answer to Escape. */
export async function askNative(win: BrowserWindow | null, message: string, detail: string, action: string): Promise<boolean> {
  const opts = {
    type: 'warning' as const,
    buttons: ['Cancel', action],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: 'WAX Master',
    message,
    detail
  }
  const r = win && !win.isDestroyed() ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
  return r.response === 1
}

/** Sent to a recovery-code page on a lock: the page drops the code at once and shows the hidden text. */
export const CODE_HIDDEN_CHANNEL = 'keywin:hidden'

/** Counts the reloads after a lock, so each one has its own address. */
let hiddenLoads = 0

/**
 * The page address of a mode. `hidden`: the reload after a lock; the query makes it
 * a new document (an address that differs only in the hash keeps the old page and its state).
 */
function pageUrl(mode: KeyWindowMode, hidden = false): string {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  const base = !app.isPackaged && devUrl ? `${devUrl.replace(/\/$/, '')}/confirm.html` : `${APP_ORIGIN}/confirm.html`
  return hidden ? `${base}?hidden=${++hiddenLoads}#${mode}` : `${base}#${mode}`
}

export function openKeyWindow(
  parent: BrowserWindow | null,
  mode: KeyWindowMode,
  extra: { keyId?: string; code?: string; onClosed?: (s: KeySession) => void } = {}
): KeySession {
  const size = SIZES[mode]
  const win = new BrowserWindow({
    parent: parent ?? undefined,
    icon: iconPath(),
    // The size of the page inside the frame: a key or code fits on one line without scrolling.
    useContentSize: true,
    width: size.width,
    height: size.height,
    minWidth: size.minWidth,
    minHeight: size.minHeight,
    resizable: true,
    show: false,
    title: size.title,
    backgroundColor: windowBackground('content'),
    autoHideMenuBar: true,
    webPreferences: secureWebPreferences(join(__dirname, '../preload/confirm.js'), themeArgs())
  })
  win.setMenu(null)
  followTheme(win, 'content')
  // The page is shared with the confirmation window; the title bar keeps the title of this mode.
  win.on('page-title-updated', (e: Electron.Event) => e.preventDefault())
  const session: KeySession = { mode, win, keyId: extra.keyId, code: extra.code, saved: false, closeOk: false, onClosed: extra.onClosed }
  const wcId = win.webContents.id
  sessions.set(wcId, session)
  // The recovery code is shown once: closing the window any other way than "I saved it" asks once.
  win.on('close', (e: Electron.Event) => {
    if (session.mode !== 'code' || !session.code || session.closeOk) return
    e.preventDefault()
    void askNative(
      win,
      'Close without saving the recovery code?',
      'The code is not shown again. Without it a forgotten password cannot be recovered. A new code can be made later in Manage Keypairs with the password.',
      'Close'
    ).then((yes) => {
      if (!yes || win.isDestroyed()) return
      session.closeOk = true
      win.close()
    })
  })
  win.on('closed', () => {
    sessions.delete(wcId)
    session.code = undefined
    session.onClosed?.(session)
  })
  win.once('ready-to-show', () => win.show())
  void win.loadURL(pageUrl(mode))
  return session
}

/** A window changes mode (the recovery window showing the new code): its title follows. */
export function setKeyWindowMode(s: KeySession, mode: KeyWindowMode): void {
  s.mode = mode
  if (!s.win.isDestroyed()) s.win.setTitle(keyWindowTitle(mode))
}

/** The session of the sending window when it is a key window of one of the modes (main frame, own page); else null. */
export function fromKeyWindow(e: IpcMainInvokeEvent, ...modes: KeyWindowMode[]): KeySession | null {
  const s = sessions.get(e.sender.id)
  const url = e.senderFrame?.url ?? ''
  if (!s || !modes.includes(s.mode) || e.senderFrame !== e.sender.mainFrame || !isAllowedOrigin(url)) return null
  if (!new URL(url).pathname.endsWith('/confirm.html')) return null
  return s
}

/** Closes the key windows of the given modes (a shown key goes with its window). */
export function closeKeyWindows(modes: KeyWindowMode[], keyId?: string): void {
  for (const s of [...sessions.values()]) {
    if (!modes.includes(s.mode) || (keyId !== undefined && s.keyId !== keyId)) continue
    if (!s.win.isDestroyed()) s.win.close()
  }
}

/**
 * A lock: every recovery-code window forgets its code. The page is told to drop
 * the code it holds, then loaded again as a new document (its old state gone),
 * and says that the code was hidden; the window closes without the question.
 */
export function hideRecoveryCodes(): void {
  for (const s of sessions.values()) {
    if (s.mode !== 'code' || !s.code) continue
    s.code = undefined
    s.hidden = true
    s.closeOk = true
    if (s.win.isDestroyed()) continue
    s.win.webContents.send(CODE_HIDDEN_CHANNEL)
    void s.win.loadURL(pageUrl('code', true))
  }
}

/** A newer code exists (or none any more): every other recovery-code window closes, its code wiped, without the question. */
export function closeOlderCodeWindows(keep?: KeySession): void {
  for (const s of [...sessions.values()]) {
    if (s.mode !== 'code' || s === keep) continue
    s.code = undefined
    s.closeOk = true
    if (!s.win.isDestroyed()) s.win.close()
  }
}

/** An open window of a mode, brought to the front; null when none is open. */
export function focusKeyWindow(mode: KeyWindowMode): KeySession | null {
  for (const s of sessions.values()) {
    if (s.mode === mode && !s.win.isDestroyed()) {
      if (s.win.isMinimized?.()) s.win.restore()
      s.win.focus?.()
      return s
    }
  }
  return null
}
