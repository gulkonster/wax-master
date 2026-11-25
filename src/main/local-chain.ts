// The app's local chain (decisions B106, B108, B109): its private WSL distro, made offline from the
// bundled parts, and its one node process, kept attached while the chain runs and stopped with a signal.
// What is sent to the node once it answers is in `local-chain-boot.ts`.

import { app, shell } from 'electron'
import { appendFileSync, existsSync, mkdirSync, promises as fsp, readFileSync, statSync, statfsSync, writeFileSync } from 'node:fs'
import { createConnection, createServer } from 'node:net'
import { join } from 'node:path'
import manifest from '../../toolchain/parts.json'
import setupScriptRaw from '../../resources/local-chain/setup-distro.sh?raw'
import { generatePrivateKey, privateKeyToString, publicFromPrivate, publicKeyToString } from '../chain-core'
import {
  LOCAL_CHAIN_DEFAULT_PORT,
  LOCAL_CHAIN_DIRTY_FLAG_TEXT,
  LOCAL_CHAIN_DISTRO,
  LOCAL_CHAIN_NETWORK_ID,
  LOCAL_CHAIN_PORT_MAX,
  LOCAL_CHAIN_PORT_MIN,
  type LocalChainOptions,
  type LocalChainPhase,
  type LocalChainRepair,
  type LocalChainState,
  type LocalChainStatus
} from '../shared/local-chain'
import { configIni, genesisJson, genesisTimestamp } from '../shared/local-chain-config'
import { bootstrap } from './local-chain-boot'
import { run, type RunResult } from './helper'
import { readJson, writeJson } from './jsonfile'
import { localDataDir } from './paths'
import { clean, listDistros, partsDir, toolchainState, toWslPath, verifyParts, wsl, wslExe } from './toolchain'
import { log } from './log'

// ---------------------------------------------------------------- fixed texts (B106 point 5, B108 point 4)

export const UNAVAILABLE_TEXT = 'The local chain needs WSL 2 (virtualization on). The compiler works without it; the local chain does not.'
export const DIRTY_TEXT =
  "The chain's data was not closed cleanly and could not be repaired. Reset makes a new empty chain; the accounts and contracts on it are lost."
export function portTakenText(port: number): string {
  return `Port ${port} is used by another program.`
}
export function silentText(port: number): string {
  return `The node runs but does not answer at 127.0.0.1:${port}. WSL's localhost forwarding may be switched off (localhostForwarding in .wslconfig).`
}

const CHAIN_DIR = '/home/wax/chain'
const NODE_ARGS = ['nodeos', '--config-dir', `${CHAIN_DIR}/config`, '--data-dir', `${CHAIN_DIR}/data`]
const GENESIS_ARGS = ['--genesis-json', `${CHAIN_DIR}/config/genesis.json`]
const PRODUCER_API_ARGS = ['--plugin', 'eosio::producer_api_plugin']
const REPLAY_ARGS = ['--replay-blockchain']

const MIN_FREE_BYTES = 2 * 1024 * 1024 * 1024
const ANSWER_WAIT_MS = 20_000
const REPLAY_WAIT_MS = 30 * 60_000
const STOP_WAIT_MS = 15_000
const IRREVERSIBLE_WAIT_MS = 10_000
const IRREVERSIBLE_POLL_MS = 200
const LOG_KEEP_BYTES = 2 * 1024 * 1024
const LOG_TRIM_AT = LOG_KEEP_BYTES + 512 * 1024
const TAIL_KEEP = 16 * 1024
const DEFAULT_OPTIONS: LocalChainOptions = { webPages: false, startWithApp: false }

const SETUP_SCRIPT = setupScriptRaw.replace(/\r\n/g, '\n')

// ---------------------------------------------------------------- pure helpers (tested)

/** The parts of the local chain's distro in install order: the base tarball first, the node package last. */
export function localChainPartIds(m: { localChain: { base: string; packages: string[] } } = manifest): string[] {
  return [m.localChain.base, ...m.localChain.packages]
}

/** Hides anything shaped like a private key (new and WIF forms) in a text that goes to a log or a window. */
export function hideKeys(text: string): string {
  return text
    .replace(/PVT_[A-Z0-9]+_[1-9A-HJ-NP-Za-km-z]+/g, '[hidden]')
    .replace(/\b5[HJK][1-9A-HJ-NP-Za-km-z]{49}\b/g, '[hidden]')
}

