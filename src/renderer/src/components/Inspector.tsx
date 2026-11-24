// Transaction inspector: header, deepest error first, and the action tree with
// decoded input, console output, RAM changes and return values. Missing data
// is labelled, never guessed.

import { useState } from 'react'
import type { InspectedTransaction, ResourceKind, ResourceProblem, TraceNode } from '../../../shared/trace-types'
import { Modal } from './Modal'
import { IconChevronDown, IconChevronRight } from './Icons'
import { ReadMore } from './HelpButton'

const NOT_RETURNED = 'not returned by this endpoint'

function Node({ node, depth }: { node: TraceNode; depth: number }): React.JSX.Element {
  const [open, setOpen] = useState(depth < 2)
  const [hex, setHex] = useState(false)
  return (
    <div className={`tr-node${node.error ? ' failed' : ''}`} style={{ marginLeft: depth ? 'var(--icon)' : 0 }}>
      <div className="tr-head" onClick={() => setOpen((o) => !o)}>
        <span className="tr-twisty">{open ? <IconChevronDown /> : <IconChevronRight />}</span>
        <span className="badge-pair">
          <span>{node.account}</span>
          <span>{node.name}</span>
        </span>
        {node.notification ? (
          <span className="badge">notification to {node.receiver}</span>
        ) : (
          <span className="hint" style={{ margin: 0 }}>
            receiver {node.receiver}
          </span>
        )}
        <span className="hint" style={{ margin: 0 }}>
          {node.authorization.map((a) => `${a.actor}@${a.permission}`).join(', ')}
        </span>
        {node.elapsedUs !== null && <span className="hint" style={{ margin: 0 }}>{node.elapsedUs} µs</span>}
      </div>
      {open && (
        <div className="tr-body">
          {node.error && <div className="tr-error">{node.error}</div>}
          <div className="tr-label">
            Input{' '}
            {node.hex && (
              <button className="btn subtle sm" onClick={() => setHex((h) => !h)}>
                {hex ? 'decoded' : 'raw hex'}
              </button>
            )}
          </div>
          <pre className="c-json">{hex ? node.hex : (node.data ?? `(${NOT_RETURNED}) ${node.hex ?? ''}`)}</pre>
          <div className="tr-label">Console</div>
          <pre className="c-json">{node.console === null ? `(${NOT_RETURNED})` : node.console || '(empty)'}</pre>
          {node.ramDeltas && node.ramDeltas.length > 0 && (
            <>
              <div className="tr-label">RAM changes</div>
              <div className="mono-small">{node.ramDeltas.map((d) => `${d.account} ${d.delta > 0 ? '+' : ''}${d.delta} bytes`).join(', ')}</div>
            </>
          )}
          {node.returnValue && (
            <>
              <div className="tr-label">Return value (hex)</div>
              <pre className="c-json">{node.returnValue}</pre>
            </>
          )}
          {node.children.map((c) => (
            <Node key={c.ordinal} node={c} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

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

export function InspectorBody({ t }: { t: InspectedTransaction }): React.JSX.Element {
  const [stack, setStack] = useState(false)
  return (
    <div className="inspector">
      {t.source === 'simulation' && <div className="sim-banner">Simulation - nothing was sent to the chain. Signatures are not checked and the result reflects the current state of {t.endpoint}.</div>}
      <div className="tr-grid">
        <span>Transaction</span>
        <span className="mono-small">{t.id || '-'}</span>
        <span>Status</span>
        <span className={t.status === 'failed' ? 'sev-error' : 'sev-ok'}>{t.status}</span>
        <span>Network</span>
        <span>
          {t.network} · {t.endpoint}
        </span>
        <span>Block / time</span>
        <span>{t.block ?? `(${NOT_RETURNED})`} {t.time ? `· ${t.time}` : ''}</span>
        <span>CPU / NET</span>
        <span>
          {t.cpuUs !== null ? `${t.cpuUs} µs` : `(${NOT_RETURNED})`} / {t.netBytes !== null ? `${t.netBytes} bytes` : `(${NOT_RETURNED})`}
        </span>
      </div>
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
      <div className="tr-label" style={{ marginTop: 'var(--sp-3)' }}>
        Actions
      </div>
      {t.actions.length === 0 && <div className="hint">No action traces.</div>}
      {t.actions.map((n) => (
        <Node key={n.ordinal} node={n} depth={0} />
      ))}
      {t.notes.map((n) => (
        <div key={n} className="hint">
          {n}
        </div>
      ))}
    </div>
  )
}

export function InspectorDialog({ t, onClose }: { t: InspectedTransaction; onClose: () => void }): React.JSX.Element {
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
      <InspectorBody t={t} />
    </Modal>
  )
}
