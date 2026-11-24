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

/**
 * Accounts > Clear Contract Code: empty setcode and setabi. The account name
 * is typed in the confirmation window (on every network), not here.
 */
export function ClearCodeDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const net = useStore(networkStore).current
  const [account, setAccount] = useState('')
  const [permission, setPermission] = useState('active')
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
          <button className="btn danger" disabled={busy || !NAME.test(account)} onClick={() => void go()}>
            {busy ? 'Waiting for confirmation...' : 'Clear code'}
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>
        Removes the contract (code and ABI) from the account. Its tables stay on the chain. The confirmation window asks you to type the
        account name.
      </p>
      <div className="field" style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 2 }}>
          <label>Account</label>
          <input className="input mono" value={account} onChange={(e) => setAccount(e.target.value.trim().toLowerCase())} />
        </div>
        <div style={{ flex: 1 }}>
          <label>Permission</label>
          <input className="input mono" value={permission} onChange={(e) => setPermission(e.target.value.trim().toLowerCase())} />
        </div>
      </div>
      {error && <div className="error-text">{error}</div>}
      {trace && <InspectorBody t={trace} />}
    </Modal>
  )
}
