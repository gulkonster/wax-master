// Transactions: the account's actions from the history service, newest first,
// in pages, filtered by action name and date range. A row opens the
// transaction inspector.

import { useCallback, useEffect, useState } from 'react'
import type { AccountActionRow, AccountActionsFilter } from '../../../../shared/chain-types'
import { ACTIONS_PAGE, filterOf, pageCount } from '../../../../shared/history-filter'
import { emit, on } from '../../lib/bus'
import { networkStore } from '../../lib/networks'
import { useStore } from '../../lib/stores'
import { errorText } from '../../lib/toast'
import { HelpButton } from '../../components/HelpButton'
import { IconRefresh } from '../../components/Icons'
import { fmtTime } from './common'
import { Busy } from '../../components/Busy'

/** `refresh` grows with the last read after a sent transaction: the list is read again then. */
export function TransactionsSection({ name, refresh = 0 }: { name: string; refresh?: number }): React.JSX.Element {
  const [rows, setRows] = useState<AccountActionRow[]>([])
  const [historyNote, setHistoryNote] = useState('')
  const [more, setMore] = useState(false)
  const [total, setTotal] = useState(0)
  const [totalExact, setTotalExact] = useState(false)
  const [windowEnd, setWindowEnd] = useState(false)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(0)
  // The fields, and the filter in use (applied with the button or Enter).
  const [action, setAction] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [filter, setFilter] = useState<AccountActionsFilter>({})
  const [problem, setProblem] = useState('')
  const history = useStore(networkStore).current?.history ?? ''

  const loadPage = useCallback(
    async (p: number) => {
      setLoading(true)
      try {
        const r = await window.wax.chain.actions(name, p * ACTIONS_PAGE, filter)
        if (!r.historyAvailable) {
          setHistoryNote('This network has no history service. Transactions you sent from WAX Master are in Network > Open Transaction by Id.')
          setRows([])
        } else {
          setHistoryNote('')
          setRows(r.rows)
        }
        setPage(p)
        setMore(r.more)
        setTotal(r.total ?? 0)
        setTotalExact(r.totalExact === true)
        setWindowEnd(r.windowEnd === true)
      } catch (e) {
        setHistoryNote(`Transactions could not be loaded: ${errorText(e)}`)
      } finally {
        setLoading(false)
      }
    },
    [name, filter]
  )

  useEffect(() => {
    void loadPage(0)
  }, [loadPage, refresh, history])

  useEffect(
    () =>
      on('account-refresh', (n) => {
        if (n === name) void loadPage(0)
      }),
    [name, loadPage]
  )

  const apply = (): void => {
    const f = filterOf(action, from, to)
    if ('problem' in f) {
      setProblem(f.problem)
      return
    }
    setProblem('')
    setFilter(f.filter)
  }
  const clear = (): void => {
    setAction('')
    setFrom('')
    setTo('')
    setProblem('')
    setFilter({})
  }
  const filtered = Object.keys(filter).length > 0
  const pages = totalExact ? pageCount(total) : 0

  return (
    <section className="wallet-section">
      <div className="wallet-section-head">
        <h3>Transactions</h3>
        <HelpButton place="walletTransactions" />
        <span className="grow" />
        <button className="icon-btn" title="Refresh" onClick={() => void loadPage(page)}>
          <IconRefresh />
        </button>
      </div>
      <form
        className="tx-filters"
        onSubmit={(e) => {
          e.preventDefault()
          apply()
        }}
      >
        <div className="field">
          <label>Action</label>
          <input className="input mono" value={action} placeholder="any, e.g. transfer" onChange={(e) => setAction(e.target.value.trim().slice(0, 13))} />
        </div>
        <div className="field">
          <label>From day</label>
          <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="field">
          <label>To day</label>
          <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <button type="submit" className="btn" disabled={loading}>
          Filter
        </button>
        {filtered && (
          <button type="button" className="btn subtle" onClick={clear}>
            Clear
          </button>
        )}
      </form>
      {problem && <div className="acct-note bad">{problem}</div>}
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
                <td className="mono-small data-cell" title={r.data}>{r.data}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!historyNote && rows.length === 0 && !loading && <div className="hint">{filtered ? 'No transactions match the filter.' : 'No transactions found.'}</div>}
      {!historyNote && (page > 0 || more) && (
        <div className="tx-pages">
          <button className="btn subtle" disabled={loading || page === 0} onClick={() => void loadPage(page - 1)}>
            Newer
          </button>
          <span className="hint">
            Page {page + 1}
            {pages > 0 ? ` of ${pages}` : ''}
          </span>
          <button className="btn subtle" disabled={loading || !more} onClick={() => void loadPage(page + 1)}>
            {loading ? <Busy text="Loading..." /> : 'Older'}
          </button>
        </div>
      )}
      {!historyNote && windowEnd && (
        <div className="hint">The history service lists the latest 10,000 matching actions; set a date range to see older ones.</div>
      )}
    </section>
  )
}
