// Left half of the Contract page: action picker, typed parameter form,
// Authorization, Ricardian text and Result. Everything from the chain is shown as text.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { InspectedTransaction } from '../../../shared/trace-types'
import { emit } from '../lib/bus'
import type { AuthLevel, ContractAbiView, ContractAction, ContractField, ContractHistoryEntry, NetworkInfo, PackResult } from '../../../shared/chain-types'
import { errorText, toast } from '../lib/toast'
import { copyText } from '../lib/clipboard'
import { IconChevronDown, IconChevronRight, IconClock, IconCopy, IconHeart, IconPlay, IconClose } from './Icons'

// ---------------------------------------------------------------- shared dropdown

export function PickMenu(props: {
  button: React.ReactNode
  className?: string
  title?: string
  disabled?: boolean
  align?: 'left' | 'right'
  children: (close: () => void) => React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', h)
    return () => window.removeEventListener('mousedown', h)
  }, [open])
  return (
    <div className="pick" ref={ref}>
      <button className={props.className ?? 'icon-btn'} title={props.title} disabled={props.disabled} onClick={() => setOpen((o) => !o)}>
        {props.button}
      </button>
      {open && <div className={`dropdown${props.align === 'right' ? ' right' : ''}`}>{props.children(() => setOpen(false))}</div>}
    </div>
  )
}

