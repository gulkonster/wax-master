// Contract build: the default command, or the project's custom command. A custom
// command of a project that came from outside needs the user's approval for this
// folder and this exact text; a project the app created on this computer runs it
// without asking (E70). The record lives in the app's own settings, not in the project.

import { BrowserWindow, dialog, type WebContents } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, promises as fsp } from 'node:fs'
import { join } from 'node:path'
import type { AbiFinding, BuildCheck, BuildOutcome, BuildResult, BuildStatus, BuildVariant, Problem } from '../shared/api'
import { classifyLine, cleanLine, placeToolchainProblems, problemSeverity, uniqueProblems } from '../shared/output-lines'
import { effectiveInclude, effectiveOutput, effectiveResource, type ProjectConfig } from '../shared/project'
import { abiProblems, checkAbi, describeAbi, moreFindingsLine, readSources } from './abi-check'
import { buildForKind, checkNetworkMacros, macroProblems, usesNetworkMacros, variantEnv, variantFlags, variantFits, variantLabel, variantOf, type BuildFor } from './build-variant'
import { currentNetwork, effectiveKind, getNetwork } from './networks'
import { BuildStateStore, projectFingerprint, type StoredBuild } from './build-state'
import { log } from './log'
import { dataDir } from './paths'
import { currentProject } from './projects'
import { findProject, isCommandTrusted, trustCommand } from './store'
import { buildProject, buildProjectShell, fromWslPath, toolchainForProject } from './toolchain'

let building = false

