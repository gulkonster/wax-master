// Raw: the answers as they were received, each in its own block with a title
// and a Copy button.

import type { InspectedTransaction } from '../../../../shared/trace-types'
import { NOT_RETURNED, RAW_CUT_LINE, rawShown } from '../../../../shared/trace-view'
import { copyWithToast } from './TraceTree'

export function RawTab({ t }: { t: InspectedTransaction }): React.JSX.Element {
  if (t.raw.length === 0) return <div className="hint">({NOT_RETURNED})</div>
  return (
    <div className="txv-raw">
      {t.raw.map((r, i) => {
        const shown = rawShown(r.text)
        return (
          <div key={`${r.title}-${i}`} className="txv-raw-block">
            <div className="tr-label">
              {r.title}
              <button type="button" className="btn subtle sm" onClick={() => copyWithToast(shown.text, r.title)}>
                Copy
              </button>
            </div>
            {shown.cut && <div className="hint">{RAW_CUT_LINE}</div>}
            <pre className="c-json">{shown.text}</pre>
          </div>
        )
      })}
    </div>
  )
}