/** The last `keep` bytes of a log, cut at the start of a line. */
export function logTail(text: string, keep = LOG_KEEP_BYTES): string {
  const buf = Buffer.from(text, 'utf8')
  if (buf.length <= keep) return text
  const cut = buf.subarray(buf.length - keep).toString('utf8')
  const nl = cut.indexOf('\n')
  return nl >= 0 ? cut.slice(nl + 1) : cut
}

export type ExitOutcome = { kind: 'replay' } | { kind: 'failed'; reason: string; repair: LocalChainRepair; portTaken?: boolean }

/**
 * What to do when the node ended without being asked to (B108 point 4): a dirty database gets one start
 * with `--replay-blockchain`; if that ends too, the chain can only be reset.
 */
export function exitOutcome(code: number, tail: string, replayTried: boolean, port: number): ExitOutcome {
  if (tail.includes(LOCAL_CHAIN_DIRTY_FLAG_TEXT)) {
    return replayTried ? { kind: 'failed', reason: DIRTY_TEXT, repair: { kind: 'reset' } } : { kind: 'replay' }
  }
  if (replayTried) return { kind: 'failed', reason: DIRTY_TEXT, repair: { kind: 'reset' } }
  if (/address already in use|address in use/i.test(tail)) {
    return { kind: 'failed', reason: portTakenText(port), repair: { kind: 'none' }, portTaken: true }
  }
  return { kind: 'failed', reason: `The node ended (exit ${code}). Open the log to see why.`, repair: { kind: 'none' } }
}

/** The first port from `from` up to the range's end for which `free` says yes; null when none is. */
export async function firstFreePort(free: (port: number) => Promise<boolean>, from = LOCAL_CHAIN_PORT_MIN, skip?: number): Promise<number | null> {
  for (let p = Math.max(from, LOCAL_CHAIN_PORT_MIN); p <= LOCAL_CHAIN_PORT_MAX; p++) {
    if (p === skip) continue
    if (await free(p)) return p
  }
  return null
}

export interface BlockNums {
  head: number
  irreversible: number
}

export type IrreversibleOutcome = 'irreversible' | 'no-answer' | 'timeout'

/**
 * Waits until the last irreversible block passes the head block read at the call, so the block with the
 * last transactions is written before the node is stopped (a SIGINT drops the block being built). Ends
 * after `limitMs` at the latest; a node that does not answer at the first read is not waited for.
 */
export async function waitIrreversible(
  read: () => Promise<BlockNums | null>,
  limitMs = IRREVERSIBLE_WAIT_MS,
  pollMs = IRREVERSIBLE_POLL_MS,
  now: () => number = Date.now
): Promise<IrreversibleOutcome> {
  const end = now() + limitMs
  const first = await read()
  if (!first) return 'no-answer'
  const target = first.head
  if (first.irreversible > target) return 'irreversible'
  while (now() < end) {
    await new Promise((r) => setTimeout(r, Math.max(0, Math.min(pollMs, end - now()))))
    const nums = await read()
    if (nums && nums.irreversible > target) return 'irreversible'
  }
  return 'timeout'
}

/** The `--exec` arguments that run one command of the setup script as root. */
export function scriptArgs(command: string, args: string[] = []): string[] {
  return ['-d', LOCAL_CHAIN_DISTRO, '-u', 'root', '--exec', 'bash', '-c', SETUP_SCRIPT, 'setup-distro', command, ...args]
}

/** The `wsl.exe` arguments of the node itself (B108 point 1). */
export function nodeArgs(mode: { genesis?: boolean; producerApi?: boolean; replay?: boolean } = {}): string[] {
  return [
    '-d',
    LOCAL_CHAIN_DISTRO,
    '-u',
    'wax',
    '--exec',
    ...NODE_ARGS,
    ...(mode.genesis ? GENESIS_ARGS : []),
    ...(mode.producerApi ? PRODUCER_API_ARGS : []),
    ...(mode.replay ? REPLAY_ARGS : [])
  ]
}

// ---------------------------------------------------------------- files and ports

function chainDir(): string {
  return join(localDataDir(), 'local-chain')
}
function distroDir(): string {
  return join(chainDir(), 'distro')
}
function stateFile(): string {
  return join(chainDir(), 'state.json')
}
export function logFile(): string {
  return join(chainDir(), 'nodeos.log')
}

