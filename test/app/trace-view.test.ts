// The transaction view: the pure helpers of its four parts, and the view drawn
// from two hand-written transactions (a sent one with a notification and an
// inline action, and one read from the history service).

import { describe, expect, it } from 'vitest'
import { createElement, type FunctionComponent } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { InspectedTransaction, TraceNode } from '../../src/shared/trace-types'
import {
  RAM_JOINED_NOTE,
  RAM_NOT_RETURNED,
  NO_RAM_CHANGE,
  RAW_CUT_LINE,
  RAW_LIMIT,
  causedSentence,
  countKinds,
  dataLine,
  detailsOpenAtStart,
  finalityText,
  flatten,
  matchesFilter,
  nextTab,
  ramChanges,
  ramEmptyText,
  ramTotals,
  rawShown,
  signedActions,
  sourceLine,
  splitNotes,
  tabLabel,
  traceLabel
} from '../../src/shared/trace-view'

function node(p: Partial<TraceNode> & { key: string; account: string; name: string }): TraceNode {
  return {
    kind: 'action',
    sequence: null,
    placed: 'top',
    ordinal: 1,
    receiver: p.account,
    authorization: [{ actor: 'alice', permission: 'active' }],
    data: '{"a":1}',
    hex: '01',
    console: '',
    ramDeltas: [],
    returnValue: null,
    notification: false,
    error: null,
    elapsedUs: null,
    children: [],
    ...p
  }
}

/** A sent transaction: transfer -> notification to bob -> inline log; and a second action. */
function sent(): InspectedTransaction {
  const log = node({ key: '13', sequence: '13', kind: 'inline', placed: 'link', ordinal: 3, account: 'logger', name: 'log', ramDeltas: [{ account: 'logger', delta: 219 }], console: 'logged' })
  const notify = node({ key: '12', sequence: '12', kind: 'notification', placed: 'link', ordinal: 2, account: 'eosio.token', name: 'transfer', receiver: 'bob', notification: true, children: [log] })
  const transfer = node({ key: '11', sequence: '11', ordinal: 1, account: 'eosio.token', name: 'transfer', data: '{\n  "from": "alice",\n  "to": "bob"\n}', children: [notify], ramDeltas: [{ account: 'alice', delta: -100 }] })
  const second = node({ key: '14', sequence: '14', ordinal: 4, account: 'game', name: 'claim', ramDeltas: [{ account: 'logger', delta: -19 }] })
  return {
    source: 'sent',
    network: 'WAX Testnet',
    endpoint: 'https://testnet.example.org',
    id: 'abc123',
    block: 10,
    time: '2026-11-24T00:36:24.000',
    status: 'executed',
    cpuUs: 134,
    netBytes: 128,
    errorMessage: null,
    errorStack: null,
    actions: [transfer, second],
    notes: [],
    raw: [{ title: 'Node answer', text: '{ "transaction_id": "abc123" }' }]
  }
}

/** Read from the history service: one entry placed by order, no RAM figures. */
function fromHistory(): InspectedTransaction {
  const mint = node({ key: '22', sequence: '22', kind: 'inline', placed: 'order', ordinal: 0, account: 'atomicassets', name: 'logmint', console: null, ramDeltas: null })
  const craft = node({ key: '21', sequence: '21', account: 'game', name: 'craft', console: null, ramDeltas: null, children: [mint] })
  return {
    ...sent(),
    source: 'history',
    endpoint: 'https://history.example.org',
    finality: 'irreversible',
    actions: [craft],
    notes: ['1 entries are placed by the order of execution, not by a link from the history service (marked "placed by order").', 'Read from the history service. It does not keep console output.', RAM_JOINED_NOTE],
    raw: [{ title: 'History service answer', text: '{}' }]
  }
}

