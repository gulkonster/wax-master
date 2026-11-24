// Vault file version 2: conversion from version 1 (every key kept, an
// interrupted write leaves a readable file), the recovery code, reset, change
// password, backup notes, import of both versions, and the password rule.

import { createCipheriv, randomBytes, randomUUID, scryptSync } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sha256 } from '@noble/hashes/sha2.js'

const io = vi.hoisted(() => ({ failWrites: 0 }))

// writeJson as in the app, except that a test can make the next writes stop
// after the temporary file was started (as a crash or a full disk would).
vi.mock('../../src/main/jsonfile', async (orig) => {
  const real = await orig<typeof import('../../src/main/jsonfile')>()
  return {
    ...real,
    writeJson: (file: string, data: unknown): void => {
      if (io.failWrites > 0) {
        io.failWrites--
        writeFileSync(`${file}.tmp`, JSON.stringify(data).slice(0, 40), 'utf8')
        throw new Error('disk full')
      }
      real.writeJson(file, data)
    }
  }
})

import {
  NO_RECOVERY,
  Vault,
  V1_BACKUP_NAME,
  WRONG_CODE,
  WRONG_IMPORT_SECRET,
  WRONG_PASSWORD,
  validateVaultFile
} from '../../src/main/vault'
import { formatRecoveryCode, newRecoveryCode, normalizeRecoveryCode } from '../../src/main/recovery-code'
import { GOOD_TEXT, MIN_PASSWORD_LENGTH, TOO_SHORT_TEXT, WEAK_TEXT, checkPassword, isWeakPassword } from '../../src/shared/password'
import { generatePrivateKey, privateKeyToString, publicFromPrivate, publicKeyToString, signDigest, verifySignature } from '../../src/chain-core'

const FAST = { N: 2 ** 10, r: 8, p: 1 }
const PW = 'correct horse battery'

function tempFile(): string {
  return join(mkdtempSync(join(tmpdir(), 'wm-vault2-')), 'vault.json')
}

function freshKey(): { text: string; pub: string } {
  const k = generatePrivateKey()
  return { text: privateKeyToString(k, 'wif'), pub: publicKeyToString(publicFromPrivate(k), 'new') }
}

function sealed(key: Buffer, plain: Uint8Array, aad: string): { iv: string; tag: string; data: string } {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key, iv)
  c.setAAD(Buffer.from(aad, 'utf8'))
  const data = Buffer.concat([c.update(plain), c.final()])
  return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') }
}

/** A version 1 vault file as the earlier builds wrote it: keys encrypted directly under the password key. */
function writeV1(file: string, password: string, count: number): { pub: string; label: string; id: string }[] {
  const salt = randomBytes(32)
  const derived = scryptSync(password.normalize('NFC'), salt, 32, { ...FAST, maxmem: 64 * 1024 * 1024 })
  const keys = Array.from({ length: count }, (_, i) => {
    const priv = generatePrivateKey()
    const pub = publicKeyToString(publicFromPrivate(priv), 'new')
    const id = randomUUID()
    return { id, label: `key ${i}`, publicKey: pub, created: 1_700_000_000_000 + i, enc: sealed(derived, priv.data, `key:${id}:${pub}`) }
  })
  const v1 = {
    format: 'wax-master-vault',
    version: 1,
    kdf: { name: 'scrypt', ...FAST, salt: salt.toString('base64') },
    check: sealed(derived, Buffer.from('wax-master-vault-check', 'utf8'), 'check'),
    keys
  }
  writeFileSync(file, JSON.stringify(v1, null, 2), 'utf8')
  return keys.map((k) => ({ pub: k.publicKey, label: k.label, id: k.id }))
}

function signs(v: Vault, pub: string): boolean {
  const digest = sha256(new TextEncoder().encode('check'))
  return verifySignature(digest, v.withPrivateKey(pub, (p) => signDigest(digest, p)), pub)
}

async function errorOf(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
  return '(no error)'
}

beforeEach(() => {
  io.failWrites = 0
})

