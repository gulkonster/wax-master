// Contract page: an open tab keeps its form and query when another tab is shown;
// the table view's Scope follows the picked table.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { rememberTypedScope, scopeForTable, type TypedScopes } from '../../src/renderer/src/lib/table-scope'

const src = (rel: string): string => readFileSync(join(__dirname, '../../src/renderer/src', rel), 'utf8')

describe('Contract page tabs', () => {
  it('keeps one mounted body per open tab and only hides the inactive ones', () => {
    const page = src('pages/ContractPage.tsx')
    const render = page.slice(page.indexOf('return ('), page.indexOf('function ContractBody'))
    // One body for every open tab, keyed by network and tab, never by the active tab alone.
    expect(render).toContain('tabs.map((t) => (')
    expect(render).toContain('key={`${net.current!.id}:${t}`}')
    expect(render).toContain("display: t === active ? 'contents' : 'none'")
    expect(render).toContain('<ContractBody name={t} />')
    expect(render).not.toContain('name={active}')
    expect(render).not.toMatch(/key=\{`[^`]*\$\{active\}`\}/)
  })
  it('the forms of a tab are not keyed by anything that changes on a tab switch', () => {
    const page = src('pages/ContractPage.tsx')
    const body = page.slice(page.indexOf('function ContractBody'))
    expect(body).toContain('<ActionForm key={`a${gen}`}')
    expect(body).toContain('<TableView key={`t${gen}`}')
  })
})

describe('table view Scope when the table changes', () => {
  const account = 'eosio.token'

  it('the first table picked keeps what the field shows', () => {
    expect(scopeForTable('', 'accounts', account, account, {})).toBe(account)
    expect(scopeForTable('', 'accounts', 'alice', account, {})).toBe('alice')
  })
  it('picking the same table again keeps the field', () => {
    expect(scopeForTable('accounts', 'accounts', 'alice', account, {})).toBe('alice')
  })
  it('another table goes back to the contract account', () => {
    let typed: TypedScopes = {}
    typed = rememberTypedScope(typed, 'balances', 'alice')
    expect(scopeForTable('balances', 'tokens', 'alice', account, typed)).toBe(account)
  })
  it('a table with a scope typed in this tab gets that scope back', () => {
    let typed: TypedScopes = {}
    typed = rememberTypedScope(typed, 'balances', 'alice')
    expect(scopeForTable('tokens', 'balances', account, account, typed)).toBe('alice')
    // An emptied field counts as typed too (the query then uses the contract account).
    typed = rememberTypedScope(typed, 'balances', '')
    expect(scopeForTable('tokens', 'balances', account, account, typed)).toBe('')
  })
  it('a scope typed before any table is picked is not stored under a table', () => {
    const typed = rememberTypedScope({}, '', 'alice')
    expect(typed).toEqual({})
  })
  it('table names that are object keys are not mistaken for typed scopes', () => {
    expect(scopeForTable('balances', 'constructor', 'alice', account, {})).toBe(account)
    expect(scopeForTable('balances', 'toString', 'alice', account, {})).toBe(account)
  })
  it('remembering does not change the earlier object', () => {
    const a: TypedScopes = { balances: 'alice' }
    const b = rememberTypedScope(a, 'tokens', 'bob')
    expect(a).toEqual({ balances: 'alice' })
    expect(b).toEqual({ balances: 'alice', tokens: 'bob' })
  })
  it('the table view uses these rules on pick, on typing and on a saved query', () => {
    const view = src('components/TableView.tsx')
    const pick = view.slice(view.indexOf('const pickTable = '), view.indexOf('const set = '))
    expect(pick).toContain('scopeForTable(table, name, q.scope, account, typedScopes)')
    expect(pick).toContain('void run(name, f, false)')
    const set = view.slice(view.indexOf('const set = '), view.indexOf('const enter = '))
    expect(set).toContain("if (k === 'scope') setTypedScopes((s) => rememberTypedScope(s, table, v as string))")
    const load = view.slice(view.indexOf('const loadEntry = '), view.indexOf('const saveFavorite = '))
    expect(load).toContain('rememberTypedScope(s, e.name, f.scope)')
  })
})
