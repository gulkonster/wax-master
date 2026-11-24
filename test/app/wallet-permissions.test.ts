// Permission changes as intents: the main process builds the new authority from
// the chain's current one, in the chain's order, and refuses every change that
// could lock the account out. Run on single-key, multi-key and key-plus-account
// authorities.

import { describe, expect, it } from 'vitest'
import {
  ancestry,
  linksFromAccount,
  linksFromHistory,
  parsePermissionIntent,
  planPermissionChange,
  PermissionRefusal,
  reachProblem,
  readPermissions,
  type PlanContext
} from '../../src/main/wallet-permissions'
import { encodeAction, EOSIO_ABI, generatePrivateKey, publicFromPrivate, publicKeyToString } from '../../src/chain-core'
import type { PermissionIntent } from '../../src/shared/chain-types'

const newPub = (): string => publicKeyToString(publicFromPrivate(generatePrivateKey()), 'new')
const K1 = newPub()
const K2 = newPub()
const K3 = newPub()
const LEGACY = publicKeyToString(publicFromPrivate(generatePrivateKey()), 'legacy')

type Auth = { threshold: number; keys?: { key: string; weight: number }[]; accounts?: { permission: { actor: string; permission: string }; weight: number }[]; waits?: { wait_sec: number; weight: number }[] }

function perm(name: string, parent: string, auth: Auth, linked?: { account: string; action: string }[]): Record<string, unknown> {
  return {
    perm_name: name,
    parent,
    required_auth: { threshold: auth.threshold, keys: auth.keys ?? [], accounts: auth.accounts ?? [], waits: auth.waits ?? [] },
    ...(linked ? { linked_actions: linked } : {})
  }
}

const SINGLE: Auth = { threshold: 1, keys: [{ key: K1, weight: 1 }] }
const MULTI: Auth = {
  threshold: 2,
  keys: [
    { key: K1, weight: 1 },
    { key: K2, weight: 1 }
  ]
}
const KEY_ACCOUNT: Auth = { threshold: 2, keys: [{ key: K1, weight: 1 }], accounts: [{ permission: { actor: 'bob', permission: 'active' }, weight: 1 }] }

const SHAPES: [string, Auth][] = [
  ['single key', SINGLE],
  ['multi key', MULTI],
  ['key plus account', KEY_ACCOUNT]
]

function account(active: Auth, extra: Record<string, unknown>[] = [], linked = true): Record<string, unknown> {
  const l = linked ? [] : undefined
  return {
    account_name: 'alice',
    permissions: [perm('owner', '', SINGLE, l), perm('active', 'owner', active, l), ...extra]
  }
}

function ctx(accountData: Record<string, unknown>, over: Partial<PlanContext> = {}): PlanContext {
  return {
    accountData,
    vaultKeys: [K1],
    levelExists: async (actor, p) => ['bob@active', 'carol@active', 'alice@owner'].includes(`${actor}@${p}`),
    actionExists: async (code, action) => code === 'eosio.token' && action === 'transfer',
    ...over
  }
}

const A = { account: 'alice' }

async function plan(i: PermissionIntent, sign: string, c: PlanContext): ReturnType<typeof planPermissionChange> {
  return planPermissionChange(parsePermissionIntent(i), sign, c)
}

/** The built action encodes with the eosio ABI (so its authority is in the chain's order). */
function encodes(p: Awaited<ReturnType<typeof planPermissionChange>>): void {
  expect(() => encodeAction(EOSIO_ABI, p.action.name, p.action.data)).not.toThrow()
}

async function refused(i: PermissionIntent, sign: string, c: PlanContext, text: RegExp): Promise<void> {
  const r = plan(i, sign, c)
  await expect(r).rejects.toBeInstanceOf(PermissionRefusal)
  await expect(r).rejects.toThrow(text)
  await expect(r).rejects.toThrow(/Nothing was prepared/)
}

