import { useEffect, useState } from 'react'
import type { ThemeSetting } from '../../../shared/api'
import { useApp } from '../state'
import { Modal } from '../components/Modal'
import { errorText, toast } from '../lib/toast'
import { HelpButton } from '../components/HelpButton'
import { TypedWord, typedWordMatches } from '../components/TypedWord'
import { settingId, takeRequestedSetting } from '../lib/open-setting'

const VAULT_WORDS = 'delete my keys'

export function SettingsPage(): React.JSX.Element {
  const { state, actions } = useApp()
  const s = state.settings
  const [clearing, setClearing] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  // Opened from a link to one setting (Deploy): scroll to it and focus it.
  const loaded = !!s
  useEffect(() => {
    if (!loaded) return
    const key = takeRequestedSetting()
    if (!key) return
    const el = document.getElementById(settingId(key))
    if (!el) return
    el.scrollIntoView({ block: 'center' })
    el.focus()
    setFlash(key)
    const t = setTimeout(() => setFlash(null), 2000)
    return () => clearTimeout(t)
  }, [loaded])
  if (!s) return <div className="coming">Loading...</div>
  const set = (patch: Parameters<typeof actions.updateSettings>[0]): void => {
    actions.updateSettings(patch).catch((e) => toast('Could not save the setting', errorText(e), 'error'))
  }
  return (
    <div className="page-scroll">
      <div className="form-page">
        <h1 className="with-help">
          Settings
          <HelpButton place="settings" />
        </h1>
        <h2 className="with-help">
          Appearance
          <HelpButton place="settingsAppearance" />
        </h2>
        <div className="card">
        <div className="field">
          <label>Theme</label>
          <select className="select w-select" value={s.theme} onChange={(e) => set({ theme: e.target.value as ThemeSetting })}>
            <option value="system">System</option>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
          <div className="hint">System follows the Windows setting for apps and changes with it.</div>
        </div>
        </div>
        <h2 className="with-help">
          Editor
          <HelpButton place="settingsEditor" />
        </h2>
        <div className="card">
        <div className="field">
          <label>Font size</label>
          <input className="input w-num" type="number" min={8} max={40} value={s.fontSize} onChange={(e) => set({ fontSize: Math.max(8, Math.min(40, Number(e.target.value) || 14)) })} />
        </div>
        <div className="field">
          <label>Default terminal</label>
          <select className="select w-select" value={s.terminalProfile} onChange={(e) => set({ terminalProfile: e.target.value as 'powershell' | 'cmd' | 'toolchain' })}>
            <option value="powershell">PowerShell</option>
            <option value="cmd">Command Prompt</option>
            <option value="toolchain">Toolchain shell (Linux)</option>
          </select>
        </div>
        <div className="field">
          <label>Default folder for new projects</label>
          <div className="field-row">
            <input className="input mono" value={s.defaultProjectFolder} readOnly />
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
        </div>
        <h2 className="with-help">
          Build and deploy
          <HelpButton place="settingsBuild" />
        </h2>
        <div className="card">
        <label className={`check-label${flash === 'autoBuildOnDeploy' ? ' flash' : ''}`}>
          <input
            id={settingId('autoBuildOnDeploy')}
            type="checkbox"
            checked={s.autoBuildOnDeploy}
            onChange={(e) => set({ autoBuildOnDeploy: e.target.checked })}
          />{' '}
          Build automatically on Deploy (Deploy builds the contract for the network it deploys to when the project changed)
        </label>
        <div className="hint">
          Off: Deploy sends the WASM and ABI of the last build as they are; Rebuild in Deploy still builds. A testnet build is never sent to a mainnet, and a mainnet build never to a test network.
        </div>
        </div>
        <h2 className="with-help">
          Key vault
          <HelpButton place="settingsVault" />
        </h2>
        <div className="card">
        <div className="field">
          <label>Lock after inactivity</label>
          <select className="select w-select" value={s.autoLockMinutes} onChange={(e) => set({ autoLockMinutes: Number(e.target.value) as 5 | 15 | 60 })}>
            <option value={5}>5 minutes</option>
            <option value={15}>15 minutes</option>
            <option value={60}>60 minutes</option>
          </select>
          <div className="hint">The vault always locks when Windows sleeps, when you lock Windows (Win+L) and when the app closes.</div>
        </div>
        <div className="field">
          <label className="check-label">
            <input type="checkbox" checked={s.lockAfterSignature} onChange={(e) => set({ lockAfterSignature: e.target.checked })} /> Lock the vault after every signature
          </label>
        </div>
        <label className={`check-label${flash === 'typedDeleteConfirm' ? ' flash' : ''}`}>
          <input
            id={settingId('typedDeleteConfirm')}
            type="checkbox"
            checked={s.typedDeleteConfirm}
            onChange={(e) => set({ typedDeleteConfirm: e.target.checked })}
          />{' '}
          Ask to type a word before deleting
        </label>
        <div className="hint">
          Clear Contract Code (the account name), Delete key (delete), Reset the vault (RESET) and Clear All App Data with the vault (delete my
          keys). A copy button stands next to the word. Off: these show only their normal confirmation.
        </div>
        </div>
        <h2 className="with-help">
          Updates
          <HelpButton place="settingsUpdates" />
        </h2>
        <div className="card">
        <label className="check-label">
          <input type="checkbox" checked={s.updateCheck} onChange={(e) => set({ updateCheck: e.target.checked })} /> Check GitHub for a new version once a day (only a notice; nothing is downloaded unless you press Download and install)
        </label>
        </div>
        <h2 className="with-help">
          Data
          <HelpButton place="settingsData" />
        </h2>
        <div className="card">
        <p className="lead" style={{ marginTop: 0 }}>
          Settings, networks and stars are in %APPDATA%\WAX Master, the toolchain in %LOCALAPPDATA%\WAX Master. Your projects are never touched.
        </p>
        <button className="btn danger-outline" onClick={() => setClearing(true)}>
          Clear All App Data...
        </button>
        </div>
      </div>
      {clearing && <ClearData onClose={() => setClearing(false)} />}
    </div>
  )
}