describe('conversion from version 1', () => {
  it('keeps every key, label, id and date; the old file is kept once; a recovery code is made', async () => {
    const file = tempFile()
    const keys = writeV1(file, PW, 5)
    const original = readFileSync(file, 'utf8')
    const v = new Vault(file, FAST)
    expect(v.version()).toBe(1)
    expect(v.list().map((k) => k.publicKey)).toEqual(keys.map((k) => k.pub))

    const code = await v.unlock(PW)
    expect(code).toMatch(/^[0-9A-Z]{5}(-[0-9A-Z]{5}){4}$/)
    expect(v.isUnlocked()).toBe(true)
    expect(v.version()).toBe(2)
    const after = v.list()
    expect(after.map((k) => [k.id, k.label, k.publicKey])).toEqual(keys.map((k) => [k.id, k.label, k.pub]))
    expect(after.every((k) => k.backup === 'none')).toBe(true)
    for (const k of keys) expect(signs(v, k.pub)).toBe(true)

    const dir = join(file, '..')
    expect(readFileSync(join(dir, V1_BACKUP_NAME), 'utf8')).toBe(original)
    const disk = JSON.parse(readFileSync(file, 'utf8'))
    expect(disk.version).toBe(2)
    expect(validateVaultFile(disk, FAST.N)).toBe(true)
    expect(JSON.stringify(disk)).not.toContain(code!.replace(/-/g, ''))

    // A new instance (next start): the password opens it without another conversion.
    v.lock()
    const again = new Vault(file, FAST)
    expect(await again.unlock(PW)).toBeNull()
    for (const k of keys) expect(signs(again, k.pub)).toBe(true)
    // The backup copy is written once and not replaced later.
    expect(readFileSync(join(dir, V1_BACKUP_NAME), 'utf8')).toBe(original)
    // The new code opens the converted vault.
    again.lock()
    await again.recoverWithCode(code!, 'a brand new password')
    for (const k of keys) expect(signs(again, k.pub)).toBe(true)
  })

  it('an interrupted write leaves the version 1 file readable and unchanged; the next unlock converts', async () => {
    const file = tempFile()
    const keys = writeV1(file, PW, 3)
    const original = readFileSync(file, 'utf8')
    const v = new Vault(file, FAST)
    io.failWrites = 1
    const msg = await errorOf(v.unlock(PW))
    expect(msg).toMatch(/could not be converted/)
    expect(v.isUnlocked()).toBe(false)
    expect(readFileSync(file, 'utf8')).toBe(original)
    expect(existsSync(`${file}.tmp`)).toBe(true)
    expect(v.version()).toBe(1)

    // The app starts again with the half-written temporary file still there.
    const next = new Vault(file, FAST)
    expect(next.list().map((k) => k.publicKey)).toEqual(keys.map((k) => k.pub))
    expect(await next.unlock(PW)).toMatch(/-/)
    for (const k of keys) expect(signs(next, k.pub)).toBe(true)
    expect(next.version()).toBe(2)
  })

  it('a wrong password does not convert and does not write anything', async () => {
    const file = tempFile()
    writeV1(file, PW, 1)
    const original = readFileSync(file, 'utf8')
    const v = new Vault(file, FAST)
    expect(await errorOf(v.unlock('not the password'))).toBe(WRONG_PASSWORD)
    expect(readFileSync(file, 'utf8')).toBe(original)
    expect(existsSync(join(file, '..', V1_BACKUP_NAME))).toBe(false)
  })

  it('reveal on a locked version 1 vault works without converting it', async () => {
    const file = tempFile()
    const keys = writeV1(file, PW, 1)
    const v = new Vault(file, FAST)
    expect((await v.revealPrivateKey(keys[0].id, PW)).startsWith('PVT_K1_')).toBe(true)
    expect(v.version()).toBe(1)
  })

  it('version 1 files are still checked value by value', () => {
    const file = tempFile()
    writeV1(file, PW, 1)
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    expect(validateVaultFile(raw, FAST.N)).toBe(true)
    for (const mutate of [
      (f: Record<string, any>) => (f.check.iv = Buffer.alloc(16).toString('base64')),
      (f: Record<string, any>) => delete f.check,
      (f: Record<string, any>) => (f.kdf.N = 3)
    ]) {
      const copy = JSON.parse(JSON.stringify(raw))
      mutate(copy)
      expect(validateVaultFile(copy, FAST.N)).toBe(false)
    }
  })
})

