import { useEffect, useRef, useState } from 'react'
import type { Problem } from '../../../shared/api'
import { useApp, type PanelTab } from '../state'
import { emit } from '../lib/bus'
import { appendOutput, clearOutput, outputStore, problemsStore, useStore } from '../lib/stores'
import { IconClose, IconError, IconInfo, IconWarning } from './Icons'

const TABS: { id: PanelTab; label: string }[] = [
  { id: 'terminal', label: 'Terminal' },
  { id: 'output', label: 'Output' },
  { id: 'problems', label: 'Problems' }
]

const DIAG = /^(.*?):(\d+):(\d+):\s+(fatal error|error|warning|note):/

export function BottomPanel({ terminal }: { terminal?: React.ReactNode }): React.JSX.Element | null {
  const { state, actions } = useApp()
  const [height, setHeight] = useState(240)
  const drag = useRef<{ y: number; h: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const output = useStore(outputStore)
  const problems = useStore(problemsStore)
  const bodyRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => window.wax.on('output', (e) => appendOutput(e.text)), [])

  useEffect(() => {
    if (state.panelTab === 'output') bodyRef.current?.scrollTo(0, bodyRef.current.scrollHeight)
  }, [output, state.panelTab])

  const onMouseDown = (e: React.MouseEvent): void => {
    drag.current = { y: e.clientY, h: height }
    setDragging(true)
    const move = (ev: MouseEvent): void => {
      if (!drag.current) return
      const h = drag.current.h + (drag.current.y - ev.clientY)
      setHeight(Math.max(100, Math.min(window.innerHeight - 200, h)))
    }
    const up = (): void => {
      drag.current = null
      setDragging(false)
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      emit('layout')
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const reveal = (p: Pick<Problem, 'file' | 'line' | 'column'>): void => {
    if (!state.project) return
    actions.setView('project')
    emit('reveal', p)
  }

  const errors = problems.filter((p) => p.severity === 'error').length
  const warnings = problems.filter((p) => p.severity === 'warning').length

  return (
    <div className="panel" style={{ height, display: state.panelOpen ? 'flex' : 'none' }}>
      <div className={`panel-resize${dragging ? ' dragging' : ''}`} onMouseDown={onMouseDown} />
      <div className="panel-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={state.panelTab === t.id}
            className={`panel-tab${state.panelTab === t.id ? ' active' : ''}`}
            onClick={() => actions.showPanel(t.id)}
          >
            {t.label}
            {t.id === 'problems' && problems.length > 0 && ` (${problems.length})`}
          </button>
        ))}
        <div className="spacer" />
        {state.panelTab === 'output' && (
          <button className="btn subtle sm" onClick={() => clearOutput()}>
            Clear
          </button>
        )}
        <button className="icon-btn" onClick={() => actions.showPanel(null)} title="Close panel">
          <IconClose />
        </button>
      </div>
      <div className="panel-body" ref={bodyRef} style={{ display: state.panelTab === 'terminal' ? 'none' : 'block' }}>
        {state.panelTab === 'output' &&
          (output ? (
            <pre className="output-text">
              {output.split('\n').map((line, i) => {
                const m = DIAG.exec(line)
                return (
                  <div
                    key={i}
                    className={m ? `diag ${m[4] === 'warning' ? 'sev-warning' : m[4] === 'note' ? 'sev-info' : 'sev-error'}` : undefined}
                    onClick={m ? () => reveal(toProblemLocation(m, problems)) : undefined}
                  >
                    {line || ' '}
                  </div>
                )
              })}
            </pre>
          ) : (
            <div className="panel-note">No output yet.</div>
          ))}
        {state.panelTab === 'problems' &&
          (problems.length === 0 ? (
            <div className="panel-note">No problems have been detected.</div>
          ) : (
            <>
              <div className="panel-note" style={{ marginBottom: 'var(--sp-1)' }}>
                {errors} error(s), {warnings} warning(s)
              </div>
              {problems.map((p, i) => (
                <div key={i} className="problem-row" onClick={() => reveal(p)}>
                  <span className={`sev-${p.severity}`}>
                    {p.severity === 'error' ? <IconError size="sm" /> : p.severity === 'warning' ? <IconWarning size="sm" /> : <IconInfo size="sm" />}
                  </span>
                  <span style={{ userSelect: 'text' }}>{p.message}</span>
                  <span className="loc">
                    {p.file}:{p.line}:{p.column}
                  </span>
                </div>
              ))}
            </>
          ))}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: state.panelTab === 'terminal' ? 'flex' : 'none' }}>
        {terminal ?? <div className="panel-body panel-note">The terminal arrives in a later build.</div>}
      </div>
    </div>
  )
}

/** Maps a raw output line to the parsed problem with the same position (paths are normalized there). */
function toProblemLocation(m: RegExpExecArray, problems: Problem[]): Pick<Problem, 'file' | 'line' | 'column'> {
  const line = Number(m[2])
  const column = Number(m[3])
  const found = problems.find((p) => p.line === line && p.column === column && m[1].replace(/\\/g, '/').endsWith(p.file))
  return found ?? { file: m[1].replace(/^\.\//, ''), line, column }
}
