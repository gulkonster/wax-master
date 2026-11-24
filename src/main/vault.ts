// Encrypted key vault (vault.json), file version 2. A random 32-byte vault key
// encrypts the private keys one by one with AES-256-GCM. The vault key itself is
// stored twice, wrapped: once under a key derived from the password and once
// under a key derived from the recovery code (scrypt, each with its own salt).
// Either opens the vault. Public keys, labels and backup notes stay readable so
// the app can show keys and match permissions while the vault is locked.
//
// Version 1 files (keys encrypted directly under the password key) are converted
// at the first unlock: written to a temporary file and renamed, with the old file
// kept once as vault.v1.bak.json.
//
// Only the signer may ask for a decrypted private key (withPrivateKey); the
// decrypted bytes are wiped as soon as the callback returns.

import { createCipheriv, createDecipheriv, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { copyFileSync, existsSync, readFileSync, renameSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import {
  generatePrivateKey,
  parsePrivateKey,
  privateKeyToString,
  publicFromPrivate,
  publicKeyToString,
  signDigest,
  verifySignature,
  type PrivateKey
} from '../chain-core'
import { sha256 } from '@noble/hashes/sha2.js'
import { writeJson } from './jsonfile'
import { LOCKED_MESSAGE } from '../shared/vault-locked'
import { requirePasswordLength } from '../shared/password'
import { newRecoveryCode, normalizeRecoveryCode } from './recovery-code'

export { MIN_PASSWORD_LENGTH } from '../shared/password'

export interface KdfParams {
  name: 'scrypt'
  N: number
  r: number
  p: number
  salt: string
}

interface Sealed {
  iv: string
  tag: string
  data: string
}

/** How the user can get a key back without this vault (clear text in the file). */
export type BackupState = 'none' | 'file' | 'shown' | 'imported' | 'vault-export'
export const BACKUP_STATES: readonly BackupState[] = ['none', 'file', 'shown', 'imported', 'vault-export']

export interface BackupNote {
  state: BackupState
  at: number
}

export interface StoredKey {
  id: string
  label: string
  publicKey: string
  created: number
  enc: Sealed
  /** Missing in version 1 files: read as 'none'. */
  backup?: BackupNote
}

export interface VaultFileV1 {
  format: 'wax-master-vault'
  version: 1
  kdf: KdfParams
  check: Sealed
  keys: StoredKey[]
}

/** The vault key wrapped under a key derived with `kdf`. */
export interface WrappedKey {
  kdf: KdfParams
  wrapped: Sealed
}

export interface VaultFileV2 {
  format: 'wax-master-vault'
  version: 2
  /** The vault key under the password. */
  kdf: KdfParams
  wrapped: Sealed
  /** The vault key under the recovery code; null when the user removed the code. */
  recovery: WrappedKey | null
  keys: StoredKey[]
}

export type VaultFile = VaultFileV1 | VaultFileV2

export interface PublicKeyEntry {
  id: string
  label: string
  publicKey: string
  created: number
  backup: BackupState
  backupAt: number
}

const CHECK_TEXT = 'wax-master-vault-check'
export const DEFAULT_KDF = { N: 2 ** 17, r: 8, p: 1 }
/** Smallest and largest scrypt cost accepted from a vault file. */
export const MIN_KDF_N = 2 ** 15
export const MAX_KDF_N = 2 ** 20
const MAX_KEYS = 1000
const DAMAGED = 'is damaged or from an unknown version'
/** One answer for a wrong password and a wrong recovery code. */
export const WRONG_SECRET = 'Wrong password or recovery code'
export const NO_RECOVERY = 'This vault has no recovery code.'
export const RESET_WORD = 'RESET'
export const V1_BACKUP_NAME = 'vault.v1.bak.json'

const AAD_PASSWORD = 'vault-key:password'
const AAD_RECOVERY = 'vault-key:recovery'

const B64 = /^[A-Za-z0-9+/]*={0,2}$/

function isSealed(s: unknown, ivLen: number, tagLen: number, dataLen?: number): s is Sealed {
  if (!s || typeof s !== 'object') return false
  const { iv, tag, data } = s as Record<string, unknown>
  if (typeof iv !== 'string' || typeof tag !== 'string' || typeof data !== 'string') return false
  if (!B64.test(iv) || !B64.test(tag) || !B64.test(data)) return false
  if (dataLen !== undefined && Buffer.from(data, 'base64').length !== dataLen) return false
  return Buffer.from(iv, 'base64').length === ivLen && Buffer.from(tag, 'base64').length === tagLen
}

function isKdf(k: unknown, minN: number): k is KdfParams {
  if (!k || typeof k !== 'object') return false
  const x = k as Record<string, unknown>
  if (x.name !== 'scrypt') return false
  const n = x.N
  if (typeof n !== 'number' || !Number.isInteger(n) || n < minN || n > MAX_KDF_N || (n & (n - 1)) !== 0) return false
  if (x.r !== 8 || x.p !== 1) return false
  if (typeof x.salt !== 'string' || !B64.test(x.salt)) return false
  const saltLen = Buffer.from(x.salt, 'base64').length
  return saltLen >= 16 && saltLen <= 64
}

function isBackupNote(b: unknown): b is BackupNote {
  if (!b || typeof b !== 'object') return false
  const x = b as Record<string, unknown>
  return typeof x.state === 'string' && (BACKUP_STATES as readonly string[]).includes(x.state) && typeof x.at === 'number' && Number.isFinite(x.at)
}

function keysValid(list: unknown): boolean {
  if (!Array.isArray(list) || list.length > MAX_KEYS) return false
  for (const e of list as unknown[]) {
    if (!e || typeof e !== 'object') return false
    const x = e as Record<string, unknown>
    if (typeof x.id !== 'string' || typeof x.label !== 'string' || typeof x.publicKey !== 'string') return false
    if (typeof x.created !== 'number' || !isSealed(x.enc, 12, 16)) return false
    if (x.backup !== undefined && !isBackupNote(x.backup)) return false
  }
  return true
}

/** Checks every value of a vault file (version 1 or 2) before it is used (the file may come from outside). */
export function validateVaultFile(v: unknown, minN: number): v is VaultFile {
  if (!v || typeof v !== 'object') return false
  const f = v as Record<string, unknown>
  if (f.format !== 'wax-master-vault') return false
  if (!isKdf(f.kdf, minN)) return false
  if (f.version === 1) {
    if (!isSealed(f.check, 12, 16)) return false
  } else if (f.version === 2) {
    if (!isSealed(f.wrapped, 12, 16, 32)) return false
    if (f.recovery !== null) {
      const r = f.recovery as Record<string, unknown> | undefined
      if (!r || typeof r !== 'object' || !isKdf(r.kdf, minN) || !isSealed(r.wrapped, 12, 16, 32)) return false
    }
  } else return false
  return keysValid(f.keys)
}

function b64(b: Uint8Array): string {
  return Buffer.from(b).toString('base64')
}
function unb64(s: string): Buffer {
  return Buffer.from(s, 'base64')
}

function deriveKey(secret: string, kdf: KdfParams): Promise<Buffer> {
  const maxmem = 128 * kdf.N * kdf.r * 2 + 1024 * 1024
  return new Promise((resolve, reject) => {
    scryptCb(secret.normalize('NFC'), unb64(kdf.salt), 32, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem }, (err, key) =>
      err ? reject(err) : resolve(key)
    )
  })
}

function seal(key: Buffer, plain: Uint8Array, aad: string): Sealed {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key, iv)
  c.setAAD(Buffer.from(aad, 'utf8'))
  const data = Buffer.concat([c.update(plain), c.final()])
  return { iv: b64(iv), tag: b64(c.getAuthTag()), data: b64(data) }
}

