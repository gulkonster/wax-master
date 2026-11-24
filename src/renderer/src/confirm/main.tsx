import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../styles.css'
import './confirm.css'
import { checkPassword } from '../../../shared/password'
import { confirmPageKind, notSentText, type SendFailure } from './not-sent'
import { approveLabel } from './approve-label'

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
      approve(id: string, typedName?: string): Promise<{ ok: boolean; transactionId?: string; error?: string; notReady?: boolean; failure?: SendFailure }>
      cancel(id: string): Promise<boolean>
      revealLoad(): Promise<{ label: string; publicKey: string }>
      revealShow(password: string): Promise<string>
      revealCopy(password: string): Promise<boolean>
      keyLoad(): Promise<unknown>
      backupSave(password: string): Promise<'saved' | 'cancelled'>
      codeCopy(): Promise<boolean>
      codeSave(): Promise<'saved' | 'cancelled'>
      codeDone(): Promise<boolean>
      recover(code: string, password: string, again: string): Promise<unknown>
      reset(typed: string): Promise<unknown>
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
function useArmed(delay: number): { armed: boolean; waitMs: number; focused: boolean } {
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
  return { armed: since !== null && waitMs === 0, waitMs, focused: since !== null }
}

function Confirm(): React.JSX.Element {
  const [a, setA] = useState<Approval | null>(null)
  // Nothing to load is the only bare page; a failed send keeps the transaction and adds one line.
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [typed, setTyped] = useState('')
  const [left, setLeft] = useState(0)
  const [state, setState] = useState<'ready' | 'sending' | 'done' | 'failed'>('ready')
  const [showHex, setShowHex] = useState(false)
  const [note, setNote] = useState('')
  const { armed, waitMs, focused } = useArmed(a?.approveDelayMs ?? 1500)

  useEffect(() => {
    window.confirmation
      .load()
      .then(setA)
      .catch(() => setLoadError('Nothing to confirm.'))
  }, [])

  useEffect(() => {
    if (!a) return
    const tick = (): void => setLeft(Math.max(0, Math.floor((a.expiresAt - Date.now()) / 1000)))
    tick()
    const t = setInterval(tick, 500)
    return () => clearInterval(t)
  }, [a])

  const kind = confirmPageKind(loadError, a !== null)
  if (kind === 'bare') return <div className="c-page">{loadError}</div>
  if (kind === 'loading' || !a) return <div className="c-page">Loading...</div>

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
      setError(notSentText(r.error, r.failure ?? 'not-sent'))
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
        <button className="btn subtle" onClick={() => setShowHex((v) => !v)}>
          {showHex ? 'Hide' : 'Show'} packed data
        </button>
        <Row label="Transaction id" mono>{a.transactionId}</Row>
        <Row label="Expires">
          {a.expiration} UTC ({expired ? 'expired' : `${left} s left`})
        </Row>
        {note && <div className="hint">{note}</div>}
        {error && <div className="error-text">{error}</div>}
        {state === 'done' && <div className="c-done">Sent.</div>}
      </div>
      <div className="c-foot">
        {state !== 'failed' && state !== 'done' && (
          <div className="c-foot-notes">
            {a.blocked && <div className="c-blocked">{a.blocked}</div>}
            {a.typedName && !a.blocked && (
              <div className="field">
                <label>
                  Type <b>{a.typedName}</b> to confirm this change on {a.network.name}:
                </label>
                <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} spellCheck={false} />
              </div>
            )}
          </div>
        )}
        <div className="c-foot-actions">
        {state === 'failed' || state === 'done' ? (
          <button className="btn" onClick={() => window.close()}>
            Close
          </button>
        ) : (
          <>
            <button className="btn" disabled={state === 'sending'} onClick={() => void window.confirmation.cancel(a.id)}>
              Cancel
            </button>
            <button className={`btn ${mainnet ? 'danger' : 'success'}`} disabled={!canApprove} onClick={() => void approve()}>
              {approveLabel({ sending: state === 'sending', armed, focused, waitMs, expired, blocked: !!a.blocked })}
            </button>
          </>
        )}
        </div>
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
        <div className="field" style={{ marginTop: 'var(--sp-2)' }}>
          <label>Vault password</label>
          <input className="input" type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void show()} />
        </div>
        {shown && (
          <div className="c-row c-stack">
            <div className="c-label">Private key ({left} s)</div>
            <div className="c-value c-key">{shown}</div>
          </div>
        )}
        {note && <div className="hint">{note}</div>}
        {error && <div className="error-text">{error}</div>}
      </div>
      <div className="c-foot">
        <div className="c-foot-actions">
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
        <button className="btn danger" disabled={!pw} onClick={() => void show()}>
          Show for 30 seconds
        </button>
        </div>
      </div>
    </div>
  )
}