function readState(): LocalChainState | null {
  const s = readJson<Partial<LocalChainState> | null>(stateFile(), null)
  if (!s || typeof s.port !== 'number') return null
  return {
    port: s.port,
    chainId: typeof s.chainId === 'string' ? s.chainId : '',
    nodeVersion: typeof s.nodeVersion === 'string' ? s.nodeVersion : '',
    contractsVersion: typeof s.contractsVersion === 'string' ? s.contractsVersion : '',
    options: { ...DEFAULT_OPTIONS, ...(s.options ?? {}) },
    bootstrapped: s.bootstrapped === true
  }
}

function saveState(s: LocalChainState): void {
  writeJson(stateFile(), s)
}

/** False only when Windows refuses the port itself (a reserved range). A refusal because of closed
 * connections still waiting on the port (TIME_WAIT, left by the app's own reads of a stopped node) is not a taker. */
function canListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer()
    srv.once('error', (err: NodeJS.ErrnoException) => resolve(err.code === 'EADDRINUSE'))
    srv.listen({ port, host: '127.0.0.1' }, () => srv.close(() => resolve(true)))
  })
}

function someoneAnswers(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection({ port, host: '127.0.0.1' })
    const done = (v: boolean): void => {
      sock.destroy()
      resolve(v)
    }
    sock.setTimeout(800, () => done(false))
    sock.once('connect', () => done(true))
    sock.once('error', () => done(false))
  })
}

/** A port is free on the Windows side when no program answers on it and Windows does not reserve it. */
export async function portFree(port: number): Promise<boolean> {
  if (await someoneAnswers(port)) return false
  return canListen(port)
}

interface ChainInfo {
  chain_id: string
  head_block_num: number
  last_irreversible_block_num?: number
  server_version_string?: string
}

async function getInfo(port: number, timeoutMs = 1500): Promise<ChainInfo | null> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/v1/chain/get_info`, { method: 'POST', body: '{}', signal: AbortSignal.timeout(timeoutMs) })
    if (!r.ok) return null
    const j = (await r.json()) as ChainInfo
    return typeof j.chain_id === 'string' ? j : null
  } catch {
    return null
  }
}

function contractsVersion(): string {
  try {
    const p = join(app.isPackaged ? join(process.resourcesPath, 'resources') : join(app.getAppPath(), 'resources'), 'local-chain', 'contracts.json')
    const j = JSON.parse(readFileSync(p, 'utf8')) as { source?: { tag?: string; commit?: string } }
    return j.source?.tag ?? j.source?.commit ?? ''
  } catch {
    return ''
  }
}

// ---------------------------------------------------------------- events

type StatusListener = (s: LocalChainStatus) => void
type ProgressListener = (line: string) => void
const statusListeners = new Set<StatusListener>()
const progressListeners = new Set<ProgressListener>()

export function onStatus(fn: StatusListener): () => void {
  statusListeners.add(fn)
  return () => statusListeners.delete(fn)
}

export function onProgress(fn: ProgressListener): () => void {
  progressListeners.add(fn)
  return () => progressListeners.delete(fn)
}

function progress(line: string): void {
  const safe = hideKeys(line).trimEnd()
  if (!safe) return
  for (const fn of progressListeners) fn(safe)
}

// ---------------------------------------------------------------- the module's state

let phase: LocalChainPhase | null = null
let reason: string | undefined
let repair: LocalChainRepair | undefined
let dataMb: number | undefined
let dataMbAt = 0
/** The system key while the chain runs (B109 point 2). Never logged, never sent to a window. */
let systemKey: string | null = null

interface NodeProc {
  done: Promise<RunResult>
  exited: boolean
  code: number | null
  stopping: boolean
  tail: string
}
let node: NodeProc | null = null
let queue: Promise<unknown> = Promise.resolve()

function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn)
  queue = next.catch(() => undefined)
  return next
}

function setPhase(p: LocalChainPhase, why?: string, fix?: LocalChainRepair): void {
  phase = p
  reason = why
  repair = fix
  // Built at once from what is known, so the events arrive in the order of the phases.
  const s = statusOf(p, readState())
  for (const fn of statusListeners) fn(s)
}

function statusOf(p: LocalChainPhase, state: LocalChainState | null, head?: number): LocalChainStatus {
  const port = state?.port ?? LOCAL_CHAIN_DEFAULT_PORT
  return {
    phase: p,
    reason,
    repair,
    port,
    endpoint: `http://127.0.0.1:${port}`,
    chainId: state?.chainId ?? '',
    nodeVersion: state?.nodeVersion ?? '',
    head,
    dataMb: state ? dataMb : undefined,
    options: state?.options ?? { ...DEFAULT_OPTIONS }
  }
}

