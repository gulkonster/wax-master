// Contract build: the default command, or the project's custom command, which
// always needs the user's approval for this folder and this exact text.

import { BrowserWindow, dialog, type WebContents } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, promises as fsp } from 'node:fs'
import { join } from 'node:path'
import type { AbiFinding, BuildCheck, BuildOutcome, BuildResult, Problem } from '../shared/api'
import { classifyLine, cleanLine, problemSeverity } from '../shared/output-lines'
import { effectiveInclude, effectiveOutput, effectiveResource, type ProjectConfig } from '../shared/project'
import { abiProblems, checkAbi, describeAbi, readSources } from './abi-check'
import { BuildStateStore, projectFingerprint, type StoredBuild } from './build-state'
import { log } from './log'
import { dataDir } from './paths'
import { currentProject } from './projects'
import { isCommandTrusted, trustCommand } from './store'
import { buildProject, buildProjectShell, fromWslPath, toolchainForProject } from './toolchain'

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
    `./${effectiveOutput(c)}`,
    // The main file is passed without "./": cdt-cpp's abigen finds no actions otherwise.
    // Project paths never start with "-" (checked when the project file is read).
    c.main
  ]
}

/** A compiler path as the editor knows it: project-relative where possible. */
export function problemPath(raw: string, projectRoot: string): string {
  const rootLower = projectRoot.toLowerCase().replace(/\\/g, '/')
  let file = raw.trim()
  const win = fromWslPath(file)
  if (win) {
    const w = win.replace(/\\/g, '/')
    file = w.toLowerCase().startsWith(rootLower + '/') ? w.slice(rootLower.length + 1) : w
  } else if (file.startsWith('./')) file = file.slice(2)
  return file
}

/**
 * Problems from the compiler output, by the same classifier that colours the
 * Output lines: diagnostics with their place, and errors or warnings without a
 * place (linker, ABI generator) with an empty file.
 */
export function parseProblems(output: string, projectRoot: string): Problem[] {
  const out: Problem[] = []
  for (const raw of output.split('\n')) {
    const c = classifyLine(raw)
    const severity = problemSeverity(c)
    if (!severity) continue
    if (c.loc) {
      out.push({ file: problemPath(c.loc.file, projectRoot), line: c.loc.line, column: c.loc.column, severity, message: c.message ?? '', source: 'build' })
    } else {
      out.push({ file: '', line: 0, column: 0, severity, message: c.message ?? cleanLine(raw), source: 'build' })
    }
  }
  return out
}

// ---------------------------------------------------------------- stored build state

const buildState = new BuildStateStore(() => join(dataDir(), 'build-state.json'))

function outputFiles(config: ProjectConfig): { wasm: string; abi: string } {
  const wasm = effectiveOutput(config)
  return { wasm, abi: wasm.replace(/\.wasm$/, '') + '.abi' }
}

function buildCommandText(config: ProjectConfig): string {
  return config.buildCommand.trim() || defaultBuildArgs().join(' ')
}

function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** The stored result of the last build of a project folder. */
export function storedBuild(root: string): StoredBuild | null {
  return buildState.get(root)
}

/**
 * The text Deploy and Simulate Deploy are stopped with when the ABI cannot be
 * deployed: the stored explanation of the last build when it is about this ABI
 * file, otherwise a fresh check of the file. null: the ABI is deployable.
 */
