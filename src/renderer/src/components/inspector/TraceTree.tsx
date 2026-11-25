// Traces: every execution of the transaction as a tree. A node's children are
// always visible under it; the twisty opens only the node's own details.

import { useEffect, useRef, useState } from 'react'
import type { InspectedTransaction, TraceNode } from '../../../../shared/trace-types'
import {
  FILTER_PLACEHOLDER,
  HISTORY_CONSOLE,
  NOT_RETURNED,
  PLACED_BY_ORDER,
  PLACED_BY_ORDER_TIP,
  TREE_LINE,
  dataLine,
  fmtRamDelta,
  matchesFilter
} from '../../../../shared/trace-view'
import { IconChevronDown, IconChevronRight } from '../Icons'
import { copyText } from '../../lib/clipboard'
import { errorText, toast } from '../../lib/toast'

export function authText(n: TraceNode): string {
  return n.authorization.map((a) => `${a.actor}@${a.permission}`).join(', ')
}

/** Copies a text and says so. */
export function copyWithToast(text: string, what: string): void {
  copyText(text).then(
    () => toast('Copied', what, 'success'),
    (e) => toast('Not copied', errorText(e), 'error')
  )
}

/** The decoded input as JSON, with the `raw hex` switch. */
export function InputBlock({ node, label = 'Input' }: { node: TraceNode; label?: string }): React.JSX.Element {
  const [hex, setHex] = useState(false)
  return (
    <>
      <div className="tr-label">
        {label}{' '}
        {node.hex && (
          <button type="button" className="btn subtle sm" onClick={() => setHex((h) => !h)}>
            {hex ? 'decoded' : 'raw hex'}
          </button>
        )}
      </div>
      <pre className="c-json">{hex ? node.hex : (node.data ?? `(${NOT_RETURNED}) ${node.hex ?? ''}`)}</pre>
    </>
  )
}

export interface TreeState {
  /** Details opened or closed by the user; a node not in it has its start state. */
  open: Record<string, boolean>
  isOpen: (n: TraceNode) => boolean
  toggle: (n: TraceNode) => void
  filter: string
}

function Details({ node, history }: { node: TraceNode; history: boolean }): React.JSX.Element {
  return (
    <div className="txv-details">
      {node.error && <div className="tr-error">{node.error}</div>}
      <InputBlock node={node} />
      <div className="tr-label">Console</div>
      <pre className="c-json">{history ? HISTORY_CONSOLE : node.console === null ? `(${NOT_RETURNED})` : node.console || '(empty)'}</pre>
      {node.ramDeltas && node.ramDeltas.length > 0 && (
        <>
          <div className="tr-label">RAM changes</div>
          <div className="mono-small">{node.ramDeltas.map((d) => `${d.account} ${fmtRamDelta(d.delta)}`).join(', ')}</div>
        </>
      )}
      {node.returnValue && (
        <>
          <div className="tr-label">Return value (hex)</div>
          <pre className="c-json">{node.returnValue}</pre>
        </>
      )}
      <div className="txv-details-actions">
        <button type="button" className="btn subtle sm" onClick={() => copyWithToast(node.data ?? node.hex ?? '', `${node.account}::${node.name}`)}>
          Copy data
        </button>
      </div>
    </div>
  )
}

function Node({ node, state, history }: { node: TraceNode; state: TreeState; history: boolean }): React.JSX.Element {
  const open = state.isOpen(node)
  const dim = !matchesFilter(node, state.filter)
  return (
    <div className={`txv-node${node.error ? ' failed' : ''}`} data-txv-key={node.key}>
      <div className={`txv-head${dim ? ' txv-dim' : ''}`} onClick={() => state.toggle(node)}>
        <button
          type="button"
          className="txv-twisty"
          aria-expanded={open}
          aria-label={open ? 'Hide details' : 'Show details'}
          onClick={(e) => {
            e.stopPropagation()
            state.toggle(node)
          }}
        >
          {open ? <IconChevronDown /> : <IconChevronRight />}
        </button>
        {node.kind === 'inline' && <span className="badge">inline</span>}
        {node.kind === 'notification' && <span className="badge">notification to {node.receiver}</span>}
        <span className="badge-pair">
          <span>{node.account}</span>
          <span>{node.name}</span>
        </span>
        {node.placed === 'order' && (
          <span className="badge warn" title={PLACED_BY_ORDER_TIP}>
            {PLACED_BY_ORDER}
          </span>
        )}
        <span className="hint">{authText(node)}</span>
        <span className="txv-data">{dataLine(node)}</span>
        {node.elapsedUs !== null && <span className="hint">{node.elapsedUs} µs</span>}
      </div>
      {open && <Details node={node} history={history} />}
      {node.children.length > 0 && (
        <div className="txv-children">
          {node.children.map((c) => (
            <Node key={c.key} node={c} state={state} history={history} />
          ))}
        </div>
      )}
    </div>
  )
}

export function TraceTree({
  t,
  state,
  setFilter,
  setAll,
  reveal,
  onRevealed,
  notes
}: {
  t: InspectedTransaction
  state: TreeState
  setFilter: (v: string) => void
  setAll: (open: boolean) => void
  /** Key of a node to scroll to once shown. */
  reveal: string | null
  onRevealed: () => void
  /** Notes that belong under the tree. */
  notes: string[]
}): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!reveal || !box.current) return
    const el = [...box.current.querySelectorAll<HTMLElement>('[data-txv-key]')].find((e) => e.dataset.txvKey === reveal)
    el?.scrollIntoView({ block: 'center' })
    el?.querySelector<HTMLElement>('.txv-twisty')?.focus()
    onRevealed()
  }, [reveal, onRevealed])
  const history = t.source === 'history'
  return (
    <div className="txv-traces" ref={box}>
      <div className="txv-toolbar">
        <button type="button" className="btn subtle sm" onClick={() => setAll(true)}>
          Expand all
        </button>
        <button type="button" className="btn subtle sm" onClick={() => setAll(false)}>
          Collapse all
        </button>
        <input className="input txv-filter" value={state.filter} onChange={(e) => setFilter(e.target.value)} placeholder={FILTER_PLACEHOLDER} aria-label={FILTER_PLACEHOLDER} />
      </div>
      <div className="hint">{TREE_LINE}</div>
      {t.actions.length === 0 && <div className="hint">No action traces.</div>}
      {t.actions.map((n) => (
        <Node key={n.key} node={n} state={state} history={history} />
      ))}
      {notes.map((n) => (
        <div key={n} className="hint">
          {n}
        </div>
      ))}
    </div>
  )
}