async function determinePhase(): Promise<LocalChainPhase> {
  if (phase) return phase
  if (!existsSync(wslExe())) {
    reason = UNAVAILABLE_TEXT
    return (phase = 'unavailable')
  }
  if (toolchainState()?.wslVersion === 1) {
    reason = UNAVAILABLE_TEXT
    return (phase = 'unavailable')
  }
  const state = readState()
  if (!state || !(await listDistros()).includes(LOCAL_CHAIN_DISTRO)) return (phase = 'not-set-up')
  return (phase = 'stopped')
}

export async function getStatus(): Promise<LocalChainStatus> {
  const p = await determinePhase()
  const state = readState()
  const port = state?.port ?? LOCAL_CHAIN_DEFAULT_PORT
  let head: number | undefined
  if (p === 'running') {
    const info = await getInfo(port)
    head = info?.head_block_num
    if (Date.now() - dataMbAt > 15_000) {
      dataMbAt = Date.now()
      const r = await script('data-mb', [], { timeoutMs: 30_000 }).catch(() => null)
      const m = r ? /DATA (\d+)/.exec(clean(r.output)) : null
      if (m) dataMb = Number(m[1])
    }
  }
  return statusOf(p, state, head)
}

// ---------------------------------------------------------------- WSL calls

function script(command: string, args: string[] = [], opts: { input?: string; timeoutMs?: number } = {}): Promise<RunResult> {
  return wsl(scriptArgs(command, args), { input: opts.input ?? '', timeoutMs: opts.timeoutMs ?? 60_000 })
}

async function scriptOk(command: string, args: string[] = [], opts: { input?: string; timeoutMs?: number } = {}): Promise<string> {
  const r = await script(command, args, opts)
  const out = clean(r.output)
  if (r.code !== 0) {
    const err = out.split('\n').filter((l) => l.startsWith('ERROR:')).pop() ?? out.trim().split('\n').pop() ?? r.error ?? ''
    throw new Error(`The local chain's distro refused "${command}" (exit ${r.code}): ${hideKeys(err).slice(0, 300)}`)
  }
  return out
}

/** The system key, read from the chain's own config through WSL and kept in memory (B109 point 2). */
export async function localChainSystemKey(): Promise<string> {
  if (systemKey) return systemKey
  const r = await script('read-key', [], { timeoutMs: 30_000 })
  const key = clean(r.output).trim()
  if (r.code !== 0 || !/^PVT_K1_[1-9A-HJ-NP-Za-km-z]+$/.test(key)) throw new Error("The local chain's system key could not be read from its config.")
  systemKey = key
  return key
}

// ---------------------------------------------------------------- the node process

