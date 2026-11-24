import { useRef, useState } from 'react'
import { useApp, type PanelTab } from '../state'
import { IconClose } from './Icons'

const TABS: { id: PanelTab; label: string }[] = [
  { id: 'terminal', label: 'Terminal' },
  { id: 'output', label: 'Output' },
  { id: 'problems', label: 'Problems' }
]

export function BottomPanel(): React.JSX.Element | null {
  const { state, actions } = useApp()
  const [height, setHeight] = useState(240)
  const drag = useRef<{ y: number; h: number } | null>(null)

  if (!state.panelOpen) return null

  const onMouseDown = (e: React.MouseEvent): void => {
    drag.current = { y: e.clientY, h: height }
    const move = (ev: MouseEvent): void => {
      if (!drag.current) return
      const h = drag.current.h + (drag.current.y - ev.clientY)
      setHeight(Math.max(100, Math.min(window.innerHeight - 200, h)))
    }
    const up = (): void => {
      drag.current = null
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <div className="panel" style={{ height }}>
      <div className="panel-resize" onMouseDown={onMouseDown} />
      <div className="panel-tabs">
        {TABS.map((t) => (
          <div
            key={t.id}
            className={`panel-tab${state.panelTab === t.id ? ' active' : ''}`}
            onClick={() => actions.showPanel(t.id)}
          >
            {t.label}
          </div>
        ))}
        <div className="spacer" />
        <button className="icon-btn" onClick={() => actions.showPanel(null)} title="Close panel">
          <IconClose />
        </button>
      </div>
      <div className="panel-body">
        {state.panelTab === 'terminal' && <div style={{ color: 'var(--text-dim)' }}>The terminal arrives in a later build.</div>}
        {state.panelTab === 'output' && <div style={{ color: 'var(--text-dim)' }}>No output yet.</div>}
        {state.panelTab === 'problems' && <div style={{ color: 'var(--text-dim)' }}>No problems have been detected.</div>}
      </div>
    </div>
  )
}