describe('each intent on single-key, multi-key and key-plus-account authorities', () => {
  for (const [shape, active] of SHAPES) {
    describe(shape, () => {
      it('add key: kept entries, new key added, chain order, threshold unchanged', async () => {
        const p = await plan({ kind: 'addKey', ...A, permission: 'active', key: K3, weight: 1 }, 'active', ctx(account(active)))
        expect(p.action.name).toBe('updateauth')
        const auth = (p.action.data as { auth: { threshold: number; keys: { key: string }[] } }).auth
        expect(auth.threshold).toBe(active.threshold)
        expect(auth.keys.map((k) => k.key).sort()).toEqual([...(active.keys ?? []).map((k) => k.key), K3].sort())
        expect(p.after?.accounts).toEqual((active.accounts ?? []).map((a) => ({ actor: a.permission.actor, permission: a.permission.permission, weight: a.weight })))
        expect(p.before?.threshold).toBe(active.threshold)
        expect((p.action.data as { parent: string }).parent).toBe('owner')
        expect(p.action.authorization).toEqual([{ actor: 'alice', permission: 'active' }])
        encodes(p)
      })

      it('remove key: allowed only when the threshold stays reachable', async () => {
        const i: PermissionIntent = { kind: 'removeKey', ...A, permission: 'active', key: K1 }
        if (shape === 'single key') return refused(i, 'active', ctx(account(active)), /could not reach its threshold 1/)
        if (shape === 'multi key') return refused(i, 'active', ctx(account(active)), /could not reach its threshold 2/)
        return refused(i, 'active', ctx(account(active)), /could not reach its threshold 2: .* add up to 1/)
      })

      it('remove key after adding weight elsewhere: the remaining entries keep their weights', async () => {
        const wide: Auth = { ...active, threshold: 1 }
        if ((wide.keys?.length ?? 0) + (wide.accounts?.length ?? 0) < 2) return
        const p = await plan({ kind: 'removeKey', ...A, permission: 'active', key: K1 }, 'active', ctx(account(wide)))
        expect(p.after?.keys.map((k) => k.key)).not.toContain(K1)
        expect([...(p.after?.keys ?? []), ...(p.after?.accounts ?? [])].every((e) => e.weight === 1)).toBe(true)
        expect(p.warnings.join(' ')).toMatch(/vault's keys no longer reach/)
        encodes(p)
      })

      it('add account and remove account', async () => {
        const p = await plan({ kind: 'addAccount', ...A, permission: 'active', actor: 'carol', actorPermission: 'active', weight: 1 }, 'active', ctx(account(active)))
        expect(p.after?.accounts.map((a) => `${a.actor}@${a.permission}`)).toContain('carol@active')
        // Accounts in the chain's order (by name value).
        const names = p.after!.accounts.map((a) => a.actor)
        expect(names).toEqual([...names].sort())
        encodes(p)
        if (active.accounts?.length) {
          await refused({ kind: 'removeAccount', ...A, permission: 'active', actor: 'bob', actorPermission: 'active' }, 'active', ctx(account(active)), /could not reach/)
          const loose = await plan({ kind: 'removeAccount', ...A, permission: 'active', actor: 'bob', actorPermission: 'active' }, 'active', ctx(account({ ...active, threshold: 1 })))
          expect(loose.after?.accounts).toEqual([])
        }
      })

      it('set threshold: reachable is built, unreachable is refused', async () => {
        const total = (active.keys?.length ?? 0) + (active.accounts?.length ?? 0)
        if (active.threshold !== 1) {
          const p = await plan({ kind: 'setThreshold', ...A, permission: 'active', threshold: 1 }, 'active', ctx(account(active)))
          expect(p.after?.threshold).toBe(1)
          encodes(p)
        }
        await refused({ kind: 'setThreshold', ...A, permission: 'active', threshold: total + 1 }, 'active', ctx(account(active)), /could not reach its threshold/)
      })

      it('eosio.code on: weight equal to the threshold, the others keep their weights; off removes it', async () => {
        const p = await plan({ kind: 'eosioCode', ...A, permission: 'active', enable: true }, 'active', ctx(account(active)))
        const code = p.after!.accounts.find((a) => a.permission === 'eosio.code')
        expect(code).toEqual({ actor: 'alice', permission: 'eosio.code', weight: active.threshold })
        for (const k of active.keys ?? []) expect(p.after!.keys.find((x) => x.key === k.key)?.weight).toBe(k.weight)
        expect(p.explanation.join(' ')).toMatch(/equal to the threshold/)
        encodes(p)
        const on = { ...active, accounts: [...(active.accounts ?? []), { permission: { actor: 'alice', permission: 'eosio.code' }, weight: active.threshold }] }
        const off = await plan({ kind: 'eosioCode', ...A, permission: 'active', enable: false }, 'active', ctx(account(on)))
        expect(off.after!.accounts.some((a) => a.permission === 'eosio.code')).toBe(false)
        await refused({ kind: 'eosioCode', ...A, permission: 'active', enable: true }, 'active', ctx(account(on)), /already an entry/)
        await refused({ kind: 'eosioCode', ...A, permission: 'active', enable: false }, 'active', ctx(account(active)), /not an entry/)
      })

      it('new permission under active, link, unlink, delete', async () => {
        const n = await plan({ kind: 'newPermission', ...A, permission: 'claim', parent: 'active', key: K3 }, 'active', ctx(account(active)))
        expect(n.action.data).toMatchObject({ account: 'alice', permission: 'claim', parent: 'active', auth: { threshold: 1, keys: [{ key: K3, weight: 1 }] } })
        expect(n.warnings.join(' ')).toMatch(/not in the vault/)
        encodes(n)
        const claim = perm('claim', 'active', SINGLE, [])
        const l = await plan({ kind: 'link', ...A, code: 'eosio.token', type: 'transfer', requirement: 'claim' }, 'active', ctx(account(active, [claim])))
        expect(l.action).toMatchObject({ name: 'linkauth', data: { account: 'alice', code: 'eosio.token', type: 'transfer', requirement: 'claim' } })
        encodes(l)
        const linked = perm('claim', 'active', SINGLE, [{ account: 'eosio.token', action: 'transfer' }])
        const u = await plan({ kind: 'unlink', ...A, code: 'eosio.token', type: 'transfer' }, 'active', ctx(account(active, [linked])))
        expect(u.action).toMatchObject({ name: 'unlinkauth', data: { account: 'alice', code: 'eosio.token', type: 'transfer' } })
        encodes(u)
        const d = await plan({ kind: 'deletePermission', ...A, permission: 'claim' }, 'active', ctx(account(active, [claim])))
        expect(d.action).toMatchObject({ name: 'deleteauth', data: { account: 'alice', permission: 'claim' } })
        expect(d.after).toBeNull()
        encodes(d)
      })
    })
  }
})

describe('refused: every way to lock an account out', () => {
  const c = (): PlanContext => ctx(account(SINGLE))
  it('removing the only key', () => refused({ kind: 'removeKey', ...A, permission: 'active', key: K1 }, 'active', c(), /could not reach its threshold 1/))
  it('a threshold above the weights', () => refused({ kind: 'setThreshold', ...A, permission: 'active', threshold: 2 }, 'active', c(), /could not reach/))
  it('a threshold of zero', async () => {
    expect(() => parsePermissionIntent({ kind: 'setThreshold', ...A, permission: 'active', threshold: 0 })).toThrow()
    expect(reachProblem('alice', 'active', { threshold: 0, keys: [{ key: K1, weight: 1 }], accounts: [], waits: [] }, readPermissions(account(SINGLE)))).toMatch(
      /at least 1/
    )
  })
  it('a weight of zero', () => expect(() => parsePermissionIntent({ kind: 'addKey', ...A, permission: 'active', key: K2, weight: 0 })).toThrow())
  it('reaching the threshold only with eosio.code (contract code, not a signer)', async () => {
    const onlyCode: Auth = { threshold: 1, keys: [{ key: K1, weight: 1 }], accounts: [{ permission: { actor: 'alice', permission: 'eosio.code' }, weight: 1 }] }
    await refused({ kind: 'removeKey', ...A, permission: 'active', key: K1 }, 'active', ctx(account(onlyCode)), /could not reach its threshold 1: .* add up to 0/)
  })
  it('reaching the threshold only through itself or a permission below it (a circle)', async () => {
    const child = perm('claim', 'active', SINGLE)
    const self: Auth = { threshold: 1, keys: [{ key: K1, weight: 1 }], accounts: [{ permission: { actor: 'alice', permission: 'claim' }, weight: 1 }] }
    await refused({ kind: 'removeKey', ...A, permission: 'active', key: K1 }, 'active', ctx(account(self, [child])), /could not reach/)
    await refused(
      { kind: 'addAccount', ...A, permission: 'active', actor: 'alice', actorPermission: 'active', weight: 1 },
      'active',
      ctx(account(SINGLE)),
      /cannot list itself/
    )
  })
  it('reaching the threshold only with waits (delayed transactions)', async () => {
    const withWait: Auth = { threshold: 1, keys: [{ key: K1, weight: 1 }], waits: [{ wait_sec: 3600, weight: 1 }] }
    await refused({ kind: 'removeKey', ...A, permission: 'active', key: K1 }, 'active', ctx(account(withWait)), /could not reach/)
  })
  it('an account entry that does not exist on the network', () =>
    refused({ kind: 'addAccount', ...A, permission: 'active', actor: 'nobody', actorPermission: 'active', weight: 1 }, 'active', c(), /does not exist/))
  it('the same on owner, with the owner warning when it is allowed', async () => {
    await refused({ kind: 'removeKey', ...A, permission: 'owner', key: K1 }, 'owner', c(), /could not reach/)
    const p = await plan({ kind: 'addKey', ...A, permission: 'owner', key: K2, weight: 1 }, 'owner', c())
    expect(p.warnings[0]).toMatch(/This changes owner/)
  })
  it('deleting owner or active, a permission with permissions under it, or one with linked actions', async () => {
    await refused({ kind: 'deletePermission', ...A, permission: 'active' }, 'owner', c(), /cannot be deleted/)
    await refused({ kind: 'deletePermission', ...A, permission: 'owner' }, 'owner', c(), /cannot be deleted/)
    const parent = perm('claim', 'active', SINGLE, [])
    const child = perm('sub', 'claim', SINGLE, [])
    await refused({ kind: 'deletePermission', ...A, permission: 'claim' }, 'active', ctx(account(SINGLE, [parent, child])), /delete those first/)
    const linked = perm('claim', 'active', SINGLE, [{ account: 'eosio.token', action: 'transfer' }])
    await refused({ kind: 'deletePermission', ...A, permission: 'claim' }, 'active', ctx(account(SINGLE, [linked])), /unlink them first/)
    // Links from the history service count when the node does not report them.
    const bare = perm('claim', 'active', SINGLE)
    await refused(
      { kind: 'deletePermission', ...A, permission: 'claim' },
      'active',
      ctx(account(SINGLE, [bare], false), { historyLinks: [{ contract: 'eosio.token', action: 'transfer', permission: 'claim' }] }),
      /unlink them first/
    )
  })
})

describe('other refusals and rules', () => {
  const c = (): PlanContext => ctx(account(MULTI))
  it('the signer must be the permission or a parent', async () => {
    await refused({ kind: 'addKey', ...A, permission: 'owner', key: K2, weight: 1 }, 'active', c(), /Sign this change with owner/)
    await refused({ kind: 'newPermission', ...A, permission: 'claim', parent: 'owner', key: K2 }, 'active', c(), /Sign this change with owner/)
    const p = await plan({ kind: 'addKey', ...A, permission: 'active', key: K3, weight: 1 }, 'owner', c())
    expect(p.action.authorization).toEqual([{ actor: 'alice', permission: 'owner' }])
  })
  it('duplicate key or account, invalid key, unknown permission, reserved new name, existing name', async () => {
    await refused({ kind: 'addKey', ...A, permission: 'active', key: K2, weight: 1 }, 'active', c(), /already a key/)
    // The same key written in the legacy form is the same key.
    const legacyActive: Auth = { threshold: 1, keys: [{ key: LEGACY, weight: 1 }] }
    await refused({ kind: 'removeKey', ...A, permission: 'active', key: LEGACY }, 'active', ctx(account(legacyActive)), /could not reach/)
    await refused({ kind: 'addKey', ...A, permission: 'active', key: 'EOSnot-a-key', weight: 1 }, 'active', c(), /Not a valid public key/)
    await refused({ kind: 'addKey', ...A, permission: 'nosuch', key: K3, weight: 1 }, 'active', c(), /no permission "nosuch"/)
    await refused({ kind: 'newPermission', ...A, permission: 'eosio.any', parent: 'active', key: K3 }, 'active', c(), /reserved/)
    await refused({ kind: 'newPermission', ...A, permission: 'active', parent: 'active', key: K3 }, 'active', c(), /already has/)
    await refused({ kind: 'addAccount', ...A, permission: 'active', actor: 'alice', actorPermission: 'eosio.code', weight: 1 }, 'active', c(), /switch/)
  })
  it('link: system auth actions, unknown action, already linked; unlink of a link that is not there', async () => {
    const claim = perm('claim', 'active', SINGLE, [{ account: 'eosio.token', action: 'transfer' }])
    const withClaim = (): PlanContext => ctx({ permissions: [perm('owner', '', SINGLE, []), perm('active', 'owner', SINGLE, []), claim] })
    await refused({ kind: 'link', ...A, code: 'eosio', type: 'updateauth', requirement: 'claim' }, 'active', withClaim(), /does not let/)
    await refused({ kind: 'link', ...A, code: 'eosio.token', type: 'issue', requirement: 'claim' }, 'active', withClaim(), /no action "issue"/)
    await refused({ kind: 'link', ...A, code: 'eosio.token', type: 'transfer', requirement: 'claim' }, 'active', withClaim(), /already linked/)
    await refused({ kind: 'unlink', ...A, code: 'eosio.token', type: 'open' }, 'active', withClaim(), /not linked/)
  })
  it('setting a threshold above an eosio.code entry warns', async () => {
    const on: Auth = { threshold: 1, keys: [{ key: K1, weight: 1 }, { key: K2, weight: 1 }], accounts: [{ permission: { actor: 'alice', permission: 'eosio.code' }, weight: 1 }] }
    const p = await plan({ kind: 'setThreshold', ...A, permission: 'active', threshold: 2 }, 'active', ctx(account(on)))
    expect(p.warnings.join(' ')).toMatch(/below the new threshold/)
  })
  it('the basis changes when the permissions change', async () => {
    const a = await plan({ kind: 'addKey', ...A, permission: 'active', key: K3, weight: 1 }, 'active', ctx(account(SINGLE)))
    const b = await plan({ kind: 'addKey', ...A, permission: 'active', key: K3, weight: 1 }, 'active', ctx(account(MULTI)))
    expect(a.basis).not.toBe(b.basis)
    expect(a.basis).toMatch(/^[0-9a-f]{32}$/)
  })
})

describe('intent parsing: the editor window cannot send an authority', () => {
  it('keeps only the fields of the intent', () => {
    const i = parsePermissionIntent({ kind: 'setThreshold', ...A, permission: 'active', threshold: 2, auth: { threshold: 1 }, data: { x: 1 } })
    expect(i).toEqual({ kind: 'setThreshold', account: 'alice', permission: 'active', threshold: 2 })
  })
  it('refuses unknown kinds and malformed fields', () => {
    for (const bad of [
      null,
      'text',
      { kind: 'updateauth', ...A, permission: 'active' },
      { kind: 'addKey', account: 'BAD', permission: 'active', key: K1, weight: 1 },
      { kind: 'addKey', ...A, permission: 'active', key: 7, weight: 1 },
      { kind: 'addKey', ...A, permission: 'active', key: 'x'.repeat(121), weight: 1 },
      { kind: 'addKey', ...A, permission: 'active', key: K1, weight: 65536 },
      { kind: 'addKey', ...A, permission: '', key: K1, weight: 1 },
      { kind: 'setThreshold', ...A, permission: 'active', threshold: 1.5 },
      { kind: 'eosioCode', ...A, permission: 'active', enable: 'yes' },
      { kind: 'link', ...A, code: 'eosio.token', type: 'BAD', requirement: 'claim' }
    ]) {
      expect(() => parsePermissionIntent(bad), JSON.stringify(bad)).toThrow()
    }
  })
})

describe('linked actions and helpers', () => {
  it('reads linked actions from get_account, or null when the node does not report them', () => {
    const a = { permissions: [perm('owner', '', SINGLE, []), perm('claim', 'active', SINGLE, [{ account: 'game', action: 'claim' }, { account: 'game2', action: null as never }])] }
    expect(linksFromAccount(a)).toEqual([
      { contract: 'game', action: 'claim', permission: 'claim' },
      { contract: 'game2', action: '', permission: 'claim' }
    ])
    expect(linksFromAccount({ permissions: [perm('owner', '', SINGLE)] })).toBeNull()
  })
  it('reads the history service answer row by row', () => {
    expect(
      linksFromHistory({
        links: [
          { code: 'game', action: 'claim', permission: 'claim' },
          { code: 'game', action: 'claim', permission: 'claim' },
          { code: 'BAD', action: 'claim', permission: 'claim' },
          { code: 'game', action: '', permission: 'claim' },
          'junk'
        ]
      })
    ).toEqual([
      { contract: 'game', action: 'claim', permission: 'claim' },
      { contract: 'game', action: '', permission: 'claim' }
    ])
    expect(linksFromHistory(null)).toEqual([])
  })
  it('ancestry is the permission, then its parents', () => {
    const perms = readPermissions(account(SINGLE, [perm('claim', 'active', SINGLE)]))
    expect(ancestry(perms, 'claim')).toEqual(['claim', 'active', 'owner'])
  })
})
