// Integrated terminals: PowerShell, Command Prompt and the toolchain shell.
// Processes run in the helper process with a clean environment. Terminal
// content is never logged.

import type { WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import type { TerminalProfile, TerminalProfileInfo } from '../shared/api'
import { onPtyMessage, ptyInput, ptyKill, ptyResize, ptyStart } from './helper'
import { currentProject, resolveInProject } from './projects'
import { toolchainState } from './toolchain'

interface Term {
  id: string
  sender: WebContents
}

const terms = new Map<string, Term>()
let wired = false

function sys32(...p: string[]): string {
  return join(process.env.SystemRoot || 'C:\\Windows', 'System32', ...p)
}

function findOnPath(exe: string): string | null {
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    if (!dir) continue
    const f = join(dir, exe)
    if (existsSync(f)) return f
  }
  return null
}

function pwsh(): string | null {
  const candidates = [
    findOnPath('pwsh.exe'),
    join(process.env.ProgramFiles || 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe')
  ]
  return candidates.find((c) => c && existsSync(c)) ?? null
}

export function profiles(): TerminalProfileInfo[] {
  const p7 = pwsh()
  const tc = toolchainState()
  return [
    { id: 'powershell', label: p7 ? 'PowerShell 7' : 'Windows PowerShell', available: true },
    { id: 'cmd', label: 'Command Prompt', available: true },
    {
      id: 'toolchain',
      label: 'Toolchain shell (Linux)',
      available: !!tc,
      note: tc ? undefined : 'Set up the toolchain first (Help > Setup).'
    }
  ]
}

export function gitHint(): string | null {
  if (findOnPath('git.exe')) return null
  return 'Git was not found. Install Git for Windows from https://git-scm.com/download/win to use Git in the terminal.'
}

function wire(): void {
  if (wired) return
  wired = true
  onPtyMessage((m) => {
    const t = terms.get(m.id)
    if (!t || t.sender.isDestroyed()) return
    if (m.type === 'pty-data') t.sender.send('terminal-data', m.id, m.data)
    else if (m.type === 'pty-exit') {
      terms.delete(m.id)
      t.sender.send('terminal-exit', m.id, m.code ?? 0, m.error ?? '')
    }
  })
}

export function createTerminal(sender: WebContents, profile: TerminalProfile, rel: string | null, cols: number, rows: number): string {
  wire()
  const project = currentProject()
  let cwd = homedir()
  if (project) cwd = rel ? resolveInProject(rel) : project.root
  if (!existsSync(cwd)) cwd = project?.root ?? homedir()
  let file: string
  let args: string[]
  if (profile === 'powershell') {
    const p7 = pwsh()
    file = p7 ?? sys32('WindowsPowerShell', 'v1.0', 'powershell.exe')
    args = ['-NoLogo']
  } else if (profile === 'cmd') {
    file = sys32('cmd.exe')
    args = []
  } else {
    const tc = toolchainState()
    if (!tc) throw new Error('The toolchain is not set up. Open Help > Setup.')
    file = sys32('wsl.exe')
    args = ['-d', tc.distro, '--cd', cwd, '--exec', 'bash', '-l']
  }
  const id = randomUUID()
  terms.set(id, { id, sender })
  ptyStart(id, file, args, cwd, cols, rows, { WSL_UTF8: '1' })
  return id
}

export function writeTerminal(id: string, data: string): void {
  if (terms.has(id)) ptyInput(id, data)
}

export function resizeTerminal(id: string, cols: number, rows: number): void {
  if (terms.has(id)) ptyResize(id, cols, rows)
}

export function killTerminal(id: string): void {
  if (terms.has(id)) ptyKill(id)
}

export function killAllTerminals(): void {
  for (const id of terms.keys()) ptyKill(id)
}
