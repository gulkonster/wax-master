import { useCallback, useEffect, useState } from 'react'
import type { AccountActionRow, AccountView } from '../../../shared/chain-types'
import { on, emit } from '../lib/bus'
import { networkStore, toggleStar } from '../lib/networks'
import { useStore } from '../lib/stores'
import { errorText } from '../lib/toast'
import { lastOpened } from '../components/ChainButtons'
import { IconClose, IconContract, IconKey, IconLock, IconPlus, IconRefresh, IconStar, IconUser } from '../components/Icons'

const NAME = /^[a-z1-5.]{1,12}[a-j1-5]?$/

function fmtBytes(n: number): string {
  if (n < 0) return 'unlimited'
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${n} B`
}

function fmtUs(n: number): string {
  if (n < 0) return 'unlimited'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} s`
  if (n >= 1000) return `${(n / 1000).toFixed(2)} ms`
  return `${n} µs`
}

function pct(used: number, max: number): number {
  if (max <= 0) return 0
  return Math.max(0, Math.min(100, (used / max) * 100))
}

function fmtTime(t: string): string {
  if (!t) return ''
  const d = new Date(t.endsWith('Z') ? t : `${t}Z`)
  return Number.isNaN(d.getTime()) ? t : d.toLocaleString()
}

export function AccountPage(): React.JSX.Element {
  const net = useStore(networkStore)
  const [tabs, setTabs] = useState<string[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [input, setInput] = useState('')

  const open = useCallback((name: string) => {
    if (!NAME.test(name)) return
    setTabs((t) => (t.includes(name) ? t : [...t, name]))
    setActive(name)
    setInput(name)
    lastOpened.set({ ...lastOpened.get(), account: name })
  }, [])

  useEffect(() => on('open-account', (n) => open(n as string)), [open])

  const close = (name: string): void => {
    const next = tabs.filter((t) => t !== name)
    setTabs(next)
    if (active === name) {
      setActive(next[next.length - 1] ?? null)
      setInput(next[next.length - 1] ?? '')
    }
  }

  const starred = active ? net.stars.includes(active) : false

  return (
    <div className="chain-page">
      <div className="page-tabs">
        {tabs.map((t) => (
          <div key={t} className={`editor-tab${t === active ? ' active' : ''}`} onClick={() => (setActive(t), setInput(t))}>
            {t}
            <span
              className="close"
              onClick={(e) => {
                e.stopPropagation()
                close(t)
              }}
            >
              <IconClose size={12} />
            </span>
          </div>
        ))}
        <button className="icon-btn" title="New tab" onClick={() => (setActive(null), setInput(''))}>
          <IconPlus />
        </button>
      </div>
      <div className="address-bar">
        <button className="icon-btn" title="Refresh" onClick={() => active && emit('account-refresh', active)}>
          <IconRefresh />
        </button>
        <div className="address-input">
          <IconUser size={14} />
          <input
            value={input}
            placeholder="Account name"
            spellCheck={false}
            onChange={(e) => setInput(e.target.value.trim().toLowerCase())}
            onKeyDown={(e) => e.key === 'Enter' && open(input)}
          />
          <button className={`icon-btn small${starred ? " on" : ""}`} disabled={!active} title={starred ? 'Unstar' : 'Star'} onClick={() => active && void toggleStar(active)}>
            <IconStar filled={starred} />
          </button>
        </div>
        <button className="icon-btn" title="Open as contract" disabled={!active} onClick={() => active && emit('open-contract', active)}>
          <IconContract />
        </button>
        <button className="icon-btn" title="Keys" disabled={!active} onClick={() => emit('open-keys', active)}>
          <IconKey />
        </button>
      </div>
      {active && net.current ? (
        <AccountBody key={`${net.current.id}:${active}`} name={active} />
      ) : (
        <div className="coming">
          <div>Enter an account name and press Enter.</div>
        </div>
      )}
    </div>
  )
}

function AccountBody({ name }: { name: string }): React.JSX.Element {
  const [view, setView] = useState<AccountView | null>(null)
  const [error, setError] = useState('')
  const [rows, setRows] = useState<AccountActionRow[]>([])
  const [historyNote, setHistoryNote] = useState('')
  const [more, setMore] = useState(false)
  const [loadingRows, setLoadingRows] = useState(false)
  const [vaultKeys, setVaultKeys] = useState<string[]>([])

  useEffect(() => {
    window.wax.keys.list().then((l) => setVaultKeys(l.map((k) => k.publicKey))).catch(() => setVaultKeys([]))
  }, [view])

  const load = useCallback(async () => {
    setError('')
    try {
      setView(await window.wax.chain.account(name))
    } catch (e) {
      setView(null)
      setError(errorText(e))
    }
  }, [name])

  const loadRows = useCallback(
    async (skip: number) => {
      setLoadingRows(true)
      try {
        const page = await window.wax.chain.actions(name, skip)
        if (!page.historyAvailable) {
          setHistoryNote('This network has no history service configured. Add one in Network > Manage Networks.')
          setRows([])
        } else {
          setHistoryNote('')
          setRows((r) => (skip === 0 ? page.rows : [...r, ...page.rows]))
        }
        setMore(page.more)
      } catch (e) {
        setHistoryNote(`Transactions could not be loaded: ${errorText(e)}`)
      } finally {
        setLoadingRows(false)
      }
    },
    [name]
  )

  useEffect(() => {
    void load()
    void loadRows(0)
  }, [load, loadRows])

  useEffect(
    () =>
      on('account-refresh', (n) => {
        if (n === name) {
          void load()
          void loadRows(0)
        }
      }),
    [name, load, loadRows]
  )

  if (error) return <div className="page-scroll"><div className="error-text" style={{ margin: 16 }}>{error}</div></div>
  if (!view) return <div className="coming">Loading {name}...</div>

  return (
    <div className="page-scroll">
      <div className="account-columns">
        <section>
          <h3>Account</h3>
          <div className="card-list">
            <div className="kv-row"><span>Total Balance</span><span className="num total">{view.total}</span></div>
            <div className="kv-row"><span>Available</span><span className="num">{view.liquid}</span></div>
            <div className="kv-row"><span>Staked</span><span className="num">{view.staked}</span></div>
            <div className="kv-row"><span>Refund</span><span className="num">{view.refund}</span></div>
          </div>
        </section>
        <section>
          <h3>Resources</h3>
          <div className="card-list">
            <Resource label="RAM" text={`${fmtBytes(view.ram.usage)} / ${fmtBytes(view.ram.quota)}`} value={pct(view.ram.usage, view.ram.quota)} />
            <Resource label={`CPU (${view.cpuWeight})`} text={`${fmtUs(view.cpu.used)} / ${fmtUs(view.cpu.max)}`} value={pct(view.cpu.used, view.cpu.max)} />
            <Resource label={`NET (${view.netWeight})`} text={`${fmtBytes(view.net.used)} / ${fmtBytes(view.net.max)}`} value={pct(view.net.used, view.net.max)} />
          </div>
        </section>
        <section>
          <h3>Permission Keys</h3>
          <div className="card-list">
          {view.permissions.map((p) => (
            <div key={p.name} className="perm-row">
              <div className="perm-head">
                <span className={`badge perm-${p.name === 'owner' ? 'owner' : p.name === 'active' ? 'active' : 'other'}`}>{p.name}</span>
                <span className="badge" title="Threshold">
                  <IconLock size={12} /> {p.threshold}
                </span>
                {p.parent && <span className="parent">parent: {p.parent}</span>}
              </div>
              <div className="perm-auths">
                {p.keys.map((k) => (
                  <div key={k.key} className="mono-small">
                    {vaultKeys.includes(k.k1) && (
                      <span className="badge green" title="This key is in your vault">
                        <IconKey size={12} /> vault
                      </span>
                    )}{' '}
                    <span className="badge" title="Weight">{k.weight}</span> {k.key}
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
                    <span className="badge" title="Weight">{a.weight}</span> {a.actor}@{a.permission}
                  </div>
                ))}
                {p.waits.map((w, i) => (
                  <div key={i} className="mono-small"><span className="badge">{w.weight}</span> wait {w.waitSec} s</div>
                ))}
              </div>
            </div>
          ))}
          </div>
        </section>
      </div>
      <div className="tx-section">
        <div className="tx-head">
          <h3>Transactions</h3>
          <button className="icon-btn" title="Refresh" onClick={() => void loadRows(0)}>
            <IconRefresh />
          </button>
        </div>
        {historyNote ? (
          <div className="hint">{historyNote}</div>
        ) : (
          <table className="tx-table clickable">
            <thead>
              <tr>
                <th>Time</th>
                <th>Action</th>
                <th>Data</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.trxId}-${i}`} title={r.trxId} onClick={() => emit('open-transaction', r.trxId)}>
                  <td className="time">{fmtTime(r.time)}</td>
                  <td className="nowrap">
                    <span className="badge-pair"><span>{r.contract}</span><span>{r.action}</span></span>
                  </td>
                  <td className="mono-small data-cell">{r.data}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!historyNote && rows.length === 0 && !loadingRows && <div className="hint">No transactions found.</div>}
        {more && (
          <button className="btn load-more" disabled={loadingRows} onClick={() => void loadRows(rows.length)}>
            {loadingRows ? 'Loading...' : 'Load more'}
          </button>
        )}
      </div>
    </div>
  )
}

function Resource({ label, text, value }: { label: string; text: string; value: number }): React.JSX.Element {
  // Blue while there is room, yellow from 75 %, red from 90 %.
  const level = value >= 90 ? ' high' : value >= 75 ? ' warn' : ''
  return (
    <div className="res-row">
      <div className="res-head">
        <span>{label}</span>
        <span className="res-value">{text}</span>
      </div>
      <div className="res-bar"><div className={level.trim() || undefined} style={{ width: `${value}%` }} /></div>
    </div>
  )
}
