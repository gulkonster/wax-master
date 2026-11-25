// Toolchain setup: a private WSL distribution assembled offline from the
// unmodified parts bundled with the app, verified against the pinned hashes.

import { app } from 'electron'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, promises as fsp, statfsSync } from 'node:fs'
import { release } from 'node:os'
import { join } from 'node:path'
import manifest from '../../toolchain/parts.json'
import setupScript from '../../resources/toolchain/setup-distro.sh?raw'
import { run, type RunResult } from './helper'
import { readJson, writeJson } from './jsonfile'
import { localDataDir, resourcesDir } from './paths'
import { log } from './log'

export interface ToolchainDef {
  id: string
  label: string
  base: string
  packages: string[]
}

interface Part {
  id: string
  file: string
  urls: string[]
  size: number
  sha256: string
}

export const TOOLCHAINS: ToolchainDef[] = manifest.toolchains
const PARTS: Part[] = manifest.parts
export const DEFAULT_TOOLCHAIN = TOOLCHAINS[0].id

export interface ToolchainState {
  id: string
  label: string
  distro: string
  wslVersion: 1 | 2
  installedAt: number
  cdtVersion: string
  clangdVersion: string
  testBuildOk: boolean
  /** CDT install folder inside the distro, e.g. /usr/opt/cdt/4.1.1wax01 */
  cdtRoot?: string
  /** For a toolchain added from a file: SHA-256 of that CDT package. */
  packageSha256?: string
}

export interface SetupStatus {
  windows: { ok: boolean; detail: string }
  wsl: { ok: boolean; detail: string }
  toolchain: { ok: boolean; detail: string; state: ToolchainState | null }
  testBuild: { ok: boolean; detail: string }
  partsAvailable: boolean
}

export type Progress = (line: string) => void

const MIN_FREE_BYTES = 3 * 1024 * 1024 * 1024

export function wslExe(): string {
  return join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe')
}

export function partsDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'toolchain-parts') : join(app.getAppPath(), 'toolchain-parts')
}

function stateFile(): string {
  return join(localDataDir(), 'toolchains', 'state.json')
}

export function distroName(id: string): string {
  return `waxmaster-${id}`
}

export function installedToolchains(): ToolchainState[] {
  const s = readJson<{ toolchains?: ToolchainState[] }>(stateFile(), {})
  return Array.isArray(s.toolchains) ? s.toolchains : []
}

function saveState(list: ToolchainState[]): void {
  writeJson(stateFile(), { toolchains: list })
}

export function toolchainState(id = DEFAULT_TOOLCHAIN): ToolchainState | null {
  return installedToolchains().find((t) => t.id === id) ?? null
}

function upsertState(t: ToolchainState): void {
  const list = installedToolchains().filter((x) => x.id !== t.id)
  list.push(t)
  saveState(list)
}

function removeState(id: string): void {
  saveState(installedToolchains().filter((x) => x.id !== id))
}

/** C:\Users\me\proj -> /mnt/c/Users/me/proj */
export function toWslPath(winPath: string): string {
  const m = /^([a-zA-Z]):[\\/]?(.*)$/.exec(winPath)
  if (!m) throw new Error(`Not a local drive path: ${winPath}`)
  const rest = m[2].replace(/\\/g, '/')
  return `/mnt/${m[1].toLowerCase()}/${rest}`.replace(/\/+$/, '')
}

/** /mnt/c/Users/me/proj -> C:\Users\me\proj (null when not a /mnt path) */
export function fromWslPath(p: string): string | null {
  const m = /^\/mnt\/([a-z])(\/.*)?$/.exec(p)
  if (!m) return null
  return `${m[1].toUpperCase()}:${(m[2] ?? '/').replace(/\//g, '\\')}`
}

export function wsl(args: string[], opts: { onOutput?: Progress; timeoutMs?: number; cwd?: string; input?: string } = {}): Promise<RunResult> {
  return run(wslExe(), args, {
    env: { WSL_UTF8: '1' },
    input: opts.input,
    cwd: opts.cwd,
    timeoutMs: opts.timeoutMs ?? 10 * 60 * 1000,
    onOutput: opts.onOutput ? (t) => opts.onOutput!(t) : undefined
  })
}

/** wsl.exe prints UTF-16 when WSL_UTF8 is not honoured; strip NULs either way. */
export function clean(s: string): string {
  return s.replace(/\0/g, '').replace(/\r/g, '')
}

export async function listDistros(): Promise<string[]> {
  const r = await wsl(['--list', '--quiet'], { timeoutMs: 30000 })
  if (r.code !== 0) return []
  return clean(r.output)
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
}

