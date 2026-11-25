// A small client for the editor engine (clangd in the toolchain distro), used by
// the scripted editor check. It starts the engine the way the app does: the
// compile database comes from src/main/compile-commands.ts, the arguments from
// src/main/clangd.ts, and incoming messages go through the app's address
// conversion (src/shared/lsp-paths.ts). The project is a copy of a shipped
// template in the system temp folder; nothing is written into the repository or
// into the distro.

import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { engineArguments } from '../../src/main/clangd'
import { compileCommands } from '../../src/main/compile-commands'
import { templateFiles } from '../../src/main/templates'
import { toWslPath } from '../../src/main/toolchain'
import { FLAG_SETUP, type LspDiagnostic } from '../../src/shared/lsp-diagnostics'
import { messageToClient, type PathMap } from '../../src/shared/lsp-paths'
import type { TemplateId } from '../../src/shared/project'

export const DEFAULT_DISTRO = 'waxmaster-wax-cdt-4.1.1wax01'

export function distroName(): string {
  return process.env.WAX_DISTRO?.trim() || DEFAULT_DISTRO
}

function wslExe(): string {
  return join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe')
}

/** "waxmaster-wax-cdt-4.1.1wax01" -> "4.1.1wax01" (the toolchain id inside the distro name). */
export function cdtVersionOf(distro: string): string {
  const m = /cdt-(\d.*)$/.exec(distro)
  return m ? m[1] : ''
}

/** True when `wsl.exe -l -q` lists the distro. */
export function distroInstalled(distro: string): boolean {
  if (process.platform !== 'win32') return false
  try {
    const r = spawnSync(wslExe(), ['-l', '-q'], { encoding: 'utf8', timeout: 20000, env: { ...process.env, WSL_UTF8: '1' } })
    const names = ((r.stdout ?? '') as string)
      .replace(/\0/g, '')
      .split(/\r?\n/)
      .map((s) => s.trim())
    return names.includes(distro)
  } catch {
    return false
  }
}

export interface CheckProject {
  /** Windows folder of the project. */
  root: string
  rootWsl: string
  contract: string
  /** Project-relative files, forward slashes, as the app writes them. */
  files: Record<string, string>
  cpp: string
  hpp: string
  dispose(): void
}

/** Writes a template (or example) as a new project in the system temp folder. */
export function makeProject(template: TemplateId, contract: string): CheckProject {
  const base = mkdtempSync(join(tmpdir(), 'waxmaster-check-'))
  const root = join(base, 'project')
  const files = templateFiles(template, contract)
  for (const [rel, text] of Object.entries(files)) {
    const p = join(root, ...rel.split('/'))
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, text)
  }
  return {
    root,
    rootWsl: toWslPath(root),
    contract,
    files,
    cpp: `src/${contract}.cpp`,
    hpp: `include/${contract}.hpp`,
    dispose: () => {
      try {
        rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
      } catch {
        // the engine may still hold its index files for a moment; the system temp folder is cleaned later
      }
    }
  }
}

export function offsetToPos(text: string, off: number): { line: number; character: number } {
  const before = text.slice(0, off)
  return { line: before.split('\n').length - 1, character: off - (before.lastIndexOf('\n') + 1) }
}

