// Projects: create, open, configure, and file access inside the open project.
// Every path from the editor window is relative and is resolved and checked
// here, so file calls never leave the project folder.

import { randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, promises as fsp, readFileSync, readdirSync, realpathSync, statSync, writeFileSync, type Dirent } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { ExternalFile, FileContent, OpenProject, TreeNode } from '../shared/api'
import { PROJECT_FILE, defaultConfig, normalizeConfig, type ProjectConfig, type TemplateId } from '../shared/project'
import { findProject, upsertProject } from './store'
import { readJson, writeJson } from './jsonfile'
import { templateFiles } from './templates'

const MAX_EDIT_SIZE = 5 * 1024 * 1024
const MAX_TREE_ENTRIES = 5000
const SKIP_DIRS = new Set(['.git', 'node_modules'])

interface Current {
  root: string
  name: string
  config: ProjectConfig
  hasConfigFile: boolean
  eosproj?: EosProj
}

/** Values offered from an EOS Studio .eosproj file. Its build script is never imported. */
interface EosProj {
  main?: string
  contract?: string
  include: string
  resource: string
  output: string
  buildScript: string
}

function safeRel(v: unknown): string {
  if (typeof v !== 'string' || !v.trim()) return ''
  const s = v.trim().replace(/\\/g, '/')
  if (s.startsWith('/') || /^[a-zA-Z]:/.test(s) || s.split('/').includes('..')) return ''
  return s
}

function readEosproj(root: string): EosProj | undefined {
  const file = join(root, '.eosproj')
  try {
    if (!existsSync(file) || statSync(file).size > 64 * 1024) return undefined
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    const main = safeRel(raw.main)
    const contract = typeof raw.contract === 'string' && isValidContractName(raw.contract) ? raw.contract : undefined
    const scripts = (typeof raw.scripts === 'object' && raw.scripts !== null ? raw.scripts : {}) as Record<string, unknown>
    return {
      main: main && main.endsWith('.cpp') && existsSync(join(root, main)) ? main : undefined,
      contract,
      include: safeRel(raw.include),
      resource: safeRel(raw.resource),
      output: safeRel(raw.output),
      buildScript: typeof scripts.build === 'string' ? scripts.build : ''
    }
  } catch {
    return undefined
  }
}

let current: Current | null = null

export function currentProject(): Current | null {
  return current
}

export function isValidContractName(name: string): boolean {
  return /^[a-z1-5.]{1,12}$/.test(name) && !name.endsWith('.') && !name.startsWith('.')
}

/** Resolves a relative path inside the open project and refuses anything outside it. */
export function resolveInProject(rel: string): string {
  if (!current) throw new Error('No project is open')
  const root = current.root
  const target = resolve(root, rel)
  const r = relative(root, target)
  if (r.startsWith('..') || isAbsolute(r)) throw new Error('Path is outside the project')
  // Refuse paths that pass through a link pointing outside the project.
  let probe = target
  while (!existsSync(probe) && probe !== root) probe = dirname(probe)
  const real = realpathSync(probe)
  const realRoot = realpathSync(root)
  const rr = relative(realRoot, real)
  if (rr.startsWith('..') || isAbsolute(rr)) throw new Error('Path is outside the project')
  return target
}

function toRel(abs: string): string {
  if (!current) return abs
  return relative(current.root, abs).split(sep).join('/')
}

function findCppFiles(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string, depth: number): void => {
    if (depth > 4 || out.length > 200) return
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name)) continue
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p, depth + 1)
      else if (e.name.endsWith('.cpp')) out.push(relative(root, p).split(sep).join('/'))
    }
  }
  walk(root, 0)
  return out.sort((a, b) => {
    const sa = a.startsWith('src/') ? 0 : 1
    const sb = b.startsWith('src/') ? 0 : 1
    return sa - sb || a.localeCompare(b)
  })
}

function folderContractName(root: string): string {
  const base = basename(root).toLowerCase().replace(/[^a-z1-5.]/g, '').slice(0, 12)
  return base || 'contract'
}

