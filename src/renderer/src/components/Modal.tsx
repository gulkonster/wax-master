import { useEffect, useState } from 'react'
import { errorText } from '../lib/toast'
import { IconClose } from './Icons'

export function Modal({
  title,
  children,
  footer,
  onClose,
  wide
}: {
  title: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
  onClose?: () => void
  wide?: boolean
}): React.JSX.Element {
  useEffect(() => {
    if (!onClose) return
    const h = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog">
        <div className="modal-head">
          <div className="modal-title">{title}</div>
          {onClose && (
            <button className="icon-btn" title="Close" onClick={onClose}>
              <IconClose />
            </button>
          )}
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

/** A small text-input dialog. */
export function InputDialog({
  title,
  label,
  initial,
  okLabel = 'OK',
  onOk,
  onClose
}: {
  title: string
  label: string
  initial: string
  okLabel?: string
  onOk: (value: string) => Promise<void> | void
  onClose: () => void
}): React.JSX.Element {
  return (
    <InputDialogInner title={title} label={label} initial={initial} okLabel={okLabel} onOk={onOk} onClose={onClose} />
  )
}


function InputDialogInner(props: {
  title: string
  label: string
  initial: string
  okLabel: string
  onOk: (value: string) => Promise<void> | void
  onClose: () => void
}): React.JSX.Element {
  const [value, setValue] = useState(props.initial)
  const [error, setError] = useState('')
  const submit = async (): Promise<void> => {
    try {
      await props.onOk(value.trim())
      props.onClose()
    } catch (e) {
      setError(errorText(e))
    }
  }
  return (
    <Modal
      title={props.title}
      onClose={props.onClose}
      footer={
        <>
          <button className="btn" onClick={props.onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => void submit()} disabled={!value.trim()}>
            {props.okLabel}
          </button>
        </>
      }
    >
      <div className="field">
        <label>{props.label}</label>
        <input
          className="input"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
          onFocus={(e) => {
            const dot = e.target.value.lastIndexOf('.')
            const slash = e.target.value.lastIndexOf('/')
            e.target.setSelectionRange(slash + 1, dot > slash ? dot : e.target.value.length)
          }}
        />
      </div>
      {error && <div className="error-text">{error}</div>}
    </Modal>
  )
}