function open(key: Buffer, s: Sealed, aad: string): Buffer {
  const d = createDecipheriv('aes-256-gcm', key, unb64(s.iv))
  d.setAAD(Buffer.from(aad, 'utf8'))
  d.setAuthTag(unb64(s.tag))
  return Buffer.concat([d.update(unb64(s.data)), d.final()])
}

function keyAad(id: string, publicKey: string): string {
  return `key:${id}:${publicKey}`
}

/** Checks that a new key can sign and that its public key is derived correctly (security plan row 31). */
function selfTest(priv: PrivateKey): string {
  const pub = publicFromPrivate(priv)
  const digest = sha256(new TextEncoder().encode(`wax-master key check ${Date.now()}`))
  const sig = signDigest(digest, priv)
  if (!verifySignature(digest, sig, pub)) throw new Error('Key check failed: the signature did not verify')
  return publicKeyToString(pub, 'new')
}

/** Opens a wrapped vault key with a derived key; null when it does not open (wrong secret). */
function unwrap(derived: Buffer, wrapped: Sealed, aad: string): Buffer | null {
  try {
    const k = open(derived, wrapped, aad)
    return k.length === 32 ? k : null
  } catch {
    return null
  }
}

/** The key that encrypts the private keys of a file, from its password; null when wrong. */
async function keysKeyFromPassword(v: VaultFile, password: string): Promise<Buffer | null> {
  const derived = await deriveKey(password, v.kdf)
  if (v.version === 2) {
    try {
      return unwrap(derived, v.wrapped, AAD_PASSWORD)
    } finally {
      derived.fill(0)
    }
  }
  let ok = false
  try {
    const text = open(derived, v.check, 'check')
    ok = text.length === CHECK_TEXT.length && timingSafeEqual(text, Buffer.from(CHECK_TEXT, 'utf8'))
  } catch {
    ok = false
  }
  if (!ok) {
    derived.fill(0)
    return null
  }
  return derived
}

