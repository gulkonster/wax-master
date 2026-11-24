import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { bytesToHex, encodeAction, parseAbi } from '../../src/chain-core'
import { abiView, ContractHistory, HISTORY_CAP, packAction, rowsBody } from '../../src/main/contract-view'
import fixture from '../fixtures/chain/system-abis.json'

const def = parseAbi((fixture as { abi: Record<string, unknown> }).abi['eosio.token'])
const data = { from: 'alice', to: 'bob', quantity: '1.00000000 WAX', memo: 'hi' }
const auth = [{ actor: 'alice', permission: 'active' }]

describe('pack', () => {
  it('matches chain-core for an eosio.token transfer', () => {
    const r = packAction(def, 'https://testnet.waxsweden.org', 'eosio.token', 'transfer', data, auth)
    expect(r.hex).toBe(bytesToHex(encodeAction(def, 'transfer', data)))
    expect(JSON.parse(r.json)).toEqual({ account: 'eosio.token', name: 'transfer', authorization: auth, data })
  })
  it('builds the cleos line', () => {
    const r = packAction(def, 'https://testnet.waxsweden.org', 'eosio.token', 'transfer', data, [...auth, { actor: 'bob', permission: 'owner' }])
    expect(r.cleos).toBe(
      `cleos -u https://testnet.waxsweden.org push action eosio.token transfer '${JSON.stringify(data)}' -p alice@active -p bob@owner`
    )
  })
  it('escapes single quotes in the data', () => {
    const r = packAction(def, 'https://x.example', 'eosio.token', 'transfer', { ...data, memo: "it's" }, auth)
    expect(r.cleos).toContain("it'\\''s")
  })
  it('names the field in errors', () => {
    expect(() => packAction(def, 'https://x.example', 'eosio.token', 'transfer', { ...data, quantity: 'nope' }, auth)).toThrow(/quantity/)
  })
})

describe('abi view', () => {
  it('lists actions and tables with fields', () => {
    const v = abiView('eosio.token', def)
    expect(v.actions.map((a) => a.name)).toContain('transfer')
    expect(v.actions.find((a) => a.name === 'transfer')?.fields.map((f) => f.name)).toEqual(['from', 'to', 'quantity', 'memo'])
    expect(v.tables.find((t) => t.name === 'stat')?.fields.map((f) => f.name)).toEqual(['supply', 'max_supply', 'issuer'])
  })
})

describe('table query body', () => {
  it('defaults the scope to the contract and sends only set fields', () => {
    const b = rowsBody({ account: 'eosio.token', table: 'accounts', scope: '', lower: '', upper: '', limit: 10, index: '', keyType: '', reverse: false })
    expect(b).toEqual({ json: true, code: 'eosio.token', table: 'accounts', scope: 'eosio.token', limit: 10, reverse: false })
  })
})

describe('favorites and history', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wax-contract-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  it('caps history at 50 per contract and keeps newest first', () => {
    const h = new ContractHistory(join(dir, 'h.json'))
    for (let i = 0; i < HISTORY_CAP + 10; i++) h.add('wax-testnet', 'eosio.token', 'action', 'history', 'transfer', { data: { n: i } })
    const list = h.list('wax-testnet', 'eosio.token', 'action', 'history')
    expect(list).toHaveLength(HISTORY_CAP)
    expect(list[0].payload).toEqual({ data: { n: HISTORY_CAP + 9 } })
  })
  it('keeps networks, contracts and kinds apart and removes by id', () => {
    const h = new ContractHistory(join(dir, 'h2.json'))
    const a = h.add('wax-testnet', 'eosio.token', 'query', 'favorite', 'stat', { scope: 'WAX' })
    h.add('wax-mainnet', 'eosio.token', 'query', 'favorite', 'stat', { scope: 'WAX' })
    expect(h.list('wax-testnet', 'eosio', 'query', 'favorite')).toHaveLength(0)
    expect(h.list('wax-testnet', 'eosio.token', 'action', 'favorite')).toHaveLength(0)
    expect(h.remove('wax-testnet', 'eosio.token', 'query', 'favorite', a[0].id)).toHaveLength(0)
    expect(h.list('wax-mainnet', 'eosio.token', 'query', 'favorite')).toHaveLength(1)
  })
  it('does not repeat an identical entry', () => {
    const h = new ContractHistory(join(dir, 'h3.json'))
    h.add('n', 'c', 'query', 'history', 't', { scope: 'x' })
    expect(h.add('n', 'c', 'query', 'history', 't', { scope: 'x' })).toHaveLength(1)
  })
})
