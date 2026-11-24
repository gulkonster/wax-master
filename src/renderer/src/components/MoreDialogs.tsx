import { useState } from 'react'
import type { InspectedTransaction } from '../../../shared/trace-types'
import { Modal } from './Modal'
import { InspectorBody } from './Inspector'
import { errorText, toast } from '../lib/toast'
import { copyText } from '../lib/clipboard'
import { networkStore } from '../lib/networks'
import { useStore } from '../lib/stores'
import { emit } from '../lib/bus'

const NAME = /^[a-z1-5.]{1,12}[a-j1-5]?$/

/** Accounts > Clear Contract Code: empty setcode and setabi; always asks for the typed account name. */
export function ClearCodeDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const net = useStore(networkStore).current
  const [account, setAccount] = useState('')
  const [permission, setPermission] = useState('active')
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [trace, setTrace] = useState<InspectedTransaction | null>(null)
  const go = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const r = await window.wax.accounts.clearCode(account, permission)
      if (r.status === 'sent') {
        setTrace(r.trace)
        toast('Contract code cleared', account, 'success')
      } else if (r.status === 'failed') {
        setError(r.error)
        if (r.trace) setTrace(r.trace)
      }
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={`Clear Contract Code on ${net?.name ?? ''}`}
      wide
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <button className="btn" disabled={busy} onClick={onClose}>
            Close
          </button>
          <button className="btn red" disabled={busy || !NAME.test(account) || typed !== account} onClick={() => void go()}>
            {busy ? 'Waiting for confirmation...' : 'Clear code'}
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>Removes the contract (code and ABI) from the account. Its tables stay on the chain.</p>
      <div className="field" style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 2 }}>
          <label>Account</label>
          <input className="input" value={account} onChange={(e) => setAccount(e.target.value.trim().toLowerCase())} />
        </div>
        <div style={{ flex: 1 }}>
          <label>Permission</label>
          <input className="input" value={permission} onChange={(e) => setPermission(e.target.value.trim().toLowerCase())} />
        </div>
      </div>
      <div className="field">
        <label>Type the account name again to confirm</label>
        <input className="input" value={typed} onChange={(e) => setTyped(e.target.value.trim().toLowerCase())} />
      </div>
      {error && <div className="error-text">{error}</div>}
      {trace && <InspectorBody t={trace} />}
    </Modal>
  )
}

const TESTNET_PAGE = 'https://waxsweden.org/testnet/'

/**
 * Accounts > Create Testnet Account. A new key is created in the vault; the
 * account itself is created on the WAX Testnet account page with that public
 * key (the faucet service has no documented interface to call from the app).
 */
export function TestnetAccountDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const net = useStore(networkStore).current
  const [pub, setPub] = useState('')
  const [account, setAccount] = useState('')
  const [error, setError] = useState('')
  const onTestnet = net?.id === 'wax-testnet'

  const makeKey = async (): Promise<void> => {
    setError('')
    try {
      const status = await window.wax.keys.status()
      if (!status.unlocked) {
        setError('Unlock or create the vault first (Accounts > Manage Keypairs).')
        return
      }
      await window.wax.keys.newPending()
      const e = await window.wax.keys.savePending('testnet account')
      setPub(e.publicKey)
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <Modal
      title="Create Testnet Account"
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Close
          </button>
          <button
            className="btn green"
            disabled={!NAME.test(account)}
            onClick={() => {
              emit('open-account-page', account)
              onClose()
            }}
          >
            Open account
          </button>
        </>
      }
    >
      {!onTestnet && <div className="error-text">Switch to WAX Testnet first (Network menu).</div>}
      <ol className="steps">
        <li>
          Create a key for the account in your vault:{' '}
          <button className="btn green" disabled={!onTestnet || !!pub} onClick={() => void makeKey()}>
            Create key
          </button>
          {pub && (
            <div className="chip" style={{ marginTop: 6, userSelect: 'text' }}>
              {pub}{' '}
              <button className="btn ghost" onClick={() => void copyText(pub).then(
                  () => toast('Public key copied'),
                  (e) => toast('Copy failed', errorText(e), 'error')
                )}>
                Copy
              </button>
            </div>
          )}
        </li>
        <li>
          Open the WAX Testnet page, create the account with this public key as owner and active key, and request test tokens
          there:{' '}
          <button className="btn" onClick={() => void window.wax.app.openExternal(TESTNET_PAGE)}>
            Open {TESTNET_PAGE}
          </button>
        </li>
        <li>
          Enter the new account name:
          <input className="input" style={{ marginTop: 6 }} value={account} onChange={(e) => setAccount(e.target.value.trim().toLowerCase())} placeholder="account name" />
        </li>
      </ol>
      <div className="hint">The account's key is already in the vault, so you can sign for it right away.</div>
      {error && <div className="error-text">{error}</div>}
    </Modal>
  )
}
