// Network > Local Chain > Copy contract (B111 point 5): the code and ABI of an account on another saved
// network are read (a read, nothing is signed there) and deployed to the local chain under the same or
// another name. The SHA-256 of the code is shown before (the source's) and after (read back from here).

import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { useVaultKeys } from './AccountDialogs'
import { NoBackupLine } from './BackupWarning'
import { errorText, toast } from '../lib/toast'
import { networkStore } from '../lib/networks'
import { useStore } from '../lib/stores'
import { emit } from '../lib/bus'
import { withVault } from '../lib/vault'
import { isUnlockCancelled } from '../../../shared/vault-locked'
import { LOCAL_CHAIN_NETWORK_ID } from '../../../shared/local-chain'

const NAME = /^[a-z1-5.]{1,12}$/
const api = (): typeof window.wax.localChain => window.wax.localChain

export function CopyContractDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const nets = useStore(networkStore)
  const keys = useVaultKeys()
  const sources = nets.list.filter((n) => n.id !== LOCAL_CHAIN_NETWORK_ID)
  const [source, setSource] = useState('')
  const [account, setAccount] = useState('')
  const [target, setTarget] = useState('')
  const [targetTouched, setTargetTouched] = useState(false)
  const [key, setKey] = useState('')
  const [read, setRead] = useState<{ hash: string; size: number } | null>(null)
  const [targetState, setTargetState] = useState<{ exists: boolean; hasCode: boolean } | null>(null)
  const [localHash, setLocalHash] = useState('')
  // After a copy: whether the code read back from the local chain equals the source's (B111 point 4).
  const [same, setSame] = useState<boolean | null>(null)
  const [replace, setReplace] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!source && sources.length) {
      const wax = sources.find((n) => n.kind === 'mainnet') ?? sources[0]
      setSource(wax.id)
    }
  }, [sources, source])

  useEffect(() => {
    if (keys.length && !keys.some((k) => k.publicKey === key)) setKey(keys[0].publicKey)
  }, [keys, key])

  // Another source, account or target makes the earlier reading void.
  const reset = (): void => {
    setRead(null)
    setTargetState(null)
    setLocalHash('')
    setSame(null)
    setReplace(false)
    setError('')
  }

  const accountOk = NAME.test(account)
  const targetOk = NAME.test(target)
  const needsKey = !!targetState && !targetState.exists
  const ready = !!read && targetOk && (!needsKey || !!key) && (!targetState?.hasCode || replace)

  const doRead = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const r = await api().copyRead({ networkId: source, account })
      setRead({ hash: r.codeHash, size: r.codeSize })
      const t = await api().copyTarget(target)
      setTargetState(t)
      setLocalHash(t.codeHash ?? '')
    } catch (e) {
      setRead(null)
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const doCopy = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const r = await withVault(() => api().copyContract({ networkId: source, account, target, publicKey: key, replace }))
      setLocalHash(r.localHash)
      setSame(r.same)
      if (r.same) toast('Contract copied', `${target} on Local chain has the code of ${account}.`, 'success')
      emit('open-account-page', target)
    } catch (e) {
      if (!isUnlockCancelled(e)) setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      size="m"
      name="copy-contract"
      help="localChain"
      title="Copy Contract to Local chain"
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <button className="btn" disabled={busy} onClick={onClose}>
            Close
          </button>
          {same !== null ? null : read ? (
            <button className="btn primary" disabled={!ready || busy} onClick={() => void doCopy()}>
              {busy ? 'Copying...' : 'Copy'}
            </button>
          ) : (
            <button className="btn primary" disabled={!source || !accountOk || !targetOk || busy} onClick={() => void doRead()}>
              {busy ? 'Reading...' : 'Read'}
            </button>
          )}
        </>
      }
    >
      <p className="hint">Only code and ABI are copied, not the tables. Most contracts need their first action (for example <span className="mono">init</span>) run again here.</p>
      <div className="field">
        <label>Source network</label>
        <select
          className="select"
          value={source}
          disabled={busy}
          onChange={(e) => {
            setSource(e.target.value)
            reset()
          }}
        >
          {sources.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Account on the source</label>
        <input
          className="input mono"
          value={account}
          disabled={busy}
          onChange={(e) => {
            const v = e.target.value.trim().toLowerCase()
            setAccount(v)
            if (!targetTouched) setTarget(v)
            reset()
          }}
        />
      </div>
      <div className="field">
        <label>Name on Local chain</label>
        <input
          className="input mono"
          value={target}
          disabled={busy}
          onChange={(e) => {
            setTarget(e.target.value.trim().toLowerCase())
            setTargetTouched(true)
            reset()
          }}
        />
      </div>
      {read && (
        <div className="card-list lc-facts">
          <div className="kv-row">
            <span>Code on the source (SHA-256)</span>
            <span className="num wrap">{read.hash}</span>
          </div>
          <div className="kv-row">
            <span>Code on Local chain (SHA-256)</span>
            <span className="num wrap">{localHash || 'none yet'}</span>
          </div>
        </div>
      )}
      {same === true && <div className="acct-note good">The code on Local chain is the same as on the source.</div>}
      {same === false && <div className="error-text">The code on Local chain is not the same as on the source.</div>}
      {same === null && read && targetState && !targetState.exists && (
        <div className="field">
          <label>Key for the new account (owner and active)</label>
          <select className="select" value={key} disabled={busy || keys.length === 0} onChange={(e) => setKey(e.target.value)}>
            {keys.length === 0 && <option value="">(the vault has no key)</option>}
            {keys.map((k) => (
              <option key={k.id} value={k.publicKey}>
                {k.label || 'unlabelled'} - {k.publicKey.slice(0, 18)}…
              </option>
            ))}
          </select>
          <NoBackupLine publicKey={key} />
          <div className="hint">The account does not exist here; it is made with RAM for the code and the key you pick.</div>
        </div>
      )}
      {same === null && read && targetState?.hasCode && (
        <label className="check-label">
          <input type="checkbox" checked={replace} disabled={busy} onChange={() => setReplace(!replace)} />
          <span>{target} on Local chain already has code. Replace it with the copy.</span>
        </label>
      )}
      {error && <div className="error-text">{error}</div>}
    </Modal>
  )
}
