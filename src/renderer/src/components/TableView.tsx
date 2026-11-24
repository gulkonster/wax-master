// Right half of the Contract page: table picker, query fields and the data table.
// Rows come from the chain and are shown as text only.

import { useCallback, useEffect, useState } from 'react'
import type { ContractAbiView, ContractField, ContractHistoryEntry } from '../../../shared/chain-types'
import { errorText, toast } from '../lib/toast'
import { IconCheck, IconChevronDown, IconTable } from './Icons'
import { PickMenu, SavedMenus } from './ActionForm'
import { rememberTypedScope, scopeForTable, type TypedScopes } from '../lib/table-scope'

const KEY_TYPES = ['i64', 'i128', 'i256', 'float64', 'float128', 'sha256', 'ripemd160', 'name']
const MAX_ROWS = 10_000
const MAX_CELL = 500

interface QueryFields {
  scope: string
  lower: string
  upper: string
  limit: string
  index: string
  keyType: string
  reverse: boolean
}

function cell(v: unknown): string {
  let t: string
  if (v === null || v === undefined) t = ''
  else if (typeof v === 'string') t = v
  else if (typeof v === 'number' || typeof v === 'boolean') t = String(v)
  else {
    try {
      t = JSON.stringify(v) ?? ''
    } catch {
      t = ''
    }
  }
  return t.length > MAX_CELL ? t.slice(0, MAX_CELL) + '…' : t
}

function describeQuery(e: ContractHistoryEntry): string {
  const q = e.payload as Partial<QueryFields>
  const parts = [`scope ${q.scope ?? ''}`]
  if (q.lower) parts.push(`from ${q.lower}`)
  if (q.upper) parts.push(`to ${q.upper}`)
  if (q.limit) parts.push(`limit ${q.limit}`)
  if (q.index) parts.push(`index ${q.index}`)
  if (q.reverse) parts.push('reverse')
  return parts.join(', ')
}

