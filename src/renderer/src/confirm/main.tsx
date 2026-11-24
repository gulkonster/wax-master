import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../styles.css'
import './confirm.css'

interface Blob {
  field: 'code' | 'abi'
  size: number
  sha256: string
}

interface Approval {
  id: string
  title: string
  network: { id: string; name: string; kind: string; chainId: string }
  endpoint: string
  expiresAt: number
  expiration: string
  transactionId: string
  packedSha256: string
  actions: { account: string; name: string; authorization: { actor: string; permission: string }[]; data: unknown; hex: string; blob?: Blob }[]
  signers: { actor: string; permission: string; publicKey: string; label: string }[]
  artifacts?: {
    account: string
    wasmSha256?: string
    wasmSize?: number
    abiSha256?: string
    abiSize?: number
    currentCodeHash: string | null
    clear: boolean
  }
  typedName?: string
  blocked?: string
  /** Approve is accepted this long after the window is shown and focused. */
  approveDelayMs: number
}

declare global {
  interface Window {
    confirmation: {
      load(): Promise<Approval>
      approve(id: string, typedName?: string): Promise<{ ok: boolean; transactionId?: string; error?: string; notReady?: boolean }>
      cancel(id: string): Promise<boolean>
      revealLoad(): Promise<{ label: string; publicKey: string }>
      revealShow(password: string): Promise<string>
      revealCopy(password: string): Promise<boolean>
    }
  }
}

function Row({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }): React.JSX.Element {
  return (
    <div className="c-row">
      <div className="c-label">{label}</div>
      <div className={`c-value${mono ? ' mono-small' : ''}`}>{children}</div>
    </div>
  )
}

function blobText(b: { size: number; sha256: string }): string {
  return b.size === 0 ? '0 bytes (empty: removes it)' : `${b.size.toLocaleString()} bytes, SHA-256 ${b.sha256}`
}

/** Action data for display: code and ABI bytes as size and hash (the hex is behind "Show packed data"). */
function shownData(act: Approval['actions'][number]): unknown {
  if (!act.blob || !act.data || typeof act.data !== 'object') return act.data
  return { ...(act.data as Record<string, unknown>), [act.blob.field]: blobText(act.blob) }
}

/**
 * True once the window has been visible and focused for `delay` ms; any blur
 * starts it over. The main process applies the same rule to Approve.
 */
function useArmed(delay: number): { armed: boolean; waitMs: number } {
  const [since, setSince] = useState<number | null>(() => (document.hasFocus() && document.visibilityState === 'visible' ? Date.now() : null))
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const on = (): void => setSince(Date.now())
    const off = (): void => setSince(null)
    const vis = (): void => (document.visibilityState === 'visible' && document.hasFocus() ? on() : off())
    window.addEventListener('focus', on)
    window.addEventListener('blur', off)
    document.addEventListener('visibilitychange', vis)
    // Focus can arrive before these listeners exist; notice it on the next tick too.
    const t = setInterval(() => {
      setNow(Date.now())
      setSince((s) => (s === null && document.hasFocus() && document.visibilityState === 'visible' ? Date.now() : s))
    }, 100)
    return () => {
      window.removeEventListener('focus', on)
      window.removeEventListener('blur', off)
      document.removeEventListener('visibilitychange', vis)
      clearInterval(t)
    }
  }, [])
  const waitMs = since === null ? delay : Math.max(0, since + delay - now)
  return { armed: since !== null && waitMs === 0, waitMs }
}

