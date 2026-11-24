import { useApp } from '../state'
import { IconError, IconHammer, IconKey, IconTerminal, IconWarning } from './Icons'

export function StatusBar(): React.JSX.Element {
  const { state, actions } = useApp()
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
      <div className="sb-item" title="Toolchain">
        <IconHammer size={12} /> Toolchain not set up
      </div>
      {state.cursor && state.view === 'project' && (
        <div className="sb-item">
          Ln {state.cursor.line}, Col {state.cursor.column}
        </div>
      )}
      <button className="sb-item" onClick={() => actions.showPanel('problems')} title="Problems">
        <IconError size={12} /> 0 <IconWarning size={12} /> 0
      </button>
      <button className="sb-item" onClick={() => actions.togglePanel()} title="Toggle panel">
        <IconTerminal size={14} />
      </button>
    </div>
  )
}
