// Editor engine: one clangd per open project, inside the toolchain distro.
//
// The app writes the engine's compile_commands.json into a per-project folder
// inside the distro (~/.waxmaster/projects/<id>/); a compile_commands.json or
// .clangd file in the project is never read (`--enable-config=false`, and the
// engine is pointed at our folder). clangd runs in the helper process; its
// messages are relayed to the editor window with every document address
// converted (see src/shared/lsp-paths.ts).

import type { WebContents } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { promises as fsp, type Dirent } from 'node:fs'
import { join, relative, sep } from 'node:path'
import type { EditorStatus } from '../shared/api'
import { effectiveInclude } from '../shared/project'
import { messageToClient, messageToServer, toolchainUriToPath, type PathMap } from '../shared/lsp-paths'
import { FLAG_SETUP, compileCommands, compileFlags } from './compile-commands'
import { lspKill, lspStart, lspWrite, onLspMessage, run, type LspProcessMessage } from './helper'
import { log } from './log'
import { currentProject } from './projects'
import { toWslPath, toolchainForProject, toolchainState, type ToolchainState } from './toolchain'

const MAX_MESSAGE_CHARS = 16 * 1024 * 1024
const MAX_HEADER_BYTES = 4 * 1024 * 1024
const MAX_CPP_FILES = 500
const SKIP_DIRS = new Set(['.git', 'node_modules'])

interface Engine {
  procId: string
  sender: WebContents
  root: string
  map: PathMap
  /** Distro folder that holds compile_commands.json and the index. */
  dir: string
  /** Settings the running engine was started with; a change restarts it. */
  key: string
  cdtRoot: string
  cdtVersion: string
}

let engine: Engine | null = null
let status: EditorStatus = { state: 'off', detail: 'No project is open.', session: 0, setup: FLAG_SETUP, cdtVersion: '' }
let generation = 0
let wired = false

function wslExe(): string {
  return join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe')
}

function setStatus(next: Omit<EditorStatus, 'session' | 'setup' | 'cdtVersion'> & { cdtVersion?: string }, sender?: WebContents | null): EditorStatus {
  status = { ...status, ...next }
  const s = sender ?? engine?.sender
  if (s && !s.isDestroyed()) s.send('editor-status', status)
  return status
}

export function editorStatus(): EditorStatus {
  return status
}

/** "wax-cdt-4.1.1wax01" -> "4.1.1wax01" */
function cdtVersionOf(toolchainId: string): string {
  const st = toolchainState(toolchainId)
  if (st?.cdtRoot) return st.cdtRoot.split('/').pop() ?? toolchainId
  return toolchainId.replace(/^(wax-)?cdt-/, '')
}

/** The toolchain whose headers the editor engine reads: the project's own choice when installed. */
function engineToolchain(): ToolchainState | null {
  const p = currentProject()
  return toolchainState(toolchainForProject(p?.config.cdt ?? '').id)
}

export function projectEngineId(root: string): string {
  return createHash('sha256').update(root.toLowerCase()).digest('hex').slice(0, 16)
}

/** The project's .cpp files for the engine: the main file and every .cpp under src/. */
async function sourceFiles(root: string, main: string): Promise<string[]> {
  const out: string[] = []
  if (main.endsWith('.cpp')) out.push(main.replace(/\\/g, '/'))
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 8 || out.length >= MAX_CPP_FILES) return
    let entries: Dirent[]
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name) || e.isSymbolicLink()) continue
      const p = join(dir, e.name)
      if (e.isDirectory()) await walk(p, depth + 1)
      else if (e.isFile() && e.name.endsWith('.cpp')) out.push(relative(root, p).split(sep).join('/'))
    }
  }
  await walk(join(root, 'src'), 0)
  return [...new Set(out)]
}

