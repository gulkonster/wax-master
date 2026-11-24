import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { createTestnetAccount, extractKeys, randomTestnetName, readCapped, requestTokens, type Fetcher } from '../../src/main/faucet'
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

describe('testnet faucet hardening', () => {
  function good(): { body: unknown; o: ReturnType<typeof key>; a: ReturnType<typeof key> } {
    const o = key()
    const a = key()
    return { o, a, body: { msg: 'succeeded', keys: { owner_key: { private: o.priv }, active_key: { private: a.priv } } } }
  }

  it('stops reading a body that passes the limit while it arrives', async () => {
    let pulled = 0
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++
        c.enqueue(new Uint8Array(1024))
      }
    })
    let aborted = false
    await expect(readCapped(new Response(body), 4096, () => (aborted = true))).rejects.toThrow('too large')
    expect(aborted).toBe(true)
    expect(pulled).toBeLessThan(20)
  })

  it('refuses a declared length over the limit and counts bytes, not characters', async () => {
    await expect(readCapped(new Response('x', { headers: { 'content-length': '999999' } }), 100)).rejects.toThrow('too large')
    // 60 two-byte characters are 120 bytes: over a 100 byte limit although only 60 characters long.
    await expect(readCapped(new Response('é'.repeat(60)), 100)).rejects.toThrow('too large')
    expect(await readCapped(new Response('{"msg":"ok"}'), 100)).toBe('{"msg":"ok"}')
  })

  it('reports plainly when the vault locked during the wait', async () => {
    const g = good()
    const f: Fetcher = async () => {
      vault.lock()
      return { status: 200, text: JSON.stringify(g.body) }
    }
    const r = await createTestnetAccount('abcdefghijk1', vault, f)
    expect(r.ok).toBe(false)
    expect(r.message).toContain('vault was locked')
    expect(r.message).toContain('could not be stored')
    expect(JSON.stringify(r)).not.toContain(g.o.priv)
  })

  it('reports a half import as such', async () => {
    const g = good()
    const real = vault.addKey.bind(vault)
    let n = 0
    vault.addKey = ((k: string, label: string) => {
      if (++n === 2) throw new Error('locked')
      return real(k, label)
    }) as typeof vault.addKey
    const r = await createTestnetAccount('abcdefghijk1', vault, answer(200, g.body))
    expect(r.ok).toBe(false)
    expect(r.message).toContain('Half import')
    expect(r.ownerPublic).toBe(g.o.pub)
  })

  it('passes the service message through the log redaction', async () => {
    const k = key()
    const r = await requestTokens('abcdefghijk1', answer(400, { msg: `failed ${k.priv} password=hunter2` }))
    expect(r.message).not.toContain(k.priv)
    expect(r.message).not.toContain('hunter2')
    const c = await createTestnetAccount('abcdefghijk1', vault, answer(400, { msg: `bad ${k.priv}` }))
    expect(c.message).not.toContain(k.priv)
  })
})

describe('faucet call without an answer', () => {
  it('says which host and why, never "fetch failed" or the remote text', async () => {
    const realFetch = globalThis.fetch
    globalThis.fetch = (async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('remote words'), { code: 'ENOTFOUND' }) })
    }) as typeof fetch
    try {
      const r = await requestTokens('abcdefghijk1')
      expect(r.ok).toBe(false)
      expect(r.message).toBe('Could not reach https://faucet.waxsweden.org: the host name could not be found (check the internet connection).')
      expect(r.message).not.toMatch(/fetch failed|remote words|get_token|abcdefghijk1/)
    } finally {
      globalThis.fetch = realFetch
    }
  })
})
