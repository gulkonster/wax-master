// Keys and permissions: the account's permissions with their keys, accounts,
// waits, weights and thresholds, vault marks, and Change key.

import { useEffect, useState } from 'react'
import { emit } from '../../lib/bus'
import { IconKey, IconLock } from '../../components/Icons'
import { ViewOnlyLine, type WalletContext } from './common'

export function PermissionsSection({ ctx }: { ctx: WalletContext }): React.JSX.Element {
  const { view } = ctx
  const [vaultKeys, setVaultKeys] = useState<string[]>([])

  useEffect(() => {
    window.wax.keys
      .list()
      .then((l) => setVaultKeys(l.map((k) => k.publicKey)))
      .catch(() => setVaultKeys([]))
  }, [view])

  return (
    <section className="wallet-section">
      <div className="wallet-section-head">
        <h3>Keys and permissions</h3>
      </div>
      <p className="wallet-lead">Who may sign for this account: each permission needs keys or accounts whose weights reach its threshold.</p>
      <div className="card-list">
        {view.permissions.map((p) => (
          <div key={p.name} className="perm-row">
            <div className="perm-head">
              <span className={`badge perm-${p.name === 'owner' ? 'owner' : p.name === 'active' ? 'active' : 'other'}`}>{p.name}</span>
              <span className="badge" title="Threshold">
                <IconLock size="xs" /> {p.threshold}
              </span>
              {p.parent && <span className="parent">parent: {p.parent}</span>}
            </div>
            <div className="perm-auths">
              {p.keys.map((k) => (
                <div key={k.key} className="mono-small">
                  {vaultKeys.includes(k.k1) && (
                    <span className="badge green" title="This key is in your vault">
                      <IconKey size="xs" /> vault
                    </span>
                  )}{' '}
                  <span className="badge" title="Weight">
                    {k.weight}
                  </span>{' '}
                  {k.key}
                </div>
              ))}
              {p.keys.some((k) => vaultKeys.includes(k.k1)) && (
                <button
                  className="btn subtle"
                  onClick={() => {
                    // The permission itself, then its parents (it may sign with any of them).
                    const signOptions = [p.name]
                    for (let cur = p; cur.parent && !signOptions.includes(cur.parent); ) {
                      signOptions.push(cur.parent)
                      const next = view.permissions.find((x) => x.name === cur.parent)
                      if (!next) break
                      cur = next
                    }
                    emit('change-key', {
                      account: view.name,
                      permission: p.name,
                      currentKeys: p.keys.map((k) => k.k1 || k.key),
                      vaultKeys: p.keys.filter((k) => vaultKeys.includes(k.k1)).map((k) => k.k1),
                      signOptions,
                      threshold: p.threshold,
                      others: [...p.accounts.map((a) => `${a.actor}@${a.permission}`), ...p.waits.map((w) => `wait ${w.waitSec} s`)]
                    })
                  }}
                >
                  Change key...
                </button>
              )}
              {p.accounts.map((a) => (
                <div key={`${a.actor}@${a.permission}`} className="mono-small">
                  <span className="badge" title="Weight">
                    {a.weight}
                  </span>{' '}
                  {a.actor}@{a.permission}
                </div>
              ))}
              {p.waits.map((w, i) => (
                <div key={i} className="mono-small">
                  <span className="badge">{w.weight}</span> wait {w.waitSec} s
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <ViewOnlyLine ctx={ctx} />
    </section>
  )
}
