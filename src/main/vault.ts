// Encrypted key vault (vault.json). Private keys are encrypted one by one with
// AES-256-GCM under a key derived from the user's password with scrypt.
// Public keys and labels stay readable so the app can show keys and match
// permissions while the vault is locked. There is no password recovery.
//
// Only the signer may ask for a decrypted private key (withPrivateKey); the
// decrypted bytes are wiped as soon as the callback returns.

import { createCipheriv, createDecipheriv, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
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
import { readJson, writeJson } from './jsonfile'

export const MIN_PASSWORD_LENGTH = 10

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

export interface StoredKey {
  id: string
  label: string
  publicKey: string
  created: number
  enc: Sealed
}

export interface VaultFile {
  format: 'wax-master-vault'
  version: 1
  kdf: KdfParams
  check: Sealed
  keys: StoredKey[]
}

export interface PublicKeyEntry {
  id: string
  label: string
  publicKey: string
  created: number
}

const CHECK_TEXT = 'wax-master-vault-check'
export const DEFAULT_KDF = { N: 2 ** 17, r: 8, p: 1 }

function b64(b: Uint8Array): string {
  return Buffer.from(b).toString('base64')
}
function unb64(s: string): Buffer {
  return Buffer.from(s, 'base64')
}

function deriveKey(password: string, kdf: KdfParams): Promise<Buffer> {
  const maxmem = 128 * kdf.N * kdf.r * 2 + 1024 * 1024
  return new Promise((resolve, reject) => {
    scryptCb(password.normalize('NFC'), unb64(kdf.salt), 32, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem }, (err, key) =>
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

export class Vault {
  private derived: Buffer | null = null
  private data: VaultFile | null = null
  private listeners = new Set<(unlocked: boolean) => void>()

  constructor(
    private readonly file: string,
    private readonly kdf = DEFAULT_KDF
  ) {}

  static inDir(dir: string): Vault {
    return new Vault(join(dir, 'vault.json'))
  }

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
    const v = readJson<VaultFile | null>(this.file, null)
    if (!v || v.format !== 'wax-master-vault' || v.version !== 1 || !Array.isArray(v.keys)) {
      throw new Error('vault.json is damaged or from an unknown version')
    }
    this.data = v
    return v
  }

  private save(): void {
    if (this.data) writeJson(this.file, this.data)
  }

  exists(): boolean {
    return existsSync(this.file)
  }

  isUnlocked(): boolean {
    return this.derived !== null
  }

  async create(password: string): Promise<void> {
    if (this.exists()) throw new Error('A vault already exists')
    if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`The password needs at least ${MIN_PASSWORD_LENGTH} characters`)
    const kdf: KdfParams = { name: 'scrypt', ...this.kdf, salt: b64(randomBytes(32)) }
    const key = await deriveKey(password, kdf)
    this.data = {
      format: 'wax-master-vault',
      version: 1,
      kdf,
      check: seal(key, Buffer.from(CHECK_TEXT, 'utf8'), 'check'),
      keys: []
    }
    this.save()
    this.derived = key
    this.emit()
  }

  private async verifyPassword(password: string): Promise<Buffer> {
    const v = this.load()
    if (!v) throw new Error('No vault yet')
    const key = await deriveKey(password, v.kdf)
    let ok = false
    try {
      const text = open(key, v.check, 'check')
      ok = text.length === CHECK_TEXT.length && timingSafeEqual(text, Buffer.from(CHECK_TEXT, 'utf8'))
    } catch {
      ok = false
    }
    if (!ok) {
      key.fill(0)
      throw new Error('Wrong password')
    }
    return key
  }

  async unlock(password: string): Promise<void> {
    const key = await this.verifyPassword(password)
    this.derived?.fill(0)
    this.derived = key
    this.emit()
  }

  /** Checks the password without changing the lock state (used before revealing a key). */
  async checkPassword(password: string): Promise<void> {
    const key = await this.verifyPassword(password)
    key.fill(0)
  }

  lock(): void {
    this.discardPendingKey()
    if (this.derived) {
      this.derived.fill(0)
      this.derived = null
      this.emit()
    }
  }

  list(): PublicKeyEntry[] {
    const v = this.load()
    return (v?.keys ?? []).map(({ id, label, publicKey, created }) => ({ id, label, publicKey, created }))
  }

  hasPublicKey(publicKey: string): boolean {
    return this.list().some((k) => k.publicKey === publicKey)
  }

  private requireUnlocked(): Buffer {
    if (!this.derived) throw new Error('The vault is locked')
    return this.derived
  }

  /** Adds a private key given as text (WIF or PVT_K1_). Returns the stored public entry. */
  addKey(privateKeyText: string, label: string): PublicKeyEntry {
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
      const entry: StoredKey = {
        id,
        label: label.trim().slice(0, 64),
        publicKey,
        created: Date.now(),
        enc: seal(key, priv.data, keyAad(id, publicKey))
      }
      v.keys.push(entry)
      this.save()
      return { id, label: entry.label, publicKey, created: entry.created }
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
      const entry: StoredKey = {
        id,
        label: label.trim().slice(0, 64),
        publicKey,
        created: Date.now(),
        enc: seal(key, priv.data, keyAad(id, publicKey))
      }
      v.keys.push(entry)
      this.save()
      return { id, label: entry.label, publicKey, created: entry.created }
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

  removeKey(id: string): void {
    const v = this.load()
    if (!v) return
    v.keys = v.keys.filter((k) => k.id !== id)
    this.save()
  }

  /**
   * Gives the decrypted private key to the callback and wipes it afterwards.
   * Only the signer module calls this.
   */
  withPrivateKey<T>(publicKey: string, fn: (key: PrivateKey) => T): T {
    const derived = this.requireUnlocked()
    const v = this.load()!
    const k = v.keys.find((x) => x.publicKey === publicKey)
    if (!k) throw new Error('The vault has no private key for this public key')
    const data = open(derived, k.enc, keyAad(k.id, k.publicKey))
    const priv: PrivateKey = { type: 'K1', data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) }
    try {
      return fn(priv)
    } finally {
      data.fill(0)
    }
  }

  /** Reveal flow: the password is asked again; returns the key text for a short display. */
  async revealPrivateKey(id: string, password: string): Promise<string> {
    await this.checkPassword(password)
    const k = this.list().find((x) => x.id === id)
    if (!k) throw new Error('Unknown key')
    if (!this.isUnlocked()) await this.unlock(password)
    return this.withPrivateKey(k.publicKey, (priv) => privateKeyToString(priv, 'new'))
  }

  /** The vault file as it is on disk (already encrypted), for Export. */
  exportFile(): VaultFile {
    const v = this.load()
    if (!v) throw new Error('No vault yet')
    return JSON.parse(JSON.stringify(v)) as VaultFile
  }

  /**
   * Merges keys from another vault file. Needs that file's password; keys are
   * re-encrypted under this vault's key. Returns how many keys were added.
   */
  async importFile(other: VaultFile, otherPassword: string): Promise<number> {
    const key = this.requireUnlocked()
    if (other?.format !== 'wax-master-vault' || other.version !== 1 || !Array.isArray(other.keys)) {
      throw new Error('This is not a WAX Master vault file')
    }
    const otherKey = await deriveKey(otherPassword, other.kdf)
    try {
      try {
        open(otherKey, other.check, 'check')
      } catch {
        throw new Error('Wrong password for the imported vault')
      }
      const v = this.load()!
      let added = 0
      for (const k of other.keys) {
        if (v.keys.some((x) => x.publicKey === k.publicKey)) continue
        const data = open(otherKey, k.enc, keyAad(k.id, k.publicKey))
        try {
          const priv: PrivateKey = { type: 'K1', data: new Uint8Array(data) }
          const pub = selfTest(priv)
          priv.data.fill(0)
          if (pub !== k.publicKey) throw new Error('Imported key does not match its public key')
          const id = randomUUID()
          v.keys.push({ id, label: k.label, publicKey: pub, created: k.created, enc: seal(key, data, keyAad(id, pub)) })
          added++
        } finally {
          data.fill(0)
        }
      }
      this.save()
      return added
    } finally {
      otherKey.fill(0)
    }
  }
}
