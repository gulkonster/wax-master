// Network > Local Chain: set up, start, stop, reset and remove the app's own chain (B108).
// One primary button per state; the state comes from the main process.

import { useEffect, useRef, useState } from 'react'
import { Modal } from './Modal'
import { LocalAccountDialog } from './LocalAccountDialog'
import { CopyContractDialog } from './CopyContractDialog'
import { copyText } from '../lib/clipboard'
import { errorText, toast } from '../lib/toast'
import { refreshNetworks, selectNetwork } from '../lib/networks'
import { LOCAL_CHAIN_NETWORK_ID, type LocalChainPhase, type LocalChainStatus } from '../../../shared/local-chain'

const api = (): typeof window.wax.localChain => window.wax.localChain

const PHASE_WORDS: Record<LocalChainPhase, string> = {
  unavailable: 'Not available',
  'not-set-up': 'Not set up',
  'setting-up': 'Setting up',
  stopped: 'Stopped',
  starting: 'Starting',
  running: 'Running',
  stopping: 'Stopping',
  failed: 'Problem'
}

const BUSY: LocalChainPhase[] = ['setting-up', 'starting', 'stopping']

export function LocalChainDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [status, setStatus] = useState<LocalChainStatus | null>(null)
  const [lines, setLines] = useState<string[]>([])
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [newAccount, setNewAccount] = useState(false)
  const [copyContract, setCopyContract] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    const refresh = (): void => {
      void api()
        .status()
        .then((s) => alive && setStatus(s))
        .catch((e) => alive && setError(errorText(e)))
    }
    refresh()
    const offStatus = api().onStatus((s) => setStatus(s))
    const offProgress = api().onProgress((line) => setLines((l) => [...l.slice(-199), line]))
    // The head block and the data size grow while the chain runs.
    const timer = window.setInterval(refresh, 2000)
    return () => {
      alive = false
      offStatus()
      offProgress()
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines])

  const phase = status?.phase ?? null
  const busy = pending || (phase !== null && BUSY.includes(phase))

  const run = async (call: () => Promise<LocalChainStatus>, clearLines = false): Promise<void> => {
    setError('')
    setPending(true)
    if (clearLines) setLines([])
    try {
      setStatus(await call())
    } catch (e) {
      setError(errorText(e))
    } finally {
      setPending(false)
      // Set up, Start, Use port and Remove change the network entry Local chain (B110 point 1); the top bar and the status bar follow it.
      void refreshNetworks().catch(() => undefined)
    }
  }

  const copy = (text: string): void => {
    void copyText(text)
      .then(() => toast('Copied', text, 'success'))
      .catch((e) => setError(errorText(e)))
  }

  const toggle = (key: 'webPages' | 'startWithApp'): void => {
    if (!status) return
    void run(() => api().setOptions({ ...status.options, [key]: !status.options[key] }))
  }

  const selectThis = async (): Promise<void> => {
    try {
      await selectNetwork(LOCAL_CHAIN_NETWORK_ID)
      toast('Network selected', 'Local chain', 'success')
    } catch (e) {
      setError(errorText(e))
    }
  }

  const openLog = (): void => {
    void api()
      .openLog()
      .catch((e) => setError(errorText(e)))
  }

  let primary: React.ReactNode = null
  let left: React.ReactNode = null
  if (status) {
    switch (status.phase) {
      case 'not-set-up':
        primary = (
          <button className="btn primary" disabled={busy} onClick={() => void run(() => api().setUp(), true)}>
            Set up
          </button>
        )
        break
      case 'stopped':
        primary = (
          <button className="btn primary" disabled={busy} onClick={() => void run(() => api().start(), true)}>
            Start
          </button>
        )
        left = (
          <>
            <button className="btn" disabled={busy} onClick={() => void run(() => api().reset())}>
              Reset
            </button>
            <button className="btn" disabled={busy} onClick={() => void run(() => api().remove())}>
              Remove
            </button>
          </>
        )
        break
      case 'running':
        primary = (
          <button className="btn primary" disabled={busy} onClick={() => void run(() => api().stop())}>
            Stop
          </button>
        )
        left = (
          <>
            <button className="btn" disabled={busy} onClick={() => void run(() => api().reset())}>
              Reset
            </button>
            <button className="btn" onClick={() => void selectThis()}>
              Select this network
            </button>
            <button className="btn" onClick={openLog}>
              Open log
            </button>
          </>
        )
        break
      case 'failed': {
        const repair = status.repair
        if (repair?.kind === 'reset') {
          primary = (
            <button className="btn primary" disabled={busy} onClick={() => void run(() => api().reset())}>
              Reset
            </button>
          )
        } else if (repair?.kind === 'use-port') {
          primary = (
            <button className="btn primary" disabled={busy} onClick={() => void run(() => api().usePort(repair.port))}>
              Use port {repair.port}
            </button>
          )
        } else {
          primary = (
            <button className="btn primary" disabled={busy} onClick={() => void run(() => api().start(), true)}>
              Start
            </button>
          )
        }
        left = (
          <>
            {repair?.kind !== 'reset' && (
              <button className="btn" disabled={busy} onClick={() => void run(() => api().reset())}>
                Reset
              </button>
            )}
            <button className="btn" onClick={openLog}>
              Open log
            </button>
            <button className="btn" disabled={busy} onClick={() => void run(() => api().remove())}>
              Remove
            </button>
          </>
        )
        break
      }
      default:
        break
    }
  }

  const showLog = lines.length > 0 && (phase === 'setting-up' || phase === 'starting' || phase === 'failed' || pending)

  return (
    <Modal
      size="l"
      name="local-chain"
      help="localChain"
      title="Local Chain"
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <div className="left">{left}</div>
          <button className="btn" onClick={onClose} disabled={busy}>
            Close
          </button>
          {primary}
        </>
      }
    >
      {!status && !error && <div className="hint">Reading the state of the local chain...</div>}
      {status && (
        <div className="lc-state">
          <span className={`lc-dot lc-${status.phase}`} />
          <b>{PHASE_WORDS[status.phase]}</b>
        </div>
      )}

      {status?.phase === 'unavailable' && (
        <p>{status.reason || 'The local chain needs WSL 2 (virtualization on). The compiler works without it; the local chain does not.'}</p>
      )}

      {status?.phase === 'not-set-up' && (
        <>
          <p>
            The local chain is a WAX node that runs only on this computer, in a private Linux of its own. It starts empty, with the WAX system contract and the WAX token (8 decimals), so accounts, RAM, CPU and NET work as on
            WAX. You make accounts and test WAX yourself, with no faucet and no waiting, and you can reset or remove the chain at any time.
          </p>
          <p>Set up uses about 350 MB of disk space and takes less than a minute. Everything it needs is inside WAX Master; nothing is downloaded. While the chain runs, WSL uses about 1 GB of memory.</p>
        </>
      )}

      {status?.phase === 'setting-up' && <p>Setting up the local chain. The lines below show what is done.</p>}
      {status?.phase === 'starting' && <p>Starting the local chain...</p>}
      {status?.phase === 'stopping' && <p>Stopping the local chain. The node is closed cleanly so that its data stays whole.</p>}

      {status?.phase === 'stopped' && (
        <p>
          The local chain is stopped. Start runs it again from where it was: its accounts, contracts and tables are kept. Reset makes a new empty chain with the same chain id. Remove deletes the chain and its private Linux
          from this computer.
        </p>
      )}

      {status?.phase === 'failed' && <div className="error-text lc-reason">{status.reason || 'The local chain did not start.'}</div>}

      {status?.phase === 'running' && (
        <div className="card-list lc-facts">
          <div className="kv-row">
            <span>Endpoint</span>
            <span className="num">
              {status.endpoint}
              <button className="btn lc-copy" onClick={() => copy(status.endpoint)}>
                Copy
              </button>
            </span>
          </div>
          <div className="kv-row">
            <span>Chain id</span>
            <span className="num wrap">
              {status.chainId}
              <button className="btn lc-copy" onClick={() => copy(status.chainId)}>
                Copy
              </button>
            </span>
          </div>
          <div className="kv-row">
            <span>Node version</span>
            <span className="num">{status.nodeVersion}</span>
          </div>
          <div className="kv-row">
            <span>Head block</span>
            <span className="num">{status.head !== undefined ? status.head.toLocaleString('en-US') : '-'}</span>
          </div>
          <div className="kv-row">
            <span>Data size</span>
            <span className="num">{status.dataMb !== undefined ? `${status.dataMb.toLocaleString('en-US')} MB` : '-'}</span>
          </div>
        </div>
      )}

      {status?.phase === 'running' && (
        <div className="lc-accounts">
          <h3>Accounts</h3>
          <p className="hint">
            A new account gets 10,000 WAX, 1 MiB of RAM and 100 WAX each of CPU and NET from the chain. Its key comes from your vault. Give tokens is in the account's own page, under Local tokens.
          </p>
          <button className="btn" disabled={busy} onClick={() => setNewAccount(true)}>
            New account...
          </button>
          <button className="btn" disabled={busy} onClick={() => setCopyContract(true)}>
            Copy contract...
          </button>
        </div>
      )}

      {showLog && (
        <div className="lc-log mono-small" ref={logRef}>
          {lines.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      )}

      {status && (status.phase === 'stopped' || status.phase === 'running' || status.phase === 'failed') && (
        <div className="lc-options">
          <label className="check-label">
            <input type="checkbox" checked={status.options.webPages} disabled={busy} onChange={() => toggle('webPages')} />
            <span>Web pages on this computer may call the local chain</span>
          </label>
          <label className="check-label">
            <input type="checkbox" checked={status.options.startWithApp} disabled={busy} onChange={() => toggle('startWithApp')} />
            <span>Start the local chain with WAX Master</span>
          </label>
        </div>
      )}

      {error && <div className="error-text">{error}</div>}
      {newAccount && <LocalAccountDialog onClose={() => setNewAccount(false)} />}
      {copyContract && <CopyContractDialog onClose={() => setCopyContract(false)} />}
    </Modal>
  )
}
