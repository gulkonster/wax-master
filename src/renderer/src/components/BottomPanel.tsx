import { useEffect, useMemo, useRef, useState } from 'react'
import type { Problem } from '../../../shared/api'
import { useApp, type PanelTab } from '../state'
import { emit } from '../lib/bus'
import { appendOutput, clearOutput, outputStore, panelsFollowProject, problemsStore, useStore } from '../lib/stores'
import { IconClose, IconError, IconInfo, IconWarning } from './Icons'
import { RICARDIAN_HINT, classifyLine, cleanLine, countProblems, isRicardianWarning, orderProblems, type ClassifiedLine } from '../../../shared/output-lines'
import { ReadMore } from './HelpButton'

const TABS: { id: PanelTab; label: string }[] = [
  { id: 'terminal', label: 'Terminal' },
  { id: 'output', label: 'Output' },
  { id: 'problems', label: 'Problems' }
]

export function BottomPanel({ terminal }: { terminal?: React.ReactNode }): React.JSX.Element | null {
  const { state, actions } = useApp()
  const [height, setHeight] = useState(240)
  const drag = useRef<{ y: number; h: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const output = useStore(outputStore)
  const problems = useStore(problemsStore)
  const bodyRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => window.wax.on('output', (e) => appendOutput(e.text)), [])

  const projectPath = state.project?.path ?? null
  useEffect(() => {
    panelsFollowProject(projectPath)
  }, [projectPath])

  const ordered = useMemo(() => orderProblems(problems), [problems])

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

  const { errors, warnings } = countProblems(problems)

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
              {output.split('\n').map((raw, i) => {
                // The line is shown as it came (colour codes removed); only the file:line:column part is a link.
                const line = cleanLine(raw)
                const c = classifyLine(line)
                const loc = c.loc
                return (
                  <div key={i} className={`out-line out-${c.severity}`}>
                    {loc ? (
                      <>
                        <span className="out-link" title="Open this place" onClick={() => reveal(toProblemLocation(loc, problems))}>
                          {line.slice(loc.start, loc.end)}
                        </span>
                        {line.slice(loc.end)}
                      </>
                    ) : (
                      line || ' '
                    )}
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
              {ordered.map((p, i) => (
                <div key={i} className={`problem-row${p.file ? '' : ' no-place'}`} onClick={p.file ? () => reveal(p) : undefined}>
                  <span className={`out-${p.severity === 'info' ? 'note' : p.severity}`}>
                    {p.severity === 'error' ? <IconError size="sm" /> : p.severity === 'warning' ? <IconWarning size="sm" /> : <IconInfo size="sm" />}
                  </span>
                  <span className="problem-message">{p.message}</span>
                  {p.severity === 'warning' && isRicardianWarning(p.message) && (
                    <span className="problem-hint" onClick={(ev) => ev.stopPropagation()}>
                      <span
                        className="out-link"
                        role="button"
                        title="Run Contract > Create Ricardian Files"
                        onClick={(ev) => {
                          ev.stopPropagation()
                          emit('menu-run', 'create-ricardian')
                        }}
                      >
                        {RICARDIAN_HINT}
                      </span>{' '}
                      <ReadMore place="ricardianWarning" />
                    </span>
                  )}
                  {p.source === 'abi' && (
                    <span className="problem-hint" onClick={(ev) => ev.stopPropagation()}>
                      <span title="Found by the ABI check after the compile">abi</span> <ReadMore place="abiCheck" />
                    </span>
                  )}
                  {p.file && (
                    <span className="loc">
                      {p.file}:{p.line}:{p.column}
                    </span>
                  )}
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

/** Maps the place of an output line to the parsed problem with the same position (paths are normalized there). */
function toProblemLocation(loc: NonNullable<ClassifiedLine['loc']>, problems: Problem[]): Pick<Problem, 'file' | 'line' | 'column'> {
  const { line, column } = loc
  const found = problems.find((p) => p.file && p.line === line && p.column === column && loc.file.replace(/\\/g, '/').endsWith(p.file))
  return found ?? { file: loc.file.replace(/^\.\//, ''), line, column }
}
