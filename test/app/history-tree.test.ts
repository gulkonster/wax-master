import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { historyTree } from '../../src/shared/history-tree'
import { fromHistory } from '../../src/main/trace'
import type { InspectedTransaction, TraceNode } from '../../src/shared/trace-types'
import { createElement, type FunctionComponent } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PLACED_AT_TOP_TIP, PLACED_BY_ORDER_TIP } from '../../src/shared/trace-view'

const dir = join(__dirname, '../fixtures/history')
const load = (name: string): unknown => JSON.parse(readFileSync(join(dir, name), 'utf8'))

const mainnet = load('mainnet-706fdfc9-v2.json')
const mainnetV1 = load('mainnet-706fdfc9-v1.json')
const handmade = load('handmade-notify-inline.json')
const transfer = load('testnet-d82fc17a-v2-transfer.json')

function flat(nodes: TraceNode[]): TraceNode[] {
  return nodes.flatMap((x) => [x, ...flat(x.children)])
}
const label = (x: TraceNode): string => `${x.account}::${x.name}`

describe('history tree', () => {
  it('rebuilds the mainnet sample: 1 top action, 18 nodes, 3 placed by order', () => {
    const t = historyTree(mainnet)
    expect(t.roots).toHaveLength(1)
    const all = flat(t.roots)
    expect(all).toHaveLength(18)
    expect(new Set(all.map((x) => x.key)).size).toBe(18)
    expect(t.placedByOrder).toBe(3)
    expect(t.joined).toBe(true)

    const craft = t.roots[0]
    expect(label(craft)).toBe('game.brpg::craft')
    expect(craft.kind).toBe('action')
    expect(craft.placed).toBe('top')
    // Children in the order the chain ran them.
    expect(craft.children.map((c) => `${label(c)}@${c.sequence}`)).toEqual([
      'stake.brpg::accounttake@110949904544',
      'stake.brpg::burntokens@110949904545',
      'stake.brpg::rewardart@110949904548',
      'stake.brpg::rewardart@110949904554',
      'game.brpg::logcraft@110949904560'
    ])

    const rewards = craft.children.filter((c) => c.name === 'rewardart')
    expect(rewards.map((r) => r.placed)).toEqual(['link', 'order'])
    for (const r of rewards) {
      expect(r.kind).toBe('inline')
      // Each mintasset under its own rewardart.
      expect(r.children.map(label)).toEqual(['atomicassets::mintasset'])
      const mint = r.children[0]
      expect(mint.kind).toBe('inline')
      // Each logmint under its own mintasset, with three notifications.
      expect(mint.children.map(label)).toEqual(['atomicassets::logmint'])
      const log = mint.children[0]
      expect(log.receiver).toBe('atomicassets')
      expect(log.children.map((c) => c.receiver)).toEqual(['stake.brpg', 'neftyblocksd', 'token.brpg'])
      expect(log.children.every((c) => c.kind === 'notification' && c.placed === 'link' && c.notification)).toBe(true)
    }
    expect(rewards[0].children[0].placed).toBe('link')
    expect(rewards[1].children[0].placed).toBe('order')
    expect(rewards[0].children[0].children[0].placed).toBe('link')
    expect(rewards[1].children[0].children[0].placed).toBe('order')

    const burns = craft.children[1].children
    expect(burns.map(label)).toEqual(['token.brpg::burn', 'token.brpg::burn'])
    expect(all.filter((x) => x.placed === 'order').map((x) => x.sequence)).toEqual(['110949904554', '110949904555', '110949904556'])
    // The service keeps no console output.
    expect(all.every((x) => x.console === null)).toBe(true)
  })

  it('gives an entry RAM changes to its first execution, or each trace its own with the v1 answer', () => {
    const without = flat(historyTree(mainnet).roots).filter((x) => x.name === 'mintasset')
    expect(without.map((x) => x.ramDeltas)).toEqual([[{ account: 'stake.brpg', delta: 219 }], null])
    const withV1 = historyTree(mainnet, mainnetV1)
    const mints = flat(withV1.roots).filter((x) => x.name === 'mintasset')
    expect(mints.map((x) => x.ramDeltas)).toEqual([[{ account: 'stake.brpg', delta: 219 }], [{ account: 'stake.brpg', delta: 219 }]])
    const rewards = flat(withV1.roots).filter((x) => x.name === 'rewardart')
    expect(rewards.map((x) => x.ramDeltas)).toEqual([[{ account: 'stake.brpg', delta: 236 }], [{ account: 'stake.brpg', delta: 236 }]])
    // The v1 traces alone are taken too.
    const traces = (mainnetV1 as { traces: unknown[] }).traces
    expect(flat(historyTree(mainnet, traces).roots).filter((x) => x.name === 'mintasset')[1].ramDeltas).toEqual([{ account: 'stake.brpg', delta: 219 }])
  })

  it('hangs an inline action sent by a notification handler under that notification', () => {
    const t = historyTree(handmade)
    expect(t.placedByOrder).toBe(1)
    expect(t.joined).toBe(false)
    expect(t.roots).toHaveLength(1)
    const tr = t.roots[0]
    expect(label(tr)).toBe('eosio.token::transfer')
    expect(tr.children.map((c) => c.receiver)).toEqual(['playerone', 'gamecontract'])
    const notice = tr.children[1]
    expect(notice.kind).toBe('notification')
    expect(notice.children.map(label)).toEqual(['gamecontract::credit'])
    const credit = notice.children[0]
    expect(credit.placed).toBe('order')
    expect(credit.kind).toBe('inline')
    expect(credit.ramDeltas).toEqual([{ account: 'gamecontract', delta: 128 }])
  })

  it('reads a plain transfer as three linked nodes', () => {
    const t = historyTree(transfer)
    const all = flat(t.roots)
    expect(all).toHaveLength(3)
    expect(t.placedByOrder).toBe(0)
    expect(t.roots[0].placed).toBe('top')
    expect(t.roots[0].kind).toBe('action')
    expect(t.roots[0].children.map((c) => [c.kind, c.placed])).toEqual([
      ['notification', 'link'],
      ['notification', 'link']
    ])
  })

  it('takes an answer without actions', () => {
    expect(historyTree({ executed: false, trx_id: 'abc' })).toEqual({ roots: [], placedByOrder: 0, joined: false })
    expect(historyTree(null)).toEqual({ roots: [], placedByOrder: 0, joined: false })
    const t = fromHistory({ executed: false, trx_id: 'abc' }, { network: 'WAX Testnet', endpoint: 'https://h' })
    expect(t.actions).toEqual([])
    expect(t.raw[0].title).toBe('History service answer')
  })
})

