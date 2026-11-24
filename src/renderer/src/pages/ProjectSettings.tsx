import { useEffect, useState } from 'react'
import type { OpenProject } from '../../../shared/api'
import { defaultBuildCommand, type ProjectConfig } from '../../../shared/project'
import { useApp } from '../state'
import { errorText, toast } from '../lib/toast'
import { IconFolder } from '../components/Icons'

export function ProjectSettings({ project }: { project: OpenProject }): React.JSX.Element {
  const { actions } = useApp()
  const [cfg, setCfg] = useState<ProjectConfig>(project.config)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(true)

  useEffect(() => {
    setCfg(project.config)
    setSaved(true)
  }, [project.config])

  const set = <K extends keyof ProjectConfig>(k: K, v: ProjectConfig[K]): void => {
    setCfg((c) => ({ ...c, [k]: v }))
    setSaved(false)
  }

  const save = async (): Promise<void> => {
    try {
      setError('')
      const p = await window.wax.projects.saveConfig(cfg)
      actions.projectOpened(p)
      setSaved(true)
      toast('Project settings saved', '', 'success')
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <div className="page-scroll">
      <div className="form-page">
        <h1>Project Settings</h1>
        <span className="chip">
          <IconFolder /> {project.path}
        </span>
        <h2>Build Settings</h2>
        <div className="field">
          <label>Main file:</label>
          <input className="input" value={cfg.main} onChange={(e) => set('main', e.target.value)} />
        </div>
        <div className="field">
          <label>
            Contract name <span className="code-tag">-contract</span>:
          </label>
          <input className="input" value={cfg.contract} onChange={(e) => set('contract', e.target.value)} />
        </div>
        <div className="field">
          <label>Version of CDT used in build:</label>
          <select className="select" value={cfg.cdt} onChange={(e) => set('cdt', e.target.value)}>
            <option value="">WAX CDT 4.1.1wax01 (default)</option>
          </select>
        </div>
        <div className="field">
          <label>
            Add directory to include search path <span className="code-tag">-I</span>:
          </label>
          <input className="input" placeholder="Default: include" value={cfg.include} onChange={(e) => set('include', e.target.value)} />
        </div>
        <div className="field">
          <label>
            Add a resource path for inclusion <span className="code-tag">-R</span>:
          </label>
          <input className="input" placeholder="Default: resource" value={cfg.resource} onChange={(e) => set('resource', e.target.value)} />
        </div>
        <div className="field">
          <label>
            Write output to <span className="code-tag">-o</span>:
          </label>
          <input
            className="input"
            placeholder={`Default: ${cfg.contract}.wasm`}
            value={cfg.output}
            onChange={(e) => set('output', e.target.value)}
          />
        </div>
        <div className="field">
          <label>Custom build command:</label>
          <textarea
            className="textarea"
            placeholder={`Default: ${defaultBuildCommand(cfg)}`}
            value={cfg.buildCommand}
            onChange={(e) => set('buildCommand', e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn purple" onClick={() => void save()} disabled={saved}>
            Save
          </button>
          {!saved && (
            <button className="btn" onClick={() => (setCfg(project.config), setSaved(true))}>
              Discard changes
            </button>
          )}
        </div>
        {error && <div className="error-text">{error}</div>}
      </div>
    </div>
  )
}