function orderCandidates(list: string[], first?: string): string[] {
  if (!first) return list
  return [first, ...list.filter((x) => x !== first)]
}

function describe(): OpenProject {
  if (!current) throw new Error('No project is open')
  const entry = findProject(current.root)
  return {
    path: current.root,
    name: current.name,
    config: current.config,
    createdHere: entry?.createdHere ?? false,
    needsMainFile: !current.hasConfigFile,
    candidates: current.hasConfigFile ? [] : orderCandidates(findCppFiles(current.root), current.eosproj?.main),
    eosproj: !current.hasConfigFile && current.eosproj ? { buildScript: current.eosproj.buildScript } : undefined
  }
}

export function openProject(path: string): OpenProject {
  const root = resolve(path)
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error('Folder not found')
  const cfgFile = join(root, PROJECT_FILE)
  const name = basename(root)
  let config: ProjectConfig
  let hasConfigFile = false
  if (existsSync(cfgFile)) {
    config = normalizeConfig(readJson(cfgFile, {}), folderContractName(root))
    hasConfigFile = true
  } else {
    const contract = folderContractName(root)
    config = defaultConfig(contract)
  }
  current = { root, name, config, hasConfigFile, eosproj: hasConfigFile ? undefined : readEosproj(root) }
  upsertProject({ path: root, name, lastOpened: Date.now() })
  return describe()
}

/** Called when a folder without waxmaster.json is opened: the user picks the main file. */
export function setMainFile(main: string): OpenProject {
  if (!current) throw new Error('No project is open')
  const abs = resolveInProject(main)
  if (!existsSync(abs) || !abs.endsWith('.cpp')) throw new Error('Main file must be an existing .cpp file')
  const rel = toRel(abs)
  const stem = basename(rel, '.cpp').toLowerCase()
  const e = current.eosproj
  const contract = e?.contract ?? (isValidContractName(stem) ? stem : current.config.contract)
  current.config = { ...defaultConfig(contract, rel) }
  if (e) {
    current.config.include = e.include
    current.config.resource = e.resource
    current.config.output = e.output
  }
  writeJson(join(current.root, PROJECT_FILE), current.config)
  current.hasConfigFile = true
  return describe()
}

export function saveConfig(config: ProjectConfig): OpenProject {
  if (!current) throw new Error('No project is open')
  const normalized = normalizeConfig(config, current.config.contract)
  if (!isValidContractName(normalized.contract)) throw new Error('Contract name must be 1-12 characters a-z, 1-5 and dots')
  resolveInProject(normalized.main)
  current.config = normalized
  writeJson(join(current.root, PROJECT_FILE), normalized)
  current.hasConfigFile = true
  return describe()
}

export function closeProject(): void {
  current = null
}

export function createProject(template: TemplateId, name: string, parent: string): OpenProject {
  if (!isValidContractName(name)) {
    throw new Error('Name must be 1-12 characters: a-z, 1-5 and dots (it is also the contract name)')
  }
  const root = resolve(parent, name)
  if (existsSync(root)) throw new Error(`A folder named "${name}" already exists there`)
  mkdirSync(join(root, 'include'), { recursive: true })
  mkdirSync(join(root, 'src'), { recursive: true })
  mkdirSync(join(root, 'resource'), { recursive: true })
  const files = templateFiles(template, name)
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content, 'utf8')
  }
  writeJson(join(root, PROJECT_FILE), defaultConfig(name))
  writeFileSync(join(root, '.gitignore'), '*.wasm\n*.abi\n', 'utf8')
  upsertProject({ path: root, name, lastOpened: Date.now(), createdHere: true })
  return openProject(root)
}

