import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { createTestnetAccount, extractKeys, randomTestnetName, requestTokens, type Fetcher } from '../../src/main/faucet'
import { Vault } from '../../src/main/vault'
import { generatePrivateKey, privateKeyToString, publicFromPrivate, publicKeyToString } from '../../src/chain-core'

let vault: Vault

function key(): { priv: string; pub: string } {
  const k = generatePrivateKey()
  return { priv: privateKeyToString(k, 'wif'), pub: publicKeyToString(publicFromPrivate(k), 'new') }
}

function answer(status: number, body: unknown): Fetcher {
  return async () => ({ status, text: typeof body === 'string' ? body : JSON.stringify(body) })
}

beforeEach(async () => {
  vault = new Vault(join(mkdtempSync(join(tmpdir(), 'wm-faucet-')), 'vault.json'), { N: 2 ** 10, r: 8, p: 1 })
  await vault.create('correct horse battery')
})

describe('testnet faucet', () => {
  it('imports both keys from a good answer', async () => {
    const o = key()
    const a = key()
    const r = await createTestnetAccount(
      'abcdefghijk1',
      vault,
      answer(200, { msg: 'succeeded', account: 'abcdefghijk1', keys: { owner_key: { public: o.pub, private: o.priv }, active_key: { public: a.pub, private: a.priv } } })
    )
    expect(r.ok).toBe(true)
    expect(vault.list().map((k) => k.publicKey).sort()).toEqual([o.pub, a.pub].sort())
    expect(vault.list().map((k) => k.label).sort()).toEqual(['abcdefghijk1 active (faucet)', 'abcdefghijk1 owner (faucet)'])
    expect(JSON.stringify(r)).not.toContain(o.priv)
  })

  it('imports nothing when the service refuses', async () => {
    const r = await createTestnetAccount('abcdefghijk1', vault, answer(400, { msg: 'failed, account exists' }))
    expect(r.ok).toBe(false)
    expect(r.message).toContain('account exists')
    expect(vault.list()).toHaveLength(0)
  })

  it('imports nothing from an unexpected form or keys that do not parse', async () => {
    for (const body of ['<html>gone</html>', { msg: 'ok', keys: { owner_key: { private: 'nonsense' }, active_key: { private: 'x' } } }, { msg: 'ok' }]) {
      const r = await createTestnetAccount('abcdefghijk1', vault, answer(200, body))
      expect(r.ok).toBe(false)
    }
    expect(vault.list()).toHaveLength(0)
  })

  it('refuses bad names and a locked vault before calling the service', async () => {
    let called = false
    const f: Fetcher = async () => {
      called = true
      return { status: 200, text: '{}' }
    }
    expect((await createTestnetAccount('short', vault, f)).ok).toBe(false)
    vault.lock()
    expect((await createTestnetAccount('abcdefghijk1', vault, f)).ok).toBe(false)
    expect(called).toBe(false)
  })

  it('shows the token answer as text', async () => {
    const r = await requestTokens('abcdefghijk1', answer(200, { msg: 'succeeded' }))
    expect(r).toEqual({ ok: true, message: 'succeeded' })
  })

  it('suggests valid names and reads flat key fields too', () => {
    expect(randomTestnetName()).toMatch(/^[a-z1-5]{12}$/)
    const o = key()
    expect(extractKeys({ owner_key: o.priv, active_key: o.priv })).toEqual({ owner: o.priv, active: o.priv })
  })
})
