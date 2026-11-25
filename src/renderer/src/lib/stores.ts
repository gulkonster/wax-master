// Small observable stores for the Output and Problems tabs.

import { useEffect, useState } from 'react'
import type { Problem } from '../../../shared/api'
import { emit } from './bus'

export class Store<T> {
  private listeners = new Set<() => void>()
  constructor(private value: T) {}
  get(): T {
    return this.value
  }
  set(v: T): void {
    this.value = v
    this.listeners.forEach((l) => l())
  }
  subscribe(l: () => void): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
}

export function useStore<T>(s: Store<T>): T {
  const [, force] = useState(0)
  useEffect(() => s.subscribe(() => force((n) => n + 1)), [s])
  return s.get()
}

const MAX_OUTPUT = 400_000

export const outputStore = new Store<string>('')
export function appendOutput(text: string): void {
  let v = outputStore.get() + text
  if (v.length > MAX_OUTPUT) v = v.slice(v.length - MAX_OUTPUT)
  outputStore.set(v)
}
export function clearOutput(): void {
  outputStore.set('')
}

export const problemsStore = new Store<Problem[]>([])

/**
 * Output and Problems belong to the open project: when another project is
 * opened (or the project is closed) both are emptied, and the editor markers
 * follow. The first call only records the project.
 */
let shownProject: string | null | undefined
export function panelsFollowProject(path: string | null): void {
  const changed = shownProject !== undefined && shownProject !== path
  shownProject = path
  if (!changed) return
  clearOutput()
  problemsStore.set([])
  emit('problems-updated')
}

export interface ToolchainLabel {
  ready: boolean
  label: string
}
export const toolchainStore = new Store<ToolchainLabel>({ ready: false, label: 'Toolchain not set up' })
