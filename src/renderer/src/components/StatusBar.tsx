import { useApp } from '../state'
import { problemsStore, toolchainStore, useStore } from '../lib/stores'
import { networkStore } from '../lib/networks'
import { vaultStore } from '../lib/vault'
import { emit } from '../lib/bus'
import { restartEditorEngine } from '../lib/lsp/engine'
import { useEngineView } from '../lib/lsp/status'
import { IconError, IconHammer, IconKey, IconTerminal, IconWarning } from './Icons'

export function StatusBar(): React.JSX.Element {
  const { state, actions } = useApp()
  const tc = useStore(toolchainStore)
  const vault = useStore(vaultStore)
  const net = useStore(networkStore).current
  const problems = useStore(problemsStore)
  const errors = problems.filter((p) => p.severity === 'error').length
  const warnings = problems.filter((p) => p.severity === 'warning').length
  const engine = useEngineView()
  return (
    <div className="statusbar">
      <button
        className={`sb-item sb-key${vault.unlocked ? '' : ' locked'}`}
        title={vault.unlocked ? 'Vault unlocked: click to lock' : 'Key vault: click to open Manage Keypairs'}
        onClick={() => (vault.unlocked ? void window.wax.keys.lock() : emit('open-keys', null))}
      >
        <IconKey size={14} />
      </button>
      <button className="sb-item" style={{ color: 'var(--text-dim)' }} onClick={() => emit('open-keys', null)}>
        {!vault.exists ? 'Vault not set up' : vault.unlocked ? `Vault unlocked (${vault.keys} keys)` : 'Vault locked'}
      </button>
      <div className="spacer" />
      <button
        className={`sb-item${net?.kind === 'mainnet' ? ' mainnet' : ''}`}
        title="Network and endpoint (click to manage)"
        onClick={() => emit('dialog', 'manage-networks')}
      >
        {net ? `${net.name} · ${net.endpoints[net.currentEndpoint] ?? ''}` : '(No Network)'}
      </button>
      <button className="sb-item" title={tc.ready ? 'Toolchain' : 'Open Setup'} onClick={() => actions.setView('setup')}>
        <IconHammer size={12} /> {tc.label}
      </button>
      {state.project && state.view === 'project' && (
        <button
          className={`sb-item sb-engine ${engine.state}`}
          title={`Code intelligence (clangd): ${engine.detail}${engine.state === 'error' ? ' Click to restart.' : ''}\nThe build output (Ctrl+B) is the final word on errors.`}
          onClick={() => engine.state === 'error' && restartEditorEngine()}
        >
          {ENGINE_LABEL[engine.state]}
          {engine.state === 'indexing' && engine.progress ? ` ${engine.progress}` : ''}
        </button>
      )}
      {state.cursor && state.view === 'project' && (
        <div className="sb-item">
          Ln {state.cursor.line}, Col {state.cursor.column}
        </div>
      )}
      <button className="sb-item" onClick={() => actions.showPanel('problems')} title="Problems">
        <IconError size={12} /> {errors} <IconWarning size={12} /> {warnings}
      </button>
      <button className="sb-item" onClick={() => actions.togglePanel()} title="Toggle panel">
        <IconTerminal size={14} />
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