export interface Published {
  version: number | undefined
  diagnostics: LspDiagnostic[]
  at: number
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export class EngineClient {
  readonly map: PathMap
  readonly cdtRoot: string
  readonly cdtVersion: string
  private proc: ChildProcessWithoutNullStreams | null = null
  private buf = Buffer.alloc(0)
  private nextId = 1
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private versions = new Map<string, number>()
  private texts = new Map<string, string>()
  /** Latest publication per project-relative path, addresses already converted like the window does. */
  readonly published = new Map<string, Published>()
  private ccBase: string
  stderr = ''

  constructor(
    readonly project: CheckProject,
    readonly distro: string
  ) {
    this.cdtVersion = cdtVersionOf(distro)
    this.cdtRoot = `/usr/opt/cdt/${this.cdtVersion}`
    this.map = { rootWsl: project.rootWsl, toolchainRoots: [`${this.cdtRoot}/include`] }
    this.ccBase = join(project.root, '..', 'cc')
  }

  /** The project-relative path of a window address (`project:///src/a.cpp`), or '' for anything else. */
  projectPathOf = (uri: string): string => {
    const m = /^project:(?:\/\/)?\/(.*)$/.exec(uri)
    if (!m) return ''
    try {
      return m[1].split('/').map(decodeURIComponent).join('/')
    } catch {
      return ''
    }
  }

  serverUri(rel: string): string {
    return `file://${this.project.rootWsl}/${rel}`
  }

  windowUri(rel: string): string {
    return `project:///${rel}`
  }

  async start(): Promise<void> {
    mkdirSync(this.ccBase, { recursive: true })
    const cppFiles = Object.keys(this.project.files).filter((f) => f.startsWith('src/') && f.endsWith('.cpp'))
    const cc = compileCommands({ rootWsl: this.project.rootWsl, files: cppFiles, include: 'include', cdtRoot: this.cdtRoot, cdtVersion: this.cdtVersion, setup: FLAG_SETUP })
    writeFileSync(join(this.ccBase, 'compile_commands.json'), JSON.stringify(cc, null, 1))
    const ccWsl = toWslPath(this.ccBase)
    this.proc = spawn(wslExe(), ['-d', this.distro, '--cd', ccWsl, '--exec', 'clangd', ...engineArguments(ccWsl)], { env: { ...process.env, WSL_UTF8: '1' } })
    this.proc.stdout.on('data', (d: Buffer) => this.onData(d))
    this.proc.stderr.on('data', (d: Buffer) => (this.stderr += d.toString()))
    await this.request('initialize', {
      processId: null,
      rootUri: `file://${this.project.rootWsl}`,
      capabilities: {
        general: { positionEncodings: ['utf-16'] },
        textDocument: {
          synchronization: { didSave: true },
          completion: { contextSupport: true, completionItem: { snippetSupport: true, documentationFormat: ['markdown', 'plaintext'] } },
          hover: { contentFormat: ['markdown', 'plaintext'] },
          signatureHelp: { signatureInformation: { parameterInformation: { labelOffsetSupport: true }, activeParameterSupport: true } },
          publishDiagnostics: { codeActionsInline: true, relatedInformation: true, tagSupport: { valueSet: [1, 2] }, codeDescriptionSupport: true },
          codeAction: { codeActionLiteralSupport: { codeActionKind: { valueSet: ['', 'quickfix', 'refactor'] } } }
        }
      },
      initializationOptions: { clangdFileStatus: true }
    })
    this.notify('initialized', {})
  }

  private onData(d: Buffer): void {
    this.buf = Buffer.concat([this.buf, d])
    for (;;) {
      const i = this.buf.indexOf('\r\n\r\n')
      if (i < 0) return
      const m = /Content-Length: (\d+)/i.exec(this.buf.subarray(0, i).toString())
      const len = Number(m?.[1] ?? 0)
      if (this.buf.length < i + 4 + len) return
      const msg = JSON.parse(this.buf.subarray(i + 4, i + 4 + len).toString('utf8')) as Record<string, unknown>
      this.buf = this.buf.subarray(i + 4 + len)
      this.onMessage(msg)
    }
  }

  private onMessage(msg: Record<string, unknown>): void {
    if (msg.id !== undefined && msg.method) {
      this.send({ jsonrpc: '2.0', id: msg.id, result: null })
      return
    }
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id as number)
      this.pending.delete(msg.id as number)
      if (p) msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result)
      return
    }
    if (msg.method === 'textDocument/publishDiagnostics') {
      messageToClient(msg, this.map)
      const params = msg.params as { uri: string; version?: number; diagnostics: LspDiagnostic[] }
      const rel = this.projectPathOf(params.uri)
      if (rel) this.published.set(rel, { version: params.version, diagnostics: params.diagnostics, at: Date.now() })
    }
  }

  private send(msg: unknown): void {
    const s = JSON.stringify(msg)
    this.proc?.stdin.write(`Content-Length: ${Buffer.byteLength(s)}\r\n\r\n${s}`)
  }

  private request(method: string, params: unknown, timeoutMs = 90000): Promise<unknown> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${method} timed out`)), timeoutMs)
      this.pending.set(id, { resolve: (v) => (clearTimeout(t), resolve(v)), reject: (e) => (clearTimeout(t), reject(e)) })
      this.send({ jsonrpc: '2.0', id, method, params })
    })
  }

  private notify(method: string, params: unknown): void {
    this.send({ jsonrpc: '2.0', method, params })
  }

  text(rel: string): string {
    return this.texts.get(rel) ?? ''
  }

  /** Waits for a publication of `rel` for document version >= `version`. */
  private waitVersion(rel: string, version: number, timeoutMs = 90000): Promise<void> {
    return this.waitUntil(() => {
      const p = this.published.get(rel)
      return !!p && p.version !== undefined && p.version >= version
    }, timeoutMs, `diagnostics for ${rel} version ${version}`)
  }

  private async waitUntil(test: () => boolean, timeoutMs: number, what: string): Promise<void> {
    const t0 = Date.now()
    while (!test()) {
      if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${what}`)
      await sleep(40)
    }
  }

  /**
   * After a change that touches the #include lines the engine publishes twice
   * (first from the old parse, then the right one), so a result counts when no
   * new publication came for `quietMs`.
   */
  async settle(quietMs = 900, maxMs = 60000): Promise<void> {
    const t0 = Date.now()
    for (;;) {
      const last = Math.max(0, ...[...this.published.values()].map((p) => p.at))
      if (Date.now() - Math.max(last, t0) >= quietMs) return
      if (Date.now() - t0 > maxMs) return
      await sleep(50)
    }
  }

  async open(rel: string, text: string): Promise<void> {
    this.versions.set(rel, 1)
    this.texts.set(rel, text)
    this.notify('textDocument/didOpen', { textDocument: { uri: this.serverUri(rel), languageId: 'cpp', version: 1, text } })
    await this.waitVersion(rel, 1)
  }

  /** Replaces the whole text of an open document (an unsaved edit). */
  async change(rel: string, text: string): Promise<void> {
    const v = (this.versions.get(rel) ?? 1) + 1
    this.versions.set(rel, v)
    this.texts.set(rel, text)
    this.notify('textDocument/didChange', { textDocument: { uri: this.serverUri(rel), version: v }, contentChanges: [{ text }] })
    await this.waitVersion(rel, v)
  }

  /** Saves a file: written to the project folder, then didSave; waits for `other` to be re-checked (up to `waitMs`). */
  async save(rel: string, text: string, other?: string, waitMs = 8000): Promise<void> {
    writeFileSync(join(this.project.root, ...rel.split('/')), text)
    const t0 = Date.now()
    this.notify('textDocument/didSave', { textDocument: { uri: this.serverUri(rel) } })
    if (other) {
      try {
        await this.waitUntil(() => (this.published.get(other)?.at ?? 0) > t0, waitMs, `${other} to be checked again`)
      } catch {
        // an unchanged answer may not be published again; the caller settles anyway
      }
    }
  }

  async stop(): Promise<void> {
    try {
      await this.request('shutdown', null, 5000)
      this.notify('exit', null)
    } catch {
      // the engine may be gone already
    }
    const proc = this.proc
    if (proc && proc.exitCode === null) {
      const gone = new Promise<void>((r) => proc.once('exit', () => r()))
      proc.kill()
      await Promise.race([gone, sleep(3000)])
    }
  }
}
