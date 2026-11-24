import { useContext, useEffect, useRef, useState } from 'react'
import type { DialogSize } from '../../../shared/api'
import { AppContext } from '../state'
import { errorText } from '../lib/toast'
import { IconClose } from './Icons'

/** Dialog widths of B28: S (text input, delete, unlock), M (forms), L (lists and tables). */
export type ModalSize = 's' | 'm' | 'l'

/** A size token of styles.css in pixels (the scale lives only there). */
function token(name: string): number {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0
}

/** Largest size a dialog may have in the current window. */
function limits(): { minW: number; minH: number; maxW: number; maxH: number } {
  const maxW = window.innerWidth - 2 * token('--dialog-edge')
  const maxH = window.innerHeight - token('--titlebar') - token('--dialog-top')
  return { minW: Math.min(token('--dialog-min-w'), maxW), minH: Math.min(token('--dialog-min-h'), maxH), maxW, maxH }
}

const clamp = (v: number, lo: number, hi: number): number => Math.round(Math.max(lo, Math.min(hi, v)))

export function Modal({
  title,
  children,
  footer,
  onClose,
  size,
  name
}: {
  title: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
  onClose?: () => void
  size: ModalSize
  /** Name under which a size the user drags is remembered in the settings. */
  name: string
}): React.JSX.Element {
  const app = useContext(AppContext)
  const stored = app?.state.settings?.dialogSizes?.[name] ?? null
  const [dragged, setDragged] = useState<DialogSize | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const current = dragged ?? stored

  useEffect(() => {
    if (!onClose) return
    const h = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      // Only the dialog on top closes (the unlock prompt over a form, a dialog over another).
      const all = document.querySelectorAll('.modal')
      if (all.length > 0 && all[all.length - 1] !== boxRef.current) return
      onClose()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  // Drag of the corner grip. The dialog is centred across and anchored at the top, so the
  // width grows by twice the pointer movement and the height by the movement itself:
  // the corner stays under the pointer.
  const startDrag = (e: React.PointerEvent<HTMLDivElement>): void => {
    const box = boxRef.current
    if (!box || e.button !== 0) return
    e.preventDefault()
    const grip = e.currentTarget
    try {
      grip.setPointerCapture(e.pointerId)
    } catch {
      // Without capture the window listeners below still follow the pointer.
    }
    const rect = box.getBoundingClientRect()
    const start = { x: e.clientX, y: e.clientY, w: rect.width, h: rect.height }
    let last: DialogSize | null = null
    const move = (ev: PointerEvent): void => {
      const l = limits()
      last = {
        width: clamp(start.w + 2 * (ev.clientX - start.x), l.minW, l.maxW),
        height: clamp(start.h + (ev.clientY - start.y), l.minH, l.maxH)
      }
      setDragged(last)
    }
    const end = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      if (last) void app?.actions.updateSettings({ dialogSizes: { [name]: last } }).catch(() => undefined)
    }
    // On the window, so the drag ends wherever the pointer is released.
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  // Double click on the grip: back to the default size, and the remembered size is forgotten.
  const reset = (): void => {
    setDragged(null)
    if (stored) void app?.actions.updateSettings({ dialogSizes: { [name]: null } }).catch(() => undefined)
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div
        ref={boxRef}
        className={`modal size-${size}${current ? ' sized' : ''}`}
        role="dialog"
        data-dialog={name}
        style={current ? { width: current.width, height: current.height } : undefined}
      >
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
        <div className="modal-grip" title="Drag to resize; double click for the default size" onPointerDown={startDrag} onDoubleClick={reset} />
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
      size="s"
      name="text-input"
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
