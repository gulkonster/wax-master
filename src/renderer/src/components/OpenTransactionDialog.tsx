// Open Transaction by Id: the id field, and under it the latest transactions this app sent on
// the current network (their kept answers). A click on one opens it.
import { useEffect, useState } from 'react'
import type { InspectedTransaction } from '../../../shared/trace-types'
import { Modal } from './Modal'
import { errorText } from '../lib/toast'
import { fmtTime } from '../lib/time'
import { networkStore } from '../lib/networks'
import { useStore } from '../lib/stores'

/** One row of the list "Sent from WAX Master" (the answer of `tx.kept()`). */
interface KeptRow {
  id: string
  time: string
  first: string
  count: number
}

export function OpenTransactionDialog({
  onOpen,
  onClose
}: {
  onOpen: (t: InspectedTransaction) => void
  onClose: () => void
}): React.JSX.Element {
  const network = useStore(networkStore).current?.name ?? ''
  const [value, setValue] = useState('')
  const [rows, setRows] = useState<KeptRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const list = (await window.wax.tx.kept()) as unknown as KeptRow[]
        if (live) setRows(list)
      } catch {
        if (live) setRows([])
      }
    })()
    return () => {
      live = false
    }
  }, [])

  const open = async (id: string): Promise<void> => {
    if (busy || !id) return
    setBusy(true)
    setError('')
    try {
      onOpen(await window.wax.tx.open(id))
      onClose()
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }

  return (
    <Modal
      size="m"
      name="open-transaction"
      help="openTransaction"
      title="Open Transaction by Id"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || !value.trim()} onClick={() => void open(value.trim())}>
            Open
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="open-tx-id">Transaction id (64 hex characters)</label>
        <input
          id="open-tx-id"
          className="input"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void open(value.trim())}
        />
      </div>
      {error && <div className="sev-error">{error}</div>}
      <div className="txv-kept">
        <div className="tr-label">Sent from WAX Master on {network}</div>
        {rows && rows.length === 0 && <div className="hint">Transactions you send from WAX Master on this network are listed here.</div>}
        {rows && rows.length > 0 && (
          <div className="txv-kept-list">
            {rows.map((r) => (
              <button key={r.id} type="button" className="txv-kept-row" disabled={busy} title={r.id} onClick={() => void open(r.id)}>
                <span className="txv-kept-time">{fmtTime(r.time)}</span>
                <span className="mono-small">
                  {r.first}
                  {r.count > 1 ? ` +${r.count - 1}` : ''}
                </span>
                <span className="mono-small txv-kept-id">{r.id.slice(0, 8)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}
