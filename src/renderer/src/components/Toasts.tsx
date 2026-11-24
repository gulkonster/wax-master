import { useEffect, useState } from 'react'
import { on } from '../lib/bus'
import type { ToastKind } from '../lib/toast'
import { IconCheck, IconError, IconInfo } from './Icons'

interface T {
  id: number
  title: string
  text: string
  kind: ToastKind
}

let nextId = 1

export function Toasts(): React.JSX.Element {
  const [items, setItems] = useState<T[]>([])
  useEffect(
    () =>
      on('toast', (p) => {
        const t = { ...(p as Omit<T, 'id'>), id: nextId++ }
        setItems((s) => [...s.slice(-4), t])
        setTimeout(() => setItems((s) => s.filter((x) => x.id !== t.id)), t.kind === 'error' ? 8000 : 4000)
      }),
    []
  )
  return (
    <div className="toasts">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => setItems((s) => s.filter((x) => x.id !== t.id))}>
          <span className="t-icon">{t.kind === 'success' ? <IconCheck /> : t.kind === 'error' ? <IconError /> : <IconInfo />}</span>
          <div>
            <div className="t-title">{t.title}</div>
            {t.text && <div className="t-text">{t.text}</div>}
          </div>
        </div>
      ))}
    </div>
  )
}
