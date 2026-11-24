// Contract page table view: a slow answer of an older query never replaces the answer
// of a newer one (rows, error and the end of loading follow the latest query only).

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createLatestGate } from '../../src/renderer/src/lib/latest-query'

const src = (rel: string): string => readFileSync(join(__dirname, '../../src/renderer/src', rel), 'utf8')

interface Shown {
  rows: string[]
  error: string
  loading: boolean
}

// The run() flow of the table view, with answers resolved by hand.
function view(): {
  shown: Shown
  run: (append: boolean) => { answer: (rows: string[]) => Promise<void>; fail: (msg: string) => Promise<void> }
} {
  const gate = createLatestGate()
  const shown: Shown = { rows: [], error: '', loading: false }
  const run = (append: boolean) => {
    const ticket = gate.start()
    shown.loading = true
    shown.error = ''
    let resolve!: (r: string[]) => void
    let reject!: (e: Error) => void
    const pending = new Promise<string[]>((res, rej) => {
      resolve = res
      reject = rej
    })
    const done = (async () => {
      try {
        const r = await pending
        if (!gate.isLatest(ticket)) return
        shown.rows = append ? [...shown.rows, ...r] : r
      } catch (e) {
        if (!gate.isLatest(ticket)) return
        if (!append) shown.rows = []
        shown.error = (e as Error).message
      } finally {
        if (gate.isLatest(ticket)) shown.loading = false
      }
    })()
    return {
      answer: async (rows: string[]) => {
        resolve(rows)
        await done
      },
      fail: async (msg: string) => {
        reject(new Error(msg))
        await done
      }
    }
  }
  return { shown, run }
}

describe('latest query gate', () => {
  it('only the last ticket started is the latest', () => {
    const g = createLatestGate()
    const a = g.start()
    expect(g.isLatest(a)).toBe(true)
    const b = g.start()
    expect(g.isLatest(a)).toBe(false)
    expect(g.isLatest(b)).toBe(true)
  })
  it('two gates do not share tickets', () => {
    const g1 = createLatestGate()
    const g2 = createLatestGate()
    const a = g1.start()
    g2.start()
    g2.start()
    expect(g1.isLatest(a)).toBe(true)
  })
})

describe('table view queries', () => {
  it('a late answer of the automatic query does not replace the newer one', async () => {
    const v = view()
    const auto = v.run(false)
    const typed = v.run(false)
    await typed.answer(['alice row'])
    expect(v.shown).toEqual({ rows: ['alice row'], error: '', loading: false })
    await auto.answer(['contract row'])
    expect(v.shown).toEqual({ rows: ['alice row'], error: '', loading: false })
  })
  it('an older answer arriving first does not end loading of the newer query', async () => {
    const v = view()
    const auto = v.run(false)
    const typed = v.run(false)
    await auto.answer(['contract row'])
    expect(v.shown.rows).toEqual([])
    expect(v.shown.loading).toBe(true)
    await typed.answer(['alice row'])
    expect(v.shown).toEqual({ rows: ['alice row'], error: '', loading: false })
  })
  it('an error of an older query is dropped', async () => {
    const v = view()
    const auto = v.run(false)
    const typed = v.run(false)
    await typed.answer(['alice row'])
    await auto.fail('timeout')
    expect(v.shown).toEqual({ rows: ['alice row'], error: '', loading: false })
  })
  it('an error of the latest query is shown and ends loading', async () => {
    const v = view()
    const auto = v.run(false)
    const typed = v.run(false)
    await auto.answer(['contract row'])
    await typed.fail('bad scope')
    expect(v.shown).toEqual({ rows: [], error: 'bad scope', loading: false })
  })
  it('a Load More answer that arrives after a new query is dropped', async () => {
    const v = view()
    await v.run(false).answer(['r1'])
    const next = v.run(true)
    const fresh = v.run(false)
    await fresh.answer(['n1'])
    await next.answer(['r2'])
    expect(v.shown).toEqual({ rows: ['n1'], error: '', loading: false })
  })
  it('a Load More answer of the latest query is appended', async () => {
    const v = view()
    await v.run(false).answer(['r1'])
    await v.run(true).answer(['r2'])
    expect(v.shown.rows).toEqual(['r1', 'r2'])
  })
})

describe('TableView source', () => {
  const tv = src('components/TableView.tsx')
  const run = tv.slice(tv.indexOf('const run = async'), tv.indexOf('const pickTable'))

  it('keeps one gate per table view', () => {
    expect(tv).toContain('const queries = useRef(createLatestGate())')
  })
  it('every query (also Load More) takes a ticket before the request', () => {
    expect(run.indexOf('queries.current.start()')).toBeGreaterThan(-1)
    expect(run.indexOf('queries.current.start()')).toBeLessThan(run.indexOf('window.wax.contract.rows('))
  })
  it('rows, errors and the end of loading are applied for the latest query only', () => {
    const afterRows = run.slice(run.indexOf('window.wax.contract.rows('))
    expect(afterRows.indexOf('if (!queries.current.isLatest(ticket)) return')).toBeLessThan(afterRows.indexOf('setRows('))
    const catchPart = run.slice(run.indexOf('} catch (e) {'), run.indexOf('} finally {'))
    expect(catchPart.indexOf('if (!queries.current.isLatest(ticket)) return')).toBeLessThan(catchPart.indexOf('setError('))
    const finallyPart = run.slice(run.indexOf('} finally {'))
    expect(finallyPart).toContain('if (queries.current.isLatest(ticket)) setLoading(false)')
  })
})
