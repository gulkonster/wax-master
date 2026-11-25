// RAM Deltas: the totals per account, then every single change with the trace
// it happened in; a click on the trace shows that node in Traces.

import type { InspectedTransaction } from '../../../../shared/trace-types'
import { fmtRamDelta, ramChanges, ramEmptyText, ramTotals, traceLabel } from '../../../../shared/trace-view'

function deltaClass(delta: number): string {
  return delta > 0 ? 'txv-ram-more' : delta < 0 ? 'txv-ram-freed' : ''
}

export function RamDeltasTab({ t, onShowTrace, notes }: { t: InspectedTransaction; onShowTrace: (key: string) => void; notes: string[] }): React.JSX.Element {
  const changes = ramChanges(t.actions)
  const totals = ramTotals(t.actions)
  return (
    <div className="txv-ram">
      {changes.length === 0 ? (
        <div className="hint">{ramEmptyText(t)}</div>
      ) : (
        <>
          <div className="tr-label">Totals</div>
          <div className="txv-ram-grid">
            {totals.map((r) => (
              <div key={r.account} className="txv-ram-row">
                <span className="mono-small">{r.account}</span>
                <span className={`mono-small ${deltaClass(r.delta)}`}>{fmtRamDelta(r.delta)}</span>
              </div>
            ))}
          </div>
          <div className="tr-label">Changes</div>
          <div className="txv-ram-grid three">
            {changes.map((c, i) => (
              <div key={`${c.node.key}-${c.account}-${i}`} className="txv-ram-row">
                <span className="mono-small">{c.account}</span>
                <span className={`mono-small ${deltaClass(c.delta)}`}>{fmtRamDelta(c.delta)}</span>
                <button type="button" className="txv-link" onClick={() => onShowTrace(c.node.key)}>
                  {traceLabel(c.node)}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      {notes.map((n) => (
        <div key={n} className="hint">
          {n}
        </div>
      ))}
    </div>
  )
}
