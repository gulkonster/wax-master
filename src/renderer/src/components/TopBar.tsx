import { useEffect, useRef, useState } from 'react'
import { useApp } from '../state'
import { IconChevronDown, IconContract, IconFileCode, IconFolderOpen, IconGlobe, IconPlus, IconUser } from './Icons'

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
          <IconFileCode size={20} />
          <div>
            <div className="tb-label">Current Project</div>
            <div className="tb-value">{state.project?.name ?? '(none)'}</div>
          </div>
        </button>
        <button className="tb-arrow" onClick={() => setProjOpen((o) => !o)} title="Switch project">
          <IconChevronDown />
        </button>
        {projOpen && (
          <div className="dropdown left" style={{ width: 272 }}>
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
                <IconFileCode /> {p.name}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="spacer" />
      <TopButton icon={<IconContract size={18} />} label="Contracts" value="(none)" note="Contract pages arrive with the chain features." />
      <TopButton icon={<IconUser size={18} />} label="Account" value="(none)" note="Account pages arrive with the chain features." />
      <TopButton icon={<IconGlobe size={18} />} label="Network" value="(No Network)" note="Networks arrive with the chain features." />
    </div>
  )
}

function TopButton({ icon, label, value, note }: { icon: React.ReactNode; label: string; value: string; note: string }): React.JSX.Element {
  return (
    <div className="tb-button right" title={note}>
      <button className="tb-main" disabled>
        {icon}
        <div>
          <div className="tb-label">{label}</div>
          <div className="tb-value">{value}</div>
        </div>
      </button>
      <button className="tb-arrow" disabled>
        <IconChevronDown />
      </button>
    </div>
  )
}