describe('trace-view helpers', () => {
  it('flatten lists each node before its children', () => {
    expect(flatten(sent().actions).map((n) => n.key)).toEqual(['11', '12', '13', '14'])
    expect(flatten([])).toEqual([])
  })

  it('countKinds counts actions, inline actions, notifications and all traces', () => {
    expect(countKinds(sent().actions)).toEqual({ actions: 2, inline: 1, notifications: 1, total: 4 })
    expect(countKinds([])).toEqual({ actions: 0, inline: 0, notifications: 0, total: 0 })
    expect(signedActions(sent().actions).map((n) => n.name)).toEqual(['transfer', 'claim'])
  })

  it('causedSentence: plural, singular, one part zero, both zero', () => {
    expect(causedSentence(2, 3)).toBe('This transaction caused 2 inline actions and 3 notifications. They are in Traces.')
    expect(causedSentence(1, 1)).toBe('This transaction caused 1 inline action and 1 notification. They are in Traces.')
    expect(causedSentence(0, 1)).toBe('This transaction caused 1 notification. They are in Traces.')
    expect(causedSentence(4, 0)).toBe('This transaction caused 4 inline actions. They are in Traces.')
    expect(causedSentence(0, 0)).toBeNull()
  })

  it('ramTotals sums per account; ramChanges keeps each change with its trace', () => {
    const t = sent()
    expect(ramTotals(t.actions)).toEqual([
      { account: 'alice', delta: -100 },
      { account: 'logger', delta: 200 }
    ])
    expect(ramChanges(t.actions).map((c) => [c.account, c.delta, c.node.key])).toEqual([
      ['alice', -100, '11'],
      ['logger', 219, '13'],
      ['logger', -19, '14']
    ])
    expect(ramTotals([])).toEqual([])
    expect(traceLabel(t.actions[0])).toBe('eosio.token::transfer')
    expect(traceLabel(t.actions[0].children[0])).toBe('eosio.token::transfer (notification to bob)')
  })

  it('the RAM empty text: nothing reported, or not returned for history and kept answers', () => {
    const none = { ...sent(), actions: [node({ key: '1', account: 'a', name: 'b' })] }
    expect(ramEmptyText(none)).toBe(NO_RAM_CHANGE)
    expect(ramEmptyText(fromHistory())).toBe(RAM_NOT_RETURNED)
    expect(ramEmptyText({ ...fromHistory(), source: 'kept' })).toBe(RAM_NOT_RETURNED)
    expect(ramEmptyText({ ...fromHistory(), source: 'sent' })).toBe(NO_RAM_CHANGE)
  })

  it('matchesFilter looks at contract, action and receiver in any case; empty matches all', () => {
    const n = sent().actions[0].children[0]
    expect(matchesFilter(n, '')).toBe(true)
    expect(matchesFilter(n, 'BOB')).toBe(true)
    expect(matchesFilter(n, 'token')).toBe(true)
    expect(matchesFilter(n, 'transf')).toBe(true)
    expect(matchesFilter(n, 'eosio.token::transfer')).toBe(true)
    expect(matchesFilter(n, 'logmint')).toBe(false)
  })

  it('dataLine is one line of at most 100 characters', () => {
    expect(dataLine(sent().actions[0])).toBe('{"from":"alice","to":"bob"}')
    const long = node({ key: 'x', account: 'a', name: 'b', data: JSON.stringify({ memo: 'm'.repeat(200) }) })
    expect(dataLine(long)).toHaveLength(101)
    expect(dataLine(node({ key: 'y', account: 'a', name: 'b', data: null, hex: 'abcd' }))).toBe('abcd')
  })

  it('details start open for the actions of the transaction and a failed node', () => {
    const [transfer] = sent().actions
    expect(detailsOpenAtStart(transfer)).toBe(true)
    expect(detailsOpenAtStart(transfer.children[0])).toBe(false)
    expect(detailsOpenAtStart({ ...transfer.children[0], error: 'boom' })).toBe(true)
  })

  it('raw text is cut at 2,000,000 characters', () => {
    expect(rawShown('abc')).toEqual({ text: 'abc', cut: false })
    const big = rawShown('x'.repeat(RAW_LIMIT + 5))
    expect(big.text).toHaveLength(RAW_LIMIT)
    expect(big.cut).toBe(true)
    expect(RAW_CUT_LINE).toBe('Shown in part: the first 2,000,000 characters.')
  })

  it('tab labels, arrow keys, finality, source line and notes', () => {
    const t = sent()
    expect(['actions', 'traces', 'ram', 'raw'].map((id) => tabLabel(id as 'raw', t))).toEqual(['Actions (2)', 'Traces (4)', 'RAM Deltas (3)', 'Raw'])
    expect(nextTab('traces', 'ArrowRight')).toBe('ram')
    expect(nextTab('raw', 'ArrowRight')).toBe('actions')
    expect(nextTab('actions', 'ArrowLeft')).toBe('raw')
    expect(nextTab('actions', 'Enter')).toBe('actions')
    expect(finalityText('irreversible')).toBe('irreversible')
    expect(finalityText('pending')).toBe('not yet irreversible')
    expect(sourceLine(t, (s) => s)).toBeNull()
    expect(sourceLine(fromHistory(), (s) => s)).toBe('Read from the history service history.example.org.')
    expect(sourceLine({ ...t, source: 'kept', keptAt: 'T' }, (s) => `<${s}>`)).toBe(
      'From the answer the node gave when WAX Master sent it (<T>). It has the console output and every link between the actions.'
    )
    const split = splitNotes(fromHistory().notes)
    expect(split.tree).toHaveLength(1)
    expect(split.ram).toEqual([RAM_JOINED_NOTE])
    expect(split.general).toEqual(['Read from the history service. It does not keep console output.'])
  })
})

// The component is a .tsx file; the test settings have no JSX, so it is loaded by path.
const INSPECTOR = '../../src/renderer/src/components/Inspector'
const loadBody = async (): Promise<FunctionComponent<{ t: InspectedTransaction }>> =>
  ((await import(/* @vite-ignore */ INSPECTOR)) as { InspectorBody: FunctionComponent<{ t: InspectedTransaction }> }).InspectorBody

