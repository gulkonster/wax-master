import { useEffect, useState } from 'react'
import type { NetworkInfo, NetworkKind } from '../../../shared/chain-types'
import { Modal } from './Modal'
import { IconArrowDown, IconArrowUp } from './Icons'
import { errorText, toast } from '../lib/toast'
import { networkStore, refreshNetworks, selectNetwork } from '../lib/networks'
import { nextNetworkAfterRemoval, suggestNetworkName } from '../lib/network-names'
import { WAX_TESTNET_CHAIN_ID } from '../../../shared/ram-market'
import { useStore } from '../lib/stores'
import { emit } from '../lib/bus'
import { LOCAL_CHAIN_NETWORK_ID } from '../../../shared/local-chain'
import { Busy } from './Busy'

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
          (kind === 'local'
            ? 'A chain on this computer: normal confirmation, no typed names.'
            : 'A network counts as mainnet until it is marked as a test network; for a chain the app does not know, WAX Master asks you to confirm that in its own dialog.')}
      </div>
    </div>
  )
}

type Probe = Awaited<ReturnType<typeof window.wax.networks.probe>>

/**
 * "Connect to Custom Network" in two steps: one endpoint field and Connect;
 * then what the endpoint said (chain id, core token, server version) with a
 * name and the kind. A chain already in the list can take the endpoint instead.
 */
