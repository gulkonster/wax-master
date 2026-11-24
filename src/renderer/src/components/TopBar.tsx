import { useEffect, useRef, useState } from 'react'
import { useApp } from '../state'
import { IconCheck, IconChevronDown, IconFileCode, IconFolderOpen, IconPlus } from './Icons'
import { ChainButtons } from './ChainButtons'
import { emit } from '../lib/bus'

function useOutsideClose(open: boolean, close: () => void): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    window.addEventListener('mousedown', h)
    return () => window.removeEventListener('mousedown', h)
  }, [open, close])
  return ref
}

export function TopBar(): React.JSX.Element {
  const { state, actions } = useApp()
  const [projOpen, setProjOpen] = useState(false)
  const projRef = useOutsideClose(projOpen, () => setProjOpen(false))
  const active = state.view === 'project'

  return (
    <div className="topbar">
      <div ref={projRef} className={`tb-button project${active ? ' active' : ''}`}>
        <button
          className="tb-main"
          onClick={() => (state.project ? actions.setView('project') : setProjOpen((o) => !o))}
          title="Current project"
        >
          <IconFileCode size={18} />
          <div>
            <div className="tb-label">Current Project</div>
            <div className={`tb-value${state.project ? '' : ' none'}`}>{state.project?.name ?? '(none)'}</div>
          </div>
        </button>
        <button className="tb-arrow" onClick={() => setProjOpen((o) => !o)} title="Switch project">
          <IconChevronDown />
        </button>
        {projOpen && (
          <div className="dropdown left" style={{ width: 268 }}>
            <div
              className="dd-item"
              onClick={() => {
                setProjOpen(false)
                actions.newProject()
              }}
            >
              <IconPlus /> Create Project...
            </div>
            <div
              className="dd-item"
              onClick={() => {
                setProjOpen(false)
                void actions.openProjectDialog()
              }}
            >
              <IconFolderOpen /> Open Project...
            </div>
            <div className="dd-section">LOCAL PROJECTS</div>
            {state.projects.length === 0 && <div className="dd-note">No projects yet</div>}
            {state.projects.map((p) => (
              <div
                key={p.path}
                className={`dd-item mono${state.project?.path === p.path ? ' selected' : ''}`}
                title={p.path}
                onClick={() => {
                  setProjOpen(false)
                  void actions.openProjectPath(p.path)
                }}
              >
                <span className="dd-lead">{state.project?.path === p.path && <IconCheck />}</span>
                <span className="dd-label">{p.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="spacer" />
      <ChainButtons onAddNetwork={() => emit('dialog', 'add-network')} onManageNetworks={() => emit('dialog', 'manage-networks')} onStarred={() => emit('dialog', 'starred')} />
    </div>
  )
}

