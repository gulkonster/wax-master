// Asks before closing the window while files have unsaved changes.

import { dialog, type BrowserWindow } from 'electron'
import { int } from '../shared/validate'
import { handle } from './ipc'

let dirtyCount = 0
let allowClose = false

export function registerCloseGuard(getWindow: () => BrowserWindow | null): void {
  handle('app:setDirty', (_e, n) => {
    dirtyCount = int(n, 'count', 0, 100000)
  })
  handle('app:quitNow', () => {
    allowClose = true
    getWindow()?.close()
  })
}

/** The update install closes the app after the window saved its files; no question then. */
export function allowQuit(): void {
  allowClose = true
}

export function guardWindow(win: BrowserWindow): void {
  win.on('close', (e) => {
    if (allowClose || dirtyCount === 0) return
    e.preventDefault()
    const r = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Save All', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      title: 'Unsaved changes',
      message: `${dirtyCount} item(s) have unsaved changes.`,
      detail: 'Save them before closing WAX Master?'
    })
    if (r === 0) win.webContents.send('menu', 'save-all-and-quit')
    else if (r === 1) {
      allowClose = true
      win.close()
    }
  })
}