/** The vault key of a version 2 file from its recovery code; null when wrong or when the file has none. */
async function keysKeyFromCode(v: VaultFile, code: string): Promise<Buffer | null> {
  if (v.version !== 2 || !v.recovery) return null
  const plain = normalizeRecoveryCode(code)
  if (!plain) return null
  const derived = await deriveKey(plain, v.recovery.kdf)
  try {
    return unwrap(derived, v.recovery.wrapped, AAD_RECOVERY)
  } finally {
    derived.fill(0)
  }
}

function noteOf(k: StoredKey): BackupNote {
  return k.backup ?? { state: 'none', at: k.created }
}

function entryOf(k: StoredKey): PublicKeyEntry {
  const b = noteOf(k)
  return { id: k.id, label: k.label, publicKey: k.publicKey, created: k.created, backup: b.state, backupAt: b.at }
}

function isoDate(t: number): string {
  return new Date(t).toISOString().slice(0, 10)
}

export class Vault {
  /** The vault key while unlocked. */
  private vaultKey: Buffer | null = null
  private data: VaultFile | null = null
  private listeners = new Set<(unlocked: boolean) => void>()

  /**
   * minN is the smallest scrypt N accepted from a file. Production uses the default;
   * a test that creates vaults with a small N passes a lower value (it defaults to
   * the given kdf's own N when a custom kdf is given).
   */
  constructor(
    private readonly file: string,
    private readonly kdf = DEFAULT_KDF,
    private readonly minN = kdf === DEFAULT_KDF ? MIN_KDF_N : Math.min(MIN_KDF_N, kdf.N)
  ) {}

  static inDir(dir: string): Vault {
    return new Vault(join(dir, 'vault.json'))
  }

