import { useEffect, useState } from 'react'
import type { OpenProject } from '../../../shared/api'
import { defaultBuildCommand, type DeployTarget, type ProjectConfig } from '../../../shared/project'
import { networkStore } from '../lib/networks'
import { useStore } from '../lib/stores'
import { useApp } from '../state'
import { errorText, toast } from '../lib/toast'
import { IconFolder } from '../components/Icons'
import { useToolchains } from '../components/ToolchainManager'

export function ProjectSettings({ project }: { project: OpenProject }): React.JSX.Element {
  const { actions } = useApp()
  const [cfg, setCfg] = useState<ProjectConfig>(project.config)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(true)
  const tcs = useToolchains()
  const net = useStore(networkStore)

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
            <option value="">{tcs.defaultLabel || 'WAX CDT 4.1.1wax01'} (default)</option>
            {tcs.list
              .filter((t) => !t.isDefault)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            {cfg.cdt && !tcs.list.some((t) => t.id === cfg.cdt) && <option value={cfg.cdt}>{cfg.cdt} (not installed; the default is used)</option>}
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
          <div className="hint">A custom command always asks for your approval before its first run, and again whenever it changes.</div>
        </div>
        <h2>Deploy Settings</h2>
        <div className="field">
          <label>Deploy WASM and/or ABI:</label>
          <select className="select" value={cfg.deploy.target} onChange={(e) => set('deploy', { ...cfg.deploy, target: e.target.value as DeployTarget })}>
            <option value="both">Both WASM and ABI</option>
            <option value="wasm">WASM only</option>
            <option value="abi">ABI only</option>
          </select>
        </div>
        {net.list.map((n) => {
          const d = cfg.deploy.networks[n.id] ?? { account: '', permission: 'active' }
          const put = (patch: Partial<typeof d>): void =>
            set('deploy', { ...cfg.deploy, networks: { ...cfg.deploy.networks, [n.id]: { ...d, ...patch } } })
          return (
            <div className="field" key={n.id}>
              <label className={n.kind === 'mainnet' ? 'mainnet-text' : undefined}>Deploy to ({n.name}):</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="input" style={{ flex: 2 }} placeholder="account" value={d.account} onChange={(e) => put({ account: e.target.value.trim().toLowerCase() })} />
                <input className="input" style={{ flex: 1 }} placeholder="permission (default: active)" value={d.permission} onChange={(e) => put({ permission: e.target.value.trim().toLowerCase() })} />
              </div>
            </div>
          )
        })}
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
