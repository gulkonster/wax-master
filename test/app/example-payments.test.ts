import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EXAMPLES } from '../../src/shared/project'
import { templateFiles } from '../../src/main/templates'

/** C++ without comments (block and line). */
function cppCode(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

function actionsOf(hpp: string): string[] {
  return [...cppCode(hpp).matchAll(/\[\[eosio::action\]\]\s*void\s+(\w+)\s*\(/g)].map((m) => m[1])
}

/** The text of one member function, from its definition to the next one. */
function body(cpp: string, fn: string): string {
  const start = cpp.indexOf(`::${fn}(`)
  const next = cpp.indexOf('\nvoid ', start + 1)
  return cpp.slice(start, next < 0 ? undefined : next)
}

const docs = (page: string): string => readFileSync(join(__dirname, '../../docs/help', page), 'utf8')

describe('token payments example', () => {
  const f = templateFiles('payments', 'payments')
  const hpp = cppCode(f['include/payments.hpp'])
  const cpp = cppCode(f['src/payments.cpp'])

  it('is listed in New Project with its page', () => {
    const e = EXAMPLES.find((x) => x.id === 'payments')
    expect(e?.name).toBe('payments')
    expect(e?.topic).toBe('example-payments')
  })

  it('has addtoken, deltoken and withdraw, and a handler on the transfer of every contract', () => {
    expect(actionsOf(f['include/payments.hpp'])).toEqual(['addtoken', 'deltoken', 'withdraw'])
    expect(hpp).toContain('void addtoken(name token_contract, symbol sym);')
    expect(hpp).toContain('void deltoken(symbol_code code);')
    expect(hpp).toContain('[[eosio::on_notify("*::transfer")]]')
    expect(hpp).toContain('void on_transfer(name from, name to, asset quantity, std::string memo);')
    expect(hpp).toContain('typedef multi_index<"tokens"_n, accepted> tokens_table;')
    expect(hpp).toContain('typedef multi_index<"balances"_n, holding> balances_table;')
  })

  it('keeps the token stat table out of its own ABI', () => {
    const ns = hpp.slice(hpp.indexOf('namespace token {'), hpp.indexOf('class [[eosio::contract'))
    expect(ns).toContain('typedef multi_index<"stat"_n, currency_stats> stats;')
    expect(ns).not.toContain('[[eosio::table]]')
  })

  it('changes the list only with the contract account and checks the token on its own contract', () => {
    const add = body(cpp, 'addtoken')
    expect(add).toContain('require_auth(get_self());')
    expect(add).toContain('token::stats stats(token_contract, sym.code().raw());')
    expect(add).toContain('check(st.supply.symbol == sym, "the token has another precision on its contract");')
    expect(add).toContain('tokens.emplace(get_self(),')
    expect(body(cpp, 'deltoken')).toContain('require_auth(get_self());')
  })

  it('refuses a token unless the contract that sent it and its symbol are on the list', () => {
    const h = body(cpp, 'on_transfer')
    expect(h).toContain('if (from == get_self() || to != get_self()) return;')
    expect(h).toContain('if (from.prefix() == "eosio"_n) return;')
    expect(h.replace(/\s+/g, ' ')).toContain(
      'check(t != tokens.end() && extended_symbol(t->sym, t->token_contract) == extended_symbol(quantity.symbol, get_first_receiver()), "this token is not accepted here");'
    )
    // The token is checked before anything that reads the amount or writes a row.
    const tokenCheck = h.indexOf('"this token is not accepted here"')
    expect(h.indexOf('quantity.is_valid()')).toBeGreaterThan(tokenCheck)
    expect(h.indexOf('quantity.amount > 0')).toBeGreaterThan(tokenCheck)
    expect(h.indexOf('emplace')).toBeGreaterThan(tokenCheck)
    // In a notification only the contract can pay for a row; the balance is per owner.
    expect(h).toContain('balances_table balances(get_self(), from.value);')
    expect(h).toContain('balances.emplace(get_self(),')
    expect(h).not.toMatch(/emplace\((from|to)\b/)
  })

  it('withdraws with the token contract of the balance row, never one the caller names', () => {
    const w = body(cpp, 'withdraw')
    expect(w).toContain('require_auth(owner);')
    expect(w).toContain('check(quantity.amount > 0, "the quantity must be positive");')
    expect(w).toContain('check(quantity <= row.balance, "the quantity is more than the balance");')
    expect(w).toContain('const name token_contract = row.token_contract;')
    expect(w).toContain('balances.erase(row);')
    expect(w).toMatch(/action\(permission_level\{get_self\(\), "active"_n\}, token_contract, "transfer"_n,/)
    expect(hpp).toContain('void withdraw(name owner, asset quantity);')
  })

  it('README and page give the same refusal text and the fake WAX steps', () => {
    const readme = f['README.md']
    const page = docs('example-payments.md')
    for (const text of [readme, page]) {
      expect(text).toContain('"this token is not accepted here"')
      expect(text).toContain('`maximum_supply` = `1000000.00000000 WAX`')
      expect(text).toContain('`sym` = `8,WAX`')
      expect(text).toContain('`sym` = `4,WMT`')
      expect(text).toContain('Before you build on it')
      expect(text).toContain('not audited')
    }
    expect(readme).toContain('keep the name `payments`')
    expect(page).toContain('keep the name `payments`')
    expect(page).toContain('(doc:contract-accept-tokens)')
  })
})

describe('accepting tokens safely page', () => {
  const page = docs('contract-accept-tokens.md')
  const blocks = [...page.matchAll(/^```cpp\n([\s\S]*?)^```/gm)].map((m) => m[1])

  it('has complete samples for one fixed contract and for every contract', () => {
    expect(blocks.length).toBe(2)
    for (const b of blocks) expect(b).toMatch(/class \[\[eosio::contract\("\w+"\)\]\]/)
    expect(blocks[0]).toContain('[[eosio::on_notify("eosio.token::transfer")]]')
    expect(blocks[1]).toContain('[[eosio::on_notify("*::transfer")]]')
    expect(blocks[1]).toContain('extended_symbol token(quantity.symbol, get_first_receiver());')
    for (const b of blocks) {
      expect(b).toContain('if (from == get_self() || to != get_self()) return;')
      expect(b).toContain('quantity.amount > 0')
    }
  })

  it('names the ways to be cheated and links its neighbours', () => {
    for (const s of ['get_first_receiver()', 'extended_symbol', 'require_recipient', 'is_account', 'memo']) expect(page, s).toContain(s)
    for (const id of ['contract-notifications', 'example-payments', 'contract-validate-input', 'contract-assets']) expect(page, id).toContain(`(doc:${id})`)
    expect(docs('contract-notifications.md')).toContain('(doc:contract-accept-tokens)')
    expect(docs('example-transfer-listener.md')).toContain('(doc:example-payments)')
  })
})
