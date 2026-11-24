// What the status bar shows about the editor engine.

import { useEffect, useState } from 'react'

export type EngineState = 'off' | 'starting' | 'indexing' | 'ready' | 'error'

export interface EngineView {
  state: EngineState
  detail: string
  /** e.g. "42%" while the background index is built, or the file being parsed. */
  progress?: string
}

let value: EngineView = { state: 'off', detail: 'No project is open.' }
const listeners = new Set<() => void>()

export function engineView(): EngineView {
  return value
}

export function setEngineView(v: EngineView): void {
  if (v.state === value.state && v.detail === value.detail && v.progress === value.progress) return
  value = v
  listeners.forEach((l) => l())
}

export function useEngineView(): EngineView {
  const [, force] = useState(0)
  useEffect(() => {
    const l = (): void => force((n) => n + 1)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  return value
}
