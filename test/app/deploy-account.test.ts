import { describe, expect, it } from 'vitest'
import { lastDeployPick, preselectAccount, readPlanAfterRamPurchase, rememberDeployPick } from '../../src/renderer/src/lib/deploy-account'

describe('Deploy dialog preselection', () => {
  const stars = ['alice', 'bob', 'carol']
  it('takes the saved deploy account first, then the top-bar account, then the last pick', () => {
    expect(preselectAccount('alice', 'bob', 'carol', stars)).toBe('alice')
    expect(preselectAccount(undefined, 'bob', 'carol', stars)).toBe('bob')
    expect(preselectAccount(undefined, null, 'carol', stars)).toBe('carol')
  })
  it('never picks an account that is not starred', () => {
    expect(preselectAccount('dave', 'erin', 'frank', stars)).toBe('')
    expect(preselectAccount('dave', 'bob', undefined, stars)).toBe('bob')
    expect(preselectAccount('dave', 'erin', 'carol', stars)).toBe('carol')
    expect(preselectAccount('alice', 'bob', 'carol', [])).toBe('')
  })
  it('remembers the last pick per project and network', () => {
    rememberDeployPick('C:/p1', 'testnet', 'alice')
    rememberDeployPick('C:/p2', 'testnet', 'bob')
    expect(lastDeployPick('C:/p1', 'testnet')).toBe('alice')
    expect(lastDeployPick('C:/p2', 'testnet')).toBe('bob')
    expect(lastDeployPick('C:/p1', 'mainnet')).toBeUndefined()
  })
})

describe('Deploy dialog reads after Buy RAM', () => {
  type Plan = { ramAvailable: number }
  /** Timers that run only when the test says so. */
  const timers = (): { set: (fn: () => void, ms: number) => unknown; clear: (t: unknown) => void; due: number[]; run: () => Promise<void> } => {
    const list: { fn: () => void; ms: number; live: boolean }[] = []
    return {
      set: (fn, ms) => {
        const t = { fn, ms, live: true }
        list.push(t)
        return t
      },
      clear: (t) => {
        ;(t as { live: boolean }).live = false
      },
      get due() {
        return list.filter((t) => t.live).map((t) => t.ms)
      },
      run: async () => {
        const t = list.find((x) => x.live)
        if (!t) return
        t.live = false
        t.fn()
        for (let i = 0; i < 5; i++) await Promise.resolve()
      }
    }
  }
  const start = (answers: (Plan | null | Error)[]) => {
    const tm = timers()
    const results: { plan: Plan | null; changed: boolean }[] = []
    const errors: unknown[] = []
    let reads = 0
    const stop = readPlanAfterRamPurchase<Plan>(
      1000,
      () => {
        const a = answers[reads++]
        return a instanceof Error ? Promise.reject(a) : Promise.resolve(a)
      },
      (plan, changed) => results.push({ plan, changed }),
      (e) => errors.push(e),
      tm.set,
      tm.clear
    )
    return { tm, results, errors, stop, reads: () => reads }
  }

  it('reads at once, after 1.5 s and after 4 s, and stops at the first plan whose available RAM changed', async () => {
    const r = start([{ ramAvailable: 1000 }, { ramAvailable: 5096 }, { ramAvailable: 5096 }])
    expect(r.tm.due).toEqual([0, 1500, 4000])
    await r.tm.run()
    expect(r.results).toEqual([])
    await r.tm.run()
    expect(r.results).toEqual([{ plan: { ramAvailable: 5096 }, changed: true }])
    expect(r.tm.due).toEqual([])
    expect(r.reads()).toBe(2)
  })

  it('passes the last plan as unchanged when no read shows the purchase', async () => {
    const r = start([{ ramAvailable: 1000 }, { ramAvailable: 1000 }, { ramAvailable: 1000 }])
    await r.tm.run()
    await r.tm.run()
    expect(r.results).toEqual([])
    await r.tm.run()
    expect(r.results).toEqual([{ plan: { ramAvailable: 1000 }, changed: false }])
    expect(r.errors).toEqual([])
  })

  it('a failed read does not stop the others; only when every read fails is the error passed on', async () => {
    const r = start([new Error('no answer'), { ramAvailable: 2000 }])
    await r.tm.run()
    expect(r.errors).toEqual([])
    await r.tm.run()
    expect(r.results).toEqual([{ plan: { ramAvailable: 2000 }, changed: true }])
    const all = start([new Error('a'), new Error('b'), new Error('c')])
    for (let i = 0; i < 3; i++) await all.tm.run()
    expect(all.results).toEqual([])
    expect(all.errors).toEqual([new Error('c')])
  })

  it('stopping (the dialog closes or the account changes) clears the timers and ignores a read still on its way', async () => {
    const r = start([{ ramAvailable: 9000 }])
    expect(r.tm.due).toEqual([0, 1500, 4000])
    const t = r.tm
    // The first read starts, then the dialog closes before it answers.
    const first = t.run()
    r.stop()
    await first
    expect(t.due).toEqual([])
    expect(r.results).toEqual([])
  })
})
