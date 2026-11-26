import { useState } from 'react'
import type { InspectedTransaction } from '../../../shared/trace-types'
import { Modal } from './Modal'
import { InspectorBody } from './Inspector'
import { errorText, toast } from '../lib/toast'
import { copyText } from '../lib/clipboard'
import { networkStore } from '../lib/networks'
import { useStore } from '../lib/stores'
import { emit } from '../lib/bus'
import { withVault } from '../lib/vault'
import { isUnlockCancelled } from '../../../shared/vault-locked'
import { CANCELLED_NOT_SENT, formLineClass, outcomeLine, type FormLine } from '../lib/tx-outcome'
import { AccountPicker, PermissionPicker } from './AccountPicker'
import { Busy } from './Busy'

const NAME = /^[a-z1-5.]{1,12}[a-j1-5]?$/

/**
 * Accounts > Clear Contract Code: empty setcode and setabi. The account name
 * is typed in the confirmation window (on every network), not here.
 */
export function ClearCodeDialog({ onClose, initialAccount = '' }: { onClose: () => void; initialAccount?: string }): React.JSX.Element {
  const net = useStore(networkStore).current
  const [account, setAccount] = useState(initialAccount)
  const [permission, setPermission] = useState('active')
  const [busy, setBusy] = useState(false)
  const [cleared, setCleared] = useState(false)
  const [line, setLine] = useState<FormLine | null>(null)
  const [trace, setTrace] = useState<InspectedTransaction | null>(null)
  const go = async (): Promise<void> => {
    setBusy(true)
    setLine(null)
    try {
      const r = await withVault(() => window.wax.accounts.clearCode(account, permission))
      if (r.status === 'sent') {
        setTrace(r.trace)
        // The code is gone: a second clear would only repeat the same transaction.
        setCleared(true)
        toast('Contract code cleared', account, 'success')
        // An open Contract tab of this account reads its ABI again until the new one is there.
        emit('contract-changed', account)
      } else {
        // A cancel is a neutral note; a refusal is explained once, by the inspector below when it has the text.
        if (r.status === 'failed' && r.trace) setTrace(r.trace)
        setLine(outcomeLine(r, CANCELLED_NOT_SENT))
      }
    } catch (e) {
      setLine(isUnlockCancelled(e) ? { kind: 'note', text: CANCELLED_NOT_SENT } : { kind: 'error', text: errorText(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      size="m"
      name="clear-code"
      help="clearCode"
      title={`Clear Contract Code on ${net?.name ?? ''}`}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <button className="btn" disabled={busy} onClick={onClose}>
            Close
          </button>
          <button className="btn danger" disabled={busy || cleared || !NAME.test(account)} onClick={() => void go()}>
            {busy ? <Busy text="Waiting for confirmation..." /> : 'Clear code'}
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>
        Removes the contract (code and ABI) from the account; its tables stay on the chain.
      </p>
      <div className="field" style={{ display: 'flex', gap: 'var(--gap-row)' }}>
        <div style={{ flex: 2 }}>
          <label>Account</label>
          <AccountPicker
            mode="starred"
            value={account}
            onChange={setAccount}
            onFind={() => {
              emit('find-account', { label: 'Clear Contract Code', command: 'clear-code' })
              onClose()
            }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label>Permission</label>
          <PermissionPicker account={account} value={permission} onChange={setPermission} />
        </div>
      </div>
      {line && <div className={formLineClass(line)}>{line.text}</div>}
      {trace && <InspectorBody t={trace} />}
    </Modal>
  )
}