describe('fromHistory', () => {
  const ctx = { network: 'WAX Mainnet', endpoint: 'https://history' }

  it('fills the head from the first action, the finality, the notes and the raw answer', () => {
    const t = fromHistory(mainnet, ctx)
    expect(t.source).toBe('history')
    expect(t.id).toBe('706fdfc93c488b3b795d051d3ef211bf9ba165a93551ec2de9d350c236e40906')
    expect(t.block).toBe(468279749)
    expect(t.time).toBe('2026-11-25T17:28:04.000')
    expect(t.cpuUs).toBe(657)
    expect(t.netBytes).toBe(128)
    // The service's lib was below the block when it answered.
    expect(t.finality).toBe('pending')
    expect(t.notes).toEqual([
      'Read from the history service. It does not keep console output.',
      '3 entries are placed by the order of execution, not by a link from the history service (marked "placed by order").',
      'The history service joined identical actions; their RAM changes may be listed once.'
    ])
    expect(t.notes).not.toContain('Read from the history service.')
    expect(t.raw).toHaveLength(1)
    expect(t.raw[0].title).toBe('History service answer')
    expect(JSON.parse(t.raw[0].text)).toEqual(mainnet)
    expect(t.raw[0].text).toBe(JSON.stringify(mainnet, null, 2))
  })

  it('says irreversible at or below lib, and gives no extra notes for a plain transfer', () => {
    expect(fromHistory(handmade, ctx).finality).toBe('irreversible')
    const t = fromHistory(transfer, ctx)
    expect(t.notes).toEqual(['Read from the history service. It does not keep console output.'])
    expect(t.cpuUs).toBe(219)
  })
})