/** Writes compile_commands.json into the distro; returns the folder. */
async function writeCompileCommands(distro: string, id: string, json: string, cdtRoot: string): Promise<string> {
  const script = [
    'set -e',
    'test -d "$2/include" || { echo "NO-CDT"; exit 3; }',
    'd="$HOME/.waxmaster/projects/$1"',
    'mkdir -p "$d"',
    'cat > "$d/compile_commands.json.tmp"',
    'mv -f "$d/compile_commands.json.tmp" "$d/compile_commands.json"',
    'echo "DIR=$d"'
  ].join('\n')
  const r = await run(wslExe(), ['-d', distro, '--exec', 'bash', '-c', script, 'engine-setup', id, cdtRoot], {
    env: { WSL_UTF8: '1' },
    input: json,
    timeoutMs: 60000
  })
  const out = r.output.replace(/\0/g, '')
  if (out.includes('NO-CDT')) throw new Error(`The toolchain headers were not found at ${cdtRoot}.`)
  const m = /DIR=(\/[^\r\n]+)/.exec(out)
  if (r.code !== 0 || !m) throw new Error(`Could not prepare the editor engine (exit ${r.code}).`)
  return m[1].trim()
}

interface Prepared {
  map: PathMap
  dir: string
  key: string
  cdtRoot: string
  cdtVersion: string
}

/** The engine's own arguments (after `wsl.exe -d <distro> --cd <dir> --exec clangd`). */
export function engineArguments(dir: string): string[] {
  return [
    `--compile-commands-dir=${dir}`,
    '--background-index',
    '--header-insertion=never',
    '--log=error',
    '--enable-config=false',
    // No clang-tidy: a project .clang-tidy file must not steer the editor engine.
    '--clang-tidy=false'
  ]
}

/** Hash of the compile flags and engine arguments: a change of either restarts a running engine. */
function flagsHash(cdtRoot: string, cdtVersion: string, dir: string): string {
  const list = [FLAG_SETUP, ...compileFlags(FLAG_SETUP, cdtRoot, cdtVersion, []), '--', ...engineArguments(dir)]
  return createHash('sha256').update(JSON.stringify(list)).digest('hex').slice(0, 16)
}

async function prepare(distro: string, toolchainId: string): Promise<Prepared> {
  const p = currentProject()
  if (!p) throw new Error('No project is open.')
  const cdtVersion = cdtVersionOf(toolchainId)
  const cdtRoot = `/usr/opt/cdt/${cdtVersion}`
  const rootWsl = toWslPath(p.root)
  const include = effectiveInclude(p.config)
  const files = await sourceFiles(p.root, p.config.main)
  const commands = compileCommands({ rootWsl, files, include, cdtRoot, cdtVersion })
  const dir = await writeCompileCommands(distro, projectEngineId(p.root), JSON.stringify(commands, null, 1), cdtRoot)
  return {
    map: { rootWsl, toolchainRoots: [`${cdtRoot}/include`] },
    dir,
    key: JSON.stringify([p.root, include, p.config.main, toolchainId, flagsHash(cdtRoot, cdtVersion, dir)]),
    cdtRoot,
    cdtVersion
  }
}

function wire(): void {
  if (wired) return
  wired = true
  onLspMessage((m: LspProcessMessage) => {
    const e = engine
    if (!e || (m.id !== e.procId && m.id !== '*')) return
    if (m.type === 'lsp-msg' && m.text !== undefined) {
      if (m.text.length > 2 * MAX_MESSAGE_CHARS) return
      let msg: unknown
      try {
        msg = JSON.parse(m.text)
      } catch {
        return
      }
      if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) return
      try {
        messageToClient(msg as Record<string, unknown>, e.map)
      } catch {
        return
      }
      if (!e.sender.isDestroyed()) e.sender.send('editor-message', status.session, msg)
    } else if (m.type === 'lsp-err' && m.data) {
      log.warn(`Editor engine: ${m.data}`)
    } else if (m.type === 'lsp-exit') {
      engine = null
      log.warn(`Editor engine ended (${m.code}${m.error ? `, ${m.error}` : ''})`)
      setStatus(
        { state: 'error', detail: 'The editor engine stopped. Click to restart it.' },
        e.sender
      )
    }
  })
}

function killEngine(now = false): void {
  const e = engine
  engine = null
  if (!e) return
  try {
    lspWrite(e.procId, JSON.stringify({ jsonrpc: '2.0', method: 'exit' }))
  } catch {
    // the helper may be gone
  }
  lspKill(e.procId, now)
}

