import { useState } from 'react'
import { EXAMPLES, TEMPLATES, type TemplateId } from '../../../shared/project'
import { useApp } from '../state'
import { errorText } from '../lib/toast'
import { Modal } from './Modal'

/** The project name offered for a template or example. */
function defaultName(id: TemplateId): string {
  if (id === 'empty') return 'contract'
  return EXAMPLES.find((e) => e.id === id)?.name ?? id
}

const DEFAULT_NAMES = new Set([...TEMPLATES, ...EXAMPLES].map((t) => defaultName(t.id)))

export function NewProjectDialog({ onClose, initialTemplate }: { onClose: () => void; initialTemplate?: TemplateId }): React.JSX.Element {
  const { state, actions } = useApp()
  const [template, setTemplate] = useState<TemplateId>(initialTemplate ?? 'hello')
  const [name, setName] = useState(defaultName(initialTemplate ?? 'hello'))
  const [parent, setParent] = useState(state.settings?.defaultProjectFolder ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const valid = /^[a-z1-5.]{1,12}$/.test(name) && !name.startsWith('.') && !name.endsWith('.')

  const pick = (id: TemplateId): void => {
    setTemplate(id)
    if (DEFAULT_NAMES.has(name)) setName(defaultName(id))
  }

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
      help="newProject"
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
        <div className="template-list" role="radiogroup" aria-label="Template">
          {TEMPLATES.map((t) => (
            <TemplateItem key={t.id} label={t.label} description={t.description} selected={template === t.id} onPick={() => pick(t.id)} />
          ))}
        </div>
      </div>
      <div className="field">
        <label>Examples</label>
        <div className="template-list" role="radiogroup" aria-label="Examples">
          {EXAMPLES.map((t) => (
            <TemplateItem key={t.id} label={t.label} description={t.description} selected={template === t.id} onPick={() => pick(t.id)} />
          ))}
        </div>
        <div className="hint">Each example is a full project; its README.md lists the steps to build, deploy and try it on WAX Testnet.</div>
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

function TemplateItem({ label, description, selected, onPick }: { label: string; description: string; selected: boolean; onPick: () => void }): React.JSX.Element {
  return (
    <div className={`template-item${selected ? ' selected' : ''}`} role="radio" aria-checked={selected} onClick={onPick}>
      <span className="radio-mark" />
      <div>
        <div className="t-name">{label}</div>
        <div className="t-desc">{description}</div>
      </div>
    </div>
  )
}
