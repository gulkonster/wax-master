// Starts the helper process and runs commands through it.

import { utilityProcess, type UtilityProcess } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { childEnvironment } from './clean-env'
import { log } from './log'

let proc: UtilityProcess | null = null
const waiters = new Map<string, { onOut?: (s: string, stream: 'stdout' | 'stderr') => void; done: (r: RunResult) => void; out: string[]; keep: boolean }>()

export interface RunResult {
  code: number
  output: string
  error?: string
}

function ensure(): UtilityProcess {
  if (proc) return proc
  proc = utilityProcess.fork(join(__dirname, 'helper.js'), [], {
    serviceName: 'WAX Master Helper',
    env: childEnvironment(),
    stdio: 'ignore'
  })
  proc.on('message', (m: { type: string; id: string; stream?: 'stdout' | 'stderr'; data?: string; code?: number; error?: string }) => {
    if (m.type.startsWith('pty-')) {
      ptyListener?.(m)
      return
    }
    if (m.type.startsWith('lsp-')) {
      lspListener?.(m as LspProcessMessage)
      return
    }
    const w = waiters.get(m.id)
    if (!w) return
    if (m.type === 'out' && m.data !== undefined) {
      if (w.keep) w.out.push(m.data)
      w.onOut?.(m.data, m.stream ?? 'stdout')
    } else if (m.type === 'exit') {
      waiters.delete(m.id)
      w.done({ code: m.code ?? -1, output: w.out.join(''), error: m.error })
    }
  })
  proc.on('exit', (code) => {
    log.warn(`Helper process ended (${code})`)
    proc = null
    lspListener?.({ type: 'lsp-exit', id: '*', code: -1, error: 'Helper process ended' })
    for (const [id, w] of waiters) {
      waiters.delete(id)
      w.done({ code: -1, output: w.out.join(''), error: 'Helper process ended' })
    }
  })
  return proc
}

export interface RunOptions {
  cwd?: string
  env?: Record<string, string>
  input?: string
  onOutput?: (text: string, stream: 'stdout' | 'stderr') => void
  timeoutMs?: number
  /** False for a process kept open for hours: its output goes only to `onOutput`, not into the result. */
  keepOutput?: boolean
}

export function run(file: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const p = ensure()
  const id = randomUUID()
  return new Promise((resolve) => {
    let timer: NodeJS.Timeout | undefined
    waiters.set(id, {
      onOut: opts.onOutput,
      out: [],
      keep: opts.keepOutput !== false,
      done: (r) => {
        if (timer) clearTimeout(timer)
        resolve(r)
      }
    })
    if (opts.timeoutMs) {
      timer = setTimeout(() => {
        p.postMessage({ type: 'kill', id })
      }, opts.timeoutMs)
    }
    p.postMessage({ type: 'run', id, file, args, cwd: opts.cwd, env: childEnvironment(opts.env), input: opts.input })
  })
}

export function stopHelper(): void {
  proc?.kill()
  proc = null
}

export interface PtyMessage {
  type: string
  id: string
  data?: string
  code?: number
  error?: string
}

let ptyListener: ((m: PtyMessage) => void) | null = null

export function onPtyMessage(fn: (m: PtyMessage) => void): void {
  ptyListener = fn
}

export function ptyStart(id: string, file: string, args: string[], cwd: string, cols: number, rows: number, env: Record<string, string>): void {
  ensure().postMessage({ type: 'pty-start', id, file, args, cwd, env: childEnvironment(env), cols, rows })
}

export function ptyInput(id: string, data: string): void {
  proc?.postMessage({ type: 'pty-input', id, data })
}

export function ptyResize(id: string, cols: number, rows: number): void {
  proc?.postMessage({ type: 'pty-resize', id, cols, rows })
}

export function ptyKill(id: string): void {
  proc?.postMessage({ type: 'pty-kill', id })
}

// Long-lived processes with framed JSON messages on stdin/stdout (the editor engine).

export interface LspProcessMessage {
  type: 'lsp-msg' | 'lsp-err' | 'lsp-exit'
  /** Process id; "*" when the helper itself ended. */
  id: string
  text?: string
  data?: string
  code?: number
  error?: string
}

let lspListener: ((m: LspProcessMessage) => void) | null = null

export function onLspMessage(fn: (m: LspProcessMessage) => void): void {
  lspListener = fn
}

export function lspStart(id: string, file: string, args: string[], cwd: string | undefined, env: Record<string, string>): void {
  ensure().postMessage({ type: 'lsp-start', id, file, args, cwd, env: childEnvironment(env) })
}

export function lspWrite(id: string, text: string): void {
  proc?.postMessage({ type: 'lsp-write', id, text })
}

/** Closes the engine's input (it exits on its own); `now` ends its process tree at once. */
export function lspKill(id: string, now = false): void {
  proc?.postMessage({ type: 'lsp-kill', id, now })
}
