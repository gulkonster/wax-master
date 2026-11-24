// Status mark of the selected network: the main process reads get_info from
// the current endpoint of the selected network on a timer and turns the last
// answers into green (working), orange (slow or behind) or red (not reachable
// or wrong chain). Nothing is read while the window is minimized or hidden.
// Changes of state are logged as one line; single checks are not.

import type { BrowserWindow } from 'electron'
import type { NetworkStatus, NetworkStatusLevel } from '../shared/chain-types'
import { oneLineText } from '../shared/network-info'

export const STATUS_TIMING = {
  /** Between checks while the window is visible. */
  intervalMs: 10_000,
  /** Between checks while the Network page is open. */
  fastIntervalMs: 2_000,
  /** One check gives up after this. */
  timeoutMs: 5_000,
  /** An answer this slow counts as slow. */
  slowMs: 1_500,
  /** The head block must grow between two checks at least this far apart. */
  stallMs: 6_000,
  /** Head block time further behind this computer's clock than this. */
  clockLagMs: 30_000,
  /** Irreversible block further behind the head than this. */
  libLagBlocks: 1_000
} as const

/** One check: an answer or a failure. */
export interface StatusSample {
  /** This computer's clock when the check ended (ms). */
  at: number
  ok: boolean
  latencyMs: number
  error?: string
  chainId?: string
  head?: number
  lib?: number
  /** Head block time (ms since 1970). */
  headTime?: number
}

export interface StatusTarget {
  networkId: string
  name: string
  chainId: string
  endpoint: string
}

const LABELS: Record<Exclude<NetworkStatusLevel, 'checking'>, string> = {
  green: 'Working',
  orange: 'Slow or behind',
  red: 'Not reachable'
}

function num(n: number): string {
  return n.toLocaleString('en-US')
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}...` : id
}

/** The error of a failed check: it may carry the node's own text, so one line of at most 200 characters. */
export function endpointError(e: unknown): string {
  return oneLineText(e instanceof Error ? e.message : String(e), 200)
}

/** Reads the fields of a get_info answer; throws when it is not one. */
export function readInfo(body: unknown): { chainId: string; head: number; lib: number; headTime: number } {
  const o = body as Record<string, unknown> | null
  const ok =
    !!o &&
    typeof o === 'object' &&
    typeof o.chain_id === 'string' &&
    /^[0-9a-f]{64}$/.test(o.chain_id) &&
    Number.isSafeInteger(o.head_block_num) &&
    Number.isSafeInteger(o.last_irreversible_block_num) &&
    typeof o.head_block_time === 'string'
  if (!ok) throw new Error('The endpoint did not give a get_info answer')
  const t = o.head_block_time as string
  // Node times are UTC without a zone mark.
  const headTime = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : `${t}Z`)
  if (!Number.isFinite(headTime)) throw new Error('The endpoint did not give a get_info answer')
  return { chainId: o.chain_id as string, head: o.head_block_num as number, lib: o.last_irreversible_block_num as number, headTime }
}

/**
 * The level from the checks so far (oldest first) for a network saved with
 * `chainId`, at time `now` of this computer's clock.
 */
export function evaluate(samples: readonly StatusSample[], chainId: string, now: number): { level: NetworkStatusLevel; label: string; reasons: string[] } {
  const last = samples[samples.length - 1]
  if (!last) return { level: 'checking', label: 'Checking', reasons: [] }
  if (last.ok && last.chainId !== chainId) {
    return {
      level: 'red',
      label: 'Wrong chain',
      reasons: [`The endpoint answers for chain ${shortId(last.chainId ?? '')}, not the saved ${shortId(chainId)}`]
    }
  }
  if (!last.ok) {
    let failed = 0
    for (let i = samples.length - 1; i >= 0 && !samples[i].ok; i--) failed++
    const why = last.error ?? 'No answer'
    if (failed >= 2) return { level: 'red', label: LABELS.red, reasons: [`${why} (${failed} checks in a row)`] }
    if (samples.length >= 2) return { level: 'orange', label: LABELS.orange, reasons: [`The last check failed: ${why}`] }
    return { level: 'checking', label: 'Checking', reasons: [`The first check failed: ${why}; checking again`] }
  }
  const reasons: string[] = []
  const recent = samples.slice(-3).filter((s) => s.ok && s.latencyMs >= STATUS_TIMING.slowMs)
  if (recent.length >= 2) reasons.push(`Slow answers: ${recent.map((s) => `${num(s.latencyMs)} ms`).join(', ')} in the last three checks`)
  // The newest good check at least the stall time before the last one.
  let earlier: StatusSample | undefined
  for (let i = samples.length - 2; i >= 0; i--) {
    const s = samples[i]
    if (s.ok && s.chainId === chainId && last.at - s.at >= STATUS_TIMING.stallMs) {
      earlier = s
      break
    }
  }
  if (earlier && last.head !== undefined && earlier.head !== undefined && last.head <= earlier.head) {
    reasons.push(`The head block did not grow in ${Math.round((last.at - earlier.at) / 1000)} s (still ${num(last.head)})`)
  }
  if (last.headTime !== undefined && now - last.headTime > STATUS_TIMING.clockLagMs) {
    reasons.push(`The head block time is ${num(Math.round((now - last.headTime) / 1000))} s behind this computer's clock (check the PC clock)`)
  }
  if (last.head !== undefined && last.lib !== undefined && last.head - last.lib > STATUS_TIMING.libLagBlocks) {
    reasons.push(`The irreversible block is ${num(last.head - last.lib)} blocks behind the head`)
  }
  return reasons.length > 0 ? { level: 'orange', label: LABELS.orange, reasons } : { level: 'green', label: LABELS.green, reasons: [] }
}