function appendLog(text: string): void {
  try {
    const f = logFile()
    appendFileSync(f, hideKeys(text))
    if (statSync(f).size > LOG_TRIM_AT) writeFileSync(f, logTail(readFileSync(f, 'utf8')))
  } catch (err) {
    log.warn(`Local chain log not written: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function launch(mode: { genesis?: boolean; producerApi?: boolean; replay?: boolean }): NodeProc {
  mkdirSync(chainDir(), { recursive: true })
  appendLog(`\n==== ${new Date().toISOString()} node started${mode.genesis ? ' from the genesis' : ''}${mode.replay ? ' with --replay-blockchain' : ''}\n`)
  const proc: NodeProc = { done: Promise.resolve({ code: -1, output: '' }), exited: false, code: null, stopping: false, tail: '' }
  proc.done = run(wslExe(), nodeArgs(mode), {
    env: { WSL_UTF8: '1' },
    input: '',
    keepOutput: false,
    onOutput: (t) => {
      const text = clean(t)
      appendLog(text)
      proc.tail = (proc.tail + text).slice(-TAIL_KEEP)
    }
  }).then((r) => {
    proc.exited = true
    proc.code = r.code
    appendLog(`==== node ended (exit ${r.code})\n`)
    if (node === proc) node = null
    if (!proc.stopping) onUnexpectedExit(proc)
    return r
  })
  node = proc
  return proc
}

type WaitResult = { kind: 'answer'; info: ChainInfo } | { kind: 'exited'; code: number; tail: string } | { kind: 'silent' }

async function waitForAnswer(proc: NodeProc, port: number, ms: number): Promise<WaitResult> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (proc.exited) return { kind: 'exited', code: proc.code ?? -1, tail: proc.tail }
    const info = await getInfo(port, 1000)
    if (info) return { kind: 'answer', info }
    if (proc.exited) return { kind: 'exited', code: proc.code ?? -1, tail: proc.tail }
    await new Promise((r) => setTimeout(r, 500))
  }
  return { kind: 'silent' }
}

/** Waits (at most 10 s) until the node's last transactions are in an irreversible block; logs one line when it gives up. */
async function settleBlocks(port: number): Promise<void> {
  const outcome = await waitIrreversible(async () => {
    const info = await getInfo(port, 1000)
    if (!info || typeof info.last_irreversible_block_num !== 'number') return null
    return { head: info.head_block_num, irreversible: info.last_irreversible_block_num }
  })
  if (outcome === 'timeout') log.warn('Local chain: the last block did not become irreversible within 10 s; stopping the node anyway')
}

/**
 * Stops the node as B108 point 3 says, after its last block became irreversible (up to 10 s; a SIGINT
 * drops the block being built): SIGINT, up to 15 s, then `wsl --terminate`.
 */
async function stopProcess(): Promise<void> {
  const proc = node
  if (proc && !proc.exited) {
    proc.stopping = true
    progress('Stopping the node...')
    const statePort = readState()?.port
    if (statePort) await settleBlocks(statePort)
    await script('stop-node', [], { timeoutMs: 30_000 }).catch(() => null)
    const ended = await Promise.race([proc.done.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), STOP_WAIT_MS))])
    if (!ended) {
      log.warn('Local chain node did not end within 15 s of SIGINT; terminating its distro')
      await wsl(['--terminate', LOCAL_CHAIN_DISTRO], { timeoutMs: 60_000 })
      await Promise.race([proc.done, new Promise((r) => setTimeout(r, 10_000))])
    }
  }
  if (node === proc) node = null
  systemKey = null
  // WSL's localhost relay keeps answering on the port for about a second after the node ended (measured
  // 0.8-0.9 s); waiting here keeps the next port check from taking the relay for another program.
  const port = readState()?.port
  if (proc && port) {
    for (let i = 0; i < 15 && (await someoneAnswers(port)); i++) await new Promise((r) => setTimeout(r, 200))
  }
}

/** A node left running in the distro (an app that was killed) is stopped before a new start. */
async function stopLeftover(): Promise<void> {
  if (node) return
  if (!(await listDistros()).includes(LOCAL_CHAIN_DISTRO)) return
  const r = await script('node-running', [], { timeoutMs: 30_000 }).catch(() => null)
  const m = r ? /RUNNING (\d+)/.exec(clean(r.output)) : null
  if (!m || m[1] === '0') return
  progress('A node left from an earlier session is still running; stopping it first...')
  const port = readState()?.port
  if (port) await settleBlocks(port)
  await script('stop-node', [], { timeoutMs: 30_000 }).catch(() => null)
  for (let i = 0; i < 30; i++) {
    await new Promise((res) => setTimeout(res, 500))
    const again = await script('node-running', [], { timeoutMs: 30_000 }).catch(() => null)
    if (again && /RUNNING 0/.test(clean(again.output))) return
  }
  await wsl(['--terminate', LOCAL_CHAIN_DISTRO], { timeoutMs: 60_000 })
}

async function portFailure(port: number): Promise<never> {
  const next = await firstFreePort(portFree, LOCAL_CHAIN_PORT_MIN, port)
  setPhase('failed', portTakenText(port), next ? { kind: 'use-port', port: next } : { kind: 'none' })
  throw new HandledFailure()
}

/** A failure already shown in the status; the call returns the status instead of throwing. */
class HandledFailure extends Error {}

/**
 * Starts the node and waits until it answers. A dirty database gets one replay (B108 point 4 a);
 * a taken port and a silent node fail with their texts.
 */
async function startAnswering(port: number, mode: { genesis?: boolean; producerApi?: boolean } = {}): Promise<ChainInfo> {
  let replay = false
  for (;;) {
    const proc = launch({ ...mode, replay })
    const res = await waitForAnswer(proc, port, replay ? REPLAY_WAIT_MS : ANSWER_WAIT_MS)
    if (res.kind === 'answer') return res.info
    if (res.kind === 'silent') {
      await stopProcess()
      setPhase('failed', silentText(port), { kind: 'none' })
      throw new HandledFailure()
    }
    const out = exitOutcome(res.code, res.tail, replay, port)
    if (out.kind === 'replay' && !mode.genesis) {
      progress("The chain's data was not closed cleanly. Replaying its blocks...")
      replay = true
      continue
    }
    if (out.kind === 'failed' && out.portTaken) return portFailure(port)
    setPhase('failed', out.kind === 'failed' ? out.reason : DIRTY_TEXT, out.kind === 'failed' ? out.repair : { kind: 'reset' })
    throw new HandledFailure()
  }
}

export const ENDED_TEXT = 'The node ended unexpectedly. Start checks its data and repairs it if needed.'

/**
 * The node ended while it ran (WSL stopped under it, or the node itself ended). Its data may be dirty;
 * the next Start replays it if so (B108 point 4 a), so the chain is shown as stopped with one line.
 */
function onUnexpectedExit(proc: NodeProc): void {
  if (phase !== 'running') return
  systemKey = null
  log.warn(`Local chain node ended while running (exit ${proc.code})`)
  setPhase('stopped', ENDED_TEXT)
}

/**
 * A new chain on an empty data folder: genesis start with the producer API, the bootstrap of
 * `local-chain-boot.ts`, then a clean stop (B108 point 1, B107 point 5). Ends stopped.
 */
async function freshChain(state: LocalChainState, key: string): Promise<LocalChainState> {
  progress('Emptying the data folder...')
  await scriptOk('wipe-data')
  saveState((state = { ...state, bootstrapped: false }))
  progress('Starting the node from the genesis...')
  const info = await startAnswering(state.port, { genesis: true, producerApi: true })
  saveState((state = { ...state, chainId: info.chain_id }))
  progress(`The node answers. Chain id ${info.chain_id}.`)
  try {
    await bootstrap(`http://127.0.0.1:${state.port}`, key, progress, {
      expect: { port: state.port, chainId: info.chain_id, networkId: LOCAL_CHAIN_NETWORK_ID }
    })
  } catch (err) {
    await stopProcess()
    const msg = err instanceof Error ? err.message : String(err)
    setPhase('failed', `The chain could not be filled with the system contracts: ${hideKeys(msg)}`, { kind: 'reset' })
    throw new HandledFailure()
  }
  // The bootstrap's last block must be irreversible before the stop, or the next start lacks it.
  await settleBlocks(state.port)
  saveState((state = { ...state, bootstrapped: true }))
  await stopProcess()
  progress('The chain is ready.')
  return state
}