export async function projectTree(): Promise<TreeNode> {
  if (!current) throw new Error('No project is open')
  let count = 0
  const walk = async (abs: string, depth: number): Promise<TreeNode[]> => {
    let entries: Dirent[]
    try {
      entries = await fsp.readdir(abs, { withFileTypes: true })
    } catch {
      return []
    }
    entries.sort((a, b) => {
      const da = a.isDirectory() ? 0 : 1
      const db = b.isDirectory() ? 0 : 1
      return da - db || a.name.localeCompare(b.name)
    })
    const nodes: TreeNode[] = []
    for (const e of entries) {
      if (++count > MAX_TREE_ENTRIES) break
      const p = join(abs, e.name)
      if (e.isSymbolicLink()) continue
      if (e.isDirectory()) {
        nodes.push({
          name: e.name,
          path: toRel(p),
          dir: true,
          children: SKIP_DIRS.has(e.name) || depth > 12 ? [] : await walk(p, depth + 1)
        })
      } else if (e.isFile()) {
        nodes.push({ name: e.name, path: toRel(p), dir: false })
      }
    }
    return nodes
  }
  return { name: current.name, path: '', dir: true, children: await walk(current.root, 0) }
}

function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000)
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true
  return false
}

export async function readProjectFile(rel: string): Promise<FileContent> {
  const abs = resolveInProject(rel)
  const st = await fsp.stat(abs)
  if (!st.isFile()) throw new Error('Not a file')
  if (st.size > MAX_EDIT_SIZE) return { path: toRel(abs), content: '', size: st.size, binary: false, tooLarge: true }
  const buf = await fsp.readFile(abs)
  if (looksBinary(buf)) return { path: toRel(abs), content: '', size: st.size, binary: true, tooLarge: false }
  return { path: toRel(abs), content: buf.toString('utf8'), size: st.size, binary: false, tooLarge: false }
}

/** Reads raw bytes of a project file (used by the main process only, e.g. .wasm info). */
export async function readProjectBytes(rel: string): Promise<Buffer> {
  return fsp.readFile(resolveInProject(rel))
}

export async function writeProjectFile(rel: string, content: string): Promise<void> {
  const abs = resolveInProject(rel)
  await fsp.mkdir(dirname(abs), { recursive: true })
  await fsp.writeFile(abs, content, 'utf8')
  if (current && rel.replace(/\\/g, '/') === PROJECT_FILE) {
    current.config = normalizeConfig(readJson(abs, {}), current.config.contract)
    current.hasConfigFile = true
  }
}

export async function createEntry(rel: string, dir: boolean): Promise<void> {
  const abs = resolveInProject(rel)
  if (existsSync(abs)) throw new Error('Already exists')
  if (dir) await fsp.mkdir(abs, { recursive: true })
  else {
    await fsp.mkdir(dirname(abs), { recursive: true })
    await fsp.writeFile(abs, '', { flag: 'wx' })
  }
}

export async function renameEntry(from: string, to: string): Promise<void> {
  const a = resolveInProject(from)
  const b = resolveInProject(to)
  if (a === current?.root) throw new Error('Cannot rename the project folder')
  if (existsSync(b)) throw new Error('Target already exists')
  await fsp.rename(a, b)
}

export async function removeEntry(rel: string): Promise<string> {
  const abs = resolveInProject(rel)
  if (abs === current?.root) throw new Error('Cannot delete the project folder')
  lstatSync(abs)
  return abs
}

// Files outside the project that the user picked in a dialog are tracked by a token,
// so the editor window never names an arbitrary path.
const externalFiles = new Map<string, string>()

export function registerExternal(absPath: string): ExternalFile {
  const token = randomUUID()
  externalFiles.set(token, absPath)
  return {
    token,
    name: basename(absPath),
    displayPath: absPath,
    content: readFileSync(absPath, 'utf8')
  }
}

export function relIfInProject(absPath: string): string | null {
  if (!current) return null
  const r = relative(current.root, absPath)
  if (r.startsWith('..') || isAbsolute(r)) return null
  return r.split(sep).join('/')
}

export async function writeExternal(token: string, content: string): Promise<void> {
  const p = externalFiles.get(token)
  if (!p) throw new Error('Unknown file')
  await fsp.writeFile(p, content, 'utf8')
}
