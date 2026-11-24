// Change key replaces one key and keeps the rest of the authority.
import { describe, expect, it } from 'vitest'
import { changeKeyActions } from '../../src/main/accounts'
import { generatePrivateKey, publicFromPrivate, publicKeyToString } from '../../src/chain-core'

const key = (): string => publicKeyToString(publicFromPrivate(generatePrivateKey()), 'new')
const A = key()
const B = key()
const NEW = key()

function account(threshold = 2): Record<string, unknown> {
  return {
    permissions: [
      { perm_name: 'owner', parent: '', required_auth: { threshold: 1, keys: [{ key: A, weight: 1 }], accounts: [], waits: [] } },
      {
        perm_name: 'active',
        parent: 'owner',
        required_auth: {
          threshold,
          keys: [
            { key: A, weight: 1 },
            { key: B, weight: 2 }
          ],
          accounts: [{ permission: { actor: 'carol', permission: 'active' }, weight: 1 }],
          waits: [{ wait_sec: 3600, weight: 1 }]
        }
      }
    ]
  }
}

type Auth = { threshold: number; keys: { key: string; weight: number }[]; accounts: unknown[]; waits: unknown[] }

describe('Change key', () => {
  it('replaces one key with the same weight; threshold, other keys, accounts, waits and parent stay', () => {
    const [act] = changeKeyActions({ account: 'alice', permission: 'active', oldKey: B, newKey: NEW, signWith: 'active' }, account())
    const d = act.data as { parent: string; auth: Auth }
    expect(act.authorization).toEqual([{ actor: 'alice', permission: 'active' }])
    expect(d.parent).toBe('owner')
    expect(d.auth.threshold).toBe(2)
    expect(d.auth.keys).toHaveLength(2)
    expect(d.auth.keys).toContainEqual({ key: A, weight: 1 })
    expect(d.auth.keys).toContainEqual({ key: NEW, weight: 2 })
    expect(d.auth.accounts).toEqual([{ permission: { actor: 'carol', permission: 'active' }, weight: 1 }])
    expect(d.auth.waits).toEqual([{ wait_sec: 3600, weight: 1 }])
  })

  it('signs with the permission itself or a parent, nothing else', () => {
    expect(changeKeyActions({ account: 'alice', permission: 'active', oldKey: A, newKey: NEW, signWith: 'owner' }, account())[0].authorization[0].permission).toBe('owner')
    expect(() => changeKeyActions({ account: 'alice', permission: 'active', oldKey: A, newKey: NEW, signWith: 'other' }, account())).toThrow(/one of its parents/)
  })

  it('refuses a key that is not in the permission, the same key, a key already present, and an unreachable threshold', () => {
    const base = { account: 'alice', permission: 'active', signWith: 'active' }
    expect(() => changeKeyActions({ ...base, oldKey: NEW, newKey: key() }, account())).toThrow(/not a key/)
    expect(() => changeKeyActions({ ...base, oldKey: A, newKey: A }, account())).toThrow(/same/)
    expect(() => changeKeyActions({ ...base, oldKey: A, newKey: B }, account())).toThrow(/already/)
    expect(() => changeKeyActions({ ...base, oldKey: A, newKey: NEW }, account(99))).toThrow(/threshold/)
    expect(() => changeKeyActions({ ...base, permission: 'nope', oldKey: A, newKey: NEW, signWith: 'nope' }, account())).toThrow(/no permission/)
  })
})
