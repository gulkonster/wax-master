import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'wm-wallet-'))
vi.mock('electron', () => ({ app: { getPath: () => userData, isPackaged: false, getAppPath: () => userData } }))

import { chainTimePlus, controlledPermissions, REFUND_DELAY_SEC } from '../../src/main/account-view'
import { signableFrom } from '../../src/main/account-pick'
import { AddedTokens, MAX_ADDED_TOKENS, MAX_HISTORY_TOKENS, parseHistoryTokens, precisionFromStats, walletTokens } from '../../src/main/wallet-tokens'
import { generatePrivateKey, publicFromPrivate, publicKeyToString } from '../../src/chain-core'
import type { NetworkInfo, PermissionView } from '../../src/shared/chain-types'
import { ramForAmount, ramSellReturn, ramFeeUnits, type RamMarket } from '../../src/shared/ram-market'
import { amountUnits, assetUnits, memoBytes, quantityText } from '../../src/shared/wallet'

function newKey(): { k1: string; legacy: string } {
  const pub = publicFromPrivate(generatePrivateKey())
  return { k1: publicKeyToString(pub, 'new'), legacy: publicKeyToString(pub, 'legacy') }
}

function perm(name: string, threshold: number, keys: { key: string; weight: number }[], extra: Partial<PermissionView> = {}): PermissionView {
  return { name, parent: name === 'owner' ? '' : 'owner', threshold, keys: keys.map((k) => ({ key: k.key, k1: '', weight: k.weight })), accounts: [], waits: [], ...extra }
}

describe('control badge: permissions the vault keys satisfy', () => {
  const a = newKey()
  const b = newKey()
  const c = newKey()
  it('a single vault key on owner and active: "active, owner" in that order', () => {
    const perms = [perm('owner', 1, [{ key: a.legacy, weight: 1 }]), perm('active', 1, [{ key: a.k1, weight: 1 }])]
    expect(controlledPermissions(perms, [a.k1])).toEqual(['active', 'owner'])
  })
  it('no vault key: view only', () => {
    expect(controlledPermissions([perm('active', 1, [{ key: a.k1, weight: 1 }])], [b.k1])).toEqual([])
    expect(controlledPermissions([perm('active', 1, [{ key: a.k1, weight: 1 }])], [])).toEqual([])
  })
  it('weights add up across vault keys; a key counts once', () => {
    const p = perm('active', 2, [
      { key: a.k1, weight: 1 },
      { key: b.k1, weight: 1 },
      { key: c.k1, weight: 1 }
    ])
    expect(controlledPermissions([p], [a.k1])).toEqual([])
    expect(controlledPermissions([p], [a.k1, a.legacy])).toEqual([])
    expect(controlledPermissions([p], [a.k1, b.k1])).toEqual(['active'])
  })
  it('accounts and waits are not counted', () => {
    const p = perm('active', 2, [{ key: a.k1, weight: 1 }], {
      accounts: [{ actor: 'someone', permission: 'active', weight: 1 }],
      waits: [{ waitSec: 10, weight: 1 }]
    })
    expect(controlledPermissions([p], [a.k1])).toEqual([])
  })
  it('a threshold of zero or a broken key never counts', () => {
    expect(controlledPermissions([perm('active', 0, [{ key: a.k1, weight: 1 }])], [a.k1])).toEqual([])
    expect(controlledPermissions([perm('active', 1, [{ key: 'not a key', weight: 1 }])], ['not a key'])).toEqual([])
  })
  it('the pickers\' "vault" mark is decided like the badge: claim with two vault keys and threshold 2', () => {
    // As the node writes them: legacy keys, one row per key in the authorizers answer.
    const claim = perm('claim', 2, [
      { key: a.legacy, weight: 1 },
      { key: b.legacy, weight: 1 }
    ])
    const rows = [a, b].map((k) => ({ account_name: 'alice', permission_name: 'claim', authorizing_key: k.legacy, weight: 1, threshold: 2 }))
    expect(controlledPermissions([claim], [a.k1, b.k1])).toEqual(['claim'])
    expect(signableFrom(rows, [a.k1, b.k1]).get('alice')).toEqual(['claim'])
    // One of the two keys: neither the badge nor the picker says "vault".
    expect(controlledPermissions([claim], [a.k1])).toEqual([])
    expect(signableFrom(rows, [a.k1]).get('alice')).toEqual([])
  })
  it('other permissions come after active and owner, by name', () => {
    const perms = [perm('zeta', 1, [{ key: a.k1, weight: 1 }]), perm('claim', 1, [{ key: a.k1, weight: 1 }]), perm('active', 1, [{ key: a.k1, weight: 1 }])]
    expect(controlledPermissions(perms, [a.k1])).toEqual(['active', 'claim', 'zeta'])
  })
})

describe('refund time', () => {
  it('chain time is UTC; the claim time is three days later', () => {
    expect(chainTimePlus('2026-11-24T10:00:00.000', 0)).toBe('2026-11-24T10:00:00.000Z')
    expect(chainTimePlus('2026-11-24T10:00:00.000', REFUND_DELAY_SEC)).toBe('2026-11-27T10:00:00.000Z')
    expect(chainTimePlus('', 5)).toBe('')
    expect(chainTimePlus('not a time', 5)).toBe('')
  })
})

