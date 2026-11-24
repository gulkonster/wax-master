// Keys and permissions: the account's permissions as a tree with their keys,
// accounts, waits, weights and thresholds, vault marks, Change key, and every
// permission change (each one opens the change dialog, which shows the full
// new authority built by the main process before the confirmation).

import { useEffect, useState } from 'react'
import type { PermissionIntent, PermissionView } from '../../../../shared/chain-types'
import { emit } from '../../lib/bus'
import { HelpButton } from '../../components/HelpButton'
import { IconClose, IconKey, IconLock } from '../../components/Icons'
import { ViewOnlyLine, type WalletContext } from './common'
import { ancestry, PermissionChangeDialog, type ChangeStart } from './PermissionChange'

/** Permissions in tree order (each followed by the ones under it) with their depth. */
export function permissionTree(perms: PermissionView[]): { perm: PermissionView; depth: number }[] {
  const out: { perm: PermissionView; depth: number }[] = []
  const seen = new Set<string>()
  const rank = (p: string): number => (p === 'owner' ? 0 : p === 'active' ? 1 : 2)
  const walk = (parent: string, depth: number): void => {
    const children = perms.filter((p) => p.parent === parent && !seen.has(p.name)).sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name))
    for (const c of children) {
      seen.add(c.name)
      out.push({ perm: c, depth })
      if (depth < 16) walk(c.name, depth + 1)
    }
  }
  walk('', 0)
  // Anything whose parent was not found is listed at the end.
  for (const p of perms) if (!seen.has(p.name)) out.push({ perm: p, depth: 0 })
  return out
}

