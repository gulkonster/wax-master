import { useState } from 'react'
import { TEMPLATES, type TemplateId } from '../../../shared/project'
import { useApp } from '../state'
import { errorText } from '../lib/toast'
import { Modal } from './Modal'

export function NewProjectDialog({ onClose, initialTemplate }: { onClose: () => void; initialTemplate?: TemplateId }): React.JSX.Element {
  const { state, actions } = useApp()
  const [template, setTemplate] = useState<TemplateId>(initialTemplate ?? 'hello')
  const [name, setName] = useState(initialTemplate === 'token' ? 'token' : 'hello')
  const [parent, setParent] = useState(state.settings?.defaultProjectFolder ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const valid = /^[a-z1-5.]{1,12}$/.test(name) && !name.startsWith('.') && !name.endsWith('.')

  const create = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const p = await window.wax.projects.create(template, name, parent)
      actions.projectOpened(p)
      onClose()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      size="m"
      name="new-project"
      title="New Project"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => void create()} disabled={!valid || !parent || busy}>
            Create
          </button>
        </>
      }
    >
      <div className="field">
        <label>Template</label>
        <div className="template-list">
          {TEMPLATES.map((t) => (
            <div
              key={t.id}
              className={`template-item${template === t.id ? ' selected' : ''}`}
              role="radio"
              aria-checked={template === t.id}
              onClick={() => {
                setTemplate(t.id)
                if (['hello', 'token', 'contract'].includes(name)) setName(t.id === 'empty' ? 'contract' : t.id)
              }}
            >
              <span className="radio-mark" />
              <div>
                <div className="t-name">{t.label}</div>
                <div className="t-desc">{t.description}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="field">
        <label>Name (also the contract name)</label>
        <input className="input mono" value={name} onChange={(e) => setName(e.target.value.toLowerCase())} autoFocus />
        <div className="hint">1-12 characters: a-z, 1-5 and dots.</div>
      </div>
      <div className="field">
        <label>Location</label>
        <div className="field-row">
          <input className="input mono" value={parent} onChange={(e) => setParent(e.target.value)} />
          <button
            className="btn"
            onClick={async () => {
              const p = await window.wax.projects.chooseParentFolder(parent)
              if (p) setParent(p)
            }}
          >
            Browse...
          </button>
        </div>
        <div className="hint">The project is created in a new folder named after it.</div>
      </div>
      {error && <div className="error-text">{error}</div>}
    </Modal>
  )
}