// A joined copy of an action of the transaction is an action of the transaction.
const twice = load('handmade-twice-transfer.json')
// A path in a variable: the test build has no JSX settings; vitest loads the component.
const INSPECTOR = '../../src/renderer/src/components/Inspector'

describe('two identical actions of the transaction', () => {
  const tops = (t: ReturnType<typeof historyTree>): TraceNode[] => t.roots

  it('without the signed count: both at the top in order, the second with ordinal 2 and placed by order', () => {
    const t = historyTree(twice)
    expect(tops(t).map((x) => [label(x), x.sequence, x.ordinal, x.placed, x.kind])).toEqual([
      ['eosio.token::transfer', '101', 1, 'top', 'action'],
      ['eosio.token::transfer', '104', 2, 'order', 'action']
    ])
    const [first, second] = tops(t)
    expect(first.children.map((c) => [c.receiver, c.kind, c.placed])).toEqual([
      ['alicewallet1', 'notification', 'link'],
      ['bobgamecontr', 'notification', 'link']
    ])
    expect(second.children.map((c) => [c.receiver, c.kind, c.placed])).toEqual([
      ['alicewallet1', 'notification', 'link'],
      ['bobgamecontr', 'notification', 'link'],
      ['bobgamecontr', 'inline', 'link']
    ])
    expect(second.children[2].name).toBe('logpay')
    expect(t.placedByOrder).toBe(1)
  })

  it('with the signed count 2: the second is placed at the top by a count, not by order', () => {
    const t = historyTree(twice, undefined, 2)
    expect(tops(t).map((x) => [x.ordinal, x.placed])).toEqual([
      [1, 'top'],
      [2, 'top']
    ])
    expect(tops(t)[1].children.map((c) => c.name)).toContain('logpay')
    expect(t.placedByOrder).toBe(0)
  })

  it('with the signed count 1: the second stays at the top, without an ordinal, placed by order', () => {
    const t = historyTree(twice, undefined, 1)
    const second = tops(t).find((x) => x.sequence === '104')!
    expect(second).toBeDefined()
    expect(second.ordinal).toBe(0)
    expect(second.placed).toBe('order')
    expect(second.kind).toBe('action')
  })

  it('leaves the mainnet sample as it is with the signed count from its block', () => {
    const t = historyTree(mainnet, undefined, 1)
    expect(t.roots).toHaveLength(1)
    expect(t.placedByOrder).toBe(3)
  })

  it('says one order-placed entry in the singular, more in the plural', () => {
    const ctx = { network: 'N', endpoint: 'https://h' }
    expect(fromHistory(twice, ctx).notes).toContain('1 entry is placed by the order of execution, not by a link from the history service (marked "placed by order").')
    expect(fromHistory(mainnet, ctx).notes).toContain(
      '3 entries are placed by the order of execution, not by a link from the history service (marked "placed by order").'
    )
    expect(fromHistory(twice, ctx, { signedActions: 2 }).notes.some((x) => x.includes('placed by the order of execution'))).toBe(false)
  })

  it('gives an order-placed action of the transaction its own tooltip', async () => {
    const { InspectorBody } = (await import(/* @vite-ignore */ INSPECTOR)) as {
      InspectorBody: FunctionComponent<{ t: InspectedTransaction }>
    }
    const html = renderToStaticMarkup(createElement(InspectorBody, { t: fromHistory(twice, { network: 'N', endpoint: 'https://h' }) }))
    expect(html).toContain(`title="${PLACED_AT_TOP_TIP}"`)
    const inline = renderToStaticMarkup(createElement(InspectorBody, { t: fromHistory(handmade, { network: 'N', endpoint: 'https://h' }) }))
    expect(inline).toContain(`title="${PLACED_BY_ORDER_TIP}"`)
    expect(inline).not.toContain(PLACED_AT_TOP_TIP)
  })
})
