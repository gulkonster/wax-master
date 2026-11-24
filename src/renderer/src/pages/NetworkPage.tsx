// Network page: endpoint and chain id of the current network, its chain state
// in three cards and the latest blocks seen. Read-only. While the page is shown
// and the window is visible it reads get_info and the head block every 2
// seconds; nothing is read while it is hidden or minimized.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { NetworkInfo, NetworkStatus } from '../../../shared/chain-types'
import { addBlockSample, type BlockSample, type ChainBasics, type NetworkOverview, type Part } from '../../../shared/network-info'
import { copyText } from '../lib/clipboard'
import { networkStore, refreshNetworks } from '../lib/networks'
import { groupAmount } from '../lib/network-names'
import { networkStatusStore, statusFor } from '../lib/network-status'
import { useStore } from '../lib/stores'
import { errorText, toast } from '../lib/toast'
import { IconCopy, IconPencil, IconClose } from '../components/Icons'
import { StatusDot } from '../components/StatusDot'
import { EditNetworkDialog, RemoveNetworkDialog } from '../components/NetworkDialogs'
import { HelpButton } from '../components/HelpButton'

/** How often the page reads get_info and the head block while it is visible. */
export const HEAD_INTERVAL_MS = 2000
/** Rows of the block list. */
export const BLOCK_ROWS = 30

const STATUS_CLASS: Record<NetworkStatus['level'], string> = { checking: '', green: ' green', orange: ' warn', red: ' red' }

const num = (n: number): string => n.toLocaleString('en-US')

function fmtBytes(n: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return i === 0 ? `${n} B` : `${v.toFixed(2)} ${units[i]}`
}

function fmtUs(n: number): string {
  return n >= 1000 ? `${num(n)} µs (${(n / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 })} ms)` : `${num(n)} µs`
}

/** Chain time (UTC, often without a zone mark) in this computer's time. */
function fmtTime(t: string): string {
  const d = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(t) ? t : `${t}Z`)
  return Number.isNaN(d.getTime()) ? t : d.toLocaleTimeString()
}

function shortId(id: string): string {
  return `${id.slice(0, 8)}…${id.slice(-8)}`
}

async function copy(text: string, what: string): Promise<void> {
  try {
    await copyText(text)
    toast('Copied', what, 'success')
  } catch (e) {
    toast('Could not copy', errorText(e), 'error')
  }
}

function NotAvailable({ reason, error }: { reason: string; error?: boolean }): React.JSX.Element {
  return (
    <span className={`badge${error ? ' red' : ''}`} title={reason}>
      n/a
    </span>
  )
}

function Row({ label, value, mono = true }: { label: string; value: React.ReactNode; mono?: boolean }): React.JSX.Element {
  return (
    <div className="kv-row">
      <span>{label}</span>
      {typeof value === 'string' ? <span className={mono ? 'num' : undefined}>{value}</span> : value}
    </div>
  )
}

/** A value of a part: the text when read, else "n/a" with the reason as tooltip. */
function partValue<T>(p: Part<T> | undefined, text: (v: T) => string): React.ReactNode {
  if (!p) return <NotAvailable reason="Reading..." />
  if (p.state === 'ok') return text(p.value)
  return <NotAvailable reason={p.reason} error={p.state === 'error'} />
}

export function NetworkPage(): React.JSX.Element {
  const net = useStore(networkStore)
  const n = net.current
  if (!n) return <div className="coming">No network is selected.</div>
  const endpoint = n.endpoints[n.currentEndpoint] ?? n.endpoints[0] ?? ''
  return <NetworkBody key={`${n.id}:${endpoint}`} network={n} endpoint={endpoint} />
}