export function TableView({ account, view }: { account: string; view: ContractAbiView }): React.JSX.Element {
  const [table, setTable] = useState('')
  const [q, setQ] = useState<QueryFields>({ scope: account, lower: '', upper: '', limit: '', index: '', keyType: '', reverse: false })
  const [rows, setRows] = useState<unknown[]>([])
  const [more, setMore] = useState(false)
  const [nextKey, setNextKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [ran, setRan] = useState(false)
  const [favorites, setFavorites] = useState<ContractHistoryEntry[]>([])
  const [history, setHistory] = useState<ContractHistoryEntry[]>([])
  // Scopes the user typed per table in this tab (memory only).
  const [typedScopes, setTypedScopes] = useState<TypedScopes>({})

  const info = view.tables.find((t) => t.name === table)
  const columns: ContractField[] =
    info && info.fields.length > 0
      ? info.fields
      : Object.keys((rows[0] as Record<string, unknown> | undefined) ?? {}).map((k) => ({ name: k, type: '', resolved: '' }))

  const reloadSaved = useCallback(async () => {
    try {
      setFavorites(await window.wax.contract.historyList(account, 'query', 'favorite'))
      setHistory(await window.wax.contract.historyList(account, 'query', 'history'))
    } catch {
      // the lists are a convenience
    }
  }, [account])
  useEffect(() => void reloadSaved(), [reloadSaved])

  const run = async (tbl: string, f: QueryFields, append: boolean): Promise<void> => {
    if (!tbl) return
    const limit = f.limit.trim() === '' ? 10 : Number(f.limit)
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      setError('Limit: enter a whole number from 1 to 1000')
      return
    }
    setLoading(true)
    setError('')
    try {
      const r = await window.wax.contract.rows({
        account,
        table: tbl,
        scope: f.scope.trim() || account,
        lower: append ? nextKey : f.lower.trim(),
        upper: f.upper.trim(),
        limit,
        index: f.index.trim(),
        keyType: f.keyType,
        reverse: f.reverse
      })
      setRows((old) => (append ? [...old, ...r.rows] : r.rows))
      setMore(r.more)
      setNextKey(r.nextKey)
      setRan(true)
      if (!append) {
        try {
          setHistory(await window.wax.contract.historyAdd(account, 'query', 'history', tbl, { ...f }))
        } catch {
          // ignore
        }
      }
    } catch (e) {
      if (!append) {
        setRows([])
        setMore(false)
      }
      setError(errorText(e))
    } finally {
      setLoading(false)
    }
  }

  const pickTable = (name: string): void => {
    // A scope typed before the first table is picked belongs to that table.
    if (!table && q.scope !== account) setTypedScopes((s) => rememberTypedScope(s, name, q.scope))
    const f = { ...q, scope: scopeForTable(table, name, q.scope, account, typedScopes) }
    setTable(name)
    setQ(f)
    setRows([])
    setRan(false)
    setMore(false)
    void run(name, f, false)
  }

  const set = <K extends keyof QueryFields>(k: K, v: QueryFields[K]): void => {
    setQ((s) => ({ ...s, [k]: v }))
    if (k === 'scope') setTypedScopes((s) => rememberTypedScope(s, table, v as string))
  }
  const enter = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') void run(table, q, false)
  }

  const loadEntry = (e: ContractHistoryEntry): void => {
    if (!view.tables.some((t) => t.name === e.name)) {
      toast('Table not found', `${e.name} is not in the ABI of ${account} any more.`, 'error')
      return
    }
    const p = e.payload as Partial<QueryFields>
    const f: QueryFields = {
      scope: typeof p.scope === 'string' ? p.scope : account,
      lower: typeof p.lower === 'string' ? p.lower : '',
      upper: typeof p.upper === 'string' ? p.upper : '',
      limit: typeof p.limit === 'string' ? p.limit : '',
      index: typeof p.index === 'string' ? p.index : '',
      keyType: typeof p.keyType === 'string' ? p.keyType : '',
      reverse: p.reverse === true
    }
    setTable(e.name)
    setQ(f)
    setTypedScopes((s) => rememberTypedScope(s, e.name, f.scope))
    setRows([])
    void run(e.name, f, false)
  }

  const saveFavorite = async (): Promise<void> => {
    if (!table) return
    try {
      setFavorites(await window.wax.contract.historyAdd(account, 'query', 'favorite', table, { ...q }))
      toast('Favorite saved', `${table} on ${account}`, 'success')
    } catch (e) {
      toast('Could not save the favorite', errorText(e), 'error')
    }
  }

  return (
    <div className="contract-right">
      <div className="pane-bar">
        <PickMenu
          className="pick-btn"
          disabled={view.tables.length === 0}
          button={
            <>
              <span className="lead">
                <IconTable />
              </span>
              <span className={`name${table ? '' : ' ui'}`}>{table || (view.tables.length ? 'Pick a table' : '(no tables)')}</span>
              <IconChevronDown className="chev" />
            </>
          }
        >
          {(close) =>
            view.tables.map((t) => (
              <div
                key={t.name}
                className={`dd-item mono${t.name === table ? ' selected' : ''}`}
                onClick={() => {
                  close()
                  pickTable(t.name)
                }}
              >
                <span className="dd-lead">{t.name === table && <IconCheck />}</span>
                {t.name}
                <span className="dd-type">{t.type}</span>
              </div>
            ))
          }
        </PickMenu>
        <button className="btn" disabled={!table || loading} onClick={() => void run(table, q, false)}>
          Run query
        </button>
        <div className="spacer" />
        <SavedMenus
          kind="query"
          favorites={favorites}
          history={history}
          canSave={!!table}
          describe={describeQuery}
          onSave={() => void saveFavorite()}
          onPick={loadEntry}
          onRemove={(list, id) => void window.wax.contract.historyRemove(account, 'query', list, id).then(list === 'favorite' ? setFavorites : setHistory)}
        />
      </div>
      <div className="section-head static">
        <span className="grow">Query</span>
      </div>
      <div className="query-grid">
        <div>
          <div className="field-label">Scope</div>
          <input className="field-input" spellCheck={false} value={q.scope} placeholder={account} onChange={(e) => set('scope', e.target.value)} onKeyDown={enter} />
        </div>
        <div>
          <div className="field-label">Lower bound</div>
          <input className="field-input" spellCheck={false} value={q.lower} placeholder="Default: 0" onChange={(e) => set('lower', e.target.value)} onKeyDown={enter} />
        </div>
        <div>
          <div className="field-label">Upper bound</div>
          <input className="field-input" spellCheck={false} value={q.upper} placeholder="Default: none" onChange={(e) => set('upper', e.target.value)} onKeyDown={enter} />
        </div>
        <div>
          <div className="field-label">Limit</div>
          <input className="field-input" spellCheck={false} value={q.limit} placeholder="Default: 10" onChange={(e) => set('limit', e.target.value)} onKeyDown={enter} />
        </div>
        <div>
          <div className="field-label">Index</div>
          <input className="field-input" spellCheck={false} value={q.index} placeholder="Default: 1 (primary)" onChange={(e) => set('index', e.target.value)} onKeyDown={enter} />
        </div>
        <div>
          <div className="field-label">Key type</div>
          <select className="field-input" value={q.keyType} onChange={(e) => set('keyType', e.target.value)}>
            <option value="">Default</option>
            {KEY_TYPES.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div className="field-label">Reverse</div>
          <label className="field-check">
            <input type="checkbox" checked={q.reverse} onChange={(e) => set('reverse', e.target.checked)} /> Newest first
          </label>
        </div>
      </div>
      <div className="section-head static">
        <span className="grow">Data Table</span>
        {ran && <span className="count">{rows.length} row{rows.length === 1 ? '' : 's'}</span>}
      </div>
      <div className="data-scroll">
        {error && <div className="error-text" style={{ margin: 'var(--sp-3)' }}>{error}</div>}
        {!table && !error && <div className="contract-note">Pick a table to see its rows.</div>}
        {table && loading && rows.length === 0 && <div className="contract-note">Loading...</div>}
        {ran && rows.length === 0 && !error && <div className="contract-note">No rows.</div>}
        {rows.length > 0 && (
          <>
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  {columns.map((c) => (
                    <th key={c.name}>
                      {c.name}
                      {c.type && <span className="htype">{c.type}</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td className="num">{i + 1}</td>
                    {columns.map((c) => {
                      const text = cell((r as Record<string, unknown> | null)?.[c.name])
                      return (
                        <td key={c.name} title={text}>
                          {text}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {more && rows.length < MAX_ROWS && (
              <button className="btn load-more" disabled={loading} onClick={() => void run(table, q, true)}>
                {loading ? 'Loading...' : 'Load More'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
