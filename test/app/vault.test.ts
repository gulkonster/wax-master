import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { sha256 } from '@noble/hashes/sha2.js'
import { Vault, DEFAULT_KDF } from '../../src/main/vault'
import { generatePrivateKey, privateKeyToString, publicFromPrivate, publicKeyToString, signDigest, verifySignature } from '../../src/chain-core'

const FAST = { N: 2 ** 10, r: 8, p: 1 }
const PW = 'correct horse battery'

function newVault(kdf = FAST): { v: Vault; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'wm-vault-'))
  const file = join(dir, 'vault.json')
  return { v: new Vault(file, kdf), file }
}

function freshKey(): { text: string; pub: string } {
  const k = generatePrivateKey()
  return { text: privateKeyToString(k, 'wif'), pub: publicKeyToString(publicFromPrivate(k), 'new') }
}

describe('vault', () => {
  it('refuses short passwords', async () => {
    const { v } = newVault()
    await expect(v.create('short')).rejects.toThrow(/at least 10/)
  })

  it('stores keys encrypted: no private key text, hex or bytes in the file', async () => {
    const { v, file } = newVault()
    await v.create(PW)
    const k = freshKey()
    const entry = v.addKey(k.text, 'test key')
    expect(entry.publicKey).toBe(k.pub)
    const raw = readFileSync(file, 'utf8')
    expect(raw).not.toContain(k.text)
    expect(raw).not.toContain(k.text.slice(5, 25))
    expect(raw).not.toMatch(/PVT_K1_/)
    expect(raw).toContain(k.pub)
    expect(raw).not.toContain(PW)
  })

  it('wrong password is refused; right password unlocks', async () => {
    const { v, file } = newVault()
    await v.create(PW)
    v.addKey(freshKey().text, 'a')
    v.lock()
    const v2 = new Vault(file, FAST)
    await expect(v2.unlock('wrong password!')).rejects.toThrow(/Wrong password/)
    expect(v2.isUnlocked()).toBe(false)
    await v2.unlock(PW)
    expect(v2.isUnlocked()).toBe(true)
    expect(v2.list()).toHaveLength(1)
  })

  it('locked vault cannot hand out keys; unlocked one signs correctly', async () => {
    const { v } = newVault()
    await v.create(PW)
    const k = freshKey()
    v.addKey(k.text, 'a')
    v.lock()
    expect(() => v.withPrivateKey(k.pub, () => 1)).toThrow(/locked/)
    await v.unlock(PW)
    const digest = sha256(new TextEncoder().encode('hello'))
    const sig = v.withPrivateKey(k.pub, (priv) => signDigest(digest, priv))
    expect(verifySignature(digest, sig, k.pub)).toBe(true)
  })

  it('wipes the decrypted key buffer after use', async () => {
    const { v } = newVault()
    await v.create(PW)
    const k = freshKey()
    v.addKey(k.text, 'a')
    let held: Uint8Array | null = null
    v.withPrivateKey(k.pub, (priv) => {
      held = priv.data
      expect(held.some((b) => b !== 0)).toBe(true)
    })
    expect(held!.every((b) => b === 0)).toBe(true)
  })

  it('detects tampering with an encrypted key', async () => {
    const { v, file } = newVault()
    await v.create(PW)
    const k = freshKey()
    v.addKey(k.text, 'a')
    const data = JSON.parse(readFileSync(file, 'utf8'))
    const bytes = Buffer.from(data.keys[0].enc.data, 'base64')
    bytes[0] ^= 1
    data.keys[0].enc.data = bytes.toString('base64')
    writeFileSync(file, JSON.stringify(data))
    const v2 = new Vault(file, FAST)
    await v2.unlock(PW)
    expect(() => v2.withPrivateKey(k.pub, () => 1)).toThrow()
  })

  it('swapping public keys between entries is detected (bound by associated data)', async () => {
    const { v, file } = newVault()
    await v.create(PW)
    const a = freshKey()
    const b = freshKey()
    v.addKey(a.text, 'a')
    v.addKey(b.text, 'b')
    const data = JSON.parse(readFileSync(file, 'utf8'))
    ;[data.keys[0].publicKey, data.keys[1].publicKey] = [data.keys[1].publicKey, data.keys[0].publicKey]
    writeFileSync(file, JSON.stringify(data))
    const v2 = new Vault(file, FAST)
    await v2.unlock(PW)
    expect(() => v2.withPrivateKey(a.pub, () => 1)).toThrow()
  })

  it('refuses duplicates and invalid keys', async () => {
    const { v } = newVault()
    await v.create(PW)
    const k = freshKey()
    v.addKey(k.text, 'a')
    expect(() => v.addKey(k.text, 'again')).toThrow(/already/)
    expect(() => v.addKey('5Knotakey', 'x')).toThrow(/not a valid private key/)
  })

  it('generated keys are stored and usable, without returning the private key', async () => {
    const { v } = newVault()
    await v.create(PW)
    const e = v.generateKey('generated')
    expect(Object.keys(e).sort()).toEqual(['created', 'id', 'label', 'publicKey'])
    const digest = sha256(new TextEncoder().encode('x'))
    const sig = v.withPrivateKey(e.publicKey, (p) => signDigest(digest, p))
    expect(verifySignature(digest, sig, e.publicKey)).toBe(true)
  })

  it('reveal asks for the password', async () => {
    const { v } = newVault()
    await v.create(PW)
    const k = freshKey()
    const e = v.addKey(k.text, 'a')
    await expect(v.revealPrivateKey(e.id, 'not the password')).rejects.toThrow(/Wrong password/)
    const shown = await v.revealPrivateKey(e.id, PW)
    expect(shown.startsWith('PVT_K1_')).toBe(true)
  })

  it('export and import merge keys under the new password', async () => {
    const a = newVault()
    await a.v.create(PW)
    const k = freshKey()
    a.v.addKey(k.text, 'exported')
    const exported = a.v.exportFile()
    const b = newVault()
    await b.v.create('another password 123')
    await expect(b.v.importFile(exported, 'bad password!!')).rejects.toThrow(/Wrong password/)
    expect(await b.v.importFile(exported, PW)).toBe(1)
    expect(await b.v.importFile(exported, PW)).toBe(0)
    expect(b.v.list()[0].publicKey).toBe(k.pub)
  })

  it('works with the production scrypt parameters', async () => {
    const { v } = newVault(DEFAULT_KDF)
    await v.create(PW)
    v.lock()
    await v.unlock(PW)
    expect(v.isUnlocked()).toBe(true)
  }, 30000)
})