/** Heart and clock menus shared by the action and table panes. */
export function SavedMenus(props: {
  kind: 'action' | 'query'
  favorites: ContractHistoryEntry[]
  history: ContractHistoryEntry[]
  canSave: boolean
  describe: (e: ContractHistoryEntry) => string
  onSave: () => void
  onPick: (e: ContractHistoryEntry) => void
  onRemove: (list: 'favorite' | 'history', id: string) => void
}): React.JSX.Element {
  const noun = props.kind === 'action' ? 'action' : 'query'
  const list = (items: ContractHistoryEntry[], which: 'favorite' | 'history', close: () => void): React.ReactNode =>
    items.map((e) => (
      <div
        key={e.id}
        className="dd-item"
        title={props.describe(e)}
        onClick={() => {
          close()
          props.onPick(e)
        }}
      >
        <span className="mono">{e.name}</span>
        <span className="hint" style={{ margin: 0, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {props.describe(e)}
        </span>
        <span
          className="dd-x"
          title="Remove"
          onClick={(ev) => {
            ev.stopPropagation()
            props.onRemove(which, e.id)
          }}
        >
          <IconClose size={12} />
        </span>
      </div>
    ))
  return (
    <>
      <PickMenu
        button={<IconHeart filled={props.favorites.length > 0} />}
        title={`Favorite ${noun}s`}
        align="right"
      >
        {(close) => (
          <>
            <div
              className={`dd-item${props.canSave ? '' : ' disabled'}`}
              onClick={() => {
                if (!props.canSave) return
                props.onSave()
                close()
              }}
            >
              <IconHeart /> Save current {noun} as favorite
            </div>
            <div className="dd-section">FAVORITES</div>
            {props.favorites.length === 0 && <div className="dd-note">No favorites yet</div>}
            {list(props.favorites, 'favorite', close)}
          </>
        )}
      </PickMenu>
      <PickMenu button={<IconClock />} title={`${noun[0].toUpperCase()}${noun.slice(1)} history`} align="right">
        {(close) => (
          <>
            <div className="dd-section" style={{ borderTop: 'none', marginTop: 0 }}>
              HISTORY
            </div>
            {props.history.length === 0 && <div className="dd-note">Nothing yet</div>}
            {list(props.history, 'history', close)}
          </>
        )}
      </PickMenu>
    </>
  )
}

function Section(props: {
  title: string
  badge?: React.ReactNode
  defaultOpen?: boolean
  right?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(props.defaultOpen ?? false)
  return (
    <>
      <div className="section-head" onClick={() => setOpen((o) => !o)}>
        {open ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
        <span className="grow">{props.title}</span>
        {props.right}
        {props.badge}
      </div>
      {open && <div className="section-body">{props.children}</div>}
    </>
  )
}

// ---------------------------------------------------------------- field types

type FieldKind = 'bool' | 'int' | 'float' | 'text' | 'json'

const SMALL_INT = /^(u?int(8|16|32)|varu?int32)$/
const TEXT_TYPES = new Set([
  'int64', 'uint64', 'int128', 'uint128', 'float128', 'string', 'name', 'asset', 'symbol', 'symbol_code',
  'time_point', 'time_point_sec', 'block_timestamp_type', 'public_key', 'signature', 'checksum160', 'checksum256',
  'checksum512', 'bytes'
])

export function fieldKind(resolved: string): FieldKind {
  if (resolved === 'bool') return 'bool'
  if (SMALL_INT.test(resolved)) return 'int'
  if (resolved === 'float32' || resolved === 'float64') return 'float'
  if (TEXT_TYPES.has(resolved)) return 'text'
  return 'json'
}

function placeholderFor(f: ContractField, net: NetworkInfo): string {
  if (f.resolved === 'asset') return `1${net.precision > 0 ? '.' + '0'.repeat(net.precision) : ''} ${net.symbol}`
  if (f.resolved === 'time_point' || f.resolved === 'time_point_sec') return `${f.type}  e.g. 2026-01-01T00:00:00`
  return f.type
}

type FieldValues = Record<string, string | boolean>

/** Builds the JSON value of the form. Throws an Error that names the field. */
export function buildData(fields: ContractField[], values: FieldValues): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) {
    const kind = fieldKind(f.resolved)
    const v = values[f.name]
    if (kind === 'bool') {
      out[f.name] = v === true
    } else if (kind === 'json') {
      const t = typeof v === 'string' ? v.trim() : ''
      if (t === '') {
        if (f.resolved.endsWith('?')) out[f.name] = null
        else if (f.resolved.endsWith('[]')) out[f.name] = []
        // binary extensions and other empty values are left out; the packer reports what is missing
      } else {
        try {
          out[f.name] = JSON.parse(t)
        } catch {
          throw new Error(`${f.name}: not valid JSON`)
        }
      }
    } else {
      const t = typeof v === 'string' ? v : ''
      if (kind === 'int' && /^-?\d+$/.test(t.trim()) && Number.isSafeInteger(Number(t))) out[f.name] = Number(t)
      else if (kind === 'float' && t.trim() !== '' && Number.isFinite(Number(t))) out[f.name] = Number(t)
      else out[f.name] = t
    }
  }
  return out
}

function toFieldState(f: ContractField, v: unknown): string | boolean {
  const kind = fieldKind(f.resolved)
  if (kind === 'bool') return v === true || v === 1 || v === 'true'
  if (v === undefined || v === null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}

function valuesFromData(fields: ContractField[], data: unknown): FieldValues {
  const o = typeof data === 'object' && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : {}
  const out: FieldValues = {}
  for (const f of fields) out[f.name] = toFieldState(f, o[f.name])
  return out
}

const LEVEL = /^([a-z1-5.]{1,12}[a-j1-5]?)@([a-z1-5.]{1,12}[a-j1-5]?)$/

function parseAuth(text: string): { levels: AuthLevel[]; error: string } {
  const parts = text.split(/[\s,]+/).filter(Boolean)
  const levels: AuthLevel[] = []
  for (const p of parts) {
    const m = LEVEL.exec(p)
    if (!m) return { levels: [], error: `Authorization: "${p}" is not account@permission` }
    levels.push({ actor: m[1], permission: m[2] })
  }
  return { levels, error: '' }
}

function preview(e: ContractHistoryEntry): string {
  const d = e.payload.data
  let t = ''
  try {
    t = JSON.stringify(d)
  } catch {
    t = ''
  }
  return t.length > 120 ? t.slice(0, 120) + '…' : t
}

// ---------------------------------------------------------------- component

export function ActionForm({ account, view, network }: { account: string; view: ContractAbiView; network: NetworkInfo }): React.JSX.Element {
  const [actionName, setActionName] = useState(view.actions[0]?.name ?? '')
  const action: ContractAction | undefined = view.actions.find((a) => a.name === actionName)
  const [values, setValues] = useState<FieldValues>({})
  const [raw, setRaw] = useState(false)
  const [rawText, setRawText] = useState('{}')
  const [command, setCommand] = useState(false)
  const [authText, setAuthText] = useState(`${account}@active`)
  const [pack, setPack] = useState<PackResult | null>(null)
  const [error, setError] = useState('')
  // Field errors show once a field was edited or Run / Simulate / Command was pressed.
  const [touched, setTouched] = useState(false)
  const [favorites, setFavorites] = useState<ContractHistoryEntry[]>([])
  const [history, setHistory] = useState<ContractHistoryEntry[]>([])
  const seq = useRef(0)
  const [simSupport, setSimSupport] = useState<'available' | 'unsupported' | 'unknown' | null>(null)
  useEffect(() => {
    let live = true
    setSimSupport(null)
    window.wax.tx.simulationSupport().then((r) => live && setSimSupport(r), () => live && setSimSupport('unknown'))
    return () => {
      live = false
    }
  }, [account, network.id])

  const fields = action?.fields ?? []

  const reloadSaved = useCallback(async () => {
    try {
      setFavorites(await window.wax.contract.historyList(account, 'action', 'favorite'))
      setHistory(await window.wax.contract.historyList(account, 'action', 'history'))
    } catch {
      // the lists are a convenience
    }
  }, [account])
  useEffect(() => void reloadSaved(), [reloadSaved])

  // The data object the form currently describes (or an error text).
  const current = (): { data: Record<string, unknown> | null; error: string } => {
    if (raw) {
      try {
        const d = JSON.parse(rawText) as unknown
        if (typeof d !== 'object' || d === null || Array.isArray(d)) return { data: null, error: 'Raw JSON: expected an object' }
        return { data: d as Record<string, unknown>, error: '' }
      } catch {
        return { data: null, error: 'Raw JSON: not valid JSON' }
      }
    }
    try {
      return { data: buildData(fields, values), error: '' }
    } catch (e) {
      return { data: null, error: errorText(e) }
    }
  }

  // Live validation: pack through the main process (debounced).
  useEffect(() => {
    if (!action) return
    const my = ++seq.current
    const timer = setTimeout(async () => {
      const cur = current()
      const auth = parseAuth(authText)
      if (!cur.data) {
        setPack(null)
        setError(cur.error)
        return
      }
      if (auth.error) {
        setPack(null)
        setError(auth.error)
        return
      }
      try {
        const r = await window.wax.contract.pack(account, action.name, cur.data, auth.levels)
        if (my !== seq.current) return
        setPack(r)
        setError('')
      } catch (e) {
        if (my !== seq.current) return
        setPack(null)
        setError(errorText(e))
      }
    }, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, action, values, raw, rawText, authText])

  /** Records the current valid action in the history list. */
  const commitHistory = async (): Promise<void> => {
    if (!action || !pack) return
    const cur = current()
    if (!cur.data) return
    try {
      setHistory(await window.wax.contract.historyAdd(account, 'action', 'history', action.name, { data: cur.data, authorization: parseAuth(authText).levels }))
    } catch {
      // ignore
    }
  }

  const pickAction = (name: string): void => {
    void commitHistory()
    setTouched(false)
    setActionName(name)
    setValues({})
    setRaw(false)
    setRawText('{}')
  }

  const loadEntry = (e: ContractHistoryEntry): void => {
    const a = view.actions.find((x) => x.name === e.name)
    if (!a) {
      toast('Action not found', `${e.name} is not in the ABI of ${account} any more.`, 'error')
      return
    }
    setTouched(true)
    setActionName(a.name)
    setValues(valuesFromData(a.fields, e.payload.data))
    setRaw(false)
    const auth = Array.isArray(e.payload.authorization) ? (e.payload.authorization as AuthLevel[]) : []
    if (auth.length) setAuthText(auth.map((l) => `${l.actor}@${l.permission}`).join(', '))
  }

  const saveFavorite = async (): Promise<void> => {
    const cur = current()
    if (!action || !cur.data) return
    try {
      setFavorites(await window.wax.contract.historyAdd(account, 'action', 'favorite', action.name, { data: cur.data, authorization: parseAuth(authText).levels }))
      toast('Favorite saved', `${action.name} on ${account}`, 'success')
    } catch (e) {
      toast('Could not save the favorite', errorText(e), 'error')
    }
  }

  const toggleRaw = (): void => {
    setTouched(true)
    if (!raw) {
      const cur = (() => {
        try {
          return buildData(fields, values)
        } catch {
          return {}
        }
      })()
      setRawText(JSON.stringify(cur, null, 2))
      setRaw(true)
    } else {
      try {
        setValues(valuesFromData(fields, JSON.parse(rawText)))
      } catch {
        // keep the old form values when the text is not valid
      }
      setRaw(false)
    }
  }

  const copy = async (text: string): Promise<void> => {
    try {
      await copyText(text)
      toast('Copied', '', 'success')
      void commitHistory()
    } catch (e) {
      toast('Copy failed', errorText(e), 'error')
    }
  }

  const [result, setResult] = useState<InspectedTransaction | null>(null)
  const [resultNote, setResultNote] = useState('')
  const [running, setRunning] = useState<null | 'run' | 'simulate'>(null)

  const txActions = (): { account: string; name: string; authorization: AuthLevel[]; data: unknown }[] | null => {
    setTouched(true)
    const cur = current()
    const auth = parseAuth(authText)
    if (!action || !cur.data || auth.error || auth.levels.length === 0) {
      toast('Check the form', cur.error || auth.error || 'Authorization is required', 'error')
      return null
    }
    return [{ account, name: action.name, authorization: auth.levels, data: cur.data }]
  }

  const run = async (): Promise<void> => {
    const acts = txActions()
    if (!acts) return
    setRunning('run')
    setResultNote('')
    try {
      void commitHistory()
      const r = await window.wax.tx.run(acts)
      if (r.status === 'sent') {
        setResult(r.trace)
        setResultNote('')
        emit('output-line', `Transaction ${r.trace.id} sent to ${r.trace.endpoint}
`)
      } else if (r.status === 'failed') {
        setResult(r.trace)
        setResultNote(r.error)
      } else setResultNote('Cancelled; nothing was signed.')
    } catch (e) {
      setResultNote(errorText(e))
      setResult(null)
    } finally {
      setRunning(null)
    }
  }

  const sim = async (): Promise<void> => {
    const acts = txActions()
    if (!acts) return
    setRunning('simulate')
    setResultNote('')
    try {
      setResult(await window.wax.tx.simulate(acts))
    } catch (e) {
      setResultNote(errorText(e))
      setResult(null)
    } finally {
      setRunning(null)
    }
  }

  const authBadge = parseAuth(authText).levels.map((l) => `${l.actor}@${l.permission}`).join(', ')

  return (
    <div className="contract-left">
      <div className="pane-bar">
        <PickMenu
          className="pick-btn"
          disabled={view.actions.length === 0}
          button={
            <>
              <span style={{ fontStyle: 'italic' }}>f(x)</span> {actionName || '(no actions)'} <IconChevronDown />
            </>
          }
        >
          {(close) =>
            view.actions.map((a) => (
              <div
                key={a.name}
                className={`dd-item mono${a.name === actionName ? ' selected' : ''}`}
                onClick={() => {
                  close()
                  pickAction(a.name)
                }}
              >
                {a.name}
              </div>
            ))
          }
        </PickMenu>
        <button className="icon-btn" style={{ height: 34, width: 40 }} disabled={!action || !!running} title="Run (sign and send after confirmation)" onClick={() => void run()}>
          <IconPlay />
        </button>
        <button
          className="btn ghost"
          style={{ borderRadius: 0 }}
          disabled={!action || !!running || simSupport === 'unsupported'}
          title={
            simSupport === 'unsupported'
              ? 'This endpoint does not offer simulation'
              : simSupport === 'unknown'
                ? 'Simulate without sending (unsigned). Not verified for this endpoint.'
                : 'Simulate without sending (unsigned)'
          }
          onClick={() => void sim()}>
          {running === 'simulate' ? 'Simulating...' : 'Simulate'}
        </button>
        <div className="spacer" />
        <SavedMenus
          kind="action"
          favorites={favorites}
          history={history}
          canSave={!!pack}
          describe={preview}
          onSave={() => void saveFavorite()}
          onPick={loadEntry}
          onRemove={(list, id) => void window.wax.contract.historyRemove(account, 'action', list, id).then(list === 'favorite' ? setFavorites : setHistory)}
        />
      </div>
      <div className="left-scroll">
        {!action ? (
          <div className="contract-note">This contract has no actions in its ABI.</div>
        ) : (
          <>
            <Section
              title="Parameters"
              defaultOpen
              right={
                <>
                  <label className="pill" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={raw} onChange={toggleRaw} /> Raw JSON
                  </label>
                  <button
                    className={`pill${command ? ' on' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      setTouched(true)
                      setCommand((c) => !c)
                    }}
                  >
                    Command
                  </button>
                </>
              }
            >
              {command ? (
                <>
                  {(
                    [
                      ['JSON', pack?.json],
                      ['PACKED HEX', pack?.hex],
                      ['CLEOS', pack?.cleos]
                    ] as const
                  ).map(([label, text]) => (
                    <div key={label}>
                      <div className="field-label">{label}</div>
                      <div className="cmd-block">
                        <pre>{text ?? '(fix the parameters first)'}</pre>
                        <button className="icon-btn" title="Copy" disabled={!text} onClick={() => text && void copy(text)}>
                          <IconCopy />
                        </button>
                      </div>
                    </div>
                  ))}
                </>
              ) : raw ? (
                <>
                  <div className="field-label">
                    {action.name} <span className="ftype">{action.type}</span>
                  </div>
                  <textarea
                    className="field-input"
                    style={{ minHeight: 140 }}
                    spellCheck={false}
                    value={rawText}
                    onChange={(e) => {
                      setTouched(true)
                      setRawText(e.target.value)
                    }}
                  />
                </>
              ) : fields.length === 0 ? (
                <div className="hint">This action has no parameters.</div>
              ) : (
                fields.map((f) => (
                  <FieldInput
                    key={f.name}
                    field={f}
                    net={network}
                    value={values[f.name]}
                    onChange={(v) => {
                      setTouched(true)
                      setValues((s) => ({ ...s, [f.name]: v }))
                    }}
                  />
                ))
              )}
              {error && touched ? <div className="error-text" style={{ marginTop: 10, userSelect: 'text' }}>{error}</div> : pack && !error && <div className="hint">Valid: {pack.hex.length / 2} bytes packed.</div>}
            </Section>
            <Section title="Authorization" badge={<span className="badge purple">{authBadge || 'none'}</span>}>
              <div className="field-label">account@permission</div>
              <input
                className="field-input"
                spellCheck={false}
                value={authText}
                placeholder={`${account}@active`}
                onChange={(e) => {
                  setTouched(true)
                  setAuthText(e.target.value)
                }}
              />
              <div className="hint">Separate several with commas. Nothing is signed from this page yet.</div>
            </Section>
            <Section title="Ricardian">
              <div className="ricardian">{action.ricardian || '(none)'}</div>
            </Section>
            <Section title="Result" defaultOpen>
              {simSupport === 'unknown' && <div className="hint">Simulate: not verified for this endpoint.</div>}
              {simSupport === 'unsupported' && <div className="hint">Simulate: this endpoint does not offer it.</div>}
              {running === 'run' && <div>Waiting for the confirmation window...</div>}
              {resultNote && <div className="error-text">{resultNote}</div>}
              {!result && !resultNote && !running && <div>(None)</div>}
              {result && (
                <div className="mono-small">
                  {result.source === 'simulation' ? 'Simulation' : 'Transaction'} {result.id.slice(0, 16)}… · {result.status}
                  {result.block ? ` · block ${result.block}` : ''}
                  {result.cpuUs !== null ? ` · CPU ${result.cpuUs} µs` : ''}
                  {result.errorMessage && <div className="error-text">{result.errorMessage}</div>}
                  <div>
                    <button className="btn" style={{ marginTop: 6 }} onClick={() => emit('show-inspector', result)}>
                      Open in inspector
                    </button>
                  </div>
                </div>
              )}
            </Section>
          </>
        )}
      </div>
    </div>
  )
}

function FieldInput(props: { field: ContractField; net: NetworkInfo; value: string | boolean | undefined; onChange: (v: string | boolean) => void }): React.JSX.Element {
  const { field: f, net } = props
  const kind = fieldKind(f.resolved)
  const typeLabel = f.resolved === f.type ? f.type : `${f.type} (${f.resolved})`
  return (
    <div>
      <div className="field-label">
        {f.name} <span className="ftype">{typeLabel}</span>
      </div>
      {kind === 'bool' ? (
        <label className="field-check">
          <input type="checkbox" checked={props.value === true} onChange={(e) => props.onChange(e.target.checked)} /> {props.value === true ? 'true' : 'false'}
        </label>
      ) : kind === 'json' ? (
        <textarea
          className="field-input"
          spellCheck={false}
          placeholder={f.type}
          value={typeof props.value === 'string' ? props.value : ''}
          onChange={(e) => props.onChange(e.target.value)}
        />
      ) : (
        <input
          className="field-input"
          spellCheck={false}
          placeholder={placeholderFor(f, net)}
          value={typeof props.value === 'string' ? props.value : ''}
          onChange={(e) => props.onChange(e.target.value)}
        />
      )}
    </div>
  )
}