function windowsCheck(): { ok: boolean; detail: string } {
  const [major, , build] = release().split('.').map(Number)
  const x64 = process.arch === 'x64'
  const ok = x64 && major >= 10 && build >= 19045
  const name = build >= 22000 ? 'Windows 11' : 'Windows 10'
  return {
    ok,
    detail: ok
      ? `${name} (build ${build}), x64`
      : !x64
        ? 'Building needs Windows on x64. Editing, chain work and the terminal still work.'
        : `Build ${build} is older than Windows 10 22H2. Editing, chain work and the terminal still work; building does not.`
  }
}

export async function status(): Promise<SetupStatus> {
  const windows = windowsCheck()
  let wslOk = false
  let wslDetail = ''
  if (!existsSync(wslExe())) {
    wslDetail = 'WSL is not installed.'
  } else {
    const r = await wsl(['--status'], { timeoutMs: 30000 })
    const text = clean(r.output)
    wslOk = r.code === 0
    wslDetail = wslOk
      ? /Default Version: 1|Varsay.lan S.r.m: 1/.test(text)
        ? 'WSL is enabled (default version 1).'
        : 'WSL is enabled.'
      : `WSL is not enabled on this computer.${text.trim() ? ` WSL says: ${text.trim().split('\n').slice(0, 4).join(' ').slice(0, 400)}` : ''}`
  }
  const state = toolchainState()
  let tcOk = false
  let tcDetail = 'Not installed.'
  if (state && wslOk) {
    const distros = await listDistros()
    tcOk = distros.includes(state.distro)
    tcDetail = tcOk ? `${state.label} (WSL ${state.wslVersion})` : 'The toolchain was removed outside the app. Repair it.'
  }
  return {
    windows,
    wsl: { ok: wslOk, detail: wslDetail },
    toolchain: { ok: tcOk, detail: tcDetail, state },
    testBuild: {
      ok: tcOk && !!state?.testBuildOk,
      detail: tcOk && state?.testBuildOk ? `${state.cdtVersion}; ${state.clangdVersion}` : 'Not run yet.'
    },
    partsAvailable: existsSync(join(partsDir(), PARTS[0].file))
  }
}

/** Runs `wsl --install --no-distribution` elevated (one UAC prompt). */
export async function enableWsl(compat: boolean): Promise<RunResult> {
  const args = compat ? '--install --enable-wsl1 --no-distribution' : '--install --no-distribution'
  const ps = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const cmd = `$p = Start-Process -FilePath '${wslExe()}' -ArgumentList '${args}' -Verb RunAs -Wait -PassThru; exit $p.ExitCode`
  return run(ps, ['-NoProfile', '-NonInteractive', '-Command', cmd], { timeoutMs: 30 * 60 * 1000 })
}

export async function sha256File(path: string): Promise<string> {
  const h = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    createReadStream(path)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve())
      .on('error', reject)
  })
  return h.digest('hex')
}

function partsFor(def: ToolchainDef | string[]): Part[] {
  const ids = Array.isArray(def) ? def : [def.base, ...def.packages]
  return ids.map((id) => {
    const p = PARTS.find((x) => x.id === id)
    if (!p) throw new Error(`Manifest has no part "${id}"`)
    return p
  })
}

/** Checks size and SHA-256 of a toolchain's parts, or of the parts named by id. */
export async function verifyParts(def: ToolchainDef | string[], progress: Progress): Promise<void> {
  const dir = partsDir()
  const parts = partsFor(def)
  let i = 0
  for (const p of parts) {
    i++
    const file = join(dir, p.file)
    if (!existsSync(file)) throw new Error(`Missing toolchain part: ${p.file}. Download the installer again.`)
    const st = await fsp.stat(file)
    if (st.size !== p.size) throw new Error(`Toolchain part has the wrong size: ${p.file}. Download the installer again.`)
    const hash = await sha256File(file)
    if (hash !== p.sha256) throw new Error(`Toolchain part failed its checksum: ${p.file}. Download the installer again.`)
    progress(`Verified ${i}/${parts.length}: ${p.file}`)
  }
}

export interface ExtraCdt {
  id: string
  label: string
  /** Windows path of the CDT .deb the user chose. */
  path: string
  sha256: string
  size: number
}

