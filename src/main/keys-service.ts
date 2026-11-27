// Vault and signer instances, automatic locking, the Manage Keypairs calls and
// the calls of the separate key windows (reveal, key backup, recovery code,
// forgotten password).

import { app, BrowserWindow, clipboard, dialog, ipcMain, powerMonitor, type IpcMainInvokeEvent } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { arr, optStr, str } from '../shared/validate'
import { handle } from './ipc'
import { dataDir } from './paths'
import { RESET_WORD, Vault, keptVaultCopies, type VaultFile } from './vault'
import { Signer, defaultDeps } from './signer'
import { closeOpenConfirmations, registerConfirmWindow } from './confirm-window'
import { getSettings, typedDeleteConfirm } from './store'
import { chain } from './rpc'
import { currentNetwork, getNetwork, readCall, stars } from './networks'
import { pickList } from './account-pick'
import { LOCKED_MESSAGE } from '../shared/vault-locked'
import { requirePasswordLength } from '../shared/password'
import { log } from './log'
import { convertPublicKey, isValidName, parsePublicKey, privateKeyToString, publicKeyToString } from '../chain-core'
import {
  askNative,
  closeKeyWindows,
  closeOlderCodeWindows,
  focusKeyWindow,
  fromKeyWindow,
  hideRecoveryCodes,
  openKeyWindow,
  setKeyWindowMode,
  type KeySession
} from './key-windows'
import {
  FILE_EXISTS,
  RECOVERY_CODE_FILE,
  keyBackupFileName,
  keyBackupText,
  recoveryCodeText,
  writeNewFile
} from './key-backup'

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
  /** Keys whose only copy is this vault (backup note 'none'). */
  noBackup: number
  /** The vault has a recovery code. */
  recovery: boolean
  /** Kept older vault files in the data folder (vault.v1.bak.json, vault-old-<date>.json). */
  keptCopies: number
}

function status(): VaultStatus {
  const v = vault()
  let keys = 0
  let noBackup = 0
  let recovery = false
  try {
    const list = v.list()
    keys = list.length
    noBackup = list.filter((k) => k.backup === 'none').length
    recovery = v.hasRecoveryCode()
  } catch {
    keys = 0
  }
  return { exists: v.exists(), unlocked: v.isUnlocked(), keys, noBackup, recovery, keptCopies: keptVaultCopies(dataDir()).length }
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
  app.on('before-quit', () => {
    lockAll()
    clearPendingSecret()
  })
}

// Clipboard: a copied private key or recovery code is cleared after 30 seconds
// if it is still there, and at quit when the 30 seconds have not passed yet.
let pendingSecret: string | null = null

function copySecretBriefly(text: string): void {
  clipboard.writeText(text)
  pendingSecret = text
  setTimeout(async () => {
    if (String(await clipboard.readText()) === text) clipboard.clear()
    if (pendingSecret === text) pendingSecret = null
  }, 30_000).unref()
}

/** Clears the clipboard when it still holds the last copied key or code. */
function clearPendingSecret(): void {
  const text = pendingSecret
  pendingSecret = null
  if (text !== null && String(clipboard.readText()) === text) clipboard.clear()
}

/** Closes the reveal and backup windows (a shown key goes with the window). */
function closeRevealWindows(): void {
  closeKeyWindows(['reveal', 'backup'])
}

/** Locks the vault, closes every reveal and backup window and hides every recovery code on screen. */
function lockAll(): void {
  vault().lock()
  closeRevealWindows()
  hideRecoveryCodes()
}

/** A native confirmation from the main process; Cancel is the default and the answer to Escape. */
export const confirmNative = askNative

/** E73: the word Delete key asks for while the setting is on. */
export const KEY_DELETE_WORD = 'delete'

function documentsDir(): string {
  try {
    return app.getPath('documents')
  } catch {
    return dataDir()
  }
}

/**
 * The system Save dialog for a plain-text secret file. Returns the chosen path,
 * or null when the user stopped. An existing file is refused (never replaced).
 * A synchronized folder (OneDrive, Dropbox, ...) asks nothing more (E70).
 */
