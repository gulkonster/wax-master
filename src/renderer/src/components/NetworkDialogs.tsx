import { useState } from 'react'
import type { NetworkInfo, NetworkKind } from '../../../shared/chain-types'
import { Modal } from './Modal'
import { IconArrowDown, IconArrowUp } from './Icons'
import { errorText, toast } from '../lib/toast'
import { networkStore, refreshNetworks, selectNetwork } from '../lib/networks'
import { useStore } from '../lib/stores'

function isLocalUrl(u: string): boolean {
  try {
    const h = new URL(u).hostname
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.endsWith('.localhost')
  } catch {
    return false
  }
}

/** Kind picker. The main process decides the kind in the end (known main chains are always mainnet). */
function KindField({
  kind,
  setKind,
  note,
  localAllowed
}: {
  kind: NetworkKind
  setKind: (k: NetworkKind) => void
  note: string | null | undefined
  localAllowed: boolean
}): React.JSX.Element {
  return (
    <div className="field">
      <label>Kind</label>
      <select className="select" value={note ? 'mainnet' : kind} disabled={!!note} onChange={(e) => setKind(e.target.value as NetworkKind)}>
        <option value="mainnet">Mainnet (real value; extra confirmations)</option>
        <option value="testnet">Testnet</option>
        <option value="local" disabled={!localAllowed}>
          Local{localAllowed ? '' : ' (only for endpoints on this computer)'}
        </option>
      </select>
      <div className="hint">
        {note ??
          'A network counts as mainnet until it is marked as a test network; for a chain the app does not know, WAX Master asks you to confirm that in its own dialog.'}
      </div>
    </div>
  )
}

/** "Connect to Custom Network": one URL field, then chain id, symbol, name and kind. */
export function AddNetworkDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [url, setUrl] = useState('')
  const [probe, setProbe] = useState<null | Awaited<ReturnType<typeof window.wax.networks.probe>>>(null)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<NetworkKind>('mainnet')
  const [symbol, setSymbol] = useState('')
  const [precision, setPrecision] = useState(4)
  const [historyUrl, setHistoryUrl] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const connect = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const r = await window.wax.networks.probe(url)
      setProbe(r)
      setSymbol(r.symbol)
      setPrecision(r.symbol ? r.precision : 4)
      const known = networkStore.get().list.find((n) => n.chainId === r.chainId)
      setName(known ? `${known.name} (${new URL(r.endpoint).host})` : new URL(r.endpoint).host)
      setKind(!r.kindNote && known?.kind === 'testnet' ? 'testnet' : 'mainnet')
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const save = async (): Promise<void> => {
    if (!probe) return
    setBusy(true)
    setError('')
    try {
      const n = await window.wax.networks.add({
        name,
        kind,
        endpoint: probe.endpoint,
        chainId: probe.chainId,
        symbol,
        precision,
        history: historyUrl.trim() || undefined
      })
      await selectNetwork(n.id)
      onClose()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      size="m"
      name="add-network"
      title="Connect to Custom Network"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          {probe ? (
            <button className="btn primary" disabled={busy || !name.trim() || !/^[A-Z]{1,7}$/.test(symbol)} onClick={() => void save()}>
              Save and switch
            </button>
          ) : (
            <button className="btn primary" disabled={busy || !url.trim()} onClick={() => void connect()}>
              {busy ? 'Connecting...' : 'Connect'}
            </button>
          )}
        </>
      }
    >
      <div className="field">
        <label>API Endpoint</label>
        <input className="input mono" autoFocus value={url} disabled={!!probe} placeholder="https://..." onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !probe && void connect()} />
      </div>
      {probe && (
        <>
          <div className="field">
            <label>Chain id</label>
            <div className="chip" style={{ userSelect: 'text' }}>{probe.chainId}</div>
            {probe.version && <div className="hint">Node version {probe.version}</div>}
          </div>
          <div className="field">
            <label>Name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <KindField kind={kind} setKind={setKind} note={probe.kindNote} localAllowed={probe.localAllowed} />
          <div className="field" style={{ display: 'flex', gap: 'var(--gap-row)' }}>
            <div style={{ flex: 1 }}>
              <label>Token symbol</label>
              <input className="input" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
            </div>
            <div style={{ width: 'var(--field-num)' }}>
              <label>Precision</label>
              <input className="input" type="number" min={0} max={18} value={precision} onChange={(e) => setPrecision(Math.max(0, Math.min(18, Number(e.target.value) || 0)))} />
            </div>
          </div>
          <div className="field">
            <label>History service (optional, Hyperion)</label>
            <input className="input mono" value={historyUrl} placeholder="https://..." onChange={(e) => setHistoryUrl(e.target.value)} />
          </div>
        </>
      )}
      {error && <div className="error-text">{error}</div>}
    </Modal>
  )
}