function Confirm(): React.JSX.Element {
  const [a, setA] = useState<Approval | null>(null)
  const [error, setError] = useState('')
  const [typed, setTyped] = useState('')
  const [left, setLeft] = useState(0)
  const [state, setState] = useState<'ready' | 'sending' | 'done' | 'failed'>('ready')
  const [showHex, setShowHex] = useState(false)
  const [note, setNote] = useState('')
  const { armed, waitMs } = useArmed(a?.approveDelayMs ?? 1500)

  useEffect(() => {
    window.confirmation
      .load()
      .then(setA)
      .catch(() => setError('Nothing to confirm.'))
  }, [])

  useEffect(() => {
    if (!a) return
    const tick = (): void => setLeft(Math.max(0, Math.floor((a.expiresAt - Date.now()) / 1000)))
    tick()
    const t = setInterval(tick, 500)
    return () => clearInterval(t)
  }, [a])

  if (error) return <div className="c-page">{error}</div>
  if (!a) return <div className="c-page">Loading...</div>

  const mainnet = a.network.kind !== 'testnet' && a.network.kind !== 'local'
  const expired = left <= 0
  const canApprove = state === 'ready' && armed && !expired && !a.blocked && (!a.typedName || typed === a.typedName)

  const approve = async (): Promise<void> => {
    setState('sending')
    setNote('')
    const r = await window.confirmation.approve(a.id, a.typedName ? typed : undefined)
    if (r.ok) setState('done')
    else if (r.notReady) {
      // Too early: nothing was used up; the button works again in a moment.
      setState('ready')
      setNote(r.error ?? '')
    } else {
      setState('failed')
      setError(r.error ?? 'Failed')
    }
  }

  return (
    <div className="c-page">
      <div className={`c-header${mainnet ? ' mainnet' : ' test'}`}>
        <div className="c-title">{a.title}</div>
        <div>
          {a.network.name} · {mainnet ? 'MAINNET (real value)' : a.network.kind}
        </div>
      </div>
      <div className="c-body">
        <Row label="Network">{a.network.name}</Row>
        <Row label="Chain id" mono>{a.network.chainId}</Row>
        <Row label="Endpoint" mono>{a.endpoint}</Row>
        <Row label="Signed by">
          {a.signers.map((s) => (
            <div key={s.publicKey}>
              <b>
                {s.actor}@{s.permission}
              </b>{' '}
              <span className="hint">key "{s.label || 'unlabelled'}" {s.publicKey.slice(0, 14)}…{s.publicKey.slice(-6)}</span>
            </div>
          ))}
        </Row>
        {a.artifacts && (
          <div className="c-artifacts">
            <Row label={a.artifacts.clear ? 'Clears contract of' : 'Contract account'}>
              <b>{a.artifacts.account}</b>
            </Row>
            {a.artifacts.wasmSha256 !== undefined && (
              <Row label="WASM (in this transaction)" mono>
                {blobText({ size: a.artifacts.wasmSize ?? 0, sha256: a.artifacts.wasmSha256 })}
              </Row>
            )}
            {a.artifacts.abiSha256 !== undefined && (
              <Row label="ABI (in this transaction)" mono>
                {blobText({ size: a.artifacts.abiSize ?? 0, sha256: a.artifacts.abiSha256 })}
              </Row>
            )}
            <Row label="Code now on account" mono>
              {a.artifacts.currentCodeHash === null ? `(could not be read from ${a.endpoint})` : a.artifacts.currentCodeHash || '(none)'}
            </Row>
          </div>
        )}
        <div className="c-section">Actions ({a.actions.length})</div>
        {a.actions.map((act, i) => (
          <div key={i} className="c-action">
            <div>
              <span className="badge-pair">
                <span>{act.account}</span>
                <span>{act.name}</span>
              </span>{' '}
              <span className="hint">{act.authorization.map((x) => `${x.actor}@${x.permission}`).join(', ')}</span>
            </div>
            <pre className="c-json">{JSON.stringify(shownData(act), null, 2)}</pre>
            {showHex && <pre className="c-json">{act.hex}</pre>}
          </div>
        ))}
        <button className="btn ghost" onClick={() => setShowHex((v) => !v)}>
          {showHex ? 'Hide' : 'Show'} packed data
        </button>
        <Row label="Transaction id" mono>{a.transactionId}</Row>
        <Row label="Expires">
          {a.expiration} UTC ({expired ? 'expired' : `${left} s left`})
        </Row>
        {a.blocked && <div className="c-blocked">{a.blocked}</div>}
        {a.typedName && !a.blocked && (
          <div className="field" style={{ marginTop: 12 }}>
            <label>
              Type <b>{a.typedName}</b> to confirm this change on {a.network.name}:
            </label>
            <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} spellCheck={false} />
          </div>
        )}
        {note && <div className="hint">{note}</div>}
        {error && <div className="error-text">{error}</div>}
        {state === 'done' && <div className="c-done">Sent.</div>}
      </div>
      <div className="c-foot">
        {state === 'failed' || state === 'done' ? (
          <button className="btn" onClick={() => window.close()}>
            Close
          </button>
        ) : (
          <>
            <button className="btn" disabled={state === 'sending'} onClick={() => void window.confirmation.cancel(a.id)}>
              Cancel
            </button>
            <button className={`btn ${mainnet ? 'red' : 'green'}`} disabled={!canApprove} onClick={() => void approve()}>
              {state === 'sending'
                ? 'Signing and sending...'
                : !armed && !expired && !a.blocked
                  ? `Approve and send (in ${(waitMs / 1000).toFixed(1)} s)`
                  : 'Approve and send'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function Reveal(): React.JSX.Element {
  const [info, setInfo] = useState<{ label: string; publicKey: string } | null>(null)
  const [pw, setPw] = useState('')
  const [shown, setShown] = useState('')
  const [left, setLeft] = useState(0)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => {
    window.confirmation.revealLoad().then(setInfo).catch(() => setError('Nothing to show.'))
  }, [])

  useEffect(() => {
    if (!shown) return
    setLeft(30)
    const t = setInterval(() => {
      setLeft((l) => {
        if (l <= 1) {
          setShown('')
          clearInterval(t)
          return 0
        }
        return l - 1
      })
    }, 1000)
    return () => clearInterval(t)
  }, [shown])

  const show = async (): Promise<void> => {
    setError('')
    try {
      setShown(await window.confirmation.revealShow(pw))
    } catch {
      setError('Wrong password')
    }
  }
  const copy = async (): Promise<void> => {
    setError('')
    try {
      await window.confirmation.revealCopy(pw)
      setNote('Copied. The clipboard is cleared in 30 seconds if it still holds the key.')
    } catch {
      setError('Wrong password')
    }
  }

  return (
    <div className="c-page">
      <div className="c-header mainnet">
        <div className="c-title">Show private key</div>
        <div>Anyone who sees this key controls the accounts it signs for.</div>
      </div>
      <div className="c-body">
        {info && (
          <>
            <Row label="Label">{info.label || '(no label)'}</Row>
            <Row label="Public key" mono>{info.publicKey}</Row>
          </>
        )}
        <div className="field" style={{ marginTop: 12 }}>
          <label>Vault password</label>
          <input className="input" type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void show()} />
        </div>
        {shown && (
          <Row label={`Private key (${left} s)`} mono>
            {shown}
          </Row>
        )}
        {note && <div className="hint">{note}</div>}
        {error && <div className="error-text">{error}</div>}
      </div>
      <div className="c-foot">
        <button
          className="btn"
          onClick={() => {
            setShown('')
            setPw('')
            window.close()
          }}
        >
          Close
        </button>
        <button className="btn" disabled={!pw} onClick={() => void copy()}>
          Copy
        </button>
        <button className="btn red" disabled={!pw} onClick={() => void show()}>
          Show for 30 seconds
        </button>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(window.location.hash === '#reveal' ? <Reveal /> : <Confirm />)
