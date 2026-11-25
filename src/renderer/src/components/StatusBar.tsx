import { useState } from 'react'
import { useApp } from '../state'
import { useToolchains } from './ToolchainManager'
import { problemsStore, toolchainStore, useStore } from '../lib/stores'
import { countProblems } from '../../../shared/output-lines'
import { networkStore } from '../lib/networks'
import { networkStatusStore, statusFor } from '../lib/network-status'
import { StatusDot } from './StatusDot'
import { ReadMore } from './HelpButton'
import { askUnlock, vaultStore } from '../lib/vault'
import { emit } from '../lib/bus'
import { restartEditorEngine } from '../lib/lsp/engine'
import { useEngineView } from '../lib/lsp/status'
import { IconCheck, IconError, IconHammer, IconKey, IconLock, IconTerminal, IconWarning } from './Icons'

export function StatusBar(): React.JSX.Element {
  const { state, actions } = useApp()
  const tc = useStore(toolchainStore)
  const vault = useStore(vaultStore)
  const net = useStore(networkStore).current
  const netStatus = statusFor(useStore(networkStatusStore), net?.id)
  const problems = useStore(problemsStore)
  // Same counting as the Problems tab (shared/output-lines.ts).
  const { errors, warnings } = countProblems(problems)
  const engine = useEngineView()
  return (
    <div className="statusbar">
      <button
        className={`sb-item${vault.unlocked ? ' ok' : ''}`}
        title={vault.unlocked ? 'Key vault: click to open Manage Keypairs' : vault.exists ? 'Key vault: click to unlock' : 'Key vault: click to create it'}
        onClick={() => (vault.unlocked ? emit('open-keys', null) : void askUnlock())}
      >
        <IconKey size="sm" />
        {!vault.exists ? 'Vault not set up' : vault.unlocked ? `Vault unlocked (${vault.keys} ${vault.keys === 1 ? 'key' : 'keys'})` : 'Vault locked'}
      </button>
      {vault.unlocked && (
        <button className="sb-item" title="Vault unlocked: click to lock" onClick={() => void window.wax.keys.lock()}>
          <IconLock size="sm" />
          Lock
        </button>
      )}
      <div className="spacer" />
      <button
        className={`sb-item${net?.kind === 'mainnet' ? ' mainnet' : ''}`}
        title={`Network and endpoint (click to manage)${net ? `\n${netStatus?.summary ?? 'Checking'}` : ''}`}
        onClick={() => emit('dialog', 'manage-networks')}
      >
        {net && <StatusDot status={netStatus} />}
        {net ? `${net.name} · ${net.endpoints[net.currentEndpoint] ?? ''}` : '(No Network)'}
      </button>
      <ToolchainPicker ready={tc.ready} label={tc.label} />
      {state.project && state.view === 'project' && (
        <>
          <button
            className={`sb-item sb-engine ${engine.state}`}
            title={`Code intelligence (clangd): ${engine.detail}${engine.state === 'error' ? ' Click to restart.' : ''}\nThe build output (Ctrl+B) is the final word on errors.`}
            onClick={() => engine.state === 'error' && restartEditorEngine()}
          >
            {ENGINE_LABEL[engine.state]}
            {engine.state === 'indexing' && engine.progress ? ` ${engine.progress}` : ''}
          </button>
          <ReadMore place="editor" />
        </>
      )}
      {state.cursor && state.view === 'project' && (
        <div className="sb-item">
          Ln {state.cursor.line}, Col {state.cursor.column}
        </div>
      )}
      <button className="sb-item" onClick={() => actions.showPanel('problems')} title="Problems">
        <span className={errors > 0 ? 'err' : undefined}>
          <IconError size="sm" /> {errors}
        </span>
        <span className={warnings > 0 ? 'warn' : undefined}>
          <IconWarning size="sm" /> {warnings}
        </span>
      </button>
      <button className="sb-item" onClick={() => actions.togglePanel()} title="Toggle panel">
        <IconTerminal size="sm" />
      </button>
    </div>
  )
}

const ENGINE_LABEL: Record<string, string> = {
  off: 'C++: off',
  starting: 'C++: starting',
  indexing: 'C++: indexing',
  ready: 'C++: ready',
  error: 'C++: error'
}

/** Status-bar toolchain picker: installed toolchains for the current project, and "Manage toolchains...". */
function ToolchainPicker({ ready, label }: { ready: boolean; label: string }): React.JSX.Element {
  const { state, actions } = useApp()
  const [open, setOpen] = useState(false)
  const { list } = useToolchains()
  const project = state.project
  const chosen = project?.config.cdt || list.find((t) => t.isDefault)?.id || ''
  const current = list.find((t) => t.id === chosen)
  const pick = async (id: string): Promise<void> => {
    setOpen(false)
    if (!project) return
    const isDefault = list.find((t) => t.id === id)?.isDefault
    const p = await window.wax.projects.saveConfig({ ...project.config, cdt: isDefault ? '' : id })
    actions.projectOpened(p)
  }
  if (!ready) {
    return (
      <button className="sb-item" title="Open Setup" onClick={() => actions.setView('setup')}>
        <IconHammer size="sm" /> {label}
      </button>
    )
  }
  return (
    <div className="sb-picker">
      <button className="sb-item" title="Toolchain of the current project" onClick={() => setOpen((o) => !o)}>
        <IconHammer size="sm" /> {project ? (current?.label ?? label) : label}
      </button>
      {open && (
        <div className="dropdown right" onMouseLeave={() => setOpen(false)}>
          <div className="dd-section">Local toolchains</div>
          {list.map((t) => (
            <div key={t.id} className={`dd-item${t.id === chosen ? ' selected' : ''}`} onClick={() => void pick(t.id)}>
              <span className="dd-lead">{t.id === chosen && <IconCheck />}</span>
              <span className="dd-label">{t.label}</span>
            </div>
          ))}
          {!project && <div className="dd-note">Open a project to choose its toolchain</div>}
          <div className="dd-sep" />
          <div
            className="dd-item"
            onClick={() => {
              setOpen(false)
              actions.setView('setup')
            }}
          >
            <span className="dd-lead" />
            Manage toolchains...
          </div>
        </div>
      )}
    </div>
  )
}
