// The confirmation window: a separate sandboxed page that shows one approval
// record and offers exactly two calls, approve and cancel. Only this window can
// approve; the editor window never sees the approval secret.

import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import type { ApprovalRecord, SendResult, Signer } from './signer'
import { APP_ORIGIN, isAllowedOrigin, secureWebPreferences } from './security'
import { log } from './log'

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
    if (typedName !== undefined && typeof typedName !== 'string') throw new Error('Refused')
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
      const message = err instanceof Error ? err.message : String(err)
      // A failed approval is used up (single use); the window shows the error and closes on Close.
      p.secret.fill(0)
      p.settle({ approved: false, reason: 'error', error: message, details: (err as { details?: unknown }).details })
      pendingByWindow.delete(e.sender.id)
      return { ok: false, error: message }
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

/** Opens the confirmation for a prepared approval and resolves when it is approved, cancelled or closed. */
export function openConfirmation(parent: BrowserWindow | null, record: ApprovalRecord, secret: Buffer): Promise<ConfirmOutcome> {
  return new Promise((resolve) => {
    let settled = false
    const settle = (r: ConfirmOutcome): void => {
      if (!settled) {
        settled = true
        resolve(r)
      }
    }
    const win = new BrowserWindow({
      parent: parent ?? undefined,
      modal: false,
      width: 760,
      height: 820,
      minWidth: 600,
      minHeight: 500,
      show: false,
      title: record.blocked || record.network.kind !== 'testnet' ? `Confirm on ${record.network.name}` : 'Confirm transaction',
      backgroundColor: '#1e1f21',
      autoHideMenuBar: true,
      webPreferences: secureWebPreferences(join(__dirname, '../preload/confirm.js'))
    })
    win.setMenu(null)
    pendingByWindow.set(win.webContents.id, { record, secret, win, settle, busy: false })
    win.once('ready-to-show', () => win.show())
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
    win.loadURL(url).catch((e) => log.error('Confirmation window failed to load', e))
  })
}
