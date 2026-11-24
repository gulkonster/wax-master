import { join } from 'node:path'
import type { ProjectEntry, Settings } from '../shared/api'
import { dataDir, defaultProjectsDir } from './paths'
import { readJson, writeJson } from './jsonfile'

interface StoreData {
  version: 1
  settings: Settings
  projects: ProjectEntry[]
  /** Custom build commands the user approved, per project folder and exact command text. */
  trustedCommands: { path: string; command: string }[]
}

function defaults(): StoreData {
  return {
    version: 1,
    settings: {
      fontSize: 14,
      defaultProjectFolder: defaultProjectsDir(),
      autoLockMinutes: 15,
      lockAfterSignature: false,
      updateCheck: true,
      terminalProfile: 'powershell',
      setupDismissed: false
    },
    projects: [],
    trustedCommands: []
  }
}

let cache: StoreData | null = null

function file(): string {
  return join(dataDir(), 'settings.json')
}

export function load(): StoreData {
  if (cache) return cache
  const d = defaults()
  const raw = readJson<Partial<StoreData>>(file(), {})
  cache = {
    version: 1,
    settings: { ...d.settings, ...(raw.settings ?? {}) },
    projects: Array.isArray(raw.projects) ? raw.projects : [],
    trustedCommands: Array.isArray(raw.trustedCommands) ? raw.trustedCommands : []
  }
  return cache
}

export function save(): void {
  if (cache) writeJson(file(), cache)
}

export function getSettings(): Settings {
  return { ...load().settings }
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const s = load()
  s.settings = { ...s.settings, ...patch }
  save()
  return { ...s.settings }
}

export function listProjects(): ProjectEntry[] {
  return [...load().projects].sort((a, b) => b.lastOpened - a.lastOpened)
}

function samePath(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

export function findProject(path: string): ProjectEntry | undefined {
  return load().projects.find((p) => samePath(p.path, path))
}

export function upsertProject(entry: Omit<ProjectEntry, 'starred' | 'createdHere'> & Partial<ProjectEntry>): ProjectEntry {
  const s = load()
  const existing = s.projects.find((p) => samePath(p.path, entry.path))
  if (existing) {
    existing.name = entry.name
    existing.lastOpened = entry.lastOpened
    if (entry.createdHere) existing.createdHere = true
    save()
    return existing
  }
  const e: ProjectEntry = {
    path: entry.path,
    name: entry.name,
    lastOpened: entry.lastOpened,
    starred: entry.starred ?? false,
    createdHere: entry.createdHere ?? false
  }
  s.projects.push(e)
  save()
  return e
}

export function setStar(path: string, starred: boolean): ProjectEntry[] {
  const p = findProject(path)
  if (p) {
    p.starred = starred
    save()
  }
  return listProjects()
}

export function removeProject(path: string): ProjectEntry[] {
  const s = load()
  s.projects = s.projects.filter((p) => !samePath(p.path, path))
  save()
  return listProjects()
}

export function isCommandTrusted(path: string, command: string): boolean {
  return load().trustedCommands.some((t) => samePath(t.path, path) && t.command === command)
}

export function trustCommand(path: string, command: string): void {
  const s = load()
  if (!isCommandTrusted(path, command)) {
    s.trustedCommands.push({ path, command })
    save()
  }
}
