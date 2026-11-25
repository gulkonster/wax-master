// Transaction view: the head, the deepest error first, then four parts
// (Actions, Traces, RAM Deltas, Raw). Missing data is labelled, never guessed.

import { useCallback, useId, useMemo, useState } from 'react'
import { errorText, toast } from '../lib/toast'
import type { InspectedTransaction, ResourceKind, ResourceProblem, TraceNode } from '../../../shared/trace-types'
import { NOT_RETURNED, TAB_ORDER, detailsOpenAtStart, finalityText, flatten, nextTab, sourceLine, splitNotes, tabLabel, type TabId } from '../../../shared/trace-view'
import { Modal } from './Modal'
import { ReadMore } from './HelpButton'
import { fmtTime } from '../lib/time'
import { TraceTree, copyWithToast, type TreeState } from './inspector/TraceTree'
import { ActionsTab } from './inspector/ActionsTab'
import { RamDeltasTab } from './inspector/RamDeltasTab'
import { RawTab } from './inspector/RawTab'
import '../styles-inspector.css'

/** The chosen tab, remembered while the window is open. */
let lastTab: TabId = 'traces'

function fmtUs(us: number): string {
  if (us < 0) return 'unlimited'
  return us >= 1000 ? `${(us / 1000).toFixed(2)} ms` : `${us} µs`
}
function fmtBytes(b: number): string {
  if (b < 0) return 'unlimited'
  if (b >= 1024 * 1024) return `${(b / 1024 / 1024).toFixed(2)} MB`
  if (b >= 1024) return `${(b / 1024).toFixed(2)} KB`
  return `${b} bytes`
}

/** CPU / NET / RAM of the first authorizer after a resource refusal. */
function ResourceState({ r, endpoint }: { r: ResourceProblem; endpoint: string }): React.JSX.Element {
  const st = r.state
  const mark = (k: ResourceKind): React.CSSProperties => (k === r.kind ? { color: 'var(--red-text)', fontWeight: 600 } : {})
  return (
    <div style={{ margin: 'var(--sp-2) 0' }}>
      <div className="tr-label">
        Resources of {r.account || '(unknown account)'} now, from {endpoint}
      </div>
      {!st ? (
        <div className="hint">The account's resources could not be read.</div>
      ) : (
        <div className="tr-grid">
          <span style={mark('cpu')}>CPU</span>
          <span>{st.cpu ? `${fmtUs(st.cpu.used)} used · ${fmtUs(st.cpu.available)} available · ${fmtUs(st.cpu.max)} max` : `(${NOT_RETURNED})`}</span>
          <span style={mark('net')}>NET</span>
          <span>{st.net ? `${fmtBytes(st.net.used)} used · ${fmtBytes(st.net.available)} available · ${fmtBytes(st.net.max)} max` : `(${NOT_RETURNED})`}</span>
          <span style={mark('ram')}>RAM</span>
          <span>{st.ram ? `${fmtBytes(st.ram.used)} used of ${fmtBytes(st.ram.quota)} · ${st.ram.quota < 0 ? 'unlimited' : `${fmtBytes(Math.max(0, st.ram.quota - st.ram.used))} available`}` : `(${NOT_RETURNED})`}</span>
        </div>
      )}
      <div className="hint">
        Node error: {r.errorName} <ReadMore place="resourceRefusal" />
      </div>
    </div>
  )
}