/** Starts (or restarts) the engine for the open project. */
export async function startEditor(sender: WebContents): Promise<EditorStatus> {
  wire()
  const gen = ++generation
  killEngine()
  const p = currentProject()
  if (!p) return setStatus({ state: 'off', detail: 'No project is open.' }, sender)
  const tc = engineToolchain()
  if (!tc) {
    return setStatus(
      { state: 'off', cdtVersion: '', detail: 'Code intelligence is off: the toolchain is not set up (Help > Setup). Syntax colors still work.' },
      sender
    )
  }
  status = { ...status, session: status.session + 1 }
  setStatus({ state: 'starting', detail: 'Starting the editor engine...' }, sender)
  let prep: Prepared
  try {
    prep = await prepare(tc.distro, tc.id)
  } catch (err) {
    if (gen !== generation) return status
    return setStatus({ state: 'error', detail: err instanceof Error ? err.message : String(err) }, sender)
  }
  if (gen !== generation) return status
  const procId = randomUUID()
  engine = { procId, sender, root: p.root, ...prep }
  lspStart(
    procId,
    wslExe(),
    ['-d', tc.distro, '--cd', prep.dir, '--exec', 'clangd', ...engineArguments(prep.dir)],
    undefined,
    { WSL_UTF8: '1' }
  )
  return setStatus({ state: 'running', detail: 'Editor engine running.', cdtVersion: prep.cdtVersion }, sender)
}

export function stopEditor(detail = 'No project is open.', now = false): void {
  generation++
  const sender = engine?.sender
  killEngine(now)
  setStatus({ state: 'off', detail }, sender)
}

/**
 * Called when the project's settings or file list change: rewrites
 * compile_commands.json, and restarts the engine when the settings it was
 * started with changed.
 */
export async function refreshEditor(): Promise<void> {
  const e = engine
  const tc = engineToolchain()
  if (!e || !tc) return
  const p = currentProject()
  if (!p || p.root !== e.root) return
  try {
    const gen = generation
    const prep = await prepare(tc.distro, tc.id)
    if (gen !== generation || engine !== e) return
    if (prep.key !== e.key) await startEditor(e.sender)
  } catch (err) {
    log.warn(`Editor engine refresh failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** Sends one message from the window to the engine of the current session. */
export function sendToEditor(session: number, msg: Record<string, unknown>): void {
  const e = engine
  if (!e || session !== status.session) return
  if (msg.jsonrpc !== '2.0') throw new Error('Not a JSON-RPC 2.0 message')
  if ('method' in msg && (typeof msg.method !== 'string' || msg.method.length > 200)) throw new Error('Invalid method')
  messageToServer(msg, e.map)
  const text = JSON.stringify(msg)
  if (text.length > MAX_MESSAGE_CHARS) throw new Error('Message too large')
  lspWrite(e.procId, text)
}

/** Reads a toolchain header for a read-only tab; only files under the toolchain header folders. */
export async function readToolchainFile(uri: string): Promise<string> {
  const tc = engineToolchain()
  if (!tc) throw new Error('The toolchain is not set up.')
  const cdtRoot = `/usr/opt/cdt/${cdtVersionOf(tc.id)}`
  const roots = [`${cdtRoot}/include`]
  const path = toolchainUriToPath(uri, roots)
  // Links are resolved inside the distro and the target must still be a toolchain header.
  const script = [
    'p=$(realpath -e -- "$1") || exit 4',
    'case "$p" in "$2"/*) ;; *) exit 5 ;; esac',
    'test -f "$p" || exit 4',
    `s=$(stat -c %s -- "$p"); [ "$s" -le ${MAX_HEADER_BYTES} ] || exit 6`,
    'cat -- "$p"'
  ].join('\n')
  const r = await run(wslExe(), ['-d', tc.distro, '--exec', 'bash', '-c', script, 'read-header', path, `${cdtRoot}/include`], {
    timeoutMs: 30000
  })
  if (r.code === 6) throw new Error('This header is too large to show.')
  if (r.code !== 0) throw new Error('This header could not be read.')
  return r.output
}
