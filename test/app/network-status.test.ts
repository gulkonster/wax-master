// Status mark of the selected network: each rule of the thresholds with a
// fake clock and fake get_info answers, the poll timer, and no checks while the
// window is minimized.

import { describe, expect, it } from 'vitest'
import { NetworkStatusPoller, STATUS_TIMING, evaluate, readInfo, type StatusSample, type StatusTarget } from '../../src/main/network-status'
import type { NetworkStatus } from '../../src/shared/chain-types'

const CHAIN = 'f16b1833c747c43682f4386fca9cbb327929334a762755ebec17f6f23c9b8a12'
const OTHER = 'a'.repeat(64)
const T0 = Date.parse('2026-11-24T12:00:00Z')

/** A good answer at `at` with the head growing two blocks per second. */
function good(at: number, extra: Partial<StatusSample> = {}): StatusSample {
  const head = 1_000_000 + Math.round((at - T0) / 500)
  return { at, ok: true, latencyMs: 180, chainId: CHAIN, head, lib: head - 144, headTime: at - 300, ...extra }
}
function bad(at: number, error = 'Could not reach node.example: no answer.'): StatusSample {
  return { at, ok: false, latencyMs: 5000, error }
}

describe('status thresholds', () => {
  it('no check yet: checking (hollow ring)', () => {
    expect(evaluate([], CHAIN, T0)).toEqual({ level: 'checking', label: 'Checking', reasons: [] })
  })

  it('green: a good answer', () => {
    const r = evaluate([good(T0)], CHAIN, T0)
    expect(r.level).toBe('green')
    expect(r.label).toBe('Working')
  })

  it('red at once: the endpoint answers for another chain', () => {
    const r = evaluate([good(T0), good(T0 + 10_000, { chainId: OTHER })], CHAIN, T0 + 10_000)
    expect(r.level).toBe('red')
    expect(r.label).toBe('Wrong chain')
    expect(r.reasons[0]).toMatch(/aaaaaaaa\.\.\., not the saved f16b1833\.\.\./)
  })

  it('red: two failed checks in a row', () => {
    const r = evaluate([good(T0), bad(T0 + 10_000), bad(T0 + 20_000)], CHAIN, T0 + 20_000)
    expect(r.level).toBe('red')
    expect(r.label).toBe('Not reachable')
    expect(r.reasons[0]).toMatch(/no answer.*2 checks in a row/)
  })

  it('orange: one failed check after a good one', () => {
    const r = evaluate([good(T0), bad(T0 + 10_000, 'HTTP 502')], CHAIN, T0 + 10_000)
    expect(r.level).toBe('orange')
    expect(r.reasons).toEqual(['The last check failed: HTTP 502'])
  })

  it('a failed first check stays "checking" and says so; the second failure is red', () => {
    const one = evaluate([bad(T0)], CHAIN, T0)
    expect(one.level).toBe('checking')
    expect(one.reasons[0]).toMatch(/first check failed/)
    expect(evaluate([bad(T0), bad(T0 + 10_000)], CHAIN, T0 + 10_000).level).toBe('red')
  })

  it('orange: 1,500 ms or more in two of the last three checks; one slow answer is still green', () => {
    const slow = (at: number, ms: number): StatusSample => good(at, { latencyMs: ms })
    expect(evaluate([good(T0), slow(T0 + 10_000, 1600), good(T0 + 20_000)], CHAIN, T0 + 20_000).level).toBe('green')
    const r = evaluate([slow(T0, 1500), good(T0 + 10_000), slow(T0 + 20_000, 2100)], CHAIN, T0 + 20_000)
    expect(r.level).toBe('orange')
    expect(r.reasons[0]).toMatch(/Slow answers: 1,500 ms, 2,100 ms/)
    // Older slow answers fall out of the three.
    expect(evaluate([slow(T0, 1500), slow(T0 + 10_000, 1500), good(T0 + 20_000), good(T0 + 30_000), good(T0 + 40_000)], CHAIN, T0 + 40_000).level).toBe('green')
  })

  it('orange: the head block did not grow between two checks at least 6 seconds apart', () => {
    const stuck = (at: number): StatusSample => good(at, { head: 500, lib: 400, headTime: at - 300 })
    const r = evaluate([stuck(T0), stuck(T0 + 10_000)], CHAIN, T0 + 10_000)
    expect(r.level).toBe('orange')
    expect(r.reasons[0]).toMatch(/did not grow in 10 s/)
    // Checks 2 seconds apart: compared with the one at least 6 seconds back.
    const fast = [stuck(T0), stuck(T0 + 2000), stuck(T0 + 4000)]
    expect(evaluate(fast, CHAIN, T0 + 4000).level).toBe('green')
    expect(evaluate([...fast, stuck(T0 + 6000)], CHAIN, T0 + 6000).level).toBe('orange')
  })

  it('orange: the head block time is more than 30 seconds behind this computer (check the PC clock)', () => {
    expect(evaluate([good(T0, { headTime: T0 - 30_000 })], CHAIN, T0).level).toBe('green')
    const r = evaluate([good(T0, { headTime: T0 - 31_000 })], CHAIN, T0)
    expect(r.level).toBe('orange')
    expect(r.reasons[0]).toMatch(/31 s behind this computer's clock \(check the PC clock\)/)
  })

  it('orange: the irreversible block more than 1,000 blocks behind the head', () => {
    expect(evaluate([good(T0, { head: 5000, lib: 4000 })], CHAIN, T0).level).toBe('green')
    const r = evaluate([good(T0, { head: 5001, lib: 4000 })], CHAIN, T0)
    expect(r.level).toBe('orange')
    expect(r.reasons[0]).toMatch(/1,001 blocks behind the head/)
  })

  it('reads a get_info answer; anything else is a failed check', () => {
    const info = readInfo({ chain_id: CHAIN, head_block_num: 7, last_irreversible_block_num: 5, head_block_time: '2026-11-24T12:00:00.500' })
    expect(info).toEqual({ chainId: CHAIN, head: 7, lib: 5, headTime: T0 + 500 })
    expect(() => readInfo('<html>')).toThrow(/get_info/)
    expect(() => readInfo({ chain_id: 'x', head_block_num: 7, last_irreversible_block_num: 5, head_block_time: '' })).toThrow(/get_info/)
    expect(() => readInfo({ chain_id: CHAIN, head_block_num: '7', last_irreversible_block_num: 5, head_block_time: '2026-11-24T12:00:00' })).toThrow(/get_info/)
    expect(() => readInfo(null)).toThrow(/get_info/)
  })
})

/** A poller with a fake clock, fake timers and scripted answers. */
function rig(answers: (endpoint: string) => { latency: number; body?: unknown; error?: string }) {
  let now = T0
  const timers: { at: number; fn: () => void; id: number }[] = []
  let nextId = 1
  const calls: string[] = []
  const emitted: NetworkStatus[] = []
  const logs: string[] = []
  let target: StatusTarget = { networkId: 'wax-testnet', name: 'WAX Testnet', chainId: CHAIN, endpoint: 'https://node.example' }
  let head = 1_000_000
  const poller = new NetworkStatusPoller({
    target: () => target,
    getInfo: async (ep, timeoutMs) => {
      expect(timeoutMs).toBe(STATUS_TIMING.timeoutMs)
      calls.push(ep)
      const a = answers(ep)
      now += a.latency
      if (a.error) throw new Error(a.error)
      head += 20
      return a.body ?? { chain_id: CHAIN, head_block_num: head, last_irreversible_block_num: head - 144, head_block_time: new Date(now - 300).toISOString().replace('Z', '') }
    },
    now: () => now,
    setTimer: (fn, ms) => {
      const t = { at: now + ms, fn, id: nextId++ }
      timers.push(t)
      return t.id
    },
    clearTimer: (id) => {
      const i = timers.findIndex((t) => t.id === id)
      if (i >= 0) timers.splice(i, 1)
    },
    emit: (s) => emitted.push(s),
    log: (l) => logs.push(l)
  })
  /** Moves the clock forward, firing due timers and letting their checks finish. */
  const advance = async (ms: number): Promise<void> => {
    const end = now + ms
    for (;;) {
      timers.sort((a, b) => a.at - b.at)
      const t = timers[0]
      if (!t || t.at > end) break
      timers.shift()
      now = Math.max(now, t.at)
      t.fn()
      for (let i = 0; i < 5; i++) await Promise.resolve()
    }
    now = Math.max(now, end)
  }
  return {
    poller,
    advance,
    calls,
    emitted,
    logs,
    timers,
    setTarget: (t: StatusTarget) => {
      target = t
    }
  }
}

describe('poll timer', () => {
  it('checks at once, then every 10 seconds; every 2 seconds while the Network page is open', async () => {
    const r = rig(() => ({ latency: 180 }))
    r.poller.start(true)
    await r.advance(0)
    expect(r.calls).toHaveLength(1)
    expect(r.poller.current()).toMatchObject({ level: 'green', networkId: 'wax-testnet', latencyMs: 180 })
    expect(r.poller.current().summary).toMatch(/^Working: 180 ms, head block 1,000,020$/)
    await r.advance(9_000)
    expect(r.calls).toHaveLength(1)
    await r.advance(1_000)
    expect(r.calls).toHaveLength(2)
    r.poller.setFast(true)
    await r.advance(10_000)
    expect(r.calls.length).toBeGreaterThanOrEqual(6)
    const before = r.calls.length
    r.poller.setFast(false)
    // The next check is 10 seconds after the last one (at most 2 seconds ago).
    await r.advance(7_000)
    expect(r.calls.length).toBe(before)
  })

  it('nothing is polled while the window is minimized; a restored window checks at once', async () => {
    const r = rig(() => ({ latency: 100 }))
    r.poller.start(false)
    await r.advance(60_000)
    expect(r.calls).toHaveLength(0)
    expect(r.timers).toHaveLength(0)
    r.poller.setVisible(true)
    await r.advance(0)
    expect(r.calls).toHaveLength(1)
    r.poller.setVisible(false)
    await r.advance(120_000)
    expect(r.calls).toHaveLength(1)
    expect(r.timers).toHaveLength(0)
    r.poller.setVisible(true)
    await r.advance(0)
    expect(r.calls).toHaveLength(2)
  })

  it('a local address that is not running turns red within two checks; the change is logged once', async () => {
    const r = rig(() => ({ latency: 5, error: 'Could not reach 127.0.0.1:8888: connection refused.' }))
    r.setTarget({ networkId: 'local', name: 'Local', chainId: CHAIN, endpoint: 'http://127.0.0.1:8888' })
    r.poller.start(true)
    await r.advance(0)
    expect(r.poller.current().level).toBe('checking')
    await r.advance(10_000)
    expect(r.calls).toHaveLength(2)
    expect(r.poller.current()).toMatchObject({ level: 'red', label: 'Not reachable', headBlock: null })
    expect(r.poller.current().summary).toMatch(/connection refused/)
    await r.advance(30_000)
    expect(r.logs.filter((l) => /Not reachable/.test(l))).toHaveLength(1)
  })

  it('a huge error text with line breaks from the node becomes one short line in the summary and the log', async () => {
    const huge = `Node says:\n${'x'.repeat(1_000_000)}\r\nend`
    const r = rig(() => ({ latency: 5, error: huge }))
    r.poller.start(true)
    await r.advance(0)
    await r.advance(10_000)
    const s = r.poller.current()
    expect(s.level).toBe('red')
    expect(s.summary.length).toBeLessThanOrEqual(300)
    // eslint-disable-next-line no-control-regex
    expect(s.summary).not.toMatch(/[\u0000-\u001f]/)
    expect(s.summary).toMatch(/Node says: x/)
    expect(r.logs.length).toBeGreaterThan(0)
    for (const l of r.logs) {
      expect(l.length).toBeLessThan(500)
      expect(l).not.toMatch(/[\r\n]/)
    }
  })

  it('a wrong chain id is red at the first answer', async () => {
    const r = rig(() => ({ latency: 50, body: { chain_id: OTHER, head_block_num: 9, last_irreversible_block_num: 8, head_block_time: '2026-11-24T12:00:00' } }))
    r.poller.start(true)
    await r.advance(0)
    expect(r.poller.current()).toMatchObject({ level: 'red', label: 'Wrong chain' })
  })

  it('another network or endpoint starts again from "Checking" and is checked at once', async () => {
    const r = rig(() => ({ latency: 100 }))
    r.poller.start(true)
    await r.advance(0)
    expect(r.poller.current().level).toBe('green')
    r.setTarget({ networkId: 'wax-testnet', name: 'WAX Testnet', chainId: CHAIN, endpoint: 'https://other.example' })
    r.poller.refresh()
    expect(r.poller.current()).toMatchObject({ level: 'checking', endpoint: 'https://other.example', checkedAt: null })
    await r.advance(0)
    expect(r.calls).toEqual(['https://node.example', 'https://other.example'])
    expect(r.poller.current().level).toBe('green')
    // Nothing changed: no new check before the interval.
    r.poller.refresh()
    await r.advance(0)
    expect(r.calls).toHaveLength(2)
  })

  it('sends the state after every check', async () => {
    const r = rig(() => ({ latency: 100 }))
    r.poller.start(true)
    // Each interval counts from the end of the previous check (100 ms each).
    await r.advance(20_500)
    const checks = r.emitted.filter((s) => s.checkedAt !== null)
    expect(checks).toHaveLength(3)
    expect(checks[2]).toMatchObject({ level: 'green', lib: checks[2].headBlock! - 144 })
  })
})