export function defaultBuildArgs(variant: BuildVariant = 'any'): string[] {
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
    // E64: the testnet or the mainnet build (nothing for a build that fits every network).
    ...variantFlags(variant),
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
 * place (linker, ABI generator) with an empty file. A line the compiler
 * prints twice (the ABI generator's Ricardian warnings) is one problem. An error
 * inside the toolchain's headers is placed at the project line that caused it.
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
  return uniqueProblems(placeToolchainProblems(out))
}

// ---------------------------------------------------------------- stored build state

const buildState = new BuildStateStore(() => join(dataDir(), 'build-state.json'))

function outputFiles(config: ProjectConfig): { wasm: string; abi: string } {
  const wasm = effectiveOutput(config)
  return { wasm, abi: wasm.replace(/\.wasm$/, '') + '.abi' }
}

function buildCommandText(config: ProjectConfig, variant: BuildVariant): string {
  return config.buildCommand.trim() || defaultBuildArgs(variant).join(' ')
}

/** The network a build is for (the given one, or the selected one) and which build it takes (E64). */
function networkOf(networkId?: string): { name: string; buildFor: BuildFor } {
  const n = networkId ? getNetwork(networkId) : currentNetwork()
  return { name: n.name, buildFor: buildForKind(effectiveKind(n)) }
}

/** The variant of the next build of this project for that network. */
async function variantFor(root: string, buildFor: BuildFor): Promise<BuildVariant> {
  const sources = await readSources(root).catch(() => [])
  return variantOf(usesNetworkMacros(sources), buildFor)
}

function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** SHA-256 of a project file; '' when it is missing. */
async function fileSha256(root: string, rel: string): Promise<string> {
  const bytes = await fsp.readFile(join(root, rel)).catch(() => null)
  return bytes ? createHash('sha256').update(bytes).digest('hex') : ''
}

/** The SHA-256 of the WASM and ABI on disk now. */
async function outputHashes(root: string, config: ProjectConfig): Promise<{ wasm: string; abi: string }> {
  const { wasm, abi } = outputFiles(config)
  return { wasm: await fileSha256(root, wasm), abi: await fileSha256(root, abi) }
}

/** E69: the files on disk are the ones the stored build wrote (the parts that exist on disk are compared). */
function sameOutputs(stored: StoredBuild, now: { wasm: string; abi: string }): boolean {
  const s = stored.outputSha256
  return !!s && s.wasm === now.wasm && s.abi === now.abi && (s.wasm !== '' || s.abi !== '')
}

/**
 * Whether the files on disk may be deployed as a build of this project to a network that takes
 * `takes` (E64, E69): when the sources use the macros, they must be the files of a stored build of
 * that network's variant; otherwise any files fit. null: they fit; otherwise the reason.
 */
export async function filesRefusal(root: string, config: ProjectConfig, takes: BuildFor, networkName: string): Promise<string | null> {
  const sources = await readSources(root).catch(() => [])
  const stored = buildState.get(root)
  const uses = usesNetworkMacros(sources)
  if (!uses && (!stored || stored.variant === 'any')) return null
  if (!stored || !sameOutputs(stored, await outputHashes(root, config))) {
    return `The files on disk are not a build WAX Master made of this project (they changed after the last build, or were built elsewhere), so it cannot tell whether they are the testnet or the mainnet build. Press Rebuild in Deploy to build the ${takes} build for ${networkName}.`
  }
  if (!variantFits(stored.variant, takes)) {
    return `The files on disk are the ${variantLabel(stored.variant)}, and ${networkName} takes the ${takes} build. Press Rebuild in Deploy to build it.`
  }
  return null
}

/** What the files on disk are for a network, without compiling (E69). */
export async function buildStatus(networkId?: string): Promise<BuildStatus> {
  const p = currentProject()
  if (!p) throw new Error('No project is open')
  const target = networkOf(networkId)
  const sources = await readSources(p.root).catch(() => [])
  const takes = variantOf(usesNetworkMacros(sources), target.buildFor)
  const stored = buildState.get(p.root)
  if (!stored) return { builtAt: null, result: null, variant: null, takes, filesMatch: false, changed: true }
  const { wasm, abi } = outputFiles(p.config)
  const tc = toolchainForProject(p.config.cdt)
  const command = buildCommandText(p.config, stored.variant)
  const fp = await projectFingerprint(p.root, { exclude: [wasm, abi], command, toolchain: tc.id }).catch(() => null)
  return {
    builtAt: stored.builtAt,
    result: stored.result,
    variant: stored.variant,
    takes,
    filesMatch: sameOutputs(stored, await outputHashes(p.root, p.config)),
    changed: !fp || fp !== stored.fingerprint || stored.command !== command || stored.toolchain !== tc.id
  }
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
  const raw = checkAbi(abiText)
  if (raw.length === 0) return null
  const s = buildState.get(root)
  const stored = s && s.result === 'abi-not-deployable' && s.abiFindings.length > 0 && s.abiSha256 === sha256Text(abiText)
  const findings = stored ? s.abiFindings : describeAbi(abiText, abiRel, await readSources(root), raw)
  const more = moreFindingsLine(raw.length)
  return [...findings.map((f) => f.text), ...(more ? [more] : [])].join('\n\n')
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

export async function runBuild(sender: WebContents, networkId?: string): Promise<BuildResult> {
  const p = currentProject()
  if (!p) throw new Error('No project is open')
  if (building) throw new Error('A build is already running')
  const custom = p.config.buildCommand.trim()
  if (custom) {
    // A project created here runs its command; any other needs approval per folder and exact text.
    const trusted = findProject(p.root)?.createdHere === true || isCommandTrusted(p.root, custom)
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
  // The window clears Output, shows it and says that a build runs (Deploy's check builds too).
  if (!sender.isDestroyed()) sender.send('output', { source: 'build', text: '', start: true })
  try {
    const tc = toolchainForProject(p.config.cdt)
    if (tc.fallback) emit(`The toolchain "${p.config.cdt}" is not installed; building with the default toolchain.\n`)
    const target = networkOf(networkId)
    const sources = await readSources(p.root).catch(() => [])
    const variant = variantOf(usesNetworkMacros(sources), target.buildFor)
    const shownCommand = buildCommandText(p.config, variant)
    emit(variant === 'any' ? `Build: ${variantLabel(variant)} (the sources use neither WAXMASTER_TESTNET nor WAXMASTER_MAINNET).\n` : `Build: the ${variantLabel(variant)}, for ${target.name}.\n`)
    // E68: warn when another compiler could build these sources silently; it never blocks the build.
    const macroFindings = variant === 'any' ? [] : checkNetworkMacros(sources)
    for (const f of macroFindings) emit(`${f.detail}\n`)
    emit(`> ${shownCommand}\n`)
    // A custom command is told which build it is (WAXMASTER_NETWORK, WAXMASTER_BUILD_FLAG).
    const r = custom
      ? await buildProjectShell(p.root, custom, emit, tc.id, variantEnv(target.buildFor))
      : await buildProject(p.root, defaultBuildArgs(variant), emit, tc.id)
    const problems = [...parseProblems(r.output, p.root), ...macroProblems(macroFindings)]
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
      let more: string | null = null
      try {
        const text = await fsp.readFile(join(p.root, abi), 'utf8')
        const raw = checkAbi(text)
        if (raw.length > 0) {
          abiFindings = describeAbi(text, abi, await readSources(p.root), raw)
          more = moreFindingsLine(raw.length)
          abiSha = sha256Text(text)
        }
      } catch (e) {
        log.warn(`ABI check could not run: ${e instanceof Error ? e.message : String(e)}`)
      }
      for (const f of abiFindings) emit(`${f.text}\n`)
      if (more) emit(`${more}\n`)
    }
    const outcome: BuildOutcome = !ok ? 'failed' : abiFindings.length > 0 ? 'abi-not-deployable' : 'ok'
    const builtAt = Date.now()
    // Taken after the compile, so files the compiler itself writes do not count as a change next time.
    const fingerprint = await projectFingerprint(p.root, { exclude: [wasm, abi], command: shownCommand, toolchain: tc.id }).catch(() => null)
    const outputSha256 = ok ? await outputHashes(p.root, p.config) : { wasm: '', abi: '' }
    buildState.set(p.root, { fingerprint, result: outcome, builtAt, toolchain: tc.id, command: shownCommand, abiFindings, abiSha256: abiSha, variant, outputSha256 })
    return { ok, problems: [...problems, ...abiProblems(abiFindings)], durationMs, outputs, outcome, builtAt, abiFindings, variant }
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
    build,
    variant: build.variant ?? null
  }
}

/**
 * Builds only when the project changed since the stored build (fingerprint),
 * its outputs are missing, or the stored build failed; otherwise answers with
 * the stored result (including the ABI findings) without compiling.
 */
export async function ensureBuilt(sender: WebContents, networkId?: string): Promise<BuildCheck> {
  const p = currentProject()
  if (!p) throw new Error('No project is open')
  if (building) throw new Error('A build is already running')
  const stored = buildState.get(p.root)
  // E64: the stored build counts only when it is the build this network takes.
  const variant = await variantFor(p.root, networkOf(networkId).buildFor)
  if (stored && stored.result !== 'failed' && stored.fingerprint && stored.variant === variant) {
    const { wasm, abi } = outputFiles(p.config)
    const command = buildCommandText(p.config, variant)
    const tc = toolchainForProject(p.config.cdt)
    const outputsThere = existsSync(join(p.root, wasm)) && existsSync(join(p.root, abi))
    // E69: files changed after the build (or built elsewhere) are built again.
    if (outputsThere && stored.command === command && stored.toolchain === tc.id && sameOutputs(stored, await outputHashes(p.root, p.config))) {
      const fp = await projectFingerprint(p.root, { exclude: [wasm, abi], command, toolchain: tc.id }).catch(() => null)
      if (fp && fp === stored.fingerprint) {
        return {
          upToDate: true,
          builtAt: stored.builtAt,
          result: stored.result,
          abiFindings: stored.abiFindings,
          abiProblems: abiProblems(stored.abiFindings),
          build: null,
          variant: stored.variant
        }
      }
    }
  }
  return checkFrom(await runBuild(sender, networkId))
}

/** Always compiles; same answer form as ensureBuilt. */
export async function rebuild(sender: WebContents, networkId?: string): Promise<BuildCheck> {
  return checkFrom(await runBuild(sender, networkId))
}
