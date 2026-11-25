// Actions: the actions of the transaction as it was signed, numbered from 1,
// and a sentence for what they caused (which is in Traces).

import type { InspectedTransaction } from '../../../../shared/trace-types'
import { NO_ACTION_TRACE, causedSentence, countKinds, signedActions } from '../../../../shared/trace-view'
import { InputBlock, authText } from './TraceTree'

export function ActionsTab({ t }: { t: InspectedTransaction }): React.JSX.Element {
  if (t.actions.length === 0) return <div className="hint">{NO_ACTION_TRACE}</div>
  const list = signedActions(t.actions)
  const c = countKinds(t.actions)
  const caused = causedSentence(c.inline, c.notifications)
  return (
    <div className="txv-actions">
      {list.map((n, i) => (
        <div key={n.key} className={`txv-action${n.error ? ' failed' : ''}`}>
          <div className="txv-action-head">
            <span className="txv-num">{i + 1}</span>
            <span className="badge-pair">
              <span>{n.account}</span>
              <span>{n.name}</span>
            </span>
            <span className="hint">{authText(n)}</span>
          </div>
          {n.error && <div className="tr-error">{n.error}</div>}
          <InputBlock node={n} label="Data" />
        </div>
      ))}
      {caused && <div className="hint">{caused}</div>}
    </div>
  )
}