describe('reveal does not unlock', () => {
  it('a locked vault stays locked, and no listener is told', async () => {
    const { v } = newVault()
    await v.create(PW)
    const e = v.addKey(freshKey().text, 'a')
    v.lock()
    let events = 0
    v.onChange(() => events++)
    const shown = await v.revealPrivateKey(e.id, PW)
    expect(shown.startsWith('PVT_K1_')).toBe(true)
    expect(v.isUnlocked()).toBe(false)
    expect(events).toBe(0)
    await expect(v.revealPrivateKey(e.id, 'wrong password!!')).rejects.toThrow(/Wrong password/)
    await expect(v.revealPrivateKey('no-such-id', PW)).rejects.toThrow(/Unknown key/)
    expect(v.isUnlocked()).toBe(false)
  })
  it('an unlocked vault stays unlocked and signing still works', async () => {
    const { v } = newVault()
    await v.create(PW)
    const e = v.addKey(freshKey().text, 'a')
    await v.revealPrivateKey(e.id, PW)
    expect(v.isUnlocked()).toBe(true)
    expect(v.withPrivateKey(e.publicKey, () => 1)).toBe(1)
  })
})

describe('vault file values are checked before use', () => {
  async function goodFile(): Promise<{ file: string; raw: Record<string, any> }> {
    const { v, file } = newVault()
    await v.create(PW)
    v.addKey(freshKey().text, 'a')
    return { file, raw: JSON.parse(readFileSync(file, 'utf8')) }
  }
  const b64 = (n: number): string => Buffer.alloc(n, 1).toString('base64')
  const mutations: [string, (f: Record<string, any>) => void][] = [
    ['kdf name', (f) => (f.kdf.name = 'pbkdf2')],
    ['N not a power of two', (f) => (f.kdf.N = 2 ** 10 + 1)],
    ['N below the minimum', (f) => (f.kdf.N = 2 ** 9)],
    ['N above the maximum', (f) => (f.kdf.N = 2 ** 21)],
    ['N as text', (f) => (f.kdf.N = '1024')],
    ['r', (f) => (f.kdf.r = 16)],
    ['p', (f) => (f.kdf.p = 2)],
    ['salt too short', (f) => (f.kdf.salt = b64(8))],
    ['salt too long', (f) => (f.kdf.salt = b64(65))],
    ['check iv', (f) => (f.check.iv = b64(16))],
    ['check tag', (f) => (f.check.tag = b64(12))],
    ['key iv', (f) => (f.keys[0].enc.iv = b64(8))],
    ['key tag', (f) => (f.keys[0].enc.tag = b64(32))],
    ['key without enc', (f) => delete f.keys[0].enc],
    ['too many keys', (f) => (f.keys = Array.from({ length: 1001 }, () => f.keys[0]))]
  ]
  for (const [name, mutate] of mutations) {
    it(`load refuses: ${name}`, async () => {
      const { file, raw } = await goodFile()
      mutate(raw)
      writeFileSync(file, JSON.stringify(raw))
      const v = new Vault(file, FAST)
      expect(() => v.list()).toThrow(/damaged or from an unknown version/)
    })
    it(`import refuses: ${name}`, async () => {
      const { raw } = await goodFile()
      mutate(raw)
      const target = newVault()
      await target.v.create(PW)
      await expect(target.v.importFile(raw as never, PW)).rejects.toThrow(/damaged or from an unknown version/)
      expect(target.v.list()).toHaveLength(0)
    })
  }

  it('production minimum: a file with a small N is refused unless the test constructor lowers it', async () => {
    const { file } = await goodFile() // N = 2^10
    expect(() => new Vault(file, DEFAULT_KDF).list()).toThrow(/damaged or from an unknown version/)
    expect(new Vault(file, FAST).list()).toHaveLength(1)
    expect(new Vault(file, DEFAULT_KDF, 2 ** 10).list()).toHaveLength(1)
  })

  it('production minimum applies to import as well, before any key derivation', async () => {
    const a = newVault()
    await a.v.create(PW)
    a.v.addKey(freshKey().text, 'x')
    const target = newVault(DEFAULT_KDF)
    await target.v.create('another password 123')
    await expect(target.v.importFile(a.v.exportFile(), PW)).rejects.toThrow(/damaged or from an unknown version/)
  }, 30000)

  it('accepts the bounds 2^15 and 2^20 in the file check', async () => {
    const { raw } = await goodFile()
    const { validateVaultFile } = await import('../../src/main/vault')
    raw.kdf.N = 2 ** 15
    expect(validateVaultFile(raw, 2 ** 15)).toBe(true)
    raw.kdf.N = 2 ** 20
    expect(validateVaultFile(raw, 2 ** 15)).toBe(true)
    raw.kdf.N = 2 ** 14
    expect(validateVaultFile(raw, 2 ** 15)).toBe(false)
  })
})

describe('listeners hear about key changes', () => {
  it('adding, generating, importing and removing keys each notify while unlocked', async () => {
    const { v } = newVault()
    await v.create(PW)
    const counts: number[] = []
    v.onChange((unlocked) => counts.push(unlocked ? v.list().length : -1))
    const a = v.addKey(freshKey().text, 'a')
    v.generateKey('b')
    v.newPendingKey()
    v.savePendingKey('c')
    v.removeKey(a.id)
    expect(counts).toEqual([1, 2, 3, 2])

    const other = newVault().v
    await other.create(PW)
    other.addKey(freshKey().text, 'd')
    other.addKey(freshKey().text, 'e')
    counts.length = 0
    expect(await v.importFile(other.exportFile(), PW)).toBe(2)
    expect(counts).toEqual([4])
  }, 30000)
})