/** Starts a set-up chain (no question). Assumes the phase allows it. */
async function startChain(): Promise<void> {
  const state = readState()
  if (!state) throw new Error('The local chain is not set up.')
  if (node && !node.exited) return
  setPhase('starting')
  await stopLeftover()
  if (!(await portFree(state.port))) {
    // A relay left from a node that just ended lets go within about a second.
    await new Promise((r) => setTimeout(r, 2000))
    if (!(await portFree(state.port))) await portFailure(state.port)
  }
  let s = state
  if (!s.bootstrapped) s = await freshChain(s, await localChainSystemKey())
  const info = await startAnswering(s.port)
  if (s.chainId && info.chain_id !== s.chainId) log.warn('Local chain answered with another chain id than its state')
  if (!s.chainId) saveState({ ...s, chainId: info.chain_id })
  setPhase('running')
  log.info(`Local chain running at 127.0.0.1:${s.port}`)
}

async function guarded(fn: () => Promise<void>, failedPrefix?: string): Promise<LocalChainStatus> {
  try {
    await fn()
  } catch (err) {
    if (!(err instanceof HandledFailure)) {
      const msg = hideKeys(err instanceof Error ? err.message : String(err))
      log.warn(`Local chain: ${msg}`)
      if (phase !== 'unavailable') setPhase('failed', failedPrefix ? `${failedPrefix} ${msg}` : msg, { kind: 'none' })
    }
  }
  return getStatus()
}

// ---------------------------------------------------------------- calls (B108 point 7)

