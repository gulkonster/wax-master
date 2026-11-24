import { useApp } from '../state'
import { problemsStore, toolchainStore, useStore } from '../lib/stores'
import { IconError, IconHammer, IconKey, IconTerminal, IconWarning } from './Icons'

export function StatusBar(): React.JSX.Element {
  const { state, actions } = useApp()
  const tc = useStore(toolchainStore)
  const problems = useStore(problemsStore)
  const errors = problems.filter((p) => p.severity === 'error').length
  const warnings = problems.filter((p) => p.severity === 'warning').length
  return (
    <div className="statusbar">
      <div className="sb-item sb-key locked" title="Key vault (arrives with keys)">
        <IconKey size={14} />
      </div>
      <div className="sb-item" style={{ color: 'var(--text-dim)' }}>
        Vault not set up
      </div>
      <div className="spacer" />
      <div className="sb-item" title="Network">
        (No Network)
      </div>
      <button className="sb-item" title={tc.ready ? 'Toolchain' : 'Open Setup'} onClick={() => actions.setView('setup')}>
        <IconHammer size={12} /> {tc.label}
      </button>
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