export function PermissionsSection({ ctx }: { ctx: WalletContext }): React.JSX.Element {
  const { view } = ctx
  const [vaultKeys, setVaultKeys] = useState<string[]>([])
  const [change, setChange] = useState<ChangeStart | null>(null)

  useEffect(() => {
    window.wax.keys
      .list()
      .then((l) => setVaultKeys(l.map((k) => k.publicKey)))
      .catch(() => setVaultKeys([]))
  }, [view])

  const open = (s: ChangeStart): void => setChange(s)
  const intent = (i: PermissionIntent): void => open({ intent: i })
  const disabled = ctx.viewOnly
  const reason = disabled ? ctx.reason : undefined

  const changeKey = (p: PermissionView): void => {
    emit('change-key', {
      account: view.name,
      permission: p.name,
      currentKeys: p.keys.map((k) => k.k1 || k.key),
      vaultKeys: p.keys.filter((k) => vaultKeys.includes(k.k1)).map((k) => k.k1),
      signOptions: ancestry(view.permissions, p.name),
      threshold: p.threshold,
      others: [...p.accounts.map((a) => `${a.actor}@${a.permission}`), ...p.waits.map((w) => `wait ${w.waitSec} s`)]
    })
  }

  return (
    <section className="wallet-section">
      <div className="wallet-section-head">
        <h3>Keys and permissions</h3>
        <HelpButton place="walletPermissions" />
      </div>
      <p className="wallet-lead">
        Who may sign for this account: each permission needs keys or accounts whose weights reach its threshold. A permission can also sign for the permissions
        under it.
      </p>
      <div className="card-list">
        {permissionTree(view.permissions).map(({ perm: p, depth }) => {
          const code = p.accounts.find((a) => a.actor === view.name && a.permission === 'eosio.code')
          const fixed = p.name === 'owner' || p.name === 'active'
          return (
            <div key={p.name} className="perm-card" style={{ ['--perm-depth' as string]: depth }}>
              <div className="perm-head">
                <span className={`badge perm-${p.name === 'owner' ? 'owner' : p.name === 'active' ? 'active' : 'other'}`}>{p.name}</span>
                <span className="badge" title="Threshold: the weights of the signers must add up to this">
                  <IconLock size="xs" /> threshold {p.threshold}
                </span>
                {p.parent && <span className="parent">under {p.parent}</span>}
                {view.control.includes(p.name) && (
                  <span className="badge green" title="The vault's keys reach the threshold of this permission">
                    <IconKey size="xs" /> vault can sign
                  </span>
                )}
              </div>
              <div className="perm-entries">
                {p.keys.map((k) => (
                  <div key={k.key} className="perm-entry mono-small">
                    <span className="badge" title="Weight">
                      {k.weight}
                    </span>
                    <span className="perm-entry-text">{k.key}</span>
                    {vaultKeys.includes(k.k1) && (
                      <span className="badge green" title="This key is in your vault">
                        <IconKey size="xs" /> vault
                      </span>
                    )}
                    <button
                      className="icon-btn small"
                      title={reason ?? 'Remove this key'}
                      aria-label="Remove this key"
                      disabled={disabled}
                      onClick={() => intent({ kind: 'removeKey', account: view.name, permission: p.name, key: k.k1 || k.key })}
                    >
                      <IconClose />
                    </button>
                  </div>
                ))}
                {p.accounts.map((a) => (
                  <div key={`${a.actor}@${a.permission}`} className="perm-entry mono-small">
                    <span className="badge" title="Weight">
                      {a.weight}
                    </span>
                    <span className="perm-entry-text">
                      {a.actor}@{a.permission}
                    </span>
                    <button
                      className="icon-btn small"
                      title={reason ?? 'Remove this account'}
                      aria-label="Remove this account"
                      disabled={disabled}
                      onClick={() =>
                        a.permission === 'eosio.code' && a.actor === view.name
                          ? intent({ kind: 'eosioCode', account: view.name, permission: p.name, enable: false })
                          : intent({ kind: 'removeAccount', account: view.name, permission: p.name, actor: a.actor, actorPermission: a.permission })
                      }
                    >
                      <IconClose />
                    </button>
                  </div>
                ))}
                {p.waits.map((w) => (
                  <div key={w.waitSec} className="perm-entry mono-small">
                    <span className="badge">{w.weight}</span>
                    <span className="perm-entry-text">wait {w.waitSec} s</span>
                  </div>
                ))}
              </div>
              {p.name !== 'owner' && (
                <label className="check-label perm-switch" title={reason}>
                  <input
                    type="checkbox"
                    checked={!!code}
                    disabled={disabled}
                    onChange={(e) => intent({ kind: 'eosioCode', account: view.name, permission: p.name, enable: e.target.checked })}
                  />
                  Allow this account&apos;s contract to send actions (eosio.code)
                  {code && code.weight < p.threshold && <span className="badge warn">weight {code.weight} is below the threshold</span>}
                  <HelpButton place="walletEosioCode" />
                </label>
              )}
              <div className="perm-buttons">
                {p.keys.some((k) => vaultKeys.includes(k.k1)) && (
                  <button className="btn subtle sm" disabled={disabled} title={reason} onClick={() => changeKey(p)}>
                    Change key...
                  </button>
                )}
                <button className="btn subtle sm" disabled={disabled} title={reason} onClick={() => open({ form: 'addKey', permission: p.name })}>
                  Add key
                </button>
                <button className="btn subtle sm" disabled={disabled} title={reason} onClick={() => open({ form: 'addAccount', permission: p.name })}>
                  Add account
                </button>
                <button className="btn subtle sm" disabled={disabled} title={reason} onClick={() => open({ form: 'setThreshold', permission: p.name })}>
                  Set threshold
                </button>
                <button className="btn subtle sm" disabled={disabled} title={reason} onClick={() => open({ form: 'newPermission', parent: p.name })}>
                  New permission
                </button>
                {!fixed && (
                  <button
                    className="btn subtle sm"
                    disabled={disabled}
                    title={reason}
                    onClick={() => intent({ kind: 'deletePermission', account: view.name, permission: p.name })}
                  >
                    Delete permission
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <ViewOnlyLine ctx={ctx} />
      {change && <PermissionChangeDialog ctx={ctx} start={change} onClose={() => setChange(null)} />}
    </section>
  )
}