describe('the transaction view', () => {
  it('opens on Traces with the four tabs in order; children are visible, details of the actions open', async () => {
    const html = renderToStaticMarkup(createElement(await loadBody(), { t: sent() }))
    expect(html).toContain('role="tablist"')
    const tabs = [...html.matchAll(/role="tab"[^>]*>([^<]+)</g)].map((m) => m[1])
    expect(tabs).toEqual(['Actions (2)', 'Traces (4)', 'RAM Deltas (3)', 'Raw'])
    expect(html).toMatch(/aria-selected="true"[^>]*>Traces \(4\)/)
    expect(html).toContain('Indented entries were caused by the entry above them.')
    expect(html).toContain('placeholder="Filter: contract, action or receiver"')
    expect(html).toContain('Expand all')
    expect(html).toContain('Collapse all')
    expect(html).toContain('notification to bob')
    expect(html).toContain('>inline<')
    // the inline log under the closed notification is still drawn
    expect(html).toContain('data-txv-key="13"')
    // details: open for the transfer (its console header), closed for the notification
    expect(html.match(/Copy data/g)).toHaveLength(2)
    expect(html).toMatch(/<button[^>]*class="txv-twisty"/)
    expect(html).toContain('>Copy</button>')
    expect(html).not.toContain('Finality')
  })

  it('a history transaction shows Finality, its source line, the order mark and the console text', async () => {
    const html = renderToStaticMarkup(createElement(await loadBody(), { t: fromHistory() }))
    expect(html).toContain('<span>Finality</span><span>irreversible</span>')
    expect(html).toContain('Read from the history service history.example.org.')
    expect(html).toContain('placed by order')
    expect(html).toContain('title="The history service did not say which action caused this one. It is shown under the nearest earlier action that could have sent it."')
    expect(html).toContain('(not kept by the history service)')
    expect(html).toContain('1 entries are placed by the order of execution')
    expect(html).toContain('Read from the history service. It does not keep console output.')
    // the RAM note belongs to RAM Deltas, not to Traces
    expect(html).not.toContain(RAM_JOINED_NOTE)
  })

  it('the view uses only classes of its own stylesheet or the existing ones, with no colour or pixel size', () => {
    const css = readFileSync(join(__dirname, '../../src/renderer/src/styles-inspector.css'), 'utf8')
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(css).not.toMatch(/rgba?\(/)
    expect(css).not.toMatch(/\d+(\.\d+)?px/)
    for (const m of css.matchAll(/^\.([\w-]+)/gm)) expect(m[1]).toMatch(/^txv-/)
  })
})

const TABS = '../../src/renderer/src/components/inspector/'
async function tab<P>(file: string, name: string): Promise<FunctionComponent<P>> {
  return ((await import(/* @vite-ignore */ TABS + file)) as Record<string, FunctionComponent<P>>)[name]
}

describe('the parts other than Traces', () => {
  it('Actions numbers the signed actions and says what they caused', async () => {
    const Actions = await tab<{ t: InspectedTransaction }>('ActionsTab', 'ActionsTab')
    const html = renderToStaticMarkup(createElement(Actions, { t: sent() }))
    expect(html).toContain('<span class="txv-num">1</span>')
    expect(html).toContain('<span class="txv-num">2</span>')
    expect(html).not.toContain('<span class="txv-num">3</span>')
    expect(html).toContain('raw hex')
    expect(html).toContain('This transaction caused 1 inline action and 1 notification. They are in Traces.')
    expect(renderToStaticMarkup(createElement(Actions, { t: { ...sent(), actions: [] } }))).toContain('The node returned no action trace.')
  })

  it('RAM Deltas shows totals in colour, every change with its trace, and the empty texts', async () => {
    const Ram = await tab<{ t: InspectedTransaction; onShowTrace: (k: string) => void; notes: string[] }>('RamDeltasTab', 'RamDeltasTab')
    const html = renderToStaticMarkup(createElement(Ram, { t: sent(), onShowTrace: () => undefined, notes: [] }))
    expect(html).toContain('<span class="mono-small txv-ram-freed">-100 bytes</span>')
    expect(html).toContain('<span class="mono-small txv-ram-more">+200 bytes</span>')
    expect(html).toContain('<span class="mono-small txv-ram-more">+219 bytes</span>')
    expect(html).toContain('>logger::log</button>')
    const hist = renderToStaticMarkup(createElement(Ram, { t: fromHistory(), onShowTrace: () => undefined, notes: [RAM_JOINED_NOTE] }))
    expect(hist).toContain('RAM changes were not returned by this endpoint.')
    expect(hist).toContain(RAM_JOINED_NOTE)
  })

  it('Raw shows each answer with its title and a Copy button', async () => {
    const Raw = await tab<{ t: InspectedTransaction }>('RawTab', 'RawTab')
    const html = renderToStaticMarkup(createElement(Raw, { t: { ...sent(), raw: [{ title: 'Node answer', text: '{}' }, { title: 'Transaction in its block', text: 'x'.repeat(RAW_LIMIT + 1) }] } }))
    expect(html).toContain('Node answer')
    expect(html).toContain('Transaction in its block')
    expect(html.match(/>Copy</g)).toHaveLength(2)
    expect(html.match(/Shown in part: the first 2,000,000 characters\./g)).toHaveLength(1)
  })
})