describe('recovery code', () => {
  it('is 25 Crockford characters in five groups, read without case, dashes, O, I or L', () => {
    const code = newRecoveryCode()
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){4}$/)
    const plain = code.replace(/-/g, '')
    expect(normalizeRecoveryCode(code.toLowerCase())).toBe(plain)
    expect(normalizeRecoveryCode(` ${plain.slice(0, 7)} ${plain.slice(7)} `)).toBe(plain)
    expect(normalizeRecoveryCode('O'.repeat(25))).toBe('0'.repeat(25))
    expect(normalizeRecoveryCode('iIlL1'.repeat(5))).toBe('1'.repeat(25))
    expect(normalizeRecoveryCode('U'.repeat(25))).toBeNull()
    expect(normalizeRecoveryCode('0'.repeat(24))).toBeNull()
    expect(formatRecoveryCode('A'.repeat(25))).toBe('AAAAA-AAAAA-AAAAA-AAAAA-AAAAA')
    // 125 random bits: codes differ.
    expect(new Set(Array.from({ length: 50 }, () => newRecoveryCode())).size).toBe(50)
  })

  it('opens the vault with a new password; the used code stops working, the new one works', async () => {
    const file = tempFile()
    const v = new Vault(file, FAST)
    const code = await v.create(PW)
    const k = v.addKey(freshKey().text, 'a')
    v.lock()
    const typed = code.toLowerCase().replace(/0/g, 'o').replace(/-/g, '')
    const next = await v.recoverWithCode(typed, 'new password here')
    expect(next).not.toBe(code)
    expect(v.isUnlocked()).toBe(true)
    expect(signs(v, k.publicKey)).toBe(true)
    v.lock()
    expect(await errorOf(v.unlock(PW))).toBe(WRONG_PASSWORD)
    await v.unlock('new password here')
    v.lock()
    expect(await errorOf(v.recoverWithCode(code, 'another new one'))).toBe(WRONG_CODE)
    await v.recoverWithCode(next, 'another new one')
    expect(v.isUnlocked()).toBe(true)
  })

  it('each form answers with its own text: a wrong or malformed code is "Wrong recovery code", a wrong password "Wrong password"', async () => {
    const file = tempFile()
    const v = new Vault(file, FAST)
    const code = await v.create(PW)
    v.lock()
    const wrongPassword = await errorOf(v.unlock('wrong password'))
    const wrongCode = await errorOf(v.recoverWithCode(newRecoveryCode(), 'new password here'))
    const badShape = await errorOf(v.recoverWithCode('not a code', 'new password here'))
    const passwordAsCode = await errorOf(v.recoverWithCode(PW, 'new password here'))
    const codeAsPassword = await errorOf(v.unlock(code))
    expect(wrongPassword).toBe('Wrong password')
    expect(codeAsPassword).toBe(WRONG_PASSWORD)
    expect([wrongCode, badShape, passwordAsCode]).toEqual(['Wrong recovery code', WRONG_CODE, WRONG_CODE])
    expect(v.isUnlocked()).toBe(false)
  })

  it('New recovery code replaces the old one; Remove recovery code leaves only the password', async () => {
    const file = tempFile()
    const v = new Vault(file, FAST)
    const first = await v.create(PW)
    expect(await errorOf(v.newRecoveryCode('wrong password'))).toBe(WRONG_PASSWORD)
    const second = await v.newRecoveryCode(PW)
    v.lock()
    expect(await errorOf(v.recoverWithCode(first, 'new password here'))).toBe(WRONG_CODE)
    await v.recoverWithCode(second, 'new password here')
    await v.removeRecoveryCode('new password here')
    expect(v.hasRecoveryCode()).toBe(false)
    v.lock()
    expect(await errorOf(v.recoverWithCode(second, 'x'.repeat(10)))).toBe(NO_RECOVERY)
    await v.unlock('new password here')
  })

  it('the recovery path keeps the password rule', async () => {
    const v = new Vault(tempFile(), FAST)
    const code = await v.create(PW)
    v.lock()
    expect(await errorOf(v.recoverWithCode(code, 'abcde'))).toBe(TOO_SHORT_TEXT)
    expect(v.isUnlocked()).toBe(false)
  })
})

