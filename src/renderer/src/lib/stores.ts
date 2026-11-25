// Small observable stores for the Output and Problems tabs.

import { useEffect, useState } from 'react'
import type { Problem } from '../../../shared/api'
import { emit, on } from './bus'
import { mergeProblems } from '../../../shared/problems-merge'
import { LIVE_PROBLEMS_EVENT } from './lsp/problems'

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

/** The problems of the last build. */
export const problemsStore = new Store<Problem[]>([])
/** What the editor reports now (errors and warnings of the open documents). */
const liveProblemsStore = new Store<Problem[]>([])
/** The list the Problems tab and the build markers show: build and live problems, each once (B101). */
export const mergedProblemsStore = new Store<Problem[]>([])

/** Alternative version id of every open project file, by project-relative path. Set by the editor page. */
let versionSource: () => Map<string, number> = () => new Map()
export function setVersionSource(fn: () => Map<string, number>): void {
  versionSource = fn
}
/** The versions the last build started from. */
let builtVersions = new Map<string, number>()
/** Called when a build starts (after the files are saved). */
export function recordBuiltVersions(): void {
  builtVersions = new Map(versionSource())
}
/** Files whose text differs from the text that was built. */
export function changedSinceBuild(): Set<string> {
  const now = versionSource()
  const changed = new Set<string>()
  for (const [file, id] of builtVersions) {
    const cur = now.get(file)
    if (cur !== undefined && cur !== id) changed.add(file)
  }
  return changed
}

/** Recomputes the merged list; true when it differs from the one shown. */
export function refreshMerged(): boolean {
  const next = mergeProblems(problemsStore.get(), liveProblemsStore.get(), changedSinceBuild())
  const prev = mergedProblemsStore.get()
  const same = next.length === prev.length && next.every((p, i) => p === prev[i] || JSON.stringify(p) === JSON.stringify(prev[i]))
  if (!same) mergedProblemsStore.set(next)
  return !same
}

on(LIVE_PROBLEMS_EVENT, (payload) => {
  liveProblemsStore.set((payload as Problem[] | undefined) ?? [])
  if (refreshMerged()) emit('problems-updated')
})

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
  builtVersions = new Map()
  refreshMerged()
  emit('problems-updated')
}

export interface ToolchainLabel {
  ready: boolean
  label: string
}
export const toolchainStore = new Store<ToolchainLabel>({ ready: false, label: 'Toolchain not set up' })