export async function abiRefusal(root: string, abiRel: string, abiText: string): Promise<string | null> {
  const s = buildState.get(root)
  if (s && s.result === 'abi-not-deployable' && s.abiFindings.length > 0 && s.abiSha256 === sha256Text(abiText)) {
    return s.abiFindings.map((f) => f.text).join('\n\n')
  }
  if (checkAbi(abiText).length === 0) return null
  const findings = describeAbi(abiText, abiRel, await readSources(root))
  return findings.map((f) => f.text).join('\n\n')
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
      'The command runs with your rights inside the toolchain environment, which can read your Windows files. Run it only if you trust the project. Your answer is remembered for this folder and this exact command.'
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
    // Every custom command needs approval per folder and exact text; no exemption.
    const trusted = isCommandTrusted(p.root, custom)
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
    const tc = toolchainForProject(p.config.cdt)
    if (tc.fallback) emit(`The toolchain "${p.config.cdt}" is not installed; building with the default toolchain.\n`)
    const shownCommand = buildCommandText(p.config)
    emit(`> ${shownCommand}\n`)
    const r = custom
      ? await buildProjectShell(p.root, custom, emit, tc.id)
      : await buildProject(p.root, defaultBuildArgs(), emit, tc.id)
    const problems = parseProblems(r.output, p.root)
    const ok = r.code === 0
    const { wasm, abi } = outputFiles(p.config)
    const outputs = [wasm, abi].filter((f) => existsSync(join(p.root, f)))
    const durationMs = Date.now() - started
    if (!sender.isDestroyed()) sender.send('files-changed')
    emit(ok ? `Build finished in ${(durationMs / 1000).toFixed(1)} s.\n` : `Build failed (exit ${r.code}${r.error ? `, ${r.error}` : ''}).\n`)
    // The ABI check runs after every successful compile.
    let abiFindings: AbiFinding[] = []
    let abiSha = ''
    if (ok && existsSync(join(p.root, abi))) {
      try {
        const text = await fsp.readFile(join(p.root, abi), 'utf8')
        if (checkAbi(text).length > 0) {
          abiFindings = describeAbi(text, abi, await readSources(p.root))
          abiSha = sha256Text(text)
        }
      } catch (e) {
        log.warn(`ABI check could not run: ${e instanceof Error ? e.message : String(e)}`)
      }
      for (const f of abiFindings) emit(`${f.text}\n`)
    }
    const outcome: BuildOutcome = !ok ? 'failed' : abiFindings.length > 0 ? 'abi-not-deployable' : 'ok'
    const builtAt = Date.now()
    // Taken after the compile, so files the compiler itself writes do not count as a change next time.
    const fingerprint = await projectFingerprint(p.root, { exclude: [wasm, abi], command: shownCommand, toolchain: tc.id }).catch(() => null)
    buildState.set(p.root, { fingerprint, result: outcome, builtAt, toolchain: tc.id, command: shownCommand, abiFindings, abiSha256: abiSha })
    return { ok, problems: [...problems, ...abiProblems(abiFindings)], durationMs, outputs, outcome, builtAt, abiFindings }
  } finally {
    building = false
  }
}

function checkFrom(build: BuildResult): BuildCheck {
  const abiFindings = build.abiFindings ?? []
  return {
    upToDate: false,
    builtAt: build.builtAt ?? null,
    result: build.outcome ?? null,
    abiFindings,
    abiProblems: abiProblems(abiFindings),
    build
  }
}

/**
 * Builds only when the project changed since the stored build (fingerprint),
 * its outputs are missing, or the stored build failed; otherwise answers with
 * the stored result (including the ABI findings) without compiling.
 */
export async function ensureBuilt(sender: WebContents): Promise<BuildCheck> {
  const p = currentProject()
  if (!p) throw new Error('No project is open')
  if (building) throw new Error('A build is already running')
  const stored = buildState.get(p.root)
  if (stored && stored.result !== 'failed' && stored.fingerprint) {
    const { wasm, abi } = outputFiles(p.config)
    const command = buildCommandText(p.config)
    const tc = toolchainForProject(p.config.cdt)
    const outputsThere = existsSync(join(p.root, wasm)) && existsSync(join(p.root, abi))
    if (outputsThere && stored.command === command && stored.toolchain === tc.id) {
      const fp = await projectFingerprint(p.root, { exclude: [wasm, abi], command, toolchain: tc.id }).catch(() => null)
      if (fp && fp === stored.fingerprint) {
        return {
          upToDate: true,
          builtAt: stored.builtAt,
          result: stored.result,
          abiFindings: stored.abiFindings,
          abiProblems: abiProblems(stored.abiFindings),
          build: null
        }
      }
    }
  }
  return checkFrom(await runBuild(sender))
}

/** Always compiles; same answer form as ensureBuilt. */
export async function rebuild(sender: WebContents): Promise<BuildCheck> {
  return checkFrom(await runBuild(sender))
}
