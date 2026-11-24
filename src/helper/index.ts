// Helper process: runs the compiler, toolchain commands, terminals and the
// editor engine. It never receives keys or passwords; it only starts processes
// it is told to start and relays their output.

import { spawn, type ChildProcess } from 'node:child_process'
import type { IPty } from 'node-pty'

type Msg =
  | { type: 'run'; id: string; file: string; args: string[]; cwd?: string; env: Record<string, string>; input?: string }
  | { type: 'kill'; id: string }
  | { type: 'pty-start'; id: string; file: string; args: string[]; cwd: string; env: Record<string, string>; cols: number; rows: number }
  | { type: 'pty-input'; id: string; data: string }
  | { type: 'pty-resize'; id: string; cols: number; rows: number }
  | { type: 'pty-kill'; id: string }

const running = new Map<string, ChildProcess>()
const ptys = new Map<string, IPty>()

// Loaded on first use so a broken native module never stops builds.
let ptyModule: typeof import('node-pty') | null = null
function loadPty(): typeof import('node-pty') {
  if (!ptyModule) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ptyModule = require('node-pty') as typeof import('node-pty')
  }
  return ptyModule
}

/** Ends a terminal and every process started in it. */
function killTree(pid: number): void {
  try {
    const exe = process.env.SystemRoot ? `${process.env.SystemRoot}\\System32\\taskkill.exe` : 'taskkill.exe'
    spawn(exe, ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore'
    })
  } catch {
    // the process may already be gone
  }
}

function post(m: unknown): void {
  process.parentPort.postMessage(m)
}

process.parentPort.on('message', (e: { data: Msg }) => {
  const m = e.data
  if (m.type === 'run') {
    let child: ChildProcess
    try {
      child = spawn(m.file, m.args, { cwd: m.cwd, env: m.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (err) {
      post({ type: 'exit', id: m.id, code: -1, error: err instanceof Error ? err.message : String(err) })
      return
    }
    running.set(m.id, child)
    child.stdout?.on('data', (d: Buffer) => post({ type: 'out', id: m.id, stream: 'stdout', data: d.toString('utf8') }))
    child.stderr?.on('data', (d: Buffer) => post({ type: 'out', id: m.id, stream: 'stderr', data: d.toString('utf8') }))
    child.on('error', (err) => {
      running.delete(m.id)
      post({ type: 'exit', id: m.id, code: -1, error: err.message })
    })
    child.on('close', (code) => {
      running.delete(m.id)
      post({ type: 'exit', id: m.id, code: code ?? -1 })
    })
    if (m.input !== undefined) child.stdin?.end(m.input)
    else child.stdin?.end()
  } else if (m.type === 'kill') {
    const c = running.get(m.id)
    if (c?.pid) killTree(c.pid)
  } else if (m.type === 'pty-start') {
    try {
      const pty = loadPty().spawn(m.file, m.args, {
        name: 'xterm-256color',
        cols: m.cols,
        rows: m.rows,
        cwd: m.cwd,
        env: m.env,
        useConpty: true
      })
      ptys.set(m.id, pty)
      pty.onData((data) => post({ type: 'pty-data', id: m.id, data }))
      pty.onExit(({ exitCode }) => {
        ptys.delete(m.id)
        post({ type: 'pty-exit', id: m.id, code: exitCode })
      })
      post({ type: 'pty-started', id: m.id, pid: pty.pid })
    } catch (err) {
      post({ type: 'pty-exit', id: m.id, code: -1, error: err instanceof Error ? err.message : String(err) })
    }
  } else if (m.type === 'pty-input') {
    ptys.get(m.id)?.write(m.data)
  } else if (m.type === 'pty-resize') {
    try {
      ptys.get(m.id)?.resize(Math.max(2, m.cols), Math.max(2, m.rows))
    } catch {
      // resizing an exiting terminal can fail; ignore
    }
  } else if (m.type === 'pty-kill') {
    const pty = ptys.get(m.id)
    if (pty) killTree(pty.pid)
  }
})
