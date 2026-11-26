// Notices (E60): they slide down at the top of the window, above dialogs, so a result or an
// error is seen wherever the user is. Green when something is done, red on an error, neutral
// with the turning ring while something runs. A notice with a key replaces the one with the
// same key (a build's "Building..." becomes "Build completed" or "Build failed").

import { useEffect, useRef, useState } from 'react'
import { on } from '../lib/bus'
import { TOAST_MS, type ToastKind } from '../lib/toast'
import { IconCheck, IconClose, IconError, IconInfo } from './Icons'
import { Spinner } from './Busy'

interface T {
  id: number
  title: string
  text: string
  kind: ToastKind
  key?: string
}

let nextId = 1

export function Toasts(): React.JSX.Element {
  const [items, setItems] = useState<T[]>([])
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())
  const remove = (id: number): void => {
    clearTimeout(timers.current.get(id))
    timers.current.delete(id)
    setItems((s) => s.filter((x) => x.id !== id))
  }
  useEffect(
    () =>
      on('toast', (p) => {
        const t = { ...(p as Omit<T, 'id'>), id: nextId++ }
        setItems((s) => {
          const same = t.key ? s.filter((x) => x.key === t.key) : []
          for (const x of same) {
            clearTimeout(timers.current.get(x.id))
            timers.current.delete(x.id)
          }
          return [...s.filter((x) => !same.includes(x)).slice(-3), t]
        })
        const ms = TOAST_MS[t.kind]
        if (ms > 0) timers.current.set(t.id, setTimeout(() => remove(t.id), ms))
      }),
    []
  )
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <span className="t-icon">
            {t.kind === 'success' ? <IconCheck /> : t.kind === 'error' ? <IconError /> : t.kind === 'progress' ? <Spinner /> : <IconInfo />}
          </span>
          <div className="t-body">
            <div className="t-title">{t.title}</div>
            {t.text && <div className="t-text">{t.text}</div>}
          </div>
          {t.kind !== 'progress' && (
            <button className="icon-btn t-close" title="Close" onClick={() => remove(t.id)}>
              <IconClose />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
