import { useState } from 'react'
import type { OpenProject } from '../../../shared/api'
import { useApp } from '../state'
import { errorText } from '../lib/toast'
import { Modal } from './Modal'

/** Shown when a folder without waxmaster.json is opened: pick the main file once. */
export function MainFileDialog({ project }: { project: OpenProject }): React.JSX.Element {
  const { actions } = useApp()
  const [main, setMain] = useState(project.candidates[0] ?? '')
  const [error, setError] = useState('')

  const ok = async (): Promise<void> => {
    try {
      const p = await window.wax.projects.setMainFile(main)
      actions.projectOpened(p)
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <Modal
      size="m"
      name="main-file"
      title="Choose the main file"
      footer={
        <>
          <div className="left">
            <button
              className="btn"
              onClick={() => void actions.closeProject()}
            >
              Close project
            </button>
          </div>
          <button className="btn primary" disabled={!main} onClick={() => void ok()}>
            Use this file
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>
        This folder has no <span className="code-tag">waxmaster.json</span> yet: choose the contract&apos;s main source file
        {project.eosproj ? ' (the other settings are taken from .eosproj)' : ' (the other settings start with their defaults)'}; you can change them in Project Settings.
      </p>
      {project.eosproj && project.eosproj.buildScript.trim() && (
        <div className="banner warn" style={{ marginBottom: 'var(--sp-2)' }}>
          The .eosproj build script was not imported; set a custom build command in Project Settings if you still need it.
          <div className="approval-command" style={{ margin: 'var(--sp-1h) 0 0' }}>{project.eosproj.buildScript}</div>
        </div>
      )}
      {project.candidates.length === 0 ? (
        <div className="banner">No .cpp file was found in this folder.</div>
      ) : (
        <div className="template-list">
          {project.candidates.map((c) => (
            <div key={c} className={`template-item${main === c ? ' selected' : ''}`} onClick={() => setMain(c)} role="radio" aria-checked={main === c}>
              <span className="radio-mark" />
              <div className="t-name" style={{ fontFamily: 'var(--font-mono)' }}>
                {c}
              </div>
            </div>
          ))}
        </div>
      )}
      {error && <div className="error-text">{error}</div>}
    </Modal>
  )
}
