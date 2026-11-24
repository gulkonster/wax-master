// Vault and signer instances, automatic locking, and the Manage Keypairs calls.

import { app, BrowserWindow, clipboard, dialog, ipcMain, powerMonitor, type IpcMainInvokeEvent } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { arr, optStr, str } from '../shared/validate'
import { handle } from './ipc'
import { dataDir } from './paths'
import { Vault, MIN_PASSWORD_LENGTH, type VaultFile } from './vault'
import { Signer, defaultDeps } from './signer'
import { closeOpenConfirmations, registerConfirmWindow } from './confirm-window'
import { getSettings } from './store'
import { chain } from './rpc'
import { currentNetwork, getNetwork, readCall, stars } from './networks'
import { pickList } from './account-pick'
import { LOCKED_MESSAGE } from '../shared/vault-locked'
import { APP_ORIGIN, isAllowedOrigin, secureWebPreferences } from './security'
import { followTheme, themeArgs, windowBackground } from './theme'
import { log } from './log'
import { parsePublicKey, publicKeyToString } from '../chain-core'

function toK1(key: string): string {
  try {
    return publicKeyToString(parsePublicKey(key), 'new')
  } catch {
    return key
  }
}

let vaultInstance: Vault | null = null
let signerInstance: Signer | null = null

export function vault(): Vault {
  if (!vaultInstance) vaultInstance = Vault.inDir(dataDir())
  return vaultInstance
}

export function signer(): Signer {
  if (!signerInstance) signerInstance = new Signer(defaultDeps(vault()))
  return signerInstance
}

export interface VaultStatus {
  exists: boolean
  unlocked: boolean
  keys: number
}

function status(): VaultStatus {
  const v = vault()
  let keys = 0
  try {
    keys = v.list().length
  } catch {
    keys = 0
  }
  return { exists: v.exists(), unlocked: v.isUnlocked(), keys }
}

/** Locks on suspend, workstation lock (both always on), inactivity and quit. */
function startAutoLock(): void {
  powerMonitor.on('suspend', () => lockAll())
  powerMonitor.on('lock-screen', () => lockAll())
  setInterval(() => {
    const v = vault()
    if (!v.isUnlocked()) return
    const minutes = getSettings().autoLockMinutes
    if (powerMonitor.getSystemIdleTime() >= minutes * 60) {
      log.info('Vault locked after inactivity')
      lockAll()
    }
  }, 30_000).unref()
  app.on('before-quit', () => lockAll())
}

// Clipboard: a copied private key is cleared after 30 seconds if it is still there.
function copySecretBriefly(text: string): void {
  clipboard.writeText(text)
  setTimeout(async () => {
    if (String(await clipboard.readText()) === text) clipboard.clear()
  }, 30_000).unref()
}

// Reveal: the password prompt and the key are shown only in a separate window.
const revealWindows = new Map<number, { keyId: string; win: BrowserWindow }>()

function closeRevealWindows(): void {
  for (const { win } of [...revealWindows.values()]) {
    if (!win.isDestroyed()) win.close()
  }
}

/** Locks the vault and closes every reveal window (a shown key goes with the window). */
function lockAll(): void {
  vault().lock()
  closeRevealWindows()
}