export function ManageNetworksDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const net = useStore(networkStore)
  const [editing, setEditing] = useState<NetworkInfo | null>(null)
  return (
    <Modal
      size="l"
      name="manage-networks"
      title="Manage Networks"
      onClose={onClose}
      footer={
        <button className="btn" onClick={onClose}>
          Close
        </button>
      }
    >
      {net.list.map((n) => (
        <div key={n.id} className="net-row">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div>
              <b className={n.kind === 'mainnet' ? 'mainnet-text' : undefined}>{n.name}</b> <span className={`badge${n.kind === 'mainnet' ? ' red' : ''}`}>{n.kind}</span>{' '}
              {net.current?.id === n.id && <span className="badge green">current</span>}
            </div>
            <div className="endpoints">
              {n.endpoints.map((ep, i) => (
                <span key={ep}>
                  <label>
                    <input
                      type="radio"
                      checked={i === n.currentEndpoint}
                      onChange={async () => {
                        await window.wax.networks.chooseEndpoint(n.id, i)
                        await refreshNetworks()
                      }}
                    />{' '}
                    {ep}
                  </label>
                </span>
              ))}
              <div style={{ flexBasis: '100%' }}>{n.history ? `History: ${n.history}` : 'No history service'}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 'var(--gap-row)' }}>
            {net.current?.id !== n.id && (
              <button className="btn" onClick={() => void selectNetwork(n.id)}>
                Use
              </button>
            )}
            {!n.preset && (
              <>
                <button className="btn" onClick={() => setEditing(n)}>
                  Edit
                </button>
                <button
                  className="btn"
                  onClick={async () => {
                    if (!window.confirm(`Remove the network "${n.name}"?`)) return
                    try {
                      await window.wax.networks.remove(n.id)
                      await refreshNetworks()
                    } catch (e) {
                      toast('Could not remove', errorText(e), 'error')
                    }
                  }}
                >
                  Remove
                </button>
              </>
            )}
          </div>
        </div>
      ))}
      {editing && <EditNetworkDialog network={editing} onClose={() => setEditing(null)} />}
    </Modal>
  )
}

function EditNetworkDialog({ network, onClose }: { network: NetworkInfo; onClose: () => void }): React.JSX.Element {
  const [name, setName] = useState(network.name)
  const [kind, setKind] = useState<NetworkKind>(network.kind)
  const [endpoints, setEndpoints] = useState(network.endpoints.join('\n'))
  const [historyUrl, setHistoryUrl] = useState(network.history ?? '')
  const [error, setError] = useState('')
  const save = async (): Promise<void> => {
    try {
      await window.wax.networks.update(network.id, {
        name,
        kind,
        endpoints: endpoints.split(/\s+/).filter(Boolean),
        history: historyUrl.trim() || null
      })
      await refreshNetworks()
      onClose()
    } catch (e) {
      setError(errorText(e))
    }
  }
  return (
    <Modal
      size="m"
      name="edit-network"
      title={`Edit ${network.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => void save()}>
            Save
          </button>
        </>
      }
    >
      <div className="field">
        <label>Name</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <KindField kind={kind} setKind={setKind} note={network.kindNote} localAllowed={endpoints.split(/\s+/).filter(Boolean).every(isLocalUrl)} />
      <div className="field">
        <label>Endpoints (one per line; same chain id)</label>
        <textarea className="textarea mono" value={endpoints} onChange={(e) => setEndpoints(e.target.value)} />
      </div>
      <div className="field">
        <label>History service</label>
        <input className="input" value={historyUrl} onChange={(e) => setHistoryUrl(e.target.value)} />
      </div>
      {error && <div className="error-text">{error}</div>}
    </Modal>
  )
}

/** "All Starred Accounts...": reorder, remove, add by name. */
export function StarredManager({ onClose }: { onClose: () => void }): React.JSX.Element {
  const net = useStore(networkStore)
  const [add, setAdd] = useState('')
  const set = async (list: string[]): Promise<void> => {
    const stars = await window.wax.networks.setStarOrder(list)
    networkStore.set({ ...networkStore.get(), stars })
  }
  const move = (i: number, d: number): void => {
    const l = [...net.stars]
    const j = i + d
    if (j < 0 || j >= l.length) return
    ;[l[i], l[j]] = [l[j], l[i]]
    void set(l)
  }
  return (
    <Modal
      size="l"
      name="starred-accounts"
      title={`Starred accounts on ${net.current?.name ?? ''}`}
      onClose={onClose}
      footer={
        <button className="btn" onClick={onClose}>
          Close
        </button>
      }
    >
      <div style={{ display: 'flex', gap: 'var(--gap-row)', marginBottom: 'var(--sp-3)' }}>
        <input className="input mono" placeholder="account name" value={add} onChange={(e) => setAdd(e.target.value.trim().toLowerCase())} />
        <button
          className="btn"
          disabled={!/^[a-z1-5.]{1,12}[a-j1-5]?$/.test(add)}
          onClick={() => {
            void set([...net.stars, add])
            setAdd('')
          }}
        >
          Add
        </button>
      </div>
      {net.stars.length === 0 && <div className="hint">No starred accounts on this network.</div>}
      {net.stars.map((s, i) => (
        <div key={s} className="net-row">
          <span className="mono" style={{ flex: 1 }}>{s}</span>
          <button className="icon-btn" title="Up" onClick={() => move(i, -1)}>
            <IconArrowUp />
          </button>
          <button className="icon-btn" title="Down" onClick={() => move(i, 1)}>
            <IconArrowDown />
          </button>
          <button className="btn" onClick={() => void set(net.stars.filter((x) => x !== s))}>
            Remove
          </button>
        </div>
      ))}
    </Modal>
  )
}