export function InspectorBody({ t, onShow }: { t: InspectedTransaction; onShow?: (t: InspectedTransaction) => void }): React.JSX.Element {
  const [reading, setReading] = useState(false)
  const uid = useId()
  const [stack, setStack] = useState(false)
  const [tab, setTabState] = useState<TabId>(lastTab)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [filter, setFilter] = useState('')
  const [reveal, setReveal] = useState<string | null>(null)
  const notes = useMemo(() => splitNotes(t.notes), [t.notes])
  const all = useMemo(() => flatten(t.actions), [t.actions])
  const setTab = (v: TabId): void => {
    lastTab = v
    setTabState(v)
  }
  const tree: TreeState = {
    open,
    filter,
    isOpen: (n: TraceNode) => open[n.key] ?? detailsOpenAtStart(n),
    toggle: (n: TraceNode) => setOpen((o) => ({ ...o, [n.key]: !(o[n.key] ?? detailsOpenAtStart(n)) }))
  }
  const setAll = (v: boolean): void => setOpen(Object.fromEntries(all.map((n) => [n.key, v])))
  const showTrace = (key: string): void => {
    setOpen((o) => ({ ...o, [key]: true }))
    setTab('traces')
    setReveal(key)
  }
  const revealed = useCallback(() => setReveal(null), [])
  const onTabKey = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const next = nextTab(tab, e.key)
    setTab(next)
    e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[TAB_ORDER.indexOf(next)]?.focus()
  }
  const source = sourceLine(t, fmtTime)
  // The two buttons of the source line: the other copy of the same transaction.
  const other = onShow && t.id ? (t.source === 'kept' && t.hasHistory ? 'history' : t.source === 'history' && t.hasKept ? 'kept' : null) : null
  const switchSource = async (from: 'kept' | 'history'): Promise<void> => {
    setReading(true)
    try {
      onShow?.(await window.wax.tx.open(t.id, from))
    } catch (e) {
      toast('Could not open the transaction', errorText(e), 'error')
    } finally {
      setReading(false)
    }
  }
  return (
    <div className="inspector">
      {t.source === 'simulation' && <div className="sim-banner">Simulation - nothing was sent to the chain. Signatures are not checked and the result reflects the current state of {t.endpoint}.</div>}
      <div className="tr-grid">
        <span>Transaction</span>
        <span className="txv-id">
          <span className="mono-small">{t.id || '-'}</span>
          {t.id && (
            <button type="button" className="btn subtle sm" onClick={() => copyWithToast(t.id, t.id)}>
              Copy
            </button>
          )}
        </span>
        <span>Status</span>
        <span className={t.status === 'failed' ? 'sev-error' : 'sev-ok'}>{t.status}</span>
        <span>Network</span>
        <span>
          {t.network} · {t.endpoint}
        </span>
        <span>Block / time</span>
        <span title={t.time ? `${t.time} UTC` : undefined}>
          {t.block ?? `(${NOT_RETURNED})`} {t.time ? `· ${fmtTime(t.time)}` : ''}
        </span>
        <span>CPU / NET</span>
        <span>
          {t.cpuUs !== null ? `${t.cpuUs} µs` : `(${NOT_RETURNED})`} / {t.netBytes !== null ? `${t.netBytes} bytes` : `(${NOT_RETURNED})`}
        </span>
        {t.source === 'history' && (
          <>
            <span>Finality</span>
            <span>{finalityText(t.finality)}</span>
          </>
        )}
      </div>
      {source && (
        <div className="hint txv-source">
          {source}
          {other && (
            <button type="button" className="btn subtle sm txv-source-switch" disabled={reading} aria-busy={reading} onClick={() => void switchSource(other)}>
              {other === 'history' ? 'Read from the history service' : "Show the node's answer"}
            </button>
          )}
        </div>
      )}
      {t.errorMessage && (
        <div className="tr-big-error">
          {t.errorMessage} {!t.resource && <ReadMore place="txRefusal" />}
        </div>
      )}
      {t.resource && <ResourceState r={t.resource} endpoint={t.endpoint} />}
      {t.errorStack && (
        <>
          <button className="btn subtle" onClick={() => setStack((v) => !v)}>
            {stack ? 'Hide' : 'Show'} full error
          </button>
          {stack && <pre className="c-json">{t.errorStack}</pre>}
        </>
      )}
      <div className="txv-tabs" role="tablist" aria-label="Transaction parts" onKeyDown={onTabKey}>
        {TAB_ORDER.map((id) => (
          <button
            key={id}
            id={`${uid}-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls={`${uid}-panel`}
            tabIndex={tab === id ? 0 : -1}
            className={`txv-tab${tab === id ? ' active' : ''}`}
            onClick={() => setTab(id)}
          >
            {tabLabel(id, t)}
          </button>
        ))}
      </div>
      <div className="txv-panel" id={`${uid}-panel`} role="tabpanel" aria-labelledby={`${uid}-tab-${tab}`}>
        {tab === 'actions' && <ActionsTab t={t} />}
        {tab === 'traces' && <TraceTree t={t} state={tree} setFilter={setFilter} setAll={setAll} reveal={reveal} onRevealed={revealed} notes={notes.tree} />}
        {tab === 'ram' && <RamDeltasTab t={t} onShowTrace={showTrace} notes={notes.ram} />}
        {tab === 'raw' && <RawTab t={t} />}
      </div>
      {notes.general.map((n) => (
        <div key={n} className="hint">
          {n}
        </div>
      ))}
    </div>
  )
}

export function InspectorDialog({ t, onClose, onReplace }: { t: InspectedTransaction; onClose: () => void; onReplace?: (t: InspectedTransaction) => void }): React.JSX.Element {
  return (
    <Modal
      size="l"
      name="transaction"
      help="inspector"
      title={t.source === 'simulation' ? 'Simulation result' : 'Transaction'}
      onClose={onClose}
      footer={
        <button className="btn" onClick={onClose}>
          Close
        </button>
      }
    >
      <InspectorBody t={t} onShow={onReplace} />
    </Modal>
  )
}
