// Contract build: default command or the project's custom command (which needs
// the user's approval unless the project was created on this computer).

import { BrowserWindow, dialog, type WebContents } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { BuildResult, Problem } from '../shared/api'
import { effectiveInclude, effectiveOutput, effectiveResource } from '../shared/project'
import { currentProject } from './projects'
import { findProject, isCommandTrusted, trustCommand } from './store'
import { buildProject, buildProjectShell, fromWslPath } from './toolchain'

let building = false

export function defaultBuildArgs(): string[] {
  const p = currentProject()
  if (!p) throw new Error('No project is open')
  const c = p.config
  return [
    'cdt-cpp',
    '-abigen',
    '-I',
    `./${effectiveInclude(c)}`,
    '-R',
    `./${effectiveResource(c)}`,
    '-contract',
    c.contract,
    '-o',
    effectiveOutput(c),
    c.main
  ]
}

const DIAG = /^(.*?):(\d+):(\d+):\s+(fatal error|error|warning|note):\s+(.*)$/

/** Parses compiler diagnostics; paths become project-relative where possible. */
export function parseProblems(output: string, projectRoot: string): Problem[] {
  const out: Problem[] = []
  const rootLower = projectRoot.toLowerCase().replace(/\\/g, '/')
  for (const raw of output.split('\n')) {
    const line = raw.replace(/\x1b\[[0-9;]*m/g, '').trimEnd()
    const m = DIAG.exec(line)
    if (!m) continue
    let file = m[1].trim()
    const win = fromWslPath(file)
    if (win) {
      const w = win.replace(/\\/g, '/')
      file = w.toLowerCase().startsWith(rootLower + '/') ? w.slice(rootLower.length + 1) : w
    } else if (file.startsWith('./')) file = file.slice(2)
    const sev = m[4] === 'note' ? 'info' : m[4] === 'warning' ? 'warning' : 'error'
    out.push({ file, line: Number(m[2]), column: Number(m[3]), severity: sev, message: m[5], source: 'build' })
  }
  return out
}

/** Shows the custom command in a dialog owned by the main process; the editor window cannot answer it. */
async function askApproval(sender: WebContents, root: string, command: string): Promise<boolean> {
  const win = BrowserWindow.fromWebContents(sender)
  const opts: Electron.MessageBoxOptions = {
    type: 'warning',
    buttons: ['Cancel', 'Run this command'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: 'Run this build command?',
    message: 'This project sets its own build command.',
    detail:
      `Project: ${root}\n\nCommand:\n${command}\n\n` +
      'The project was not created on this computer. The command runs with your rights inside the toolchain environment, which can read your Windows files. Run it only if you trust the project. Your answer is remembered for this folder and this exact command.'
  }
  const r = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
  return r.response === 1
}

export async function runBuild(sender: WebContents): Promise<BuildResult> {
  const p = currentProject()
  if (!p) throw new Error('No project is open')
  if (building) throw new Error('A build is already running')
  const custom = p.config.buildCommand.trim()
  if (custom) {
    const entry = findProject(p.root)
    const trusted = entry?.createdHere || isCommandTrusted(p.root, custom)
    if (!trusted) {
      if (!(await askApproval(sender, p.root, custom))) {
        return { ok: false, needsApproval: true, command: custom, problems: [], durationMs: 0, outputs: [] }
      }
      trustCommand(p.root, custom)
    }
  }
  building = true
  const started = Date.now()
  const emit = (text: string): void => {
    if (!sender.isDestroyed()) sender.send('output', { source: 'build', text })
  }
  try {
    const shown = custom || defaultBuildArgs().join(' ')
    emit(`> ${shown}\n`)
    const r = custom
      ? await buildProjectShell(p.root, custom, emit)
      : await buildProject(p.root, defaultBuildArgs(), emit)
    const problems = parseProblems(r.output, p.root)
    const ok = r.code === 0
    const out = effectiveOutput(p.config)
    const abi = out.replace(/\.wasm$/, '') + '.abi'
    const outputs = [out, abi].filter((f) => existsSync(join(p.root, f)))
    const durationMs = Date.now() - started
    if (!sender.isDestroyed()) sender.send('files-changed')
    emit(ok ? `Build finished in ${(durationMs / 1000).toFixed(1)} s.\n` : `Build failed (exit ${r.code}${r.error ? `, ${r.error}` : ''}).\n`)
    return { ok, problems, durationMs, outputs }
  } finally {
    building = false
  }
}