export async function install(opts: { wslVersion: 1 | 2; progress: Progress; extra?: ExtraCdt }): Promise<ToolchainState> {
  const base0 = TOOLCHAINS[0]
  // A toolchain added from a file uses the bundled base and editor engine parts with the user's CDT package.
  const def: ToolchainDef = opts.extra
    ? { id: opts.extra.id, label: opts.extra.label, base: base0.base, packages: base0.packages.filter((id) => !id.startsWith('wax-cdt')) }
    : base0
  const { progress } = opts
  const root = join(localDataDir(), 'toolchains')
  mkdirSync(root, { recursive: true })
  const free = statfsSync(root)
  if (free.bavail * free.bsize < MIN_FREE_BYTES) {
    throw new Error('At least 3 GB of free disk space is needed for the toolchain.')
  }

  progress('Checking the bundled toolchain parts (SHA-256)...')
  await verifyParts(def, progress)
  if (opts.extra) {
    const st = await fsp.stat(opts.extra.path)
    if (st.size !== opts.extra.size || (await sha256File(opts.extra.path)) !== opts.extra.sha256) {
      throw new Error('The CDT package changed after it was chosen. Choose it again.')
    }
    progress(`Verified the added package ${opts.extra.sha256}`)
  }

  const name = distroName(def.id)
  if ((await listDistros()).includes(name)) {
    progress('Removing the previous toolchain...')
    await wsl(['--unregister', name], { timeoutMs: 120000 })
  }
  removeState(def.id)

  const dir = join(root, def.id)
  await fsp.rm(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const base = partsFor(def)[0]
  progress(`Importing ${base.file} as "${name}" (WSL ${opts.wslVersion})...`)
  const imp = await wsl(['--import', name, dir, join(partsDir(), base.file), '--version', String(opts.wslVersion)], {
    timeoutMs: 10 * 60 * 1000
  })
  if (imp.code !== 0) throw new Error(`WSL could not import the toolchain:\n${clean(imp.output).trim() || imp.error || ''}`)

  progress('Installing the compiler and editor engine inside it (offline)...')
  // The script is part of the app bundle and goes in on stdin; it installs only the files verified above.
  const debs = toWslPath(partsDir())
  const files = partsFor(def).slice(1).map((p) => p.file)
  if (opts.extra) files.push(`@${toWslPath(opts.extra.path)}`)
  const setup = await wsl(['-d', name, '-u', 'root', '--exec', 'bash', '-s', '--', debs, ...files], {
    input: setupScript.replace(/\r\n/g, '\n'),
    onOutput: (t) => clean(t).split('\n').filter(Boolean).forEach((l) => progress(l)),
    timeoutMs: 20 * 60 * 1000
  })
  if (setup.code !== 0) {
    throw new Error(`Toolchain setup failed inside WSL (exit ${setup.code}). See the lines above.`)
  }
  await wsl(['--terminate', name], { timeoutMs: 60000 })

  const versions = await toolVersions(name)
  const roots = await wsl(['-d', name, '--exec', 'bash', '-c', 'ls -d /usr/opt/cdt/*/ 2>/dev/null | head -n 1'], { timeoutMs: 60000 })
  const cdtRoot = clean(roots.output).trim().replace(/\/$/, '') || undefined
  const state: ToolchainState = {
    id: def.id,
    label: def.label,
    distro: name,
    wslVersion: opts.wslVersion,
    installedAt: Date.now(),
    cdtVersion: versions.cdt,
    clangdVersion: versions.clangd,
    testBuildOk: false,
    cdtRoot,
    packageSha256: opts.extra?.sha256
  }
  upsertState(state)
  progress('Toolchain installed.')
  return state
}

async function toolVersions(distro: string): Promise<{ cdt: string; clangd: string }> {
  const c = await wsl(['-d', distro, '--exec', 'cdt-cpp', '--version'], { timeoutMs: 60000 })
  const d = await wsl(['-d', distro, '--exec', 'clangd', '--version'], { timeoutMs: 60000 })
  const cdt = clean(c.output).trim().split('\n')[0] || 'unknown'
  const clangd = clean(d.output).trim().split('\n')[0] || 'unknown'
  return { cdt, clangd }
}

/**
 * Builds the bundled sample contract in a scratch folder inside the distro and
 * checks the editor engine answers. Nothing is written on the Windows side.
 */
export async function testBuild(progress: Progress, id = DEFAULT_TOOLCHAIN): Promise<ToolchainState> {
  const state = toolchainState(id)
  if (!state) throw new Error('The toolchain is not installed.')
  const template = toWslPath(join(resourcesDir(), 'templates', 'hello'))
  const script = [
    'set -e',
    'rm -rf ~/test-build',
    'mkdir -p ~/test-build',
    'cp -r "$1"/. ~/test-build/',
    'cd ~/test-build',
    'cdt-cpp -abigen -I ./include -R ./resource -contract hello -o hello.wasm src/hello.cpp',
    'test -s hello.wasm && test -s hello.abi && echo "OUTPUT hello.wasm $(stat -c %s hello.wasm) bytes, hello.abi $(stat -c %s hello.abi) bytes"'
  ].join('\n')
  progress('Building the sample contract...')
  const r = await wsl(['-d', state.distro, '-u', 'wax', '--exec', 'bash', '-c', script, 'test-build', template], {
    onOutput: (t) => clean(t).split('\n').filter(Boolean).forEach((l) => progress(l)),
    timeoutMs: 5 * 60 * 1000
  })
  const ok = r.code === 0 && clean(r.output).includes('OUTPUT hello.wasm')
  if (!ok) {
    upsertState({ ...state, testBuildOk: false })
    throw new Error(`The sample contract did not build (exit ${r.code}).`)
  }
  progress('Checking the editor engine...')
  const versions = await toolVersions(state.distro)
  if (!versions.clangd.toLowerCase().includes('clangd')) {
    upsertState({ ...state, testBuildOk: false })
    throw new Error('The editor engine (clangd) did not answer.')
  }
  const next = { ...state, cdtVersion: versions.cdt, clangdVersion: versions.clangd, testBuildOk: true }
  upsertState(next)
  progress(`Test build passed: hello.wasm and hello.abi created. ${versions.cdt}; ${versions.clangd}`)
  return next
}

export async function remove(id = DEFAULT_TOOLCHAIN): Promise<void> {
  const name = distroName(id)
  if ((await listDistros()).includes(name)) await wsl(['--unregister', name], { timeoutMs: 120000 })
  removeState(id)
  await fsp.rm(join(localDataDir(), 'toolchains', id), { recursive: true, force: true })
  log.info(`Toolchain ${id} removed`)
}

/** Runs the compiler in the project folder. Arguments are passed without a shell. */
export async function buildProject(
  projectRoot: string,
  args: string[],
  onOutput: (t: string) => void,
  toolchainId = DEFAULT_TOOLCHAIN
): Promise<RunResult> {
  const state = toolchainState(toolchainId)
  if (!state) throw new Error('The toolchain is not set up. Open Help > Setup.')
  return wsl(['-d', state.distro, '--cd', projectRoot, '--exec', ...args], {
    onOutput: (t) => onOutput(clean(t)),
    timeoutMs: 15 * 60 * 1000
  })
}

/** Runs a custom build command through bash in the project folder (only after the user approved it). */
export async function buildProjectShell(projectRoot: string, command: string, onOutput: (t: string) => void, toolchainId = DEFAULT_TOOLCHAIN): Promise<RunResult> {
  const state = toolchainState(toolchainId)
  if (!state) throw new Error('The toolchain is not set up. Open Help > Setup.')
  return wsl(['-d', state.distro, '--cd', projectRoot, '--exec', 'bash', '-lc', command], {
    onOutput: (t) => onOutput(clean(t)),
    timeoutMs: 15 * 60 * 1000
  })
}

/** Known CDT packages (SHA-256 published by the releases). */
export const KNOWN_CDT: { sha256: string; label: string }[] = [
  { sha256: 'b2273213b1267c25974b2820cb78faf024387e36f7eaeb97235e43dd4c27e44a', label: 'WAX CDT 4.1.1wax01 (worldwide-asset-exchange/wax-cdt)' },
  { sha256: 'd946e6b64f297442d19e486401aa49f956080b07a1fa6335f29976106175b588', label: 'CDT 4.1.1 (AntelopeIO/cdt)' }
]

/** Reads a CDT .deb the user chose: hash, size, whether it is known, and the id it would get. */
export async function inspectCdtPackage(path: string): Promise<ExtraCdt & { known: string | null }> {
  if (!/\.deb$/i.test(path)) throw new Error('Choose a .deb file')
  const st = await fsp.stat(path)
  if (st.size > 600 * 1024 * 1024) throw new Error('The file is too large for a CDT package')
  const sha256 = await sha256File(path)
  const known = KNOWN_CDT.find((k) => k.sha256 === sha256)?.label ?? null
  const m = /^cdt_([0-9][0-9a-z.]*)-\d+_amd64\.deb$/i.exec(path.split(/[\\/]/).pop() ?? '')
  const version = m ? m[1].toLowerCase() : sha256.slice(0, 8)
  const id = `cdt-${version}`.replace(/[^a-z0-9.-]/g, '')
  if (id === DEFAULT_TOOLCHAIN) throw new Error('This toolchain is already the default one')
  return { id, label: m ? `CDT ${m[1]}` : `CDT (${sha256.slice(0, 8)})`, path, sha256, size: st.size, known }
}

/** The toolchain a project builds with: its own choice if installed, else the default. */
export function toolchainForProject(cdt: string): { id: string; fallback: boolean } {
  if (cdt && toolchainState(cdt)) return { id: cdt, fallback: false }
  return { id: DEFAULT_TOOLCHAIN, fallback: !!cdt }
}