describe('change password', () => {
  it('rewrites only the password wrap: keys, recovery code and earlier exports keep working', async () => {
    const v = new Vault(tempFile(), FAST)
    const code = await v.create(PW)
    const k = v.addKey(freshKey().text, 'a')
    const before = JSON.stringify(v.exportFile().keys.map((x) => x.enc))
    const exported = v.exportFile()
    expect(await errorOf(v.changePassword('wrong password', 'new password here'))).toBe(WRONG_PASSWORD)
    expect(await errorOf(v.changePassword(PW, 'abc'))).toBe(TOO_SHORT_TEXT)
    await v.changePassword(PW, 'new password here')
    expect(JSON.stringify(v.exportFile().keys.map((x) => x.enc))).toBe(before)
    v.lock()
    expect(await errorOf(v.unlock(PW))).toBe(WRONG_PASSWORD)
    await v.unlock('new password here')
    expect(signs(v, k.publicKey)).toBe(true)
    v.lock()
    await v.recoverWithCode(code, 'third password!')
    // The copy exported before the change still opens with the old password.
    const other = new Vault(tempFile(), FAST)
    await other.create('other vault password')
    expect(await other.importFile(exported, PW)).toBe(1)
  })
})

describe('reset', () => {
  it('needs the typed word; keeps the old file as vault-old-<date>.json, which imports with its password', async () => {
    const file = tempFile()
    const v = new Vault(file, FAST)
    await v.create(PW)
    const k = v.addKey(freshKey().text, 'kept')
    for (const word of ['', 'reset', 'Reset', 'RESET ', ' RESET', 'RESET!']) {
      expect(() => v.reset(word)).toThrow(/Type RESET/)
      expect(v.exists()).toBe(true)
    }
    expect(v.isUnlocked()).toBe(true)
    const name = v.reset('RESET')
    expect(name).toMatch(/^vault-old-\d{4}-\d{2}-\d{2}\.json$/)
    expect(v.exists()).toBe(false)
    expect(v.isUnlocked()).toBe(false)
    expect(v.list()).toEqual([])
    const dir = join(file, '..')
    expect(readdirSync(dir)).toContain(name)

    // A second reset the same day gets its own name.
    await v.create('second vault pw')
    expect(v.reset('RESET')).not.toBe(name)

    // A new vault; the old file comes back with Import vault and the old password.
    await v.create('third vault pw')
    const old = JSON.parse(readFileSync(join(dir, name), 'utf8'))
    expect(await v.importFile(old, PW)).toBe(1)
    expect(v.list()[0].publicKey).toBe(k.publicKey)
    expect(v.list()[0].backup).toBe('imported')
  })
})

describe('backup notes and import', () => {
  it('generated keys start without backup; imported keys are noted; setBackup and export record the way', async () => {
    const v = new Vault(tempFile(), FAST)
    await v.create(PW)
    const gen = v.generateKey('made here')
    const imp = v.addKey(freshKey().text, 'brought')
    const faucet = v.addKey(freshKey().text, 'faucet', 'none')
    expect([gen.backup, imp.backup, faucet.backup]).toEqual(['none', 'imported', 'none'])
    v.setBackup(gen.id, 'file')
    expect(v.list().find((x) => x.id === gen.id)!.backup).toBe('file')
    v.lock()
    // The note is clear text: it can be written while locked.
    v.setBackup(faucet.id, 'shown')
    expect(v.list().find((x) => x.id === faucet.id)!.backup).toBe('shown')
    await v.unlock(PW)
    const file = v.exportFile()
    expect(file.version).toBe(2)
    expect(file.keys.every((x) => x.backup?.state === 'vault-export')).toBe(true)
    v.markExported(file.keys.map((x) => x.publicKey))
    expect(v.list().every((x) => x.backup === 'vault-export')).toBe(true)
  })

  it('imports version 1 and version 2 files, a version 2 file also with its recovery code', async () => {
    const target = new Vault(tempFile(), FAST)
    await target.create(PW)
    const v1File = tempFile()
    const v1Keys = writeV1(v1File, 'old one password', 2)
    expect(await target.importFile(JSON.parse(readFileSync(v1File, 'utf8')), 'old one password')).toBe(2)

    const src = new Vault(tempFile(), FAST)
    const code = await src.create('source password')
    src.addKey(freshKey().text, 'x')
    const exported = src.exportFile()
    expect(await errorOf(target.importFile(exported, 'wrong'))).toBe(WRONG_IMPORT_SECRET)
    expect(WRONG_IMPORT_SECRET).toBe('Wrong password or recovery code for the imported vault')
    expect(await target.importFile(exported, code.toLowerCase())).toBe(1)
    for (const k of v1Keys) expect(signs(target, k.pub)).toBe(true)
  })
})

