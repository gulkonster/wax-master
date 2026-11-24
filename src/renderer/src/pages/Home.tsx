import { useState } from 'react'
import type { ProjectEntry } from '../../../shared/api'
import { useApp } from '../state'
import { IconClose, IconFolder, IconFolderOpen, IconList, IconPlus, IconStar } from '../components/Icons'
import { HelpButton } from '../components/HelpButton'

export function Home(): React.JSX.Element {
  const { state, actions } = useApp()
  const [tab, setTab] = useState<'local' | 'starred'>('local')
  const list = tab === 'local' ? state.projects : state.projects.filter((p) => p.starred)

  const star = async (p: ProjectEntry): Promise<void> => {
    await window.wax.projects.star(p.path, !p.starred)
    await actions.refreshProjects()
  }
  const remove = async (p: ProjectEntry): Promise<void> => {
    await window.wax.projects.remove(p.path)
    await actions.refreshProjects()
  }

  return (
    <div className="page-scroll">
      <div className="home">
        <div className="page-head">
          <h1 className="with-help">
            Projects
            <HelpButton place="home" />
          </h1>
          <button className="btn primary" onClick={() => actions.newProject()}>
            <IconPlus /> New
          </button>
          <button className="btn" onClick={() => void actions.openProjectDialog()}>
            <IconFolderOpen /> Open
          </button>
        </div>
        <div className="utabs" role="tablist">
          <button role="tab" aria-selected={tab === 'local'} className={`utab${tab === 'local' ? ' active' : ''}`} onClick={() => setTab('local')}>
            <IconList /> Local
          </button>
          <button role="tab" aria-selected={tab === 'starred'} className={`utab${tab === 'starred' ? ' active' : ''}`} onClick={() => setTab('starred')}>
            <IconStar /> Starred
          </button>
        </div>
        {list.length === 0 && (
          <div className="empty-note">
            {tab === 'local'
              ? 'No projects yet. Create one with New, or open an existing contract folder with Open.'
              : 'No starred projects. Use the star on a project row.'}
          </div>
        )}
        {list.map((p) => (
          <div key={p.path} className="project-row" onClick={() => void actions.openProjectPath(p.path)}>
            <div className="info">
              <div className="name">{p.name}</div>
              <div className="path-line" title={p.path}>
                <IconFolder />
                <span>{p.path}</span>
              </div>
            </div>
            <div className="row-actions" onClick={(e) => e.stopPropagation()}>
              <button className={`icon-btn${p.starred ? ' on' : ''}`} title={p.starred ? 'Unstar' : 'Star'} onClick={() => void star(p)}>
                <IconStar filled={p.starred} />
              </button>
              <button className="icon-btn" title="Remove from list (files are not deleted)" onClick={() => void remove(p)}>
                <IconClose />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