/** The reason of a refused call, without Electron's prefix. */
function reason(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

function Foot({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="c-foot">
      <div className="c-foot-actions">{children}</div>
    </div>
  )
}

/** One key to a plain-text file: the password again, the warning, then the system Save dialog (main process). */
function Backup(): React.JSX.Element {
  const [info, setInfo] = useState<{ label: string; publicKey: string } | null>(null)
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    window.confirmation
      .keyLoad()
      .then((r) => setInfo(r as { label: string; publicKey: string }))
      .catch(() => setError('Nothing to back up.'))
  }, [])

  const save = async (): Promise<void> => {
    if (!pw || busy) return
    setBusy(true)
    setError('')
    try {
      const r = await window.confirmation.backupSave(pw)
      if (r === 'saved') {
        setSaved(true)
        setPw('')
      }
    } catch (e) {
      setError(reason(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="c-page">
      <div className="c-header mainnet">
        <div className="c-title">Back up key</div>
        <div>The backup file holds the private key as readable text.</div>
      </div>
      <div className="c-body">
        {info && (
          <>
            <Row label="Label">{info.label || '(no label)'}</Row>
            <Row label="Public key" mono>
              <span className="c-oneline">{info.publicKey}</span>
            </Row>
          </>
        )}
        <div className="banner warn c-gap">
          The file will hold the private key as readable text. Anyone who gets the file controls the account. Keep it offline (a USB
          stick, a printed page); not in a cloud folder, e-mail or chat.
        </div>
        {!saved && (
          <div className="field c-gap">
            <label>Vault password</label>
            <input
              className="input"
              type="password"
              autoFocus
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void save()}
            />
          </div>
        )}
        {saved && <div className="banner green c-gap">Saved. Move the file to a safe offline place and delete it from this computer.</div>}
        {error && <div className="error-text">{error}</div>}
      </div>
      <Foot>
        <button className="btn" onClick={() => window.close()}>
          {saved ? 'Close' : 'Cancel'}
        </button>
        {!saved && (
          <button className="btn danger" disabled={!pw || busy} onClick={() => void save()}>
            {busy ? 'Saving...' : 'Save as text file...'}
          </button>
        )}
      </Foot>
    </div>
  )
}

/** The recovery code in place of its characters until "Show code": five groups of dots. */
const MASKED_CODE = Array.from({ length: 5 }, () => '\u2022'.repeat(5)).join('-')

/** Shown in place of the code after a lock wiped it in the main process. */
const CODE_HIDDEN_TEXT =
  'The vault was locked and the code was hidden. It was not saved from this window: make a new one in Manage Keypairs > Vault > New recovery code.'

/** The recovery code, shown once; masked until "Show code" (Save and Copy work while masked). */
function Code({ given }: { given?: string }): React.JSX.Element {
  const [code, setCode] = useState(given ?? '')
  const [hidden, setHidden] = useState(false)
  const [visible, setVisible] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (given) return
    window.confirmation
      .keyLoad()
      .then((r) => {
        const x = r as { code: string; hidden?: boolean }
        setCode(x.code)
        setHidden(x.hidden === true)
      })
      .catch(() => setError('No code to show.'))
  }, [given])

  const run = async (fn: () => Promise<unknown>, done: (r: unknown) => string): Promise<void> => {
    setError('')
    setNote('')
    try {
      setNote(done(await fn()))
    } catch (e) {
      setError(reason(e))
    }
  }

  if (hidden) {
    return (
      <div className="c-page">
        <div className="c-header test">
          <div className="c-title">Vault recovery code</div>
        </div>
        <div className="c-body">
          <div className="banner warn">{CODE_HIDDEN_TEXT}</div>
        </div>
        <Foot>
          <button className="btn" disabled>
            Save as text file...
          </button>
          <button className="btn" disabled>
            Copy
          </button>
          <button className="btn primary" autoFocus onClick={() => window.close()}>
            Close
          </button>
        </Foot>
      </div>
    )
  }

  return (
    <div className="c-page">
      <div className="c-header test">
        <div className="c-title">Vault recovery code</div>
        <div>Shown once.</div>
      </div>
      <div className="c-body">
        <div className="c-row c-stack">
          <div className="c-label">Recovery code</div>
          <div className="c-value c-key">{code ? (visible ? code : MASKED_CODE) : ''}</div>
        </div>
        <div className="banner warn c-gap">
          With this code the vault can be opened without the password. Keep it away from this computer. It is not shown again.
        </div>
        {note && <div className="hint c-gap">{note}</div>}
        {error && <div className="error-text">{error}</div>}
      </div>
      <Foot>
        <button className="btn" disabled={!code} onClick={() => setVisible((v) => !v)}>
          {visible ? 'Hide code' : 'Show code'}
        </button>
        <button
          className="btn"
          disabled={!code}
          onClick={() =>
            void run(
              () => window.confirmation.codeSave(),
              (r) => (r === 'saved' ? 'Saved as a text file. Move it away from this computer.' : '')
            )
          }
        >
          Save as text file...
        </button>
        <button
          className="btn"
          disabled={!code}
          onClick={() => void run(() => window.confirmation.codeCopy(), () => 'Copied. The clipboard is cleared in 30 seconds if it still holds the code.')}
        >
          Copy
        </button>
        <button
          className="btn primary"
          onClick={() => {
            setCode('')
            setVisible(false)
            void window.confirmation.codeDone()
          }}
        >
          I saved it
        </button>
      </Foot>
    </div>
  )
}