describe('password rule', () => {
  it(`allows ${MIN_PASSWORD_LENGTH} characters, refuses fewer, in the vault itself`, async () => {
    await expect(new Vault(tempFile(), FAST).create('abcde')).rejects.toThrow(TOO_SHORT_TEXT)
    await expect(new Vault(tempFile(), FAST).create('k7#pQz')).resolves.toBeTruthy()
  })

  const weak = [
    'k7#pQz', // under 10
    'abcdefghijklm', // only letters, under 14
    '1234567890123', // only digits, under 14
    'aaaaaaaaaaaaaaaaaaaa', // one repeated character
    'abcdefghijklmnopqrstu', // a plain run
    'zyxwvutsrqponmlkjih', // a run backwards
    'qwertyuiopasdfgh', // keyboard row
    'Password123', // a common password (any case)
    'iloveyou1', // common and short
    '01234567890123456789'.slice(0, 15) // digit run
  ]
  for (const pw of weak) {
    it(`warns, does not block: ${pw}`, () => {
      expect(isWeakPassword(pw)).toBe(true)
      expect(checkPassword(pw)).toEqual({ level: 'weak', allowed: true, text: WEAK_TEXT })
    })
  }
  const fine: [string, string][] = [
    ['horse7battery', ''],
    ['Tr0ub4dor&3x', ''],
    ['abcdefghijklmx', GOOD_TEXT],
    ['correct horse battery staple', GOOD_TEXT]
  ]
  for (const [pw, text] of fine) {
    it(`does not warn: ${pw}`, () => {
      expect(isWeakPassword(pw)).toBe(false)
      expect(checkPassword(pw).text).toBe(text)
      expect(checkPassword(pw).allowed).toBe(true)
    })
  }
  it('too short and empty are not allowed', () => {
    expect(checkPassword('abcde')).toEqual({ level: 'short', allowed: false, text: TOO_SHORT_TEXT })
    expect(checkPassword('')).toEqual({ level: 'empty', allowed: false, text: '' })
  })
})

