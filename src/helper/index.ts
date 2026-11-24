// Helper process: runs the compiler, toolchain commands, terminals and the
// editor engine. It never receives keys or passwords; it only starts processes
// it is told to start and relays their output.

import { spawn, type ChildProcess } from 'node:child_process'

type Msg =
  | { type: 'run'; id: string; file: string; args: string[]; cwd?: string; env: Record<string, string>; input?: string }
  | { type: 'kill'; id: string }

const running = new Map<string, ChildProcess>()

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
    running.get(m.id)?.kill()
  }
})