function ClearData({ onClose }: { onClose: () => void }): React.JSX.Element {
  // E73: with the setting on, the typed words are the confirmation of a clear with the vault; off, the main process asks.
  const askWord = useApp().state.settings?.typedDeleteConfirm !== false
  const [vault, setVault] = useState(false)
  const [typed, setTyped] = useState('')
  const [error, setError] = useState('')
  return (
    <Modal
      size="s"
      name="clear-data"
      help="settingsData"
      title="Clear All App Data"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn danger"
            disabled={vault && askWord && !typedWordMatches(typed, VAULT_WORDS)}
            onClick={async () => {
              try {
                await window.wax.app.clearData(vault, vault && askWord ? typed : '')
                onClose()
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
      <p style={{ marginTop: 0 }}>Removes settings, networks, stars, added tokens, saved queries, the build record, the log files, the installed toolchains and the local chain (when set up), then restarts WAX Master; your projects are not touched.{' '}
        {vault && askWord ? 'With the vault, the typed words are the confirmation.' : 'A separate confirmation follows.'}
      </p>
      <label className="check-label">
        <input type="checkbox" checked={vault} onChange={(e) => setVault(e.target.checked)} /> Also delete the key vault
      </label>
      {vault && (
        <div style={{ marginTop: 'var(--sp-2h)' }}>
          <p style={{ marginTop: 0 }}>The private keys in the vault are lost unless you have an exported copy.</p>
          {askWord && <TypedWord word={VAULT_WORDS} value={typed} onChange={setTyped} after="to delete the vault too:" />}
        </div>
      )}
      {error && <div className="error-text">{error}</div>}
    </Modal>
  )
}