/** Makes the distro, the key, genesis and config, fills the chain with the system contracts. Ends stopped. */
export function setUp(): Promise<LocalChainStatus> {
  return serial(async () => {
    const p = await determinePhase()
    if (p === 'unavailable' || p === 'running' || p === 'starting') return getStatus()
    return guarded(async () => {
      setPhase('setting-up')
      const started = Date.now()
      mkdirSync(chainDir(), { recursive: true })
      const free = statfsSync(chainDir())
      if (free.bavail * free.bsize < MIN_FREE_BYTES) throw new Error('At least 2 GB of free disk space is needed for the local chain.')

      progress('Checking the bundled node parts (SHA-256)...')
      const ids = localChainPartIds()
      await verifyParts(ids, progress)

      const port = await firstFreePort(portFree)
      if (port === null) throw new Error(`No free port between ${LOCAL_CHAIN_PORT_MIN} and ${LOCAL_CHAIN_PORT_MAX} on this computer.`)
      progress(`Port ${port} is free.`)

      if ((await listDistros()).includes(LOCAL_CHAIN_DISTRO)) {
        progress('Removing the earlier local chain...')
        await wsl(['--unregister', LOCAL_CHAIN_DISTRO], { timeoutMs: 120_000 })
      }
      await fsp.rm(stateFile(), { force: true })
      await fsp.rm(distroDir(), { recursive: true, force: true })
      mkdirSync(distroDir(), { recursive: true })

      const parts = manifest.parts
      const fileOf = (id: string): string => {
        const part = parts.find((x) => x.id === id)
        if (!part) throw new Error(`Manifest has no part "${id}"`)
        return part.file
      }
      const baseFile = fileOf(ids[0])
      progress(`Importing ${baseFile} as "${LOCAL_CHAIN_DISTRO}" (WSL 2)...`)
      const imp = await wsl(['--import', LOCAL_CHAIN_DISTRO, distroDir(), join(partsDir(), baseFile), '--version', '2'], { timeoutMs: 10 * 60_000 })
      if (imp.code !== 0) {
        const text = clean(imp.output).trim() || imp.error || ''
        await fsp.rm(distroDir(), { recursive: true, force: true })
        if (/virtuali|wsl ?2|hcs_|HCS|Virtual Machine Platform|Sanal Makine/i.test(text)) {
          setPhase('unavailable', UNAVAILABLE_TEXT)
          throw new HandledFailure()
        }
        throw new Error(`WSL could not import the local chain's distro: ${text.split('\n').slice(0, 3).join(' ')}`)
      }

      progress('Installing the WAX node inside it (offline)...')
      const files = ids.slice(1).map(fileOf)
      const inst = await wsl(scriptArgs('install', [toWslPath(partsDir()), ...files]), {
        input: '',
        onOutput: (t) => clean(t).split('\n').filter(Boolean).forEach((l) => progress(l)),
        timeoutMs: 20 * 60_000
      })
      const instOut = clean(inst.output)
      if (inst.code !== 0) throw new Error(`The node could not be installed inside WSL (exit ${inst.code}). See the lines above.`)
      const nodeVersion = /NODE (\S+)/.exec(instOut)?.[1] ?? ''
      // The installed user and wsl.conf take effect at the next start of the distro.
      await wsl(['--terminate', LOCAL_CHAIN_DISTRO], { timeoutMs: 60_000 })

      progress('Making the chain key and writing the genesis and config...')
      const priv = generatePrivateKey()
      const key = privateKeyToString(priv)
      const pub = publicKeyToString(publicFromPrivate(priv))
      await scriptOk('write', ['genesis.json'], { input: genesisJson(pub, genesisTimestamp(new Date())) })
      await scriptOk('write', ['config.ini'], { input: configIni({ port, publicKey: pub, privateKey: key, webPages: false }) })

      let state: LocalChainState = {
        port,
        chainId: '',
        nodeVersion,
        contractsVersion: contractsVersion(),
        options: { ...DEFAULT_OPTIONS },
        bootstrapped: false
      }
      saveState(state)
      systemKey = key
      state = await freshChain(state, key)
      systemKey = null
      setPhase('stopped')
      const secs = Math.round((Date.now() - started) / 1000)
      progress(`Ready (${secs} s). Press Start to run the chain.`)
      log.info(`Local chain set up in ${secs} s, node ${state.nodeVersion}, port ${state.port}`)
    }, 'Set up did not finish:')
  })
}

export function start(): Promise<LocalChainStatus> {
  return serial(async () => {
    const p = await determinePhase()
    if (p === 'unavailable' || p === 'not-set-up' || p === 'running') return getStatus()
    return guarded(startChain)
  })
}

export function stop(): Promise<LocalChainStatus> {
  return serial(async () => {
    const p = await determinePhase()
    if (p !== 'running' && p !== 'starting' && !node) return getStatus()
    return guarded(async () => {
      setPhase('stopping')
      await stopProcess()
      setPhase('stopped')
    })
  })
}