async function chooseSecretFile(win: BrowserWindow, title: string, name: string): Promise<string | null> {
  const opts: Electron.SaveDialogOptions = {
    title,
    defaultPath: join(documentsDir(), name),
    filters: [{ name: 'Text', extensions: ['txt'] }]
  }
  const r = await dialog.showSaveDialog(win, opts)
  // The window closed (a lock) while the dialog was open: nothing is written.
  if (r.canceled || !r.filePath || win.isDestroyed()) return null
  if (existsSync(r.filePath)) throw new Error(FILE_EXISTS)
  return r.filePath
}

/** Most account@permission lines written into a key backup file. */
export const MAX_BACKUP_ACCOUNTS = 200

/**
 * The account@permission lines of a node's answer for the backup file: the
 * answer is untrusted text, so only valid chain names are kept, at most 200.
 */
export function backupAccountLines(rows: readonly { account_name?: unknown; permission_name?: unknown }[]): string[] {
  const out: string[] = []
  for (const a of rows) {
    if (out.length >= MAX_BACKUP_ACCOUNTS) break
    const account = a.account_name
    const permission = a.permission_name
    if (typeof account !== 'string' || typeof permission !== 'string') continue
    if (!isValidName(account) || !isValidName(permission)) continue
    out.push(`${account}@${permission}`)
  }
  return out
}

async function accountsOfKey(publicKey: string): Promise<string[] | null> {
  try {
    const r = await readCall((ep) => chain.getAccountsByAuthorizers(ep, [publicKey]))
    return backupAccountLines(Array.isArray(r.accounts) ? r.accounts : [])
  } catch {
    return null
  }
}

/** Writes the plain-text backup of one key, after the password was typed again in the backup window. */
async function saveKeyBackup(s: KeySession, password: string): Promise<'saved' | 'cancelled'> {
  const id = s.keyId!
  const entry = vault().list().find((k) => k.id === id)
  if (!entry) throw new Error('Unknown key')
  // The password first: a wrong one is refused before any dialog.
  await vault().checkPassword(password)
  const path = await chooseSecretFile(s.win, 'Save key backup', keyBackupFileName(entry.label, entry.publicKey))
  if (!path || s.win.isDestroyed()) return 'cancelled'
  const accounts = await accountsOfKey(entry.publicKey)
  const network = currentNetwork().name
  if (s.win.isDestroyed()) return 'cancelled'
  const written = await vault().withRevealedKey(id, password, (priv, e) => {
    // The window can close (a lock) during the waits above and the key derivation.
    if (s.win.isDestroyed()) return false
    writeNewFile(
      path,
      keyBackupText({
        date: new Date(),
        label: e.label,
        publicKey: e.publicKey,
        publicKeyLegacy: convertPublicKey(e.publicKey, 'legacy'),
        privateKey: privateKeyToString(priv, 'new'),
        privateKeyWif: privateKeyToString(priv, 'wif'),
        network,
        accounts
      })
    )
    return true
  })
  if (!written) return 'cancelled'
  vault().setBackup(id, 'file')
  s.saved = true
  log.info('Key backup file written')
  return 'saved'
}

/** Opens the window that shows a new recovery code once; a window with an older code closes. */
function showRecoveryCode(parent: BrowserWindow | null, code: string): void {
  closeOlderCodeWindows()
  openKeyWindow(parent, 'code', { code })
}

/** The reveal window's key was shown or copied: noted as `shown` only when it had no backup before. */
function noteShown(id: string): void {
  if (vault().backupOf(id) === 'none') vault().setBackup(id, 'shown')
}

