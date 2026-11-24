import { useEffect, useState } from 'react'
import type { OpenProject } from '../../../shared/api'
import { defaultBuildCommand, type DeployTarget, type ProjectConfig } from '../../../shared/project'
import { networkStore } from '../lib/networks'
import { useStore } from '../lib/stores'
import { useApp } from '../state'
import { errorText, toast } from '../lib/toast'
import { IconFolder } from '../components/Icons'
import { useToolchains } from '../components/ToolchainManager'
import { AccountPicker, PermissionPicker } from '../components/AccountPicker'
import { emit } from '../lib/bus'
import { HelpButton } from '../components/HelpButton'

/** Saves the settings; resolves to null on success or to the reason it failed. */
export type SettingsSaver = () => Promise<string | null>

export function ProjectSettings({
  project,
  onDirty,
  saverRef
}: {
  project: OpenProject
  onDirty: (dirty: boolean) => void
  saverRef: { current: SettingsSaver | null }
}): React.JSX.Element {
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

  useEffect(() => {
    onDirty(!saved)
  }, [saved, onDirty])

  const save: SettingsSaver = async () => {
    try {
      setError('')
      const p = await window.wax.projects.saveConfig(cfg)
      actions.projectOpened(p)
      setSaved(true)
      toast('Project settings saved', '', 'success')
      return null
    } catch (e) {
      setError(errorText(e))
      return errorText(e)
    }
  }
  saverRef.current = save

  return (
    <div className="settings-tab">
    <div className="page-scroll">
      <div className="form-page wide">
        <h1 className="with-help">
          Project Settings
          <HelpButton place="projectSettings" />
        </h1>
        <div className="path-line" title={project.path}>
          <IconFolder />
          <span>{project.path}</span>
        </div>
        <h2>Build Settings</h2>
        <div className="card">
        <div className="field">
          <label>Main file:</label>
          <input className="input mono" value={cfg.main} onChange={(e) => set('main', e.target.value)} />
        </div>
        <div className="field">
          <label>
            Contract name <span className="code-tag">-contract</span>:
          </label>
          <input className="input mono w-account" value={cfg.contract} onChange={(e) => set('contract', e.target.value)} />
        </div>
        <div className="field">
          <label>Version of CDT used in build:</label>
          <select className="select w-select" value={cfg.cdt} onChange={(e) => set('cdt', e.target.value)}>
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
          <input className="input mono" placeholder="Default: include" value={cfg.include} onChange={(e) => set('include', e.target.value)} />
        </div>
        <div className="field">
          <label>
            Add a resource path for inclusion <span className="code-tag">-R</span>:
          </label>
          <input className="input mono" placeholder="Default: resource" value={cfg.resource} onChange={(e) => set('resource', e.target.value)} />
        </div>
        <div className="field">
          <label>
            Write output to <span className="code-tag">-o</span>:
          </label>
          <input
            className="input mono"
            placeholder={`Default: ${cfg.contract}.wasm`}
            value={cfg.output}
            onChange={(e) => set('output', e.target.value)}
          />
        </div>
        <div className="field">
          <label>Custom build command:</label>
          <textarea
            className="textarea mono"
            placeholder={`Default: ${defaultBuildCommand(cfg)}`}
            value={cfg.buildCommand}
            onChange={(e) => set('buildCommand', e.target.value)}
          />
          <div className="hint">A custom command always asks for your approval before its first run, and again whenever it changes.</div>
        </div>
        </div>
        <h2>Deploy Settings</h2>
        <div className="card">
        <div className="field">
          <label>Deploy WASM and/or ABI:</label>
          <select className="select w-select" value={cfg.deploy.target} onChange={(e) => set('deploy', { ...cfg.deploy, target: e.target.value as DeployTarget })}>
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
              <div className="field-pair">
                <div className="w-account">
                  <AccountPicker
                    mode="starred"
                    networkId={n.id}
                    value={d.account}
                    onChange={(account) => put({ account })}
                    onFind={() => emit('find-account', { label: 'Project Settings', command: 'project-settings' })}
                  />
                </div>
                <div className="w-perm">
                  <PermissionPicker networkId={n.id} account={d.account} value={d.permission || 'active'} onChange={(permission) => put({ permission })} />
                </div>
              </div>
            </div>
          )
        })}
        </div>
        {error && <div className="error-text">{error}</div>}
      </div>
    </div>
    <div className="save-bar">
      <span className={`state${saved ? '' : ' dirty'}`}>{saved ? 'No changes' : 'Unsaved changes'}</span>
      {!saved && (
        <button className="btn" onClick={() => (setCfg(project.config), setSaved(true))}>
          Discard changes
        </button>
      )}
      <button className="btn primary" onClick={() => void save()} disabled={saved}>
        Save
      </button>
    </div>
    </div>
  )
}
