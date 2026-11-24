// Build fingerprint and the stored result of the last build per project.
// The fingerprint is SHA-256 over the sorted list of (relative path, size,
// modified time) of every file under the project folder except the output
// WASM / ABI and `.git`, plus the build command text and the toolchain id.
// The project file `waxmaster.json` counts by its content without the
// `deploy` key, so saving a deploy account or target does not cause a build.
// The state is kept in memory and in build-state.json in the app data folder
// (never in the project).

import { createHash } from 'node:crypto'
import { promises as fsp, type Dirent } from 'node:fs'
import { join, resolve } from 'node:path'
import type { AbiFinding, BuildOutcome } from '../shared/api'
import { readJson, writeJson } from './jsonfile'

/** Above this many files no fingerprint is made and every request builds. */
export const MAX_FINGERPRINT_FILES = 20_000
/** At most this many projects are remembered (oldest builds are dropped). */
const MAX_PROJECTS = 100
/** The project file whose deploy block does not count in the fingerprint (project root only). */
const PROJECT_FILE = 'waxmaster.json'
const MAX_PROJECT_FILE = 1024 * 1024
/** Stored limits: findings kept, and the length of one stored explanation. */
const MAX_STORED_FINDINGS = 50
const MAX_STORED_TEXT = 4000

/** JSON text with object keys sorted at every level. */
function sortedJson(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(sortedJson).join(',') + ']'
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + sortedJson(o[k])).join(',') + '}'
  }
  return JSON.stringify(v) ?? 'null'
}

/** The project file's content without its `deploy` key; null when it cannot be read or parsed. */
async function projectFileContent(path: string, size: number): Promise<string | null> {
  if (size > MAX_PROJECT_FILE) return null
  try {
    const parsed: unknown = JSON.parse(await fsp.readFile(path, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const rest = { ...(parsed as Record<string, unknown>) }
    delete rest.deploy
    return sortedJson(rest)
  } catch {
    return null
  }
}

export interface StoredBuild {
  /** null: the project has too many files for a fingerprint. */
  fingerprint: string | null
  result: BuildOutcome
  builtAt: number
  toolchain: string
  command: string
  abiFindings: AbiFinding[]
  /** SHA-256 of the ABI file the findings are about (empty when none). */
  abiSha256: string
}

/**
 * Fingerprint of a project folder. `exclude` lists project-relative paths
 * (forward slashes) left out, such as the output WASM and ABI. Returns null
 * when the folder has more than MAX_FINGERPRINT_FILES files.
 */
export async function projectFingerprint(root: string, opts: { exclude: string[]; command: string; toolchain: string }): Promise<string | null> {
  const exclude = new Set(opts.exclude.map((p) => p.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()))
  const items: string[] = []
  let tooMany = false
  const walk = async (dir: string, rel: string): Promise<void> => {
    if (tooMany) return
    let entries: Dirent[]
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (tooMany) return
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        if (e.name === '.git') continue
        await walk(join(dir, e.name), r)
        continue
      }
      if (exclude.has(r.toLowerCase())) continue
      // Files and links: a link counts with its own size and time (it is not followed).
      try {
        const st = await fsp.lstat(join(dir, e.name))
        const content = r === PROJECT_FILE && st.isFile() ? await projectFileContent(join(dir, e.name), st.size) : null
        items.push(content !== null ? `${r}\u0000content\u0000${content}` : `${r}\u0000${st.size}\u0000${Math.round(st.mtimeMs)}`)
      } catch {
        continue
      }
      if (items.length > MAX_FINGERPRINT_FILES) tooMany = true
    }
  }
  await walk(root, '')
  if (tooMany) return null
  items.sort()
  const h = createHash('sha256')
  h.update(`command\u0000${opts.command}\ntoolchain\u0000${opts.toolchain}\n`)
  for (const it of items) h.update(it + '\n')
  return h.digest('hex')
}

function keyOf(root: string): string {
  return resolve(root).replace(/[\\/]+$/, '').toLowerCase()
}

function isFinding(v: unknown): v is AbiFinding {
  const f = v as AbiFinding
  return !!f && typeof f.kind === 'string' && typeof f.text === 'string' && typeof f.subject === 'string' && typeof f.type === 'string'
}

/** A relative project path: no `..`, no drive, no leading slash. */
function isRelativePath(p: unknown): p is string {
  if (typeof p !== 'string' || p === '' || p.length > 1024) return false
  if (/^[\\/]/.test(p) || /^[A-Za-z]:/.test(p) || p.includes('\u0000')) return false
  return !p.split(/[\\/]/).some((s) => s === '..')
}

function isLineNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1
}

/** A stored finding as read back: the place only when it is a safe project place, the text cut. */
function storedFinding(f: AbiFinding): AbiFinding {
  const p = f.place as { file?: unknown; line?: unknown; column?: unknown } | null
  const place = p && isRelativePath(p.file) && isLineNumber(p.line) && isLineNumber(p.column) ? { file: p.file, line: p.line, column: p.column } : null
  return { kind: f.kind, subject: f.subject, type: f.type, text: f.text.slice(0, MAX_STORED_TEXT), place }
}

function sanitize(v: unknown): StoredBuild | null {
  const s = v as StoredBuild
  if (!s || typeof s !== 'object') return null
  if (s.result !== 'ok' && s.result !== 'failed' && s.result !== 'abi-not-deployable') return null
  if (typeof s.builtAt !== 'number' || (s.fingerprint !== null && typeof s.fingerprint !== 'string')) return null
  return {
    fingerprint: s.fingerprint,
    result: s.result,
    builtAt: s.builtAt,
    toolchain: typeof s.toolchain === 'string' ? s.toolchain : '',
    command: typeof s.command === 'string' ? s.command : '',
    abiFindings: Array.isArray(s.abiFindings) ? s.abiFindings.filter(isFinding).slice(0, MAX_STORED_FINDINGS).map(storedFinding) : [],
    abiSha256: typeof s.abiSha256 === 'string' ? s.abiSha256 : ''
  }
}

/** Stored build results, in memory and in one JSON file. */
export class BuildStateStore {
  private map: Map<string, StoredBuild> | null = null
  constructor(private readonly file: () => string) {}

  private load(): Map<string, StoredBuild> {
    if (this.map) return this.map
    const raw = readJson<{ version?: number; projects?: Record<string, unknown> }>(this.file(), {})
    const m = new Map<string, StoredBuild>()
    if (raw && typeof raw.projects === 'object' && raw.projects !== null) {
      for (const [k, v] of Object.entries(raw.projects)) {
        const s = sanitize(v)
        if (s) m.set(k, s)
      }
    }
    this.map = m
    return m
  }

  get(root: string): StoredBuild | null {
    return this.load().get(keyOf(root)) ?? null
  }

  set(root: string, s: StoredBuild): void {
    const m = this.load()
    m.delete(keyOf(root))
    m.set(keyOf(root), s)
    if (m.size > MAX_PROJECTS) {
      const oldest = [...m.entries()].sort((a, b) => a[1].builtAt - b[1].builtAt).slice(0, m.size - MAX_PROJECTS)
      for (const [k] of oldest) m.delete(k)
    }
    try {
      writeJson(this.file(), { version: 1, projects: Object.fromEntries(m) })
    } catch {
      // The memory copy still answers; the file is written again on the next build.
    }
  }
}
