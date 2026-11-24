// Starts the helper process and runs commands through it.

import { utilityProcess, type UtilityProcess } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { childEnvironment } from './clean-env'
import { log } from './log'

let proc: UtilityProcess | null = null
const waiters = new Map<string, { onOut?: (s: string, stream: 'stdout' | 'stderr') => void; done: (r: RunResult) => void; out: string[] }>()

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
    const w = waiters.get(m.id)
    if (!w) return
    if (m.type === 'out' && m.data !== undefined) {
      w.out.push(m.data)
      w.onOut?.(m.data, m.stream ?? 'stdout')
    } else if (m.type === 'exit') {
      waiters.delete(m.id)
      w.done({ code: m.code ?? -1, output: w.out.join(''), error: m.error })
    }
  })
  proc.on('exit', (code) => {
    log.warn(`Helper process ended (${code})`)
    proc = null
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
}

export function run(file: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const p = ensure()
  const id = randomUUID()
  return new Promise((resolve) => {
    let timer: NodeJS.Timeout | undefined
    waiters.set(id, {
      onOut: opts.onOutput,
      out: [],
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
