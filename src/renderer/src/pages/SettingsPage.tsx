import { useState } from 'react'
import { useApp } from '../state'
import { Modal } from '../components/Modal'
import { errorText, toast } from '../lib/toast'

const VAULT_WORDS = 'delete my keys'

export function SettingsPage(): React.JSX.Element {
  const { state, actions } = useApp()
  const s = state.settings
  const [clearing, setClearing] = useState(false)
  if (!s) return <div className="coming">Loading...</div>
  const set = (patch: Parameters<typeof actions.updateSettings>[0]): void => {
    actions.updateSettings(patch).catch((e) => toast('Could not save the setting', errorText(e), 'error'))
  }
  return (
    <div className="page-scroll">
      <div className="form-page">
        <h1>Settings</h1>
        <h2>Editor</h2>
        <div className="field">
          <label>Font size</label>
          <input className="input" style={{ width: 120 }} type="number" min={8} max={40} value={s.fontSize} onChange={(e) => set({ fontSize: Math.max(8, Math.min(40, Number(e.target.value) || 14)) })} />
        </div>
        <div className="field">
          <label>Default terminal</label>
          <select className="select" value={s.terminalProfile} onChange={(e) => set({ terminalProfile: e.target.value as 'powershell' | 'cmd' | 'toolchain' })}>
            <option value="powershell">PowerShell</option>
            <option value="cmd">Command Prompt</option>
            <option value="toolchain">Toolchain shell (Linux)</option>
          </select>
        </div>
        <div className="field">
          <label>Default folder for new projects</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input" value={s.defaultProjectFolder} readOnly />
            <button
              className="btn"
              onClick={async () => {
                const p = await window.wax.projects.chooseParentFolder(s.defaultProjectFolder)
                if (p) set({ defaultProjectFolder: p })
              }}
            >
              Browse...
            </button>
          </div>
        </div>
        <h2>Key vault</h2>
        <div className="field">
          <label>Lock after inactivity</label>
          <select className="select" style={{ width: 200 }} value={s.autoLockMinutes} onChange={(e) => set({ autoLockMinutes: Number(e.target.value) as 5 | 15 | 60 })}>
            <option value={5}>5 minutes</option>
            <option value={15}>15 minutes</option>
            <option value={60}>60 minutes</option>
          </select>
          <div className="hint">The vault always locks when Windows sleeps, when you lock Windows (Win+L) and when the app closes.</div>
        </div>
        <label className="field" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={s.lockAfterSignature} onChange={(e) => set({ lockAfterSignature: e.target.checked })} /> Lock the vault after every signature
        </label>
        <h2>Updates</h2>
        <label className="field" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={s.updateCheck} onChange={(e) => set({ updateCheck: e.target.checked })} /> Check GitHub for a new version once a day (only a notice; nothing is downloaded)
        </label>
        <h2>Data</h2>
        <p className="hint" style={{ fontSize: 13 }}>
          Settings, networks and stars are in %APPDATA%\WAX Master, the toolchain in %LOCALAPPDATA%\WAX Master. Your projects are never touched.
        </p>
        <button className="btn red" onClick={() => setClearing(true)}>
          Clear All App Data...
        </button>
      </div>
      {clearing && <ClearData onClose={() => setClearing(false)} />}
    </div>
  )
}

function ClearData({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [vault, setVault] = useState(false)
  const [typed, setTyped] = useState('')
  const [error, setError] = useState('')
  return (
    <Modal
      title="Clear All App Data"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn red"
            disabled={vault && typed !== VAULT_WORDS}
            onClick={async () => {
              try {
                await window.wax.app.clearData(vault, vault ? typed : '')
              } catch (e) {
                setError(errorText(e))
              }
            }}
          >
            Clear and restart
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>Removes settings, networks, stars, saved queries and the installed toolchains, then restarts WAX Master. Projects are not touched.</p>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={vault} onChange={(e) => setVault(e.target.checked)} /> Also delete the key vault
      </label>
      {vault && (
        <div className="field" style={{ marginTop: 10 }}>
          <label>
            The private keys in the vault are lost unless you have an exported copy. Type <b>{VAULT_WORDS}</b>:
          </label>
          <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} />
        </div>
      )}
      {error && <div className="error-text">{error}</div>}
    </Modal>
  )
}