/** Forgotten password: the recovery code and a new password, or a reset that keeps the old file. */
function Recover(): React.JSX.Element {
  const [info, setInfo] = useState<{ keys: number; recovery: boolean } | null>(null)
  const [path, setPath] = useState<'code' | 'reset'>('code')
  const [code, setCode] = useState('')
  const [pw, setPw] = useState('')
  const [again, setAgain] = useState('')
  const [leftAgain, setLeftAgain] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [newCode, setNewCode] = useState('')
  const [resetFile, setResetFile] = useState('')

  useEffect(() => {
    window.confirmation
      .keyLoad()
      .then((r) => {
        const i = r as { keys: number; recovery: boolean }
        setInfo(i)
        if (!i.recovery) setPath('reset')
      })
      .catch(() => setError('Nothing to recover.'))
  }, [])

  if (newCode) return <Code given={newCode} />

  const strength = checkPassword(pw)
  const canRecover = !!code.trim() && strength.allowed && pw === again && !busy
  const recover = async (): Promise<void> => {
    if (!canRecover) return
    setBusy(true)
    setError('')
    try {
      const r = (await window.confirmation.recover(code, pw, again)) as { code: string }
      setCode('')
      setPw('')
      setAgain('')
      setNewCode(r.code)
    } catch (e) {
      setError(reason(e))
    } finally {
      setBusy(false)
    }
  }
  const reset = async (): Promise<void> => {
    if (typed !== 'RESET' || busy) return
    setBusy(true)
    setError('')
    try {
      const r = (await window.confirmation.reset(typed)) as { file: string }
      setResetFile(r.file)
    } catch (e) {
      setError(reason(e))
    } finally {
      setBusy(false)
    }
  }

  if (resetFile) {
    return (
      <div className="c-page">
        <div className="c-header test">
          <div className="c-title">The vault was reset</div>
        </div>
        <div className="c-body">
          <p>
            The old vault file is kept as <span className="mono-small">{resetFile}</span> in the data folder. If you remember its
            password later, Manage Keypairs &gt; Import vault brings its keys back. Create the new vault in the main window.
          </p>
        </div>
        <Foot>
          <button className="btn primary" onClick={() => window.close()}>
            Close
          </button>
        </Foot>
      </div>
    )
  }

  const n = info?.keys ?? 0
  return (
    <div className="c-page">
      <div className="c-header test">
        <div className="c-title">Forgot password</div>
        <div>The vault opens with its password or its recovery code, and with nothing else.</div>
      </div>
      <div className="c-body">
        <div className="c-choices">
          <label className="c-choice">
            <input type="radio" checked={path === 'code'} disabled={info !== null && !info.recovery} onChange={() => setPath('code')} /> I
            have the recovery code
          </label>
          <label className="c-choice">
            <input type="radio" checked={path === 'reset'} onChange={() => setPath('reset')} /> Reset the vault
          </label>
        </div>
        {info && !info.recovery && <div className="hint c-gap">This vault has no recovery code.</div>}
        {path === 'code' ? (
          <>
            <div className="field c-gap">
              <label>Recovery code</label>
              <input
                className="input mono"
                autoFocus
                spellCheck={false}
                placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
            <div className="field">
              <label>New password</label>
              <input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
              {strength.text && <div className={strength.level === 'weak' ? 'hint warn-note' : 'hint'}>{strength.text}</div>}
            </div>
            <div className="field">
              <label>New password again</label>
              <input
                className="input"
                type="password"
                value={again}
                onChange={(e) => setAgain(e.target.value)}
                onBlur={() => setLeftAgain(true)}
                onKeyDown={(e) => e.key === 'Enter' && void recover()}
              />
              {leftAgain && again && pw !== again && <div className="hint">The two passwords are not the same.</div>}
            </div>
          </>
        ) : (
          <>
            <p className="c-gap">
              The vault holds {n} {n === 1 ? 'key' : 'keys'}. Without the password or the recovery code they cannot be read by anyone. A
              reset starts an empty vault. Accounts whose only key is in the old vault can no longer be controlled from here.
            </p>
            <p>The old file is not deleted: it is moved to vault-old-&lt;date&gt;.json in the data folder.</p>
            <div className="field">
              <label>
                Type <b>RESET</b> to reset the vault
              </label>
              <input
                className="input"
                spellCheck={false}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void reset()}
              />
            </div>
          </>
        )}
        {error && <div className="error-text">{error}</div>}
      </div>
      <Foot>
        <button className="btn" disabled={busy} onClick={() => window.close()}>
          Cancel
        </button>
        {path === 'code' ? (
          <button className="btn primary" disabled={!canRecover} onClick={() => void recover()}>
            {busy ? 'Opening...' : 'Set new password'}
          </button>
        ) : (
          <button className="btn danger" disabled={typed !== 'RESET' || busy} onClick={() => void reset()}>
            Reset the vault
          </button>
        )}
      </Foot>
    </div>
  )
}

function Page(): React.JSX.Element {
  switch (window.location.hash) {
    case '#reveal':
      return <Reveal />
    case '#backup':
      return <Backup />
    case '#code':
      return <Code />
    case '#recover':
      return <Recover />
    default:
      return <Confirm />
  }
}

createRoot(document.getElementById('root')!).render(<Page />)