export function AddNetworkDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const net = useStore(networkStore)
  const [url, setUrl] = useState('')
  const [probe, setProbe] = useState<null | Probe>(null)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<NetworkKind>('mainnet')
  const [symbol, setSymbol] = useState('')
  const [precision, setPrecision] = useState(4)
  const [historyUrl, setHistoryUrl] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const sameChain = probe ? net.list.filter((n) => n.chainId === probe.chainId) : []
  const target = sameChain[0] ?? null
  const alreadyIn = probe ? sameChain.find((n) => n.endpoints.includes(probe.endpoint)) : undefined

  const connect = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const r = await window.wax.networks.probe(url)
      setProbe(r)
      setSymbol(r.symbol)
      setPrecision(r.symbol ? r.precision : 4)
      const list = networkStore.get().list
      const known = list.find((n) => n.chainId === r.chainId)
      setName(suggestNetworkName(r, list))
      setKind(!r.kindNote && (known?.kind === 'testnet' || r.knownName === 'WAX Testnet') ? 'testnet' : !r.kindNote && r.localAllowed ? 'local' : 'mainnet')
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const back = (): void => {
    setProbe(null)
    setError('')
  }

  const addAsNew = async (): Promise<void> => {
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

  const addToExisting = async (to: NetworkInfo): Promise<void> => {
    if (!probe) return
    setBusy(true)
    setError('')
    try {
      await window.wax.networks.update(to.id, { endpoints: [...to.endpoints, probe.endpoint] })
      await refreshNetworks()
      toast('Network', `Added ${probe.endpoint} to ${to.name}.`, 'success')
      onClose()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const canAddNew = !busy && !!name.trim() && /^[A-Z]{1,7}$/.test(symbol)

  return (
    <Modal
      size="m"
      name="add-network"
      help="addNetwork"
      title="Connect to Custom Network"
      onClose={onClose}
      footer={
        probe ? (
          <>
            <button className="btn" disabled={busy} onClick={back}>
              Back
            </button>
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            {target && !alreadyIn && (
              <button className="btn primary" disabled={busy} onClick={() => void addToExisting(target)}>
                Add this endpoint to {target.name}
              </button>
            )}
            <button className={`btn${target && !alreadyIn ? '' : ' primary'}`} disabled={!canAddNew} onClick={() => void addAsNew()}>
              {target ? 'Add as a new network' : 'Add'}
            </button>
          </>
        ) : (
          <>
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn primary" disabled={busy || !url.trim()} onClick={() => void connect()}>
              {busy ? <Busy text="Connecting..." /> : 'Connect'}
            </button>
          </>
        )
      }
    >
      {!probe && (
        <div className="field">
          <label>API Endpoint</label>
          <input
            className="input mono"
            autoFocus
            value={url}
            placeholder="https://..."
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && url.trim() && !busy && void connect()}
          />
        </div>
      )}
      {probe && (
        <>
          <div className="field">
            <label>API Endpoint</label>
            <div className="chip" style={{ userSelect: 'text' }}>{probe.endpoint}</div>
          </div>
          <div className="field">
            <label>Chain ID</label>
            <div className="chip" style={{ userSelect: 'text' }}>{probe.chainId}</div>
            <div className="hint">
              {probe.knownName ? `This is the ${probe.knownName} chain.` : 'A chain WAX Master does not know.'}
              {probe.version ? ` Server version ${probe.version}.` : ''}
            </div>
          </div>
          {target && (
            <div className="hint warn-note" style={{ marginTop: 0, marginBottom: 'var(--gap-field)' }}>
              {alreadyIn
                ? `This endpoint is already in ${alreadyIn.name}.`
                : `${target.name} is this chain. Add the endpoint to it (its starred accounts and deploy settings stay), or add a new network.`}
            </div>
          )}
          <div className="field">
            <label>Name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <KindField kind={kind} setKind={setKind} note={probe.kindNote} localAllowed={probe.localAllowed} />
          <div className="field" style={{ display: 'flex', gap: 'var(--gap-row)' }}>
            <div style={{ flex: 1 }}>
              <label>Core token symbol</label>
              <input className="input" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
              {!probe.symbol && <div className="hint">The chain has no system RAM market to read the symbol from; enter it.</div>}
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

/**
 * The question before a network is removed: names what is forgotten (its
 * starred accounts) and which network is selected afterwards.
 */
export function RemoveNetworkDialog({ network, onClose, onRemoved }: { network: NetworkInfo; onClose: () => void; onRemoved?: () => void }): React.JSX.Element {
  const net = useStore(networkStore)
  const [stars, setStars] = useState<string[] | null>(null)
  const [tokens, setTokens] = useState<string[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void window.wax.networks
      .stars(network.id)
      .then(setStars)
      .catch(() => setStars([]))
    void window.wax.wallet
      .addedTokens(network.id)
      .then((list) => setTokens(list.map((t) => `${t.symbol} (${t.contract})`)))
      .catch(() => setTokens([]))
  }, [network.id])
  const last = net.list.length <= 1
  const isCurrent = net.current?.id === network.id
  const next = nextNetworkAfterRemoval(net.list, network.id, WAX_TESTNET_CHAIN_ID)
  const remove = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const cur = await window.wax.networks.remove(network.id)
      await refreshNetworks()
      if (isCurrent) toast('Network', `${network.name} was removed. Switched to ${cur.name} at ${cur.endpoints[cur.currentEndpoint] ?? ''}.`, 'success')
      else toast('Network', `${network.name} was removed.`, 'success')
      onRemoved?.()
      onClose()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      size="s"
      name="remove-network"
      help="manageNetworks"
      title={`Remove ${network.name}?`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn danger" disabled={busy || last || stars === null || tokens === null} onClick={() => void remove()}>
            Remove
          </button>
        </>
      }
    >
      {last ? (
        <p>This is the only network in the list. At least one network must stay.</p>
      ) : (
        <>
          <p>
            {stars === null
              ? 'Reading its starred accounts...'
              : stars.length === 0
                ? `${network.name} has no starred accounts.`
                : `Its ${stars.length === 1 ? 'starred account is' : `${stars.length} starred accounts are`} forgotten:`}
          </p>
          {stars && stars.length > 0 && (
            <ul className="net-remove-list mono">
              {stars.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          )}
          {tokens && tokens.length > 0 && (
            <>
              <p>{tokens.length === 1 ? 'The token added for it is forgotten:' : `The ${tokens.length} tokens added for it are forgotten:`}</p>
              <ul className="net-remove-list mono">
                {tokens.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </>
          )}
          {isCurrent && next && <p>It is the current network; {next.name} is selected instead.</p>}
          <p className="hint">
            {network.preset ? 'Manage Networks > "Restore default networks" brings it back with its default endpoints.' : 'To use it again, add it with Add Network.'}
          </p>
        </>
      )}
      {error && <div className="error-text">{error}</div>}
    </Modal>
  )
}

export function ManageNetworksDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const net = useStore(networkStore)
  const [editing, setEditing] = useState<NetworkInfo | null>(null)
  const [removing, setRemoving] = useState<NetworkInfo | null>(null)
  const [removed, setRemoved] = useState<{ id: string; name: string }[]>([])
  const listKey = net.list.map((n) => n.id).join(',')
  useEffect(() => {
    void window.wax.networks
      .removedDefaults()
      .then(setRemoved)
      .catch(() => setRemoved([]))
  }, [listKey])
  const restore = async (): Promise<void> => {
    try {
      await window.wax.networks.restoreDefaults()
      await refreshNetworks()
      toast('Network', `Restored ${removed.map((r) => r.name).join(' and ')}.`, 'success')
    } catch (e) {
      toast('Could not restore', errorText(e), 'error')
    }
  }
  const last = net.list.length <= 1
  return (
    <Modal
      size="l"
      name="manage-networks"
      help="manageNetworks"
      title="Manage Networks"
      onClose={onClose}
      footer={
        <>
          <button
            className="btn"
            disabled={removed.length === 0}
            title={removed.length === 0 ? 'WAX Mainnet and WAX Testnet are in the list' : `Brings back ${removed.map((r) => r.name).join(' and ')}`}
            onClick={() => void restore()}
          >
            Restore default networks
          </button>
          <div className="spacer" />
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      {net.list.map((n) => (
        <div key={n.id} className="net-row">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div>
              <b className={n.kind === 'mainnet' ? 'mainnet-text' : undefined}>{n.name}</b> <span className={`badge${n.kind === 'mainnet' ? ' red' : ''}`}>{n.kind}</span>{' '}
              {n.preset && <span className="badge">default</span>} {net.current?.id === n.id && <span className="badge green">current</span>}
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
            {n.id === LOCAL_CHAIN_NETWORK_ID ? (
              <button className="btn" onClick={() => emit('dialog', 'local-chain')}>
                Local Chain...
              </button>
            ) : (
              <button className="btn" onClick={() => setEditing(n)}>
                Edit
              </button>
            )}
            <button className="btn" disabled={last} title={last ? 'The last network cannot be removed' : undefined} onClick={() => setRemoving(n)}>
              Remove
            </button>
          </div>
        </div>
      ))}
      {editing && <EditNetworkDialog network={editing} onClose={() => setEditing(null)} />}
      {removing && <RemoveNetworkDialog network={removing} onClose={() => setRemoving(null)} />}
    </Modal>
  )
}

/** Edit a network: endpoints and history for every network; name and kind for the user's own. The chain id never changes. */
export function EditNetworkDialog({ network, onClose }: { network: NetworkInfo; onClose: () => void }): React.JSX.Element {
  const [name, setName] = useState(network.name)
  const [kind, setKind] = useState<NetworkKind>(network.kind)
  const [endpoints, setEndpoints] = useState(network.endpoints.join('\n'))
  const [historyUrl, setHistoryUrl] = useState(network.history ?? '')
  const [error, setError] = useState('')
  const save = async (): Promise<void> => {
    try {
      const eps = endpoints.split(/\s+/).filter(Boolean)
      await window.wax.networks.update(
        network.id,
        network.preset ? { endpoints: eps, history: historyUrl.trim() || null } : { name, kind, endpoints: eps, history: historyUrl.trim() || null }
      )
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
      help="editNetwork"
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
        {network.preset ? (
          <>
            <div className="chip ui">{network.name}</div>
            <div className="hint">The name and kind of a default network are fixed; its endpoints and history service can be changed.</div>
          </>
        ) : (
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        )}
      </div>
      <div className="field">
        <label>Chain ID</label>
        <div className="chip" style={{ userSelect: 'text' }}>{network.chainId}</div>
      </div>
      {!network.preset && <KindField kind={kind} setKind={setKind} note={network.kindNote} localAllowed={endpoints.split(/\s+/).filter(Boolean).every(isLocalUrl)} />}
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
      help="starredAccounts"
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