describe('history service tokens (untrusted)', () => {
  it('keeps valid rows with the token precision', () => {
    const rows = parseHistoryTokens({
      tokens: [
        { symbol: 'CRW', precision: 4, amount: 10262.9462, contract: 'chickentoken' },
        { symbol: 'TLM', precision: 4, amount: '12.5', contract: 'alien.worlds' }
      ]
    })
    expect(rows).toEqual([
      { contract: 'chickentoken', symbol: 'CRW', precision: 4, balance: '10262.9462 CRW', source: 'history' },
      { contract: 'alien.worlds', symbol: 'TLM', precision: 4, balance: '12.5000 TLM', source: 'history' }
    ])
  })
  it('drops bad names, symbols, precisions, amounts and duplicates', () => {
    const rows = parseHistoryTokens({
      tokens: [
        { symbol: 'abc', precision: 4, amount: 1, contract: 'a' },
        { symbol: 'ABC', precision: 4, amount: 1, contract: 'BAD NAME' },
        { symbol: 'ABC', precision: 19, amount: 1, contract: 'a' },
        { symbol: 'ABC', precision: 1.5, amount: 1, contract: 'a' },
        { symbol: 'ABC', precision: 4, amount: -1, contract: 'a' },
        { symbol: 'ABC', precision: 4, amount: '1e5', contract: 'a' },
        { symbol: 'ABC', precision: 4, amount: { x: 1 }, contract: 'a' },
        { symbol: 'ABC', precision: 4, amount: 1, contract: 'a' },
        { symbol: 'ABC', precision: 4, amount: 2, contract: 'a' },
        null,
        'text'
      ]
    })
    expect(rows).toEqual([{ contract: 'a', symbol: 'ABC', precision: 4, balance: '1.0000 ABC', source: 'history' }])
    expect(parseHistoryTokens(null)).toEqual([])
    expect(parseHistoryTokens({ tokens: 'x' })).toEqual([])
  })
  it('cuts the list at its limit', () => {
    const tokens = Array.from({ length: MAX_HISTORY_TOKENS + 50 }, (_, i) => ({ symbol: 'ABC', precision: 0, amount: 1, contract: `tok${'abcdefghij'[i % 10]}${'abcdefghij'[Math.floor(i / 10) % 10]}${'abcde'[Math.floor(i / 100)]}` }))
    expect(parseHistoryTokens({ tokens })).toHaveLength(MAX_HISTORY_TOKENS)
  })
})

describe('Add token', () => {
  it('reads the precision from get_currency_stats', () => {
    expect(precisionFromStats({ TLM: { supply: '100.0000 TLM', max_supply: '1000.0000 TLM', issuer: 'a' } }, 'TLM')).toBe(4)
    expect(precisionFromStats({}, 'TLM')).toBeNull()
    expect(precisionFromStats({ TLM: { supply: '100.0000 XYZ' } }, 'TLM')).toBeNull()
    expect(precisionFromStats(null, 'TLM')).toBeNull()
  })
  it('keeps tokens per network, without duplicates, up to the limit; a broken file reads as empty', () => {
    const file = join(userData, 'tokens-a.json')
    const s = new AddedTokens(file)
    expect(s.add('net1', { contract: 'alien.worlds', symbol: 'TLM', precision: 4 })).toHaveLength(1)
    expect(s.add('net1', { contract: 'alien.worlds', symbol: 'TLM', precision: 4 })).toHaveLength(1)
    expect(s.list('net2')).toEqual([])
    expect(s.remove('net1', 'alien.worlds', 'TLM')).toEqual([])
    expect(() => s.add('net1', { contract: 'BAD', symbol: 'TLM', precision: 4 })).toThrow()
    for (let i = 0; i < MAX_ADDED_TOKENS; i++) s.add('net3', { contract: 'tok', symbol: String.fromCharCode(65 + Math.floor(i / 26), 65 + (i % 26)), precision: 0 })
    expect(() => s.add('net3', { contract: 'other', symbol: 'ZZZ', precision: 0 })).toThrow()
    writeFileSync(file, '{ not json')
    expect(s.list('net1')).toEqual([])
    writeFileSync(file, JSON.stringify({ networks: { net1: [{ contract: 'ok', symbol: 'OK', precision: 2 }, { contract: 'x', symbol: 'bad', precision: 2 }] } }))
    expect(s.list('net1')).toEqual([{ contract: 'ok', symbol: 'OK', precision: 2 }])
    expect(readFileSync(file, 'utf8')).toContain('bad')
  })
})