/** The tooltip line: "Working: 180 ms, head block 439,179,091". */
export function summaryText(label: string, reasons: readonly string[], last: StatusSample | undefined): string {
  const numbers = last?.ok ? `${num(last.latencyMs)} ms, head block ${num(last.head ?? 0)}` : ''
  if (reasons.length === 0) return numbers ? `${label}: ${numbers}` : label
  return `${label}: ${reasons.join('; ')}${numbers ? ` (${numbers})` : ''}`
}

export interface PollerDeps {
  /** The selected network and its current endpoint. */
  target(): StatusTarget | null
  /** One get_info request with a time limit. */
  getInfo(endpoint: string, timeoutMs: number): Promise<unknown>
  now(): number
  setTimer(fn: () => void, ms: number): unknown
  clearTimer(handle: unknown): void
  emit(status: NetworkStatus): void
  log(line: string): void
}

/** Checks kept: enough to look back over the stall time at the fast interval. */
const KEEP = 12

export class NetworkStatusPoller {
  private samples: StatusSample[] = []
  private key = ''
  private target: StatusTarget | null = null
  private visible = false
  private fast = false
  private running = false
  private timer: unknown = null
  private inFlight = false
  private state: NetworkStatus
  private lastLogged = ''

  constructor(private readonly deps: PollerDeps) {
    this.state = this.build()
  }

  /** Starts the checks (they run only while the window is visible). */
  start(visible: boolean): void {
    this.running = true
    this.visible = visible
    this.retarget()
    this.schedule()
  }

  stop(): void {
    this.running = false
    this.cancel()
  }

  /** Window shown or restored: check now when due; minimized or hidden: no checks. */
  setVisible(visible: boolean): void {
    if (this.visible === visible) return
    this.visible = visible
    this.schedule()
  }

  /** The Network page is open: check every 2 seconds instead of every 10. */
  setFast(fast: boolean): void {
    if (this.fast === fast) return
    this.fast = fast
    this.schedule()
  }

  isFast(): boolean {
    return this.fast
  }

  /** The network list or the current network changed: a new endpoint starts from "Checking". */
  refresh(): void {
    if (this.retarget()) this.schedule()
  }

  current(): NetworkStatus {
    return this.state
  }

