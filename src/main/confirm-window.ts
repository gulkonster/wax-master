// The confirmation window: a separate sandboxed page that shows one approval
// record and offers exactly two calls, approve and cancel. Only this window can
// approve; the editor window never sees the approval secret.
//
// Approve works at once (E65), and only one confirmation is open at a time. While a recovery code is
// on screen (the vault was just converted or made) the confirmation waits until
// that window is closed, so it never covers the code.

import { app, BrowserWindow, ipcMain, screen, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { iconPath } from './paths'
import { approveFailure, type ApprovalRecord, type SendResult, type Signer } from './signer'
import { APP_ORIGIN, isAllowedOrigin, secureWebPreferences } from './security'
import { log } from './log'
import { withoutLockedCode } from '../shared/vault-locked'
import { followTheme, themeArgs, windowBackground } from './theme'
import { afterCodeWindows, focusKeyWindow } from './key-windows'

/** Default size: a plain transfer shows without scrolling at the size scale of styles.css. */
const CONFIRM_WIDTH = 880
const CONFIRM_HEIGHT = 860

interface Pending {
  record: ApprovalRecord
  secret: Buffer
  win: BrowserWindow
  settle: (r: ConfirmOutcome) => void
  busy: boolean
}

export type ConfirmOutcome =
  | { approved: true; result: SendResult }
  | { approved: false; reason: 'cancelled' | 'closed' | 'error'; error?: string; details?: unknown }

const pendingByWindow = new Map<number, Pending>()
/** Confirmations waiting for a recovery-code window to close; each call drops its approval. */
const waiting = new Set<() => void>()
let signerRef: Signer | null = null
let registered = false

function fromConfirmWindow(e: IpcMainInvokeEvent): Pending | null {
  const p = pendingByWindow.get(e.sender.id)
  if (!p) return null
  const url = e.senderFrame?.url ?? ''
  if (e.senderFrame !== e.sender.mainFrame || !isAllowedOrigin(url)) return null
  if (!new URL(url).pathname.endsWith('/confirm.html')) return null
  return p
}

/** True while a confirmation window is open. */
export function hasOpenConfirmation(): boolean {
  return pendingByWindow.size > 0 || waiting.size > 0
}

/** Brings the open confirmation window to the front (a second request was refused). */
export function focusOpenConfirmation(): void {
  // A confirmation waiting behind a recovery code: the code window comes to the front.
  if (waiting.size > 0) focusKeyWindow('code')
  for (const p of pendingByWindow.values()) {
    if (!p.win.isDestroyed()) {
      if (p.win.isMinimized()) p.win.restore()
      p.win.focus()
    }
  }
}

/**
 * Closes every open confirmation window (the vault was locked: its approval is gone).
 * A window whose approval is already being sent is left alone; it ends with the send.
 */
export function closeOpenConfirmations(): void {
  for (const drop of [...waiting]) drop()
  for (const p of [...pendingByWindow.values()]) {
    if (!p.busy && !p.win.isDestroyed()) p.win.close()
  }
}

export function registerConfirmWindow(signer: Signer): void {
  signerRef = signer
  if (registered) return
  registered = true
  ipcMain.handle('confirm:load', (e) => {
    const p = fromConfirmWindow(e)
    if (!p) throw new Error('Refused')
    return p.record
  })
  ipcMain.handle('confirm:approve', async (e, id: unknown, typedName: unknown) => {
    const p = fromConfirmWindow(e)
    if (!p || typeof id !== 'string' || id !== p.record.id) throw new Error('Refused')
    // E73: the account name typed for Clear Contract Code; the signer compares it with its record.
    if (typedName !== undefined && (typeof typedName !== 'string' || typedName.length > 13)) throw new Error('Refused')
    if (p.busy) throw new Error('Already sending')
    p.busy = true
    try {
      const result = await signerRef!.approve(p.record.id, p.secret, typedName as string | undefined)
      p.secret.fill(0)
      p.settle({ approved: true, result })
      pendingByWindow.delete(e.sender.id)
      setTimeout(() => !p.win.isDestroyed() && p.win.close(), 50)
      return { ok: true, transactionId: result.transactionId }
    } catch (err) {
      // The vault may have locked itself while this window was open: shown without the code.
      const message = withoutLockedCode(err instanceof Error ? err.message : String(err))
      const details = (err as { details?: unknown }).details
      // A failed approval is used up (single use); the window keeps the transaction, adds why it was not sent and closes on Close.
      p.secret.fill(0)
      p.settle({ approved: false, reason: 'error', error: message, details })
      pendingByWindow.delete(e.sender.id)
      // failure: refused (the node answered with an error), unknown (it may have arrived) or not-sent.
      return { ok: false, error: message, failure: approveFailure(err) }
    }
  })
  ipcMain.handle('confirm:cancel', (e, id: unknown) => {
    const p = fromConfirmWindow(e)
    if (!p || id !== p.record.id) throw new Error('Refused')
    signerRef!.cancel(p.record.id)
    p.secret.fill(0)
    p.settle({ approved: false, reason: 'cancelled' })
    pendingByWindow.delete(e.sender.id)
    setTimeout(() => !p.win.isDestroyed() && p.win.close(), 10)
    return true
  })
}

/**
 * Opens the confirmation for a prepared approval and resolves when it is approved,
 * cancelled or closed. While a recovery-code window is open the window opens only
 * after it has closed; a lock in the meantime ends the request as closed.
 */
/** Sent to the main window when an approved transaction was not taken by the node. */
export const TX_FAILED_EVENT = 'tx-failed'

export function openConfirmation(parent: BrowserWindow | null, record: ApprovalRecord, secret: Buffer): Promise<ConfirmOutcome> {
  return new Promise((resolve) => {
    let settled = false
    const settle = (r: ConfirmOutcome): void => {
      if (!settled) {
        settled = true
        // E60: a transaction the node did not take is also told in the main window, at the top.
        if (!r.approved && r.reason === 'error' && parent && !parent.isDestroyed()) {
          parent.webContents.send(TX_FAILED_EVENT, { title: record.title, network: record.network.name, error: r.error })
        }
        resolve(r)
      }
    }
    const drop = (): void => {
      waiting.delete(drop)
      signerRef?.cancel(record.id)
      secret.fill(0)
      settle({ approved: false, reason: 'closed' })
    }
    waiting.add(drop)
    afterCodeWindows(() => {
      if (!waiting.delete(drop)) return
      showConfirmation(parent, record, secret, settle)
    })
  })
}

/** Creates the confirmation window; `settle` ends the request. */
function showConfirmation(parent: BrowserWindow | null, record: ApprovalRecord, secret: Buffer, settle: (r: ConfirmOutcome) => void): void {
  if (parent?.isDestroyed()) parent = null
  const area = (parent ? screen.getDisplayMatching(parent.getBounds()) : screen.getPrimaryDisplay()).workAreaSize
  const win = new BrowserWindow({
    parent: parent ?? undefined,
    icon: iconPath(),
    modal: false,
    width: Math.min(CONFIRM_WIDTH, area.width),
    height: Math.min(CONFIRM_HEIGHT, area.height),
    minWidth: 600,
    minHeight: 500,
    show: false,
    title: record.network.kind === 'mainnet' ? `Confirm on ${record.network.name}` : 'Confirm transaction',
    backgroundColor: windowBackground('content'),
    autoHideMenuBar: true,
    webPreferences: secureWebPreferences(join(__dirname, '../preload/confirm.js'), themeArgs())
  })
  win.setMenu(null)
  followTheme(win, 'content')
  const pending: Pending = { record, secret, win, settle, busy: false }
  pendingByWindow.set(win.webContents.id, pending)
  win.once('ready-to-show', () => {
    win.show()
    win.focus()
  })
  win.on('closed', () => {
    const p = [...pendingByWindow.entries()].find(([, v]) => v.win === win)
    if (p) {
      pendingByWindow.delete(p[0])
      signerRef?.cancel(record.id)
      secret.fill(0)
    }
    settle({ approved: false, reason: 'closed' })
  })
  const devUrl = process.env.ELECTRON_RENDERER_URL
  const url = !app.isPackaged && devUrl ? `${devUrl.replace(/\/$/, '')}/confirm.html` : `${APP_ORIGIN}/confirm.html`
  win.loadURL(url).catch((e) => {
    log.error('Confirmation window failed to load', e)
    if (!win.isDestroyed()) win.destroy()
  })
}
