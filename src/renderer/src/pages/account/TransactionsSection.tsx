// Transactions: the account's actions from the history service, newest first.
// A row opens the transaction inspector.

import { useCallback, useEffect, useState } from 'react'
import type { AccountActionRow } from '../../../../shared/chain-types'
import { emit, on } from '../../lib/bus'
import { errorText } from '../../lib/toast'
import { HelpButton } from '../../components/HelpButton'
import { IconRefresh } from '../../components/Icons'
import { fmtTime } from './common'

/** `refresh` grows with the last read after a sent transaction: the list is read again then. */
export function TransactionsSection({ name, refresh = 0 }: { name: string; refresh?: number }): React.JSX.Element {
  const [rows, setRows] = useState<AccountActionRow[]>([])
  const [historyNote, setHistoryNote] = useState('')
  const [more, setMore] = useState(false)
  const [loading, setLoading] = useState(false)

  const loadRows = useCallback(
    async (skip: number) => {
      setLoading(true)
      try {
        const page = await window.wax.chain.actions(name, skip)
        if (!page.historyAvailable) {
          setHistoryNote('This network has no history service configured. Add one in Network > Manage Networks.')
          setRows([])
        } else {
          setHistoryNote('')
          setRows((r) => (skip === 0 ? page.rows : [...r, ...page.rows]))
        }
        setMore(page.more)
      } catch (e) {
        setHistoryNote(`Transactions could not be loaded: ${errorText(e)}`)
      } finally {
        setLoading(false)
      }
    },
    [name]
  )

  useEffect(() => {
    void loadRows(0)
  }, [loadRows, refresh])

  useEffect(
    () =>
      on('account-refresh', (n) => {
        if (n === name) void loadRows(0)
      }),
    [name, loadRows]
  )

  return (
    <section className="wallet-section">
      <div className="wallet-section-head">
        <h3>Transactions</h3>
        <HelpButton place="walletTransactions" />
        <span className="grow" />
        <button className="icon-btn" title="Refresh" onClick={() => void loadRows(0)}>
          <IconRefresh />
        </button>
      </div>
      {historyNote ? (
        <div className="hint">{historyNote}</div>
      ) : (
        <table className="tx-table clickable">
          <thead>
            <tr>
              <th>Time</th>
              <th>Action</th>
              <th>Data</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.trxId}-${i}`} title={r.trxId} onClick={() => emit('open-transaction', r.trxId)}>
                <td className="time">{fmtTime(r.time)}</td>
                <td className="nowrap">
                  <span className="badge-pair">
                    <span>{r.contract}</span>
                    <span>{r.action}</span>
                  </span>
                </td>
                <td className="mono-small data-cell">{r.data}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!historyNote && rows.length === 0 && !loading && <div className="hint">No transactions found.</div>}
      {more && (
        <button className="btn load-more" disabled={loading} onClick={() => void loadRows(rows.length)}>
          {loading ? 'Loading...' : 'Load more'}
        </button>
      )}
    </section>
  )
}
