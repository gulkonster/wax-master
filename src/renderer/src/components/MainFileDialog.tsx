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
        This folder has no <span className="code-tag">waxmaster.json</span> yet. Choose the contract&apos;s main source file; the
        other settings start with their defaults and can be changed in Project Settings.
      </p>
      {project.eosproj && (
        <div className="hint" style={{ fontSize: 13, lineHeight: '20px', marginBottom: 8 }}>
          Settings taken from .eosproj.
          {project.eosproj.buildScript.trim() && (
            <>
              {' '}Its build script was not imported:
              <div className="approval-command" style={{ margin: '6px 0' }}>{project.eosproj.buildScript}</div>
              Set a custom build command in Project Settings if you still need one.
            </>
          )}
        </div>
      )}
      {project.candidates.length === 0 ? (
        <div className="error-text">No .cpp file was found in this folder.</div>
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
