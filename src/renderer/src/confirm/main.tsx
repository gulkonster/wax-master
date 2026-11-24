import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../styles.css'
import './confirm.css'

interface Approval {
  id: string
  purpose: string
  network: { id: string; name: string; kind: string; chainId: string }
  endpoint: string
  expiresAt: number
  expiration: string
  transactionId: string
  packedSha256: string
  actions: { account: string; name: string; authorization: { actor: string; permission: string }[]; data: unknown; hex: string }[]
  signers: { actor: string; permission: string; publicKey: string; label: string }[]
  artifacts?: { wasmSha256?: string; wasmSize?: number; abiSha256?: string; abiSize?: number; currentCodeHash?: string }
  typedName?: string
  blocked?: string
}

declare global {
  interface Window {
    confirmation: {
      load(): Promise<Approval>
      approve(id: string, typedName?: string): Promise<{ ok: boolean; transactionId?: string; error?: string }>
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

function Confirm(): React.JSX.Element {
  const [a, setA] = useState<Approval | null>(null)
  const [error, setError] = useState('')
  const [typed, setTyped] = useState('')
  const [left, setLeft] = useState(0)
  const [state, setState] = useState<'ready' | 'sending' | 'done' | 'failed'>('ready')
  const [showHex, setShowHex] = useState(false)

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
  const canApprove = state === 'ready' && !expired && !a.blocked && (!a.typedName || typed === a.typedName)

  const approve = async (): Promise<void> => {
    setState('sending')
    const r = await window.confirmation.approve(a.id, a.typedName ? typed : undefined)
    if (r.ok) setState('done')
    else {
      setState('failed')
      setError(r.error ?? 'Failed')
    }
  }

  return (
    <div className="c-page">
      <div className={`c-header${mainnet ? ' mainnet' : ''}`}>
        <div className="c-title">{a.purpose}</div>
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
            {a.artifacts.wasmSha256 && (
              <Row label="WASM SHA-256" mono>
                {a.artifacts.wasmSha256} ({a.artifacts.wasmSize?.toLocaleString()} bytes)
              </Row>
            )}
            {a.artifacts.abiSha256 && (
              <Row label="ABI SHA-256" mono>
                {a.artifacts.abiSha256} ({a.artifacts.abiSize?.toLocaleString()} bytes)
              </Row>
            )}
            {a.artifacts.currentCodeHash !== undefined && (
              <Row label="Code now on account" mono>
                {a.artifacts.currentCodeHash || '(none)'}
              </Row>
            )}
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
            <pre className="c-json">{JSON.stringify(act.data, null, 2)}</pre>
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
              {state === 'sending' ? 'Signing and sending...' : 'Approve and send'}
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
        <button className="btn" onClick={() => window.close()}>
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