function NetworkBody({ network: n, endpoint }: { network: NetworkInfo; endpoint: string }): React.JSX.Element {
  const [overview, setOverview] = useState<NetworkOverview | null>(null)
  const [overviewError, setOverviewError] = useState('')
  const [basics, setBasics] = useState<ChainBasics | null>(null)
  const [headError, setHeadError] = useState('')
  const [blocks, setBlocks] = useState<BlockSample[]>([])
  const [blockNote, setBlockNote] = useState('')
  const [dialog, setDialog] = useState<'edit' | 'remove' | null>(null)
  // The checked status the top bar and the status bar show, for this network only.
  const status = statusFor(useStore(networkStatusStore), n.id)
  // Set when the overview read failed: it is read again after the next good head answer.
  const overviewFailed = useRef(false)

  // The status mark checks every 2 seconds while this page is open.
  useEffect(() => {
    void window.wax.network.watchFast(true).catch(() => undefined)
    return () => {
      void window.wax.network.watchFast(false).catch(() => undefined)
    }
  }, [n.id])

  const loadOverview = useCallback(async () => {
    setOverviewError('')
    try {
      const o = await window.wax.networkInfo.overview(n.id)
      overviewFailed.current = false
      setOverview(o)
      setBasics((b) => b ?? o.basics)
    } catch (e) {
      overviewFailed.current = true
      setOverviewError(errorText(e))
    }
  }, [n.id])

  useEffect(() => {
    void loadOverview()
  }, [loadOverview])

  // The 2-second loop: only while the page is shown and the window is visible.
  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = (ms: number): void => {
      clearTimeout(timer)
      timer = setTimeout(() => void tick(), ms)
    }
    const tick = async (): Promise<void> => {
      if (stopped || document.visibilityState !== 'visible') return
      try {
        const h = await window.wax.networkInfo.head(n.id)
        if (stopped) return
        if (h) {
          setBasics(h.basics)
          setHeadError('')
          if (overviewFailed.current) {
            overviewFailed.current = false
            void loadOverview()
          }
          if (h.block) {
            const b = h.block
            setBlocks((list) => addBlockSample(list, b, BLOCK_ROWS))
            setBlockNote('')
          } else setBlockNote(h.blockError ?? '')
        }
      } catch (e) {
        if (!stopped) setHeadError(errorText(e))
      }
      if (!stopped) schedule(HEAD_INTERVAL_MS)
    }
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') schedule(0)
      else clearTimeout(timer)
    }
    document.addEventListener('visibilitychange', onVisibility)
    schedule(0)
    return () => {
      stopped = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [n.id, loadOverview])

  const chooseEndpoint = async (index: number): Promise<void> => {
    try {
      await window.wax.networks.chooseEndpoint(n.id, index)
      await refreshNetworks()
    } catch (e) {
      toast('Could not change the endpoint', errorText(e), 'error')
    }
  }

  const ram = overview?.ram
  const ramPct = ram?.state === 'ok' ? Math.max(0, Math.min(100, (ram.value.reserved / ram.value.total) * 100)) : 0
  const limit = (v: number | null | undefined, text: (x: number) => string): React.ReactNode =>
    v === null || v === undefined ? <NotAvailable reason={basics ? 'get_info does not give this value.' : 'Reading...'} /> : text(v)

  return (
    <div className="page-scroll network-page">
      <div className="network-head">
        <div className="network-title">
          <h2 className={n.kind === 'mainnet' ? 'mainnet-text' : undefined}>{n.name}</h2>
          <span className={`badge${n.kind === 'mainnet' ? ' red' : ''}`}>{n.kind}</span>
          {status && (
            <span className={`badge${STATUS_CLASS[status.level]}`} title={status.summary}>
              <StatusDot status={status} />
              {status.label}
            </span>
          )}
          <span className="spacer" />
          <button className="btn" onClick={() => setDialog('edit')}>
            <IconPencil size="sm" /> Edit
          </button>
          <button className="btn" onClick={() => setDialog('remove')}>
            <IconClose size="sm" /> Remove
          </button>
          <HelpButton place="networkPage" />
        </div>
        <div className="network-fields">
          <label htmlFor="network-endpoint">API endpoint</label>
          <div className="network-field">
            <select id="network-endpoint" className="select" value={n.currentEndpoint} onChange={(e) => void chooseEndpoint(Number(e.target.value))}>
              {n.endpoints.map((ep, i) => (
                <option key={ep} value={i}>
                  {ep}
                </option>
              ))}
            </select>
            <button className="icon-btn" title="Copy the endpoint" onClick={() => void copy(endpoint, endpoint)}>
              <IconCopy />
            </button>
          </div>
          <span>Chain ID</span>
          <div className="network-field">
            <span className="mono-small">{n.chainId}</span>
            <button className="icon-btn" title="Copy the chain id" onClick={() => void copy(n.chainId, 'Chain id')}>
              <IconCopy />
            </button>
          </div>
        </div>
        {(overviewError || headError) && <div className="error-text">{headError || overviewError}</div>}
      </div>

      <div className="network-cards">
        <section>
          <h3>Basic info</h3>
          <div className="card-list">
            <Row label="Blocks" value={basics ? num(basics.headBlock) : <NotAvailable reason="Reading..." />} />
            <Row label="Irreversible" value={basics ? num(basics.irreversible) : <NotAvailable reason="Reading..." />} />
            <Row label="Current producer" value={basics?.producer ?? <NotAvailable reason={basics ? 'get_info does not name the producer.' : 'Reading...'} />} />
            <Row label="Server version" value={basics?.serverVersion ?? <NotAvailable reason={basics ? 'get_info does not give the version.' : 'Reading...'} />} />
          </div>
        </section>
        <section>
          <h3>System token</h3>
          <div className="card-list">
            <Row label="Core symbol" value={partValue(overview?.token, (t) => `${t.symbol} (${t.precision} decimals)`)} />
            <Row label="Max supply" value={partValue(overview?.token, (t) => groupAmount(t.maxSupply))} />
            <Row label="Supply" value={partValue(overview?.token, (t) => groupAmount(t.supply))} />
          </div>
        </section>
        <section>
          <h3>Resources</h3>
          <div className="card-list">
            <div className="res-row">
              <div className="res-head">
                <span>RAM</span>
                {ram?.state === 'ok' ? (
                  <span className="res-value">
                    {fmtBytes(ram.value.reserved)} of {fmtBytes(ram.value.total)} ({ramPct.toFixed(1)} %)
                  </span>
                ) : (
                  partValue(ram, () => '')
                )}
              </div>
              <div className="res-bar">
                <div style={{ width: `${ramPct}%` }} />
              </div>
            </div>
            <Row label="RAM price (1 KB)" value={partValue(overview?.ramPrice, (p) => p.text)} />
            <Row label="CPU block limit" value={limit(basics?.cpuBlockLimit, fmtUs)} />
            <Row label="NET block limit" value={limit(basics?.netBlockLimit, (v) => `${num(v)} bytes (${fmtBytes(v)})`)} />
          </div>
        </section>
      </div>

      <div className="tx-section">
        <div className="tx-head">
          <h3>Block production</h3>
          <span className="hint">Latest blocks seen, read every 2 seconds (not every block)</span>
        </div>
        {blockNote && <div className="hint">The head block could not be read: {blockNote}</div>}
        {blocks.length === 0 ? (
          <div className="coming network-empty">{headError ? 'Blocks info not available' : 'Waiting for the first block...'}</div>
        ) : (
          <table className="tx-table">
            <thead>
              <tr>
                <th>Block</th>
                <th>Time</th>
                <th>Producer</th>
                <th>Transactions</th>
                <th>Id</th>
              </tr>
            </thead>
            <tbody>
              {blocks.map((b) => (
                <tr key={b.num}>
                  <td className="mono-small">{num(b.num)}</td>
                  <td className="time">{fmtTime(b.time)}</td>
                  <td>{b.producer}</td>
                  <td>{num(b.transactions)}</td>
                  <td className="actions">
                    <span className="mono-small" title={b.id}>
                      {shortId(b.id)}
                    </span>{' '}
                    <button className="icon-btn small" title="Copy the block id" onClick={() => void copy(b.id, `Block ${num(b.num)}`)}>
                      <IconCopy size="sm" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {dialog === 'edit' && <EditNetworkDialog network={n} onClose={() => setDialog(null)} />}
      {dialog === 'remove' && <RemoveNetworkDialog network={n} onClose={() => setDialog(null)} />}
    </div>
  )
}