/** Stop, empty data, genesis start, bootstrap, start (B108 point 3). The question is asked by the caller. */
export function reset(): Promise<LocalChainStatus> {
  return serial(async () => {
    const p = await determinePhase()
    if (p === 'unavailable' || p === 'not-set-up') return getStatus()
    return guarded(async () => {
      const state = readState()
      if (!state) throw new Error('The local chain is not set up.')
      setPhase('stopping')
      await stopProcess()
      await stopLeftover()
      setPhase('starting')
      const key = await localChainSystemKey()
      await freshChain(state, key)
      await startChain()
    })
  })
}

/** Stop, unregister the distro, delete its folder (B108 point 3). The caller asks first and removes the network entry. */
export function remove(): Promise<LocalChainStatus> {
  return serial(async () => {
    const p = await determinePhase()
    if (p === 'unavailable') return getStatus()
    return guarded(async () => {
      setPhase('stopping')
      await stopProcess()
      if ((await listDistros()).includes(LOCAL_CHAIN_DISTRO)) {
        const r = await wsl(['--unregister', LOCAL_CHAIN_DISTRO], { timeoutMs: 120_000 })
        if (r.code !== 0) throw new Error(`WSL could not remove the local chain's distro: ${clean(r.output).trim().slice(0, 200)}`)
      }
      await fsp.rm(chainDir(), { recursive: true, force: true })
      dataMb = undefined
      setPhase('not-set-up')
      log.info('Local chain removed')
    })
  })
}

/** Moves the chain to another port: config.ini and state; a running or failed chain is started on it. */
export function usePort(port: number): Promise<LocalChainStatus> {
  return serial(async () => {
    const p = await determinePhase()
    if (p === 'unavailable' || p === 'not-set-up' || p === 'setting-up') return getStatus()
    return guarded(async () => {
      if (!Number.isInteger(port) || port < LOCAL_CHAIN_PORT_MIN || port > LOCAL_CHAIN_PORT_MAX) {
        throw new Error(`The port must be between ${LOCAL_CHAIN_PORT_MIN} and ${LOCAL_CHAIN_PORT_MAX}.`)
      }
      const state = readState()
      if (!state) throw new Error('The local chain is not set up.')
      const restart = p === 'running' || p === 'failed'
      if (node) {
        setPhase('stopping')
        await stopProcess()
      }
      await scriptOk('set-port', [String(port)])
      saveState({ ...state, port })
      progress(`The chain now uses port ${port}.`)
      if (restart) await startChain()
      else setPhase('stopped')
    })
  })
}

/** Saves the options; the web pages option rewrites config.ini and restarts a running node (B108 point 9). */
export function setOptions(options: LocalChainOptions): Promise<LocalChainStatus> {
  return serial(async () => {
    const state = readState()
    if (!state) return getStatus()
    return guarded(async () => {
      const next = { webPages: !!options.webPages, startWithApp: !!options.startWithApp }
      if (next.webPages !== state.options.webPages) {
        await scriptOk('set-cors', [next.webPages ? '1' : '0'])
        saveState({ ...state, options: next })
        if (node && !node.exited) {
          setPhase('stopping')
          await stopProcess()
          await startChain()
        } else {
          setPhase(phase ?? 'stopped', reason, repair)
        }
      } else {
        saveState({ ...state, options: next })
        setPhase(phase ?? 'stopped', reason, repair)
      }
    })
  })
}

export async function openLog(): Promise<void> {
  const f = logFile()
  if (!existsSync(f)) {
    mkdirSync(chainDir(), { recursive: true })
    writeFileSync(f, '')
  }
  const err = await shell.openPath(f)
  if (err) throw new Error(`The log could not be opened: ${err}`)
}

// ---------------------------------------------------------------- app life (B108 points 5, 6, 9)

/** True when the chain is set up (for the first question of Clear All App Data). */
export function isLocalChainSetUp(): boolean {
  return readState() !== null || existsSync(distroDir())
}

/** True while a node process of this app runs. */
export function localChainRunning(): boolean {
  return !!node && !node.exited
}

/** Stops the node for the app's quit, without a question (B108 point 5). */
export async function stopForQuit(): Promise<void> {
  if (!node || node.exited) return
  setPhase('stopping')
  await stopProcess()
  setPhase('stopped')
}

/** "Start the local chain with WAX Master": starts it once at app start when the option is on. */
export async function startIfAsked(): Promise<LocalChainStatus | null> {
  const state = readState()
  if (!state?.options.startWithApp) return null
  const s = await start()
  return s.phase === 'running' ? s : null
}