describe('a failed write changes nothing; changes run one at a time', () => {
  /** The vault as a fresh start reads it from the disk. */
  const fromDisk = (file: string): Vault => new Vault(file, FAST)

  it('change password: the old password and code keep working; a later save does not store the new password', async () => {
    const file = tempFile()
    const v = new Vault(file, FAST)
    const code = await v.create(PW)
    const k = v.addKey(freshKey().text, 'a')
    io.failWrites = 1
    expect(await errorOf(v.changePassword(PW, 'new password here'))).toBe('disk full')
    v.setLabel(k.id, 'renamed')
    for (const x of [v, fromDisk(file)]) {
      x.lock()
      expect(await errorOf(x.unlock('new password here'))).toBe(WRONG_PASSWORD)
      await x.unlock(PW)
      expect(x.list()[0].label).toBe('renamed')
    }
    v.lock()
    await v.recoverWithCode(code, 'after the failure')
  })

  it('new recovery code: the old code keeps working and the unseen code never does', async () => {
    const file = tempFile()
    const v = new Vault(file, FAST)
    const code = await v.create(PW)
    const k = v.addKey(freshKey().text, 'a')
    io.failWrites = 1
    expect(await errorOf(v.newRecoveryCode(PW))).toBe('disk full')
    v.setLabel(k.id, 'renamed')
    const disk = JSON.parse(readFileSync(file, 'utf8'))
    expect(disk.keys[0].label).toBe('renamed')
    v.lock()
    await fromDisk(file).recoverWithCode(code, 'after the failure')
  })

  it('remove recovery code: the code keeps working', async () => {
    const file = tempFile()
    const v = new Vault(file, FAST)
    const code = await v.create(PW)
    const k = v.addKey(freshKey().text, 'a')
    io.failWrites = 1
    expect(await errorOf(v.removeRecoveryCode(PW))).toBe('disk full')
    expect(v.hasRecoveryCode()).toBe(true)
    v.setLabel(k.id, 'renamed')
    expect(fromDisk(file).hasRecoveryCode()).toBe(true)
    v.lock()
    await v.recoverWithCode(code, 'after the failure')
  })

  it('recovery with the code: the vault stays locked, old password and code keep working, no unseen code is stored', async () => {
    const file = tempFile()
    const v = new Vault(file, FAST)
    const code = await v.create(PW)
    const k = v.addKey(freshKey().text, 'a')
    v.lock()
    io.failWrites = 1
    expect(await errorOf(v.recoverWithCode(code, 'new password here'))).toBe('disk full')
    expect(v.isUnlocked()).toBe(false)
    v.setLabel(k.id, 'renamed')
    for (const x of [v, fromDisk(file)]) {
      expect(await errorOf(x.unlock('new password here'))).toBe(WRONG_PASSWORD)
      await x.unlock(PW)
      x.lock()
    }
    await fromDisk(file).recoverWithCode(code, 'after the failure')
  })

  it('a key that could not be written is not in the vault, and a later save does not add it', async () => {
    const file = tempFile()
    const v = new Vault(file, FAST)
    await v.create(PW)
    const first = v.addKey(freshKey().text, 'a')
    const lost = freshKey()
    io.failWrites = 1
    expect(() => v.addKey(lost.text, 'lost')).toThrow('disk full')
    expect(v.hasPublicKey(lost.pub)).toBe(false)
    io.failWrites = 1
    expect(() => v.generateKey('lost too')).toThrow('disk full')
    io.failWrites = 1
    expect(() => v.setBackup(first.id, 'file')).toThrow('disk full')
    io.failWrites = 1
    expect(() => v.removeKey(first.id)).toThrow('disk full')
    v.setLabel(first.id, 'renamed')
    for (const x of [v, fromDisk(file)]) {
      expect(x.list().map((e) => [e.label, e.backup])).toEqual([['renamed', 'imported']])
    }
  })

  it('import: nothing is added when the write fails', async () => {
    const target = new Vault(tempFile(), FAST)
    await target.create(PW)
    const src = new Vault(tempFile(), FAST)
    await src.create('source password')
    src.addKey(freshKey().text, 'x')
    io.failWrites = 1
    expect(await errorOf(target.importFile(src.exportFile(), 'source password'))).toBe('disk full')
    expect(target.list()).toEqual([])
    expect(await target.importFile(src.exportFile(), 'source password')).toBe(1)
  })

  it('two unlocks at once on a version 1 file: one conversion, one code, one kept copy', async () => {
    const file = tempFile()
    const keys = writeV1(file, PW, 2)
    const v = new Vault(file, FAST)
    const [a, b] = await Promise.all([v.unlock(PW), v.unlock(PW)])
    const codes = [a, b].filter((c) => c !== null)
    expect(codes).toHaveLength(1)
    expect(readdirSync(join(file, '..')).filter((n) => n === V1_BACKUP_NAME)).toHaveLength(1)
    for (const k of keys) expect(signs(v, k.pub)).toBe(true)
    v.lock()
    await fromDisk(file).recoverWithCode(codes[0]!, 'after the conversion')
  })

  it('two wrap changes at once run one after the other; both are kept', async () => {
    const v = new Vault(tempFile(), FAST)
    await v.create(PW)
    const [, code] = await Promise.all([v.changePassword(PW, 'second password'), v.newRecoveryCode(PW).catch((e: Error) => e.message)])
    // The code change ran after the password change: the old password no longer opens the vault.
    expect(code).toBe(WRONG_PASSWORD)
    const next = await v.newRecoveryCode('second password')
    v.lock()
    await v.recoverWithCode(next, 'third password')
  })
})

describe('writeJson', () => {
  it('writes through a flushed temporary file and leaves none behind', async () => {
    const real = await vi.importActual<typeof import('../../src/main/jsonfile')>('../../src/main/jsonfile')
    const file = tempFile()
    real.writeJson(file, { a: 1 })
    real.writeJson(file, { a: 2 })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ a: 2 })
    expect(existsSync(`${file}.tmp`)).toBe(false)
    const src = readFileSync(join(__dirname, '../../src/main/jsonfile.ts'), 'utf8')
    expect(src.indexOf('fsyncSync(fd)')).toBeGreaterThan(src.indexOf('writeSync(fd'))
    expect(src.indexOf('renameSync(tmp, file)')).toBeGreaterThan(src.indexOf('closeSync(fd)'))
  })
})