  /** Called after create, unlock, lock and reset, and after keys or their backup notes changed. */
  onChange(fn: (unlocked: boolean) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit(): void {
    for (const l of this.listeners) l(this.isUnlocked())
  }

  private load(): VaultFile | null {
    if (this.data) return this.data
    if (!existsSync(this.file)) return null
    let v: unknown = null
    try {
      v = JSON.parse(readFileSync(this.file, 'utf8'))
    } catch {
      v = null
    }
    if (!validateVaultFile(v, this.minN)) {
      throw new Error(`vault.json ${DAMAGED}`)
    }
    this.data = v
    return v
  }

  private save(): void {
    if (this.data) writeJson(this.file, this.data)
  }

  /** Saves after keys were added or removed and tells the listeners, so the shown key count follows. */
  private saveKeys(): void {
    this.save()
    this.emit()
  }

  private newKdf(): KdfParams {
    return { name: 'scrypt', ...this.kdf, salt: b64(randomBytes(32)) }
  }

  /** A new password wrap of the vault key. */
  private async wrapForPassword(vaultKey: Buffer, password: string): Promise<{ kdf: KdfParams; wrapped: Sealed }> {
    const kdf = this.newKdf()
    const derived = await deriveKey(password, kdf)
    try {
      return { kdf, wrapped: seal(derived, vaultKey, AAD_PASSWORD) }
    } finally {
      derived.fill(0)
    }
  }

  /** A new recovery code and the vault key wrapped under it. The code is returned once and kept nowhere. */
  private async wrapForNewCode(vaultKey: Buffer): Promise<{ code: string; recovery: WrappedKey }> {
    const code = newRecoveryCode()
    const kdf = this.newKdf()
    const derived = await deriveKey(normalizeRecoveryCode(code)!, kdf)
    try {
      return { code, recovery: { kdf, wrapped: seal(derived, vaultKey, AAD_RECOVERY) } }
    } finally {
      derived.fill(0)
    }
  }

  exists(): boolean {
    return existsSync(this.file)
  }

  isUnlocked(): boolean {
    return this.vaultKey !== null
  }

  /** The file version on disk (null when there is no vault). */
  version(): 1 | 2 | null {
    return this.load()?.version ?? null
  }

  hasRecoveryCode(): boolean {
    const v = this.load()
    return v?.version === 2 && v.recovery !== null
  }

  /** Creates a version 2 vault and unlocks it. Returns the recovery code, to be shown once. */
  async create(password: string): Promise<string> {
    if (this.exists()) throw new Error('A vault already exists')
    requirePasswordLength(password)
    const vaultKey = randomBytes(32)
    const pw = await this.wrapForPassword(vaultKey, password)
    const { code, recovery } = await this.wrapForNewCode(vaultKey)
    this.data = { format: 'wax-master-vault', version: 2, kdf: pw.kdf, wrapped: pw.wrapped, recovery, keys: [] }
    this.save()
    this.vaultKey = vaultKey
    this.emit()
    return code
  }

  /**
   * Converts a version 1 file to version 2: a new vault key re-encrypts every
   * key, the password wrap reuses the file's own scrypt parameters (the derived
   * key is at hand), and a recovery code is made. The old file is copied once to
   * vault.v1.bak.json; the new one is written to a temporary file and renamed,
   * so an interrupted write leaves the version 1 file as it was.
   */
  private async convert(v1: VaultFileV1, derived: Buffer): Promise<{ vaultKey: Buffer; code: string }> {
    const vaultKey = randomBytes(32)
    const keys: StoredKey[] = []
    for (const k of v1.keys) {
      const data = open(derived, k.enc, keyAad(k.id, k.publicKey))
      try {
        keys.push({ ...k, enc: seal(vaultKey, data, keyAad(k.id, k.publicKey)), backup: noteOf(k) })
      } finally {
        data.fill(0)
      }
    }
    const { code, recovery } = await this.wrapForNewCode(vaultKey)
    const next: VaultFileV2 = {
      format: 'wax-master-vault',
      version: 2,
      kdf: v1.kdf,
      wrapped: seal(derived, vaultKey, AAD_PASSWORD),
      recovery,
      keys
    }
    const bak = join(dirname(this.file), V1_BACKUP_NAME)
    if (!existsSync(bak)) copyFileSync(this.file, bak)
    writeJson(this.file, next)
    this.data = next
    return { vaultKey, code }
  }

  /**
   * Unlocks with the password. A version 1 file is converted first; then the new
   * recovery code is returned (to be shown once), otherwise null.
   */
  async unlock(password: string): Promise<string | null> {
    const v = this.load()
    if (!v) throw new Error('No vault yet')
    const key = await keysKeyFromPassword(v, password)
    if (!key) throw new Error(WRONG_SECRET)
    let code: string | null = null
    let vaultKey = key
    if (v.version === 1) {
      try {
        const r = await this.convert(v, key)
        vaultKey = r.vaultKey
        code = r.code
      } catch (e) {
        throw new Error(`The vault could not be converted to the new format; it is unchanged. ${e instanceof Error ? e.message : String(e)}`)
      } finally {
        key.fill(0)
      }
    }
    this.vaultKey?.fill(0)
    this.vaultKey = vaultKey
    this.emit()
    return code
  }

  /** Checks the password without changing the lock state (used before revealing a key). */
  async checkPassword(password: string): Promise<void> {
    const v = this.load()
    if (!v) throw new Error('No vault yet')
    const key = await keysKeyFromPassword(v, password)
    if (!key) throw new Error(WRONG_SECRET)
    key.fill(0)
  }

  /** The version 2 file and its vault key from the password, for a change of the wraps; v1 asks for an unlock first. */
  private async v2WithPassword(password: string): Promise<{ v: VaultFileV2; vaultKey: Buffer }> {
    const v = this.load()
    if (!v) throw new Error('No vault yet')
    // Unlocking converts a version 1 file; the wraps are changed only on version 2.
    if (v.version !== 2) throw new Error(LOCKED_MESSAGE)
    const vaultKey = await keysKeyFromPassword(v, password)
    if (!vaultKey) throw new Error(WRONG_SECRET)
    return { v, vaultKey }
  }

  /** Change password: only the password wrap of the vault key is rewritten. */
  async changePassword(current: string, next: string): Promise<void> {
    requirePasswordLength(next)
    const { v, vaultKey } = await this.v2WithPassword(current)
    try {
      const pw = await this.wrapForPassword(vaultKey, next)
      v.kdf = pw.kdf
      v.wrapped = pw.wrapped
      this.save()
    } finally {
      vaultKey.fill(0)
    }
  }

  /** New recovery code (the old one stops working). Returns the code, to be shown once. */
  async newRecoveryCode(password: string): Promise<string> {
    const { v, vaultKey } = await this.v2WithPassword(password)
    try {
      const { code, recovery } = await this.wrapForNewCode(vaultKey)
      v.recovery = recovery
      this.save()
      this.emit()
      return code
    } finally {
      vaultKey.fill(0)
    }
  }

  async removeRecoveryCode(password: string): Promise<void> {
    const { v, vaultKey } = await this.v2WithPassword(password)
    vaultKey.fill(0)
    v.recovery = null
    this.save()
    this.emit()
  }

  /**
   * Forgotten password: the recovery code opens the vault key, which is wrapped
   * under the new password; a new recovery code replaces the used one; the vault
   * is unlocked. Returns the new code, to be shown once.
   */
  async recoverWithCode(code: string, newPassword: string): Promise<string> {
    requirePasswordLength(newPassword)
    const v = this.load()
    if (!v) throw new Error('No vault yet')
    if (v.version !== 2 || !v.recovery) throw new Error(NO_RECOVERY)
    const vaultKey = await keysKeyFromCode(v, code)
    if (!vaultKey) throw new Error(WRONG_SECRET)
    try {
      const pw = await this.wrapForPassword(vaultKey, newPassword)
      const next = await this.wrapForNewCode(vaultKey)
      v.kdf = pw.kdf
      v.wrapped = pw.wrapped
      v.recovery = next.recovery
      this.save()
      this.vaultKey?.fill(0)
      this.vaultKey = vaultKey
      this.emit()
      return next.code
    } catch (e) {
      vaultKey.fill(0)
      throw e
    }
  }

  /**
   * Reset: the vault file is moved (not deleted) to vault-old-<date>.json in the
   * same folder, so it can be imported later with its password. Needs the typed word.
   * Returns the name of the moved file.
   */
  reset(typed: string): string {
    if (typed !== RESET_WORD) throw new Error(`Type ${RESET_WORD} to reset the vault.`)
    if (!this.exists()) throw new Error('No vault yet')
    this.lock()
    const dir = dirname(this.file)
    const date = isoDate(Date.now())
    let target = join(dir, `vault-old-${date}.json`)
    for (let i = 2; existsSync(target); i++) target = join(dir, `vault-old-${date}-${i}.json`)
    renameSync(this.file, target)
    this.data = null
    this.emit()
    return basename(target)
  }

  lock(): void {
    this.discardPendingKey()
    if (this.vaultKey) {
      this.vaultKey.fill(0)
      this.vaultKey = null
      this.emit()
    }
  }

  list(): PublicKeyEntry[] {
    const v = this.load()
    return (v?.keys ?? []).map(entryOf)
  }

  hasPublicKey(publicKey: string): boolean {
    return this.list().some((k) => k.publicKey === publicKey)
  }

  private requireUnlocked(): Buffer {
    if (!this.vaultKey) throw new Error(LOCKED_MESSAGE)
    return this.vaultKey
  }

  /** Adds a private key given as text (WIF or PVT_K1_). Returns the stored public entry. */
  addKey(privateKeyText: string, label: string, backup: BackupState = 'imported'): PublicKeyEntry {
    const key = this.requireUnlocked()
    const v = this.load()!
    let priv: PrivateKey
    try {
      priv = parsePrivateKey(privateKeyText.trim())
    } catch {
      throw new Error('This is not a valid private key')
    }
    if (priv.type !== 'K1') throw new Error('Only K1 keys can be imported for signing')
    try {
      const publicKey = selfTest(priv)
      if (v.keys.some((k) => k.publicKey === publicKey)) throw new Error('This key is already in the vault')
      const id = randomUUID()
      const now = Date.now()
      const entry: StoredKey = {
        id,
        label: label.trim().slice(0, 64),
        publicKey,
        created: now,
        enc: seal(key, priv.data, keyAad(id, publicKey)),
        backup: { state: backup, at: now }
      }
      v.keys.push(entry)
      this.saveKeys()
      return entryOf(entry)
    } finally {
      priv.data.fill(0)
    }
  }

  private pending: PrivateKey | null = null

  /** Creates a new key in memory only (Create dialog); returns its public key. Regenerating replaces it. */
  newPendingKey(): string {
    this.requireUnlocked()
    this.discardPendingKey()
    const priv = generatePrivateKey()
    const pub = selfTest(priv)
    this.pending = priv
    return pub
  }

  discardPendingKey(): void {
    this.pending?.data.fill(0)
    this.pending = null
  }

  /** Stores the pending key under a label. */
  savePendingKey(label: string): PublicKeyEntry {
    if (!this.pending) throw new Error('No new key to save; press Regenerate')
    const priv = this.pending
    this.pending = null
    return this.storeGenerated(priv, label)
  }

  /** Generates a new key and stores it at once. Returns only the public entry. */
  generateKey(label: string): PublicKeyEntry {
    return this.storeGenerated(generatePrivateKey(), label)
  }

  private storeGenerated(priv: PrivateKey, label: string): PublicKeyEntry {
    const key = this.requireUnlocked()
    const v = this.load()!
    try {
      const publicKey = selfTest(priv)
      const id = randomUUID()
      const now = Date.now()
      const entry: StoredKey = {
        id,
        label: label.trim().slice(0, 64),
        publicKey,
        created: now,
        enc: seal(key, priv.data, keyAad(id, publicKey)),
        backup: { state: 'none', at: now }
      }
      v.keys.push(entry)
      this.saveKeys()
      return entryOf(entry)
    } finally {
      priv.data.fill(0)
    }
  }

  setLabel(id: string, label: string): void {
    const v = this.load()
    const k = v?.keys.find((x) => x.id === id)
    if (!k) throw new Error('Unknown key')
    k.label = label.trim().slice(0, 64)
    this.save()
  }

  /** Records how the key was backed up (works while locked: the note is clear text). */
  setBackup(id: string, state: BackupState): void {
    const v = this.load()
    const k = v?.keys.find((x) => x.id === id)
    if (!k) throw new Error('Unknown key')
    k.backup = { state, at: Date.now() }
    this.saveKeys()
  }

  removeKey(id: string): void {
    const v = this.load()
    if (!v) return
    v.keys = v.keys.filter((k) => k.id !== id)
    this.saveKeys()
  }

  /**
   * Gives the decrypted private key to the callback and wipes it afterwards.
   * Only the signer module calls this.
   */
  withPrivateKey<T>(publicKey: string, fn: (key: PrivateKey) => T): T {
    const vaultKey = this.requireUnlocked()
    const v = this.load()!
    const k = v.keys.find((x) => x.publicKey === publicKey)
    if (!k) throw new Error('The vault has no private key for this public key')
    const data = open(vaultKey, k.enc, keyAad(k.id, k.publicKey))
    const priv: PrivateKey = { type: 'K1', data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) }
    try {
      return fn(priv)
    } finally {
      data.fill(0)
    }
  }

