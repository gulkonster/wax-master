// Account picker list: starred accounts first, then accounts of the vault's
// keys, with the permissions whose threshold the vault's keys reach; and the
// account existence check used for recipients and new names.

import { describe, expect, it } from 'vitest'
import { isUnknownAccount, pickList, signableFrom, type AuthorizerRow } from '../../src/main/account-pick'
import { RpcError } from '../../src/main/rpc'
import { convertPublicKey, generatePrivateKey, publicFromPrivate, publicKeyToString } from '../../src/chain-core'

const newKey = (): string => publicKeyToString(publicFromPrivate(generatePrivateKey()))
const K1 = newKey()
const K2 = newKey()
const FOREIGN = newKey()

const row = (account: string, permission: string, key: string, weight = 1, threshold = 1): AuthorizerRow => ({
  account_name: account,
  permission_name: permission,
  authorizing_key: key,
  weight,
  threshold
})

describe('what the vault can sign', () => {
  it('a permission counts when the vault keys reach its threshold together', () => {
    const m = signableFrom([
      row('alice', 'active', K1, 1, 1),
      row('alice', 'owner', K1, 1, 2),
      row('bob', 'active', K1, 1, 2),
      row('bob', 'active', K2, 1, 2)
    ], [K1, K2])
    expect(m.get('alice')).toEqual(['active'])
    expect(m.get('bob')).toEqual(['active'])
  })
  it('the same key listed twice is counted once; an account below every threshold is view only', () => {
    const m = signableFrom([row('carol', 'active', K1, 1, 2), row('carol', 'active', K1, 1, 2)], [K1, K2])
    expect(m.get('carol')).toEqual([])
  })
})

describe('the node answer is untrusted', () => {
  it('drops rows with a bad name, a foreign key, a bad weight or threshold; the same key in legacy form counts', () => {
    const m = signableFrom(
      [
        row('Bad.Name', 'active', K1),
        row('alice', 'act ive', K1),
        row('toolongaccountname', 'active', K1),
        row('mallory', 'active', FOREIGN),
        row('mallory', 'owner', 'not a key'),
        row('dave', 'active', K1, -5, 1),
        row('dave', 'owner', K1, 1.5, 1),
        row('dave', 'other', K1, 70_000, 1),
        row('erin', 'active', K1, 1, 0),
        row('erin', 'owner', K1, 1, 5_000_000_000),
        { account_name: 7, permission_name: 'active', authorizing_key: K1, weight: 1, threshold: 1 } as unknown as AuthorizerRow,
        row('frank', 'active', convertPublicKey(K1, 'legacy'))
      ],
      [K1]
    )
    expect([...m.keys()]).toEqual(['frank'])
    expect(m.get('frank')).toEqual(['active'])
  })
  it('a key the vault never sent adds no weight', () => {
    const m = signableFrom([row('gina', 'active', K1, 1, 2), row('gina', 'active', FOREIGN, 1, 2)], [K1])
    expect(m.get('gina')).toEqual([])
  })
  it('10,000 rows: at most 500 accounts and 20 permissions per account', () => {
    const rows: AuthorizerRow[] = []
    const name = (i: number): string => 'a' + i.toString(5).replace(/[0-4]/g, (d) => 'bcdef'[Number(d)]).padStart(6, 'b')
    for (let i = 0; i < 9_970; i++) rows.push(row(name(i), 'active', K1))
    for (let i = 0; i < 30; i++) rows.push(row(name(0), 'perm' + 'bcdefghijklmnopqrstuvwxyz'[i % 25] + (i < 25 ? '' : 'z'), K1))
    const m = signableFrom(rows, [K1])
    expect(m.size).toBe(500)
    expect(m.get(name(0))!.length).toBe(20)
  })
})

describe('picker list', () => {
  it('starred first in their order, then vault accounts by name; active first', async () => {
    const l = await pickList('net', {
      stars: ['zed', 'alice'],
      vaultKeys: [K1],
      lookup: async () => [row('bob', 'owner', K1), row('bob', 'active', K1), row('alice', 'active', K1), row('abe', 'active', K1, 1, 3)]
    })
    expect(l.networkId).toBe('net')
    expect(l.vaultChecked).toBe(true)
    expect(l.entries).toEqual([
      { account: 'zed', starred: true, fromVault: false, signable: [] },
      { account: 'alice', starred: true, fromVault: true, signable: ['active'] },
      { account: 'abe', starred: false, fromVault: true, signable: [] },
      { account: 'bob', starred: false, fromVault: true, signable: ['active', 'owner'] }
    ])
  })
  it('lists the starred accounts when the endpoint cannot look up keys, and asks nothing without keys', async () => {
    const failed = await pickList('net', {
      stars: ['alice'],
      vaultKeys: [K1],
      lookup: async () => {
        throw new Error('not supported')
      }
    })
    expect(failed.vaultChecked).toBe(false)
    expect(failed.entries.map((e) => e.account)).toEqual(['alice'])
    let asked = 0
    const none = await pickList('net', {
      stars: [],
      vaultKeys: [],
      lookup: async () => {
        asked++
        return []
      }
    })
    expect(none.entries).toEqual([])
    expect(asked).toBe(0)
  })
})

describe('account existence', () => {
  it('a node answer "unknown key" means the account does not exist; a failed request does not', () => {
    const body = { code: 500, error: { name: 'exception', details: [{ message: 'unknown key (eosio::chain::name): nosuchacct' }] } }
    expect(isUnknownAccount(new RpcError('Internal Service Error', 500, body))).toBe(true)
    expect(isUnknownAccount(new RpcError('Request failed', 0))).toBe(false)
    expect(isUnknownAccount(new Error('unknown key'))).toBe(false)
  })
})