function pw(v: unknown, field = 'password'): string {
  return str(v, field, 1024)
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
      hideRecoveryCodes()
    }
  })

  handle('keys:status', () => status())
  handle('keys:create', async (_e, pw1, pw2) => {
    const a = pw(pw1)
    if (a !== pw(pw2)) throw new Error('The two passwords are not the same')
    requirePasswordLength(a)
    const code = await vault().create(a)
    showRecoveryCode(getWindow(), code)
    return status()
  })
  handle('keys:unlock', async (_e, pw1) => {
    const code = await vault().unlock(pw(pw1))
    if (code) {
      log.info('Vault converted to file version 2')
      showRecoveryCode(getWindow(), code)
    }
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
  // E73: with the setting on, the typed word `delete` is the confirmation (nothing else is asked);
  // off, the normal question is asked here.
  handle('keys:remove', async (_e, id, typed) => {
    const keyId = str(id, 'id', 64)
    const word = optStr(typed, 'typed', 20)
    const k = vault().list().find((x) => x.id === keyId)
    if (!k) throw new Error('Unknown key')
    if (typedDeleteConfirm()) {
      if (word !== KEY_DELETE_WORD) throw new Error(`Type "${KEY_DELETE_WORD}" to delete the key`)
      vault().removeKey(keyId)
      closeKeyWindows(['reveal', 'backup'], keyId)
      return
    }
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
    closeKeyWindows(['reveal', 'backup'], keyId)
  })
  handle('keys:reveal', (_e, id) => {
    const keyId = str(id, 'id', 64)
    if (!vault().list().some((k) => k.id === keyId)) throw new Error('Unknown key')
    openKeyWindow(getWindow(), 'reveal', { keyId })
  })
  // Back up one key: the separate window asks the password and writes the file; this window learns only the outcome.
  handle('keys:backup', (_e, id) => {
    const keyId = str(id, 'id', 64)
    if (!vault().list().some((k) => k.id === keyId)) throw new Error('Unknown key')
    return new Promise<'saved' | 'cancelled'>((resolve) => {
      openKeyWindow(getWindow(), 'backup', { keyId, onClosed: (s) => resolve(s.saved ? 'saved' : 'cancelled') })
    })
  })
  // Forgot password: the recovery window (code and new password, or reset); nothing comes back here.
  handle('keys:forgot', () => {
    if (!vault().exists()) throw new Error('No vault yet')
    if (!focusKeyWindow('recover')) openKeyWindow(getWindow(), 'recover')
  })
  handle('keys:changePassword', async (_e, current, next, again) => {
    const a = pw(next, 'newPassword')
    if (a !== pw(again, 'newPassword')) throw new Error('The two new passwords are not the same')
    requirePasswordLength(a)
    await vault().changePassword(pw(current), a)
    log.info('Vault password changed')
    return status()
  })
  handle('keys:newRecoveryCode', async (_e, password) => {
    const code = await vault().newRecoveryCode(pw(password))
    log.info('New vault recovery code made')
    showRecoveryCode(getWindow(), code)
    return status()
  })
  handle('keys:removeRecoveryCode', async (_e, password) => {
    const p = pw(password)
    await vault().checkPassword(p)
    const ok = await confirmNative(
      getWindow(),
      'Remove the recovery code?',
      'Without a recovery code a forgotten password cannot be recovered: the keys in the vault are then lost. The current code stops working.',
      'Remove code'
    )
    if (!ok) return status()
    await vault().removeRecoveryCode(p)
    closeOlderCodeWindows()
    log.info('Vault recovery code removed')
    return status()
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
    // Version 2 only; a version 1 file asks for the unlock that converts it (before the file dialog).
    if (vault().exists() && vault().version() !== 2) throw new Error(LOCKED_MESSAGE)
    const win = getWindow()
    const opts = { title: 'Export vault', defaultPath: 'wax-master-vault.json', filters: [{ name: 'Vault', extensions: ['json'] }] }
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return false
    const file = vault().exportFile()
    writeFileSync(r.filePath, JSON.stringify(file, null, 2), 'utf8')
    vault().markExported(file.keys.map((k) => k.publicKey))
    return true
  })
  handle('keys:importVault', async (_e, otherSecret) => {
    const secret = pw(otherSecret)
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
    return vault().importFile(other, secret)
  })

  registerKeyWindowCalls()
}

function refused(): never {
  throw new Error('Refused')
}

/** Calls of the separate key windows; each is accepted only from a window of its mode. */
function registerKeyWindowCalls(): void {
  const fromReveal = (e: IpcMainInvokeEvent): string => fromKeyWindow(e, 'reveal')?.keyId ?? refused()
  const secret = (v: unknown, max = 1024): string => (typeof v === 'string' && v.length <= max ? v : refused())

  ipcMain.handle('reveal:load', (e) => {
    const id = fromReveal(e)
    const k = vault().list().find((x) => x.id === id)
    if (!k) throw new Error('Unknown key')
    return { label: k.label, publicKey: k.publicKey }
  })
  ipcMain.handle('reveal:show', async (e, p: unknown) => {
    const id = fromReveal(e)
    const shown = await vault().revealPrivateKey(id, secret(p))
    noteShown(id)
    return shown
  })
  ipcMain.handle('reveal:copy', async (e, p: unknown) => {
    const id = fromReveal(e)
    copySecretBriefly(await vault().revealPrivateKey(id, secret(p)))
    noteShown(id)
    return true
  })

  ipcMain.handle('keywin:load', (e) => {
    const s = fromKeyWindow(e, 'backup', 'code', 'recover') ?? refused()
    if (s.mode === 'backup') {
      const k = vault().list().find((x) => x.id === s.keyId)
      if (!k) throw new Error('Unknown key')
      return { mode: s.mode, label: k.label, publicKey: k.publicKey }
    }
    if (s.mode === 'code') return { mode: s.mode, code: s.code ?? '', hidden: s.hidden === true }
    let keys = 0
    try {
      keys = vault().list().length
    } catch {
      keys = 0
    }
    // E73: whether Reset asks for the typed word (the setting is read here, not taken from the window).
    return { mode: s.mode, keys, recovery: vault().exists() && vault().hasRecoveryCode(), typedWord: typedDeleteConfirm() }
  })
  ipcMain.handle('keywin:backupSave', async (e, p: unknown) => {
    const s = fromKeyWindow(e, 'backup') ?? refused()
    return saveKeyBackup(s, secret(p))
  })
  ipcMain.handle('keywin:codeCopy', (e) => {
    const s = fromKeyWindow(e, 'code') ?? refused()
    if (!s.code) throw new Error('No code to copy')
    copySecretBriefly(s.code)
    return true
  })
  ipcMain.handle('keywin:codeSave', async (e) => {
    const s = fromKeyWindow(e, 'code') ?? refused()
    if (!s.code) throw new Error('No code to save')
    const path = await chooseSecretFile(s.win, 'Save recovery code', RECOVERY_CODE_FILE)
    // The code was hidden (a lock) or replaced, or the window closed, while the dialog was open: nothing is written.
    if (!path || !s.code || s.win.isDestroyed()) return 'cancelled'
    writeNewFile(path, recoveryCodeText(s.code, new Date()))
    log.info('Recovery code file written')
    return 'saved'
  })
  ipcMain.handle('keywin:codeDone', (e) => {
    const s = fromKeyWindow(e, 'code') ?? refused()
    s.closeOk = true
    s.code = undefined
    setTimeout(() => !s.win.isDestroyed() && s.win.close(), 10)
    return true
  })
  // Forgotten password, path 1: the code opens the vault key; the new password and a new code replace the old ones.
  ipcMain.handle('keywin:recover', async (e, code: unknown, p1: unknown, p2: unknown) => {
    const s = fromKeyWindow(e, 'recover') ?? refused()
    const c = secret(code, 100)
    const a = secret(p1)
    if (a !== secret(p2)) throw new Error('The two passwords are not the same')
    requirePasswordLength(a)
    const next = await vault().recoverWithCode(c, a)
    log.info('Vault opened with the recovery code; new password and code set')
    // The same window now shows the new code once; a window with an older code closes.
    setKeyWindowMode(s, 'code')
    s.code = next
    closeOlderCodeWindows(s)
    return { code: next }
  })
  // Forgotten password, path 2: the vault file is moved aside and an empty start follows.
  // E73: with the setting on, the typed word RESET is the confirmation; off, a normal question is asked here.
  ipcMain.handle('keywin:reset', async (e, typed: unknown) => {
    const s = fromKeyWindow(e, 'recover') ?? refused()
    let word = secret(typed, 20)
    if (!typedDeleteConfirm()) {
      const ok = await confirmNative(
        s.win,
        'Reset the vault?',
        'A new, empty vault starts. The old vault file is not deleted: it is moved to vault-old-<date>.json in the data folder and can be imported later with its password.',
        'Reset the vault'
      )
      if (!ok || s.win.isDestroyed()) return { file: '' }
      word = RESET_WORD
    }
    const name = vault().reset(word)
    closeRevealWindows()
    closeOpenConfirmations()
    closeOlderCodeWindows()
    log.info('Vault reset; the old file was kept in the data folder')
    return { file: name }
  })
}