  /** One check now (used by the timer and by tests). */
  async pollOnce(): Promise<void> {
    const t = this.target
    if (!t || this.inFlight) return
    this.inFlight = true
    const key = this.key
    const started = this.deps.now()
    let sample: StatusSample
    try {
      const body = await this.deps.getInfo(t.endpoint, STATUS_TIMING.timeoutMs)
      const info = readInfo(body)
      const at = this.deps.now()
      sample = { at, ok: true, latencyMs: Math.max(0, at - started), ...info }
    } catch (e) {
      const at = this.deps.now()
      sample = { at, ok: false, latencyMs: Math.max(0, at - started), error: endpointError(e) }
    } finally {
      this.inFlight = false
    }
    // The network changed while the answer was on its way: the answer is for the old one.
    if (key !== this.key) return
    this.samples.push(sample)
    if (this.samples.length > KEEP) this.samples.splice(0, this.samples.length - KEEP)
    this.update()
  }

  private retarget(): boolean {
    const t = this.deps.target()
    const key = t ? `${t.networkId}\u0000${t.chainId}\u0000${t.endpoint}` : ''
    if (key === this.key) return false
    this.key = key
    this.target = t
    this.samples = []
    this.update()
    return true
  }

  private update(): void {
    this.state = this.build()
    const s = this.state
    const line = `${s.level} ${s.label}`
    if (line !== this.lastLogged && this.target) {
      this.lastLogged = line
      if (s.level !== 'checking' || s.reasons.length > 0) this.deps.log(`Network status of ${this.target.name} (${this.target.endpoint}): ${s.summary}`)
    }
    this.deps.emit(s)
  }

  private build(): NetworkStatus {
    const t = this.target
    const last = this.samples[this.samples.length - 1]
    const r = evaluate(this.samples, t?.chainId ?? '', this.deps.now())
    const good = [...this.samples].reverse().find((s) => s.ok)
    return {
      networkId: t?.networkId ?? '',
      endpoint: t?.endpoint ?? '',
      level: r.level,
      label: r.label,
      reasons: r.reasons,
      summary: summaryText(r.label, r.reasons, last),
      headBlock: good?.head ?? null,
      lib: good?.lib ?? null,
      latencyMs: last?.ok ? last.latencyMs : null,
      checkedAt: last?.at ?? null
    }
  }

  private cancel(): void {
    if (this.timer !== null) this.deps.clearTimer(this.timer)
    this.timer = null
  }

  /** Plans the next check from the last one and the interval; none while hidden. */
  private schedule(): void {
    this.cancel()
    // A check on its way plans the next one when it ends.
    if (!this.running || !this.visible || !this.target || this.inFlight) return
    const interval = this.fast ? STATUS_TIMING.fastIntervalMs : STATUS_TIMING.intervalMs
    const last = this.samples[this.samples.length - 1]
    const wait = last ? Math.max(0, interval - (this.deps.now() - last.at)) : 0
    this.timer = this.deps.setTimer(() => {
      this.timer = null
      void this.pollOnce().finally(() => this.schedule())
    }, wait)
  }
}

let poller: NetworkStatusPoller | null = null

/** The one poller of the app (made by the chain handlers, started with the window). */
export function networkStatus(make?: () => NetworkStatusPoller): NetworkStatusPoller | null {
  if (!poller && make) poller = make()
  return poller
}

/** Starts the checks for the main window and follows its minimize, hide and reload. */
export function watchWindowForStatus(win: BrowserWindow): void {
  const p = networkStatus()
  if (!p) return
  const shown = (): boolean => !win.isDestroyed() && win.isVisible() && !win.isMinimized()
  p.start(shown())
  win.on('minimize', () => p.setVisible(false))
  win.on('hide', () => p.setVisible(false))
  win.on('restore', () => p.setVisible(shown()))
  win.on('show', () => p.setVisible(shown()))
  // A reloaded page has no Network page open.
  win.webContents.on('did-start-loading', () => p.setFast(false))
  win.on('closed', () => p.stop())
}