  /**
   * Reveal flows (show, copy, backup file): the password is asked again; the
   * decrypted key goes to the callback and is wiped afterwards. The lock state
   * does not change.
   */
  async withRevealedKey<T>(id: string, password: string, fn: (key: PrivateKey, entry: PublicKeyEntry) => T | Promise<T>): Promise<T> {
    const v = this.load()
    if (!v) throw new Error('No vault yet')
    const temp = await keysKeyFromPassword(v, password)
    if (!temp) throw new Error(WRONG_SECRET)
    try {
      const k = v.keys.find((x) => x.id === id)
      if (!k) throw new Error('Unknown key')
      const data = open(temp, k.enc, keyAad(k.id, k.publicKey))
      try {
        return await fn({ type: 'K1', data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) }, entryOf(k))
      } finally {
        data.fill(0)
      }
    } finally {
      temp.fill(0)
    }
  }

  /** Reveal flow: the password is asked again; returns the key text for a short display. */
  async revealPrivateKey(id: string, password: string): Promise<string> {
    return this.withRevealedKey(id, password, (priv) => privateKeyToString(priv, 'new'))
  }

  /**
   * The vault file for Export (already encrypted; version 2, so it opens with the
   * password or the recovery code). Every key in the copy is noted as exported;
   * markExported records the same in this vault once the file is written.
   */
  exportFile(): VaultFileV2 {
    const v = this.load()
    if (!v) throw new Error('No vault yet')
    // A version 1 file becomes version 2 at the next unlock.
    if (v.version !== 2) throw new Error(LOCKED_MESSAGE)
    const copy = JSON.parse(JSON.stringify(v)) as VaultFileV2
    const at = Date.now()
    for (const k of copy.keys) k.backup = { state: 'vault-export', at }
    return copy
  }

  markExported(publicKeys: string[]): void {
    const v = this.load()
    if (!v) return
    const at = Date.now()
    for (const k of v.keys) if (publicKeys.includes(k.publicKey)) k.backup = { state: 'vault-export', at }
    this.saveKeys()
  }

  /**
   * Merges keys from another vault file (version 1 or 2). Needs that file's
   * password, or for version 2 its recovery code; keys are re-encrypted under
   * this vault's key. Returns how many keys were added.
   */
  async importFile(other: VaultFile, otherSecret: string): Promise<number> {
    const key = this.requireUnlocked()
    if (!validateVaultFile(other, this.minN)) {
      throw new Error(`This vault file ${DAMAGED}`)
    }
    const otherKey = (await keysKeyFromPassword(other, otherSecret)) ?? (await keysKeyFromCode(other, otherSecret))
    if (!otherKey) throw new Error(`${WRONG_SECRET} for the imported vault`)
    try {
      const v = this.load()!
      let added = 0
      const at = Date.now()
      for (const k of other.keys) {
        if (v.keys.some((x) => x.publicKey === k.publicKey)) continue
        const data = open(otherKey, k.enc, keyAad(k.id, k.publicKey))
        try {
          const priv: PrivateKey = { type: 'K1', data: new Uint8Array(data) }
          const pub = selfTest(priv)
          priv.data.fill(0)
          if (pub !== k.publicKey) throw new Error('Imported key does not match its public key')
          const id = randomUUID()
          v.keys.push({
            id,
            label: k.label,
            publicKey: pub,
            created: k.created,
            enc: seal(key, data, keyAad(id, pub)),
            backup: { state: 'imported', at }
          })
          added++
        } finally {
          data.fill(0)
        }
      }
      this.saveKeys()
      return added
    } finally {
      otherKey.fill(0)
    }
  }
}