describe('the token list', () => {
  const n = { id: 'wax-testnet', name: 'WAX Testnet', symbol: 'WAX', precision: 8 } as NetworkInfo
  it('core first, then history tokens, then added ones not already listed', async () => {
    const r = await walletTokens(n, {
      coreBalance: async () => ['56.76675385 WAX'],
      historyTokens: async () => ({ tokens: [{ symbol: 'WAX', precision: 8, amount: 1, contract: 'eosio.token' }, { symbol: 'CRW', precision: 4, amount: 1, contract: 'chickentoken' }] }),
      balance: async (contract, symbol) => (symbol === 'TLM' ? ['3.5000 TLM'] : []),
      added: [
        { contract: 'chickentoken', symbol: 'CRW', precision: 4 },
        { contract: 'alien.worlds', symbol: 'TLM', precision: 4 },
        { contract: 'empty', symbol: 'NONE', precision: 2 }
      ]
    })
    expect(r.history).toBe('ok')
    expect(r.rows.map((x) => [x.contract, x.symbol, x.balance, x.source])).toEqual([
      ['eosio.token', 'WAX', '56.76675385 WAX', 'core'],
      ['chickentoken', 'CRW', '1.0000 CRW', 'history'],
      ['alien.worlds', 'TLM', '3.5000 TLM', 'added'],
      ['empty', 'NONE', '0.00 NONE', 'added']
    ])
  })
  it('without a history service, and when it fails', async () => {
    const none = await walletTokens(n, {
      coreBalance: async () => {
        throw new Error('no answer')
      },
      balance: async () => [],
      added: []
    })
    expect(none.history).toBe('none')
    expect(none.rows).toEqual([{ contract: 'eosio.token', symbol: 'WAX', precision: 8, balance: '', source: 'core', mark: { kind: 'core', text: 'core token' } }])
    const failed = await walletTokens(n, {
      coreBalance: async () => ['1.00000000 WAX'],
      historyTokens: async () => {
        throw new Error('HTTP 500')
      },
      balance: async () => {
        throw new Error('no')
      },
      added: [{ contract: 'alien.worlds', symbol: 'TLM', precision: 4 }]
    })
    expect(failed.history).toBe('error')
    expect(failed.historyNote).toContain('HTTP 500')
    expect(failed.rows[1]).toEqual({ contract: 'alien.worlds', symbol: 'TLM', precision: 4, balance: '', source: 'added' })
  })
})

describe('RAM market: buy by amount, sell', () => {
  const m: RamMarket = { ramReserve: 100_000_000_000, quoteReserve: 4_000_000_000_000, symbol: 'WAX', precision: 8 }
  it('the fee is 0.5 % rounded up', () => {
    expect(ramFeeUnits(200)).toBe(1)
    expect(ramFeeUnits(201)).toBe(2)
    expect(ramFeeUnits(0)).toBe(0)
  })
  it('bytes for an amount after the fee', () => {
    // 1 WAX = 1e8 units; fee 500,000; input 99,500,000 -> 1e11 * 99.5e6 / (4e12 + 99.5e6)
    expect(ramForAmount(m, 100_000_000)).toBe(Math.trunc((1e11 * 99_500_000) / (4e12 + 99_500_000)))
    expect(ramForAmount(m, 0)).toBe(0)
    expect(ramForAmount(m, 1)).toBe(0)
  })
  it('tokens back for bytes, less the fee', () => {
    const out = Math.trunc((4e12 * 1024) / (1e11 + 1024))
    expect(ramSellReturn(m, 1024)).toBe(out - Math.floor((out + 199) / 200))
    expect(ramSellReturn(m, 0)).toBe(0)
  })
})

describe('wallet amounts', () => {
  it('amounts with the token precision', () => {
    expect(amountUnits('1', 4)).toBe(10_000n)
    expect(amountUnits('1.5', 4)).toBe(15_000n)
    expect(amountUnits('0.0001', 4)).toBe(1n)
    expect(amountUnits('1.', 4)).toBe(10_000n)
    expect(amountUnits('1.00001', 4)).toBeNull()
    expect(amountUnits('-1', 4)).toBeNull()
    expect(amountUnits('1e3', 4)).toBeNull()
    expect(amountUnits('', 4)).toBeNull()
    expect(amountUnits('99999999999', 8)).toBeNull()
    expect(quantityText('1.5', 8, 'WAX')).toBe('1.50000000 WAX')
    expect(quantityText('3', 0, 'NFT')).toBe('3 NFT')
    expect(quantityText('x', 0, 'NFT')).toBeNull()
  })
  it('asset text to units; memo bytes', () => {
    expect(assetUnits('1.5000 TLM', 4, 'TLM')).toBe(15_000n)
    expect(assetUnits('1.5 TLM', 4, 'TLM')).toBe(15_000n)
    expect(assetUnits('1.5000 TLM', 4, 'WAX')).toBeNull()
    expect(memoBytes('abc')).toBe(3)
    expect(memoBytes('é')).toBe(2)
  })
})

describe('wallet calls in the editor preload', () => {
  it('exposes the wallet calls', () => {
    const preload = readFileSync(join(__dirname, '../../src/preload/index.ts'), 'utf8')
    for (const c of ['wallet:tokens', 'wallet:addedTokens', 'wallet:balance', 'wallet:addToken', 'wallet:removeToken','wallet:permPreview', 'wallet:permSend', 'wallet:links', 'wallet:contractInfo', 'wallet:system', 'wallet:voting', 'wallet:powerup']) expect(preload).toContain(`call('${c}')`)
  })
})