/** A native confirmation from the main process; Cancel is the default and the answer to Escape. */
export async function confirmNative(win: BrowserWindow | null, message: string, detail: string, action: string): Promise<boolean> {
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

function openRevealWindow(parent: BrowserWindow | null, keyId: string): void {
  const win = new BrowserWindow({
    parent: parent ?? undefined,
    // The size of the page inside the frame: the key fits on one line without scrolling.
    useContentSize: true,
    width: 780,
    height: 420,
    minWidth: 640,
    minHeight: 360,
    resizable: true,
    show: false,
    title: 'Show private key',
    backgroundColor: windowBackground('content'),
    autoHideMenuBar: true,
    webPreferences: secureWebPreferences(join(__dirname, '../preload/confirm.js'), themeArgs())
  })
  win.setMenu(null)
  followTheme(win, 'content')
  const wcId = win.webContents.id
  revealWindows.set(wcId, { keyId, win })
  win.on('closed', () => revealWindows.delete(wcId))
  win.once('ready-to-show', () => win.show())
  const devUrl = process.env.ELECTRON_RENDERER_URL
  const base = !app.isPackaged && devUrl ? `${devUrl.replace(/\/$/, '')}/confirm.html` : `${APP_ORIGIN}/confirm.html`
  void win.loadURL(`${base}#reveal`)
}

function fromRevealWindow(e: IpcMainInvokeEvent): string | null {
  const id = revealWindows.get(e.sender.id)?.keyId
  const url = e.senderFrame?.url ?? ''
  if (!id || e.senderFrame !== e.sender.mainFrame || !isAllowedOrigin(url)) return null
  if (!new URL(url).pathname.endsWith('/confirm.html')) return null
  return id
}

export function registerKeys(getWindow: () => BrowserWindow | null): void {
  startAutoLock()
  registerConfirmWindow(signer())
  vault().onChange(() => {
    const w = getWindow()
    if (w && !w.isDestroyed()) w.webContents.send('vault-changed', status())
  })
  vault().onChange((unlocked) => {
    if (!unlocked) {
      closeRevealWindows()
      closeOpenConfirmations()
    }
  })

  handle('keys:status', () => status())
  handle('keys:create', async (_e, pw, pw2) => {
    const a = str(pw, 'password', 1024)
    if (a !== str(pw2, 'password', 1024)) throw new Error('The two passwords are not the same')
    if (a.length < MIN_PASSWORD_LENGTH) throw new Error(`The password needs at least ${MIN_PASSWORD_LENGTH} characters`)
    await vault().create(a)
    return status()
  })
  handle('keys:unlock', async (_e, pw) => {
    await vault().unlock(str(pw, 'password', 1024))
    return status()
  })
  handle('keys:lock', () => {
    lockAll()
    return status()
  })
  handle('keys:list', () => vault().list())
  handle('keys:newPending', () => vault().newPendingKey())
  handle('keys:savePending', (_e, label) => vault().savePendingKey(str(label, 'label', 64)))
  handle('keys:discardPending', () => vault().discardPendingKey())
  handle('keys:import', (_e, key, label) => vault().addKey(str(key, 'privateKey', 200), str(label, 'label', 64)))
  handle('keys:setLabel', (_e, id, label) => vault().setLabel(str(id, 'id', 64), str(label, 'label', 64)))
  handle('keys:remove', async (_e, id) => {
    const keyId = str(id, 'id', 64)
    const k = vault().list().find((x) => x.id === keyId)
    if (!k) throw new Error('Unknown key')
    const ok = await confirmNative(
      getWindow(),
      'Delete this key from the vault?',
      `Label: ${k.label || '(no label)'}
Public key: ${k.publicKey}

The private key is removed. Without a backup it cannot be recovered.`,
      'Delete key'
    )
    if (!ok) return
    vault().removeKey(keyId)
    for (const { keyId: rk, win } of [...revealWindows.values()]) if (rk === keyId && !win.isDestroyed()) win.close()
  })
  handle('keys:reveal', (_e, id) => {
    const keyId = str(id, 'id', 64)
    if (!vault().list().some((k) => k.id === keyId)) throw new Error('Unknown key')
    openRevealWindow(getWindow(), keyId)
  })
  handle('keys:accounts', async (_e, keys) => {
    const list = arr(keys, 'keys', 200).map((k, i) => str(k, `keys[${i}]`, 120))
    if (list.length === 0) return []
    const r = await readCall((ep) => chain.getAccountsByAuthorizers(ep, list))
    return (r.accounts ?? []).map((a) => ({
      account: String(a.account_name),
      permission: String(a.permission_name),
      key: toK1(String(a.authorizing_key ?? '')),
      network: currentNetwork().id
    }))
  })
  // Account picker: starred accounts and accounts of the vault's public keys on one network.
  handle('accounts:pickList', async (_e, networkId) => {
    const n = getNetwork(optStr(networkId, 'networkId', 64) || currentNetwork().id)
    let keys: string[] = []
    try {
      keys = vault().list().map((k) => k.publicKey)
    } catch {
      keys = []
    }
    return pickList(n.id, {
      stars: stars(n.id),
      vaultKeys: keys.slice(0, 200),
      lookup: async (list) => (await readCall((ep) => chain.getAccountsByAuthorizers(ep, list), n)).accounts ?? []
    })
  })
  handle('keys:exportVault', async () => {
    const win = getWindow()
    const opts = { title: 'Export vault', defaultPath: 'wax-master-vault.json', filters: [{ name: 'Vault', extensions: ['json'] }] }
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return false
    writeFileSync(r.filePath, JSON.stringify(vault().exportFile(), null, 2), 'utf8')
    return true
  })
  handle('keys:importVault', async (_e, otherPassword) => {
    const pw = str(otherPassword, 'password', 1024)
    // Asked before the file dialog: the imported keys are stored with this vault's key.
    if (!vault().isUnlocked()) throw new Error(LOCKED_MESSAGE)
    const win = getWindow()
    const opts: Electron.OpenDialogOptions = { title: 'Import vault', properties: ['openFile'], filters: [{ name: 'Vault', extensions: ['json'] }] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || r.filePaths.length === 0) return null
    let other: VaultFile
    try {
      other = JSON.parse(readFileSync(r.filePaths[0], 'utf8').slice(0, 5 * 1024 * 1024)) as VaultFile
    } catch {
      throw new Error('This file is not a WAX Master vault file')
    }
    return vault().importFile(other, pw)
  })

  // Reveal window calls (only from that window).
  ipcMain.handle('reveal:load', (e) => {
    const id = fromRevealWindow(e)
    if (!id) throw new Error('Refused')
    const k = vault().list().find((x) => x.id === id)
    if (!k) throw new Error('Unknown key')
    return { label: k.label, publicKey: k.publicKey }
  })
  ipcMain.handle('reveal:show', async (e, pw: unknown) => {
    const id = fromRevealWindow(e)
    if (!id || typeof pw !== 'string' || pw.length > 1024) throw new Error('Refused')
    return vault().revealPrivateKey(id, pw)
  })
  ipcMain.handle('reveal:copy', async (e, pw: unknown) => {
    const id = fromRevealWindow(e)
    if (!id || typeof pw !== 'string' || pw.length > 1024) throw new Error('Refused')
    copySecretBriefly(await vault().revealPrivateKey(id, pw))
    return true
  })
}
