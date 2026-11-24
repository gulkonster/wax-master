import { describe, expect, it } from 'vitest'
import { TEMPLATES } from '../../src/shared/project'
import { templateFiles } from '../../src/main/templates'

/** C++ without comments (block and line). */
function cppCode(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

/** Markdown without HTML comments. */
function mdText(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, '')
}

function actionsOf(hpp: string): string[] {
  return [...cppCode(hpp).matchAll(/\[\[eosio::action\]\]\s*void\s+(\w+)\s*\(/g)].map((m) => m[1])
}

/** Ricardian sections by action name, as the ABI generator splits them (comments do not hide a heading from it). */
function sectionsOf(md: string): Map<string, string> {
  const out = new Map<string, string>()
  const parts = md.split(/<h1 class="contract">(\w+)<\/h1>/)
  for (let i = 1; i < parts.length; i += 2) out.set(parts[i], parts[i + 1])
  return out
}

/** The edit the comments describe: drop the comment lines around transfers in the three files. */
function enableTransfers(f: Record<string, string>, c: string): Record<string, string> {
  const drop = (text: string, lines: string[]): string =>
    text
      .split('\n')
      .filter((l) => !lines.includes(l) && !l.startsWith('<!-- The transfers action is off by default'))
      .join('\n')
  return {
    ...f,
    [`include/${c}.hpp`]: drop(f[`include/${c}.hpp`], ['  /*', '  */']),
    [`src/${c}.cpp`]: drop(f[`src/${c}.cpp`], ['/*', '*/']),
    [`resource/${c}.contracts.md`]: drop(f[`resource/${c}.contracts.md`], ['<!--', '-->'])
  }
}

describe('project templates', () => {
  for (const { id } of TEMPLATES) {
    describe(id, () => {
      const f = templateFiles(id, 'my.tok')

      it('writes source, header and both Ricardian files with the names filled in', () => {
        expect(Object.keys(f).sort()).toEqual([
          'include/my.tok.hpp',
          'resource/my.tok.clauses.md',
          'resource/my.tok.contracts.md',
          'src/my.tok.cpp'
        ])
        for (const text of Object.values(f)) {
          expect(text).not.toMatch(/%CONTRACT%|%CLASS%|\r/)
          expect(text.endsWith('\n')).toBe(true)
        }
        expect(f['src/my.tok.cpp'].startsWith('#include <my.tok.hpp>\n')).toBe(true)
        expect(f['include/my.tok.hpp']).toContain('class [[eosio::contract("my.tok")]] my_tok : public contract {')
      })

      it('has one finished Ricardian section per action', () => {
        const md = f['resource/my.tok.contracts.md']
        // Text before the first heading makes the ABI generator drop every section.
        expect(md.slice(0, md.indexOf('<h1')).trim()).toBe('')
        const sections = sectionsOf(md)
        const actions = actionsOf(f['include/my.tok.hpp'])
        expect(actions.length).toBeGreaterThan(0)
        for (const a of actions) {
          const body = sections.get(a)
          expect(body, a).toBeDefined()
          const text = body!.trim()
          expect(text).toMatch(/^---\nspec_version: "0\.2\.0"\ntitle: [^\n]+\nsummary: '[^'\n]+'\n---\n\n\S/)
          expect(text).not.toMatch(/TODO|<!--|-->/)
        }
        for (const name of sections.keys()) {
          if (actions.includes(name)) continue
          // A section for an action that is off is fully commented out.
          expect(name).toBe('transfers')
          expect(mdText(sections.get(name)!).trim()).toBe('')
        }
      })

      it('has a clause file with at least one clause', () => {
        const clauses = f['resource/my.tok.clauses.md']
        expect(clauses.trimStart().startsWith('<h1 class="clause">')).toBe(true)
        expect(clauses).not.toMatch(/TODO/)
      })
    })
  }

  it('keeps the Hello World and Empty code as before', () => {
    const hello = templateFiles('hello', 'my.tok')
    expect(hello['src/my.tok.cpp']).toBe(`#include <my.tok.hpp>

void my_tok::hi(name user) {
  require_auth(user);
  print("Hello, ", user);
}
`)
    expect(hello['include/my.tok.hpp']).toBe(`#pragma once

#include <eosio/eosio.hpp>

using namespace eosio;

class [[eosio::contract("my.tok")]] my_tok : public contract {
public:
  using contract::contract;

  [[eosio::action]]
  void hi(name user);

  using hi_action = action_wrapper<"hi"_n, &my_tok::hi>;
};
`)
    const empty = templateFiles('empty', 'my.tok')
    expect(empty['src/my.tok.cpp']).toBe(`#include <my.tok.hpp>

void my_tok::doit(name user) {
  require_auth(user);
}
`)
    expect(empty['include/my.tok.hpp']).toBe(`#pragma once

#include <eosio/eosio.hpp>

using namespace eosio;

class [[eosio::contract("my.tok")]] my_tok : public contract {
public:
  using contract::contract;

  [[eosio::action]]
  void doit(name user);
};
`)
  })
})

describe('token template', () => {
  const f = templateFiles('token', 'mytoken')
  const hpp = f['include/mytoken.hpp']
  const cpp = f['src/mytoken.cpp']
  const md = f['resource/mytoken.contracts.md']

  it('keeps the standard actions, signatures and table layout', () => {
    expect(actionsOf(hpp)).toEqual(['create', 'issue', 'retire', 'transfer', 'open', 'close'])
    const code = cppCode(hpp)
    expect(code).toContain('void open(const name& owner, const symbol& symbol, const name& ram_payer);')
    expect(code).toContain('void close(const name& owner, const symbol& symbol);')
    expect(code).toMatch(/struct \[\[eosio::table\]\] account \{\s*asset balance;\s*uint64_t primary_key\(\)/)
    expect(code).toContain('typedef eosio::multi_index<"accounts"_n, account> accounts;')
    expect(code).toContain('typedef eosio::multi_index<"stat"_n, currency_stats> stats;')
    expect(cppCode(cpp)).toContain('check(it->balance.amount == 0, "cannot close because the balance is not zero");')
    expect(cppCode(cpp)).toContain('auto payer = has_auth(to) ? to : from;')
  })

  it('erases a balance row that reaches zero in sub_balance', () => {
    const code = cppCode(cpp)
    const body = code.slice(code.indexOf('::sub_balance('), code.indexOf('::add_balance('))
    expect(body.replace(/\s+/g, ' ')).toContain(
      'check(from.balance.amount >= value.amount, "overdrawn balance"); if (from.balance.amount == value.amount) { from_acnts.erase(from); } else { from_acnts.modify(from, owner, [&](auto& a) { a.balance -= value; }); }'
    )
  })

  it('returns a zero balance without a row and fails only for an unknown token', () => {
    const code = cppCode(hpp)
    const body = code.slice(code.indexOf('static asset get_balance('), code.indexOf('using create_action'))
    expect(body).toContain('auto ac = accountstable.find(sym_code.raw());')
    expect(body).toContain('if (ac != accountstable.end()) return ac->balance;')
    expect(body).toContain('const auto& st = statstable.get(sym_code.raw(), "unknown token");')
    expect(body).toContain('return asset{0, st.supply.symbol};')
    expect(body).not.toContain('no balance with this symbol')
  })

  it('states the zero-balance rules in comments', () => {
    expect(hpp).toContain('A missing row means a zero balance.')
    expect(hpp).toMatch(/erased in sub_balance/)
    expect(hpp).toMatch(/open and close keep their standard signatures/)
    expect(hpp).toMatch(/The table layout is the standard one/)
    expect(hpp).toMatch(/retire of the issuer's whole balance erases the issuer's row/)
    expect(cpp).toMatch(/\/\/ The balance reaches zero: remove the row\./)
  })

  it('ships transfers commented out in the header, the source and the Ricardian file', () => {
    expect(cppCode(hpp)).not.toContain('transfers')
    expect(cppCode(cpp)).not.toContain('transfers')
    expect(hpp).toContain('void transfers(const name& from, const name& to, const std::vector<asset>& quantities, const std::string& memo);')
    expect(cpp).toContain('void mytoken::transfers(const name& from, const name& to, const std::vector<asset>& quantities, const std::string& memo) {')
    expect(mdText(sectionsOf(md).get('transfers')!).trim()).toBe('')
    // Why it is off: deposit listeners only credit the transfer notification.
    expect(hpp).toMatch(/contracts that credit deposits listen\s+\/\/ for the transfer notification/)
    expect(md).toContain('Contracts that credit deposits listen for the transfer action only')
  })

  it('enables transfers when the comment lines are removed', () => {
    const on = enableTransfers(f, 'mytoken')
    const h = on['include/mytoken.hpp']
    const c = cppCode(on['src/mytoken.cpp'])
    expect(actionsOf(h)).toEqual(['create', 'issue', 'retire', 'transfer', 'transfers', 'open', 'close'])
    expect(cppCode(h)).toContain('using transfers_action = action_wrapper<"transfers"_n, &mytoken::transfers>;')
    const body = c.slice(c.indexOf('::transfers('), c.indexOf('::sub_balance('))
    for (const rule of [
      'check(from != to, "cannot transfer to self");',
      'require_auth(from);',
      'check(is_account(to), "to account does not exist");',
      'check(!quantities.empty(), "no quantity given");',
      'check(quantities.size() <= 16, "more than 16 quantities");',
      'check(memo.size() <= 256, "memo has more than 256 bytes");',
      'require_recipient(from);',
      'require_recipient(to);',
      'auto payer = has_auth(to) ? to : from;',
      'check(quantities[j].symbol.code() != quantity.symbol.code(), "a symbol is given more than once");',
      'check(quantity.is_valid(), "invalid quantity");',
      'check(quantity.amount > 0, "must transfer positive quantity");',
      'check(quantity.symbol == st.supply.symbol, "symbol precision mismatch");',
      'sub_balance(from, quantity);',
      'add_balance(to, quantity, payer);'
    ]) {
      expect(body, rule).toContain(rule)
    }
    const section = sectionsOf(on['resource/mytoken.contracts.md']).get('transfers')!.trim()
    expect(section).toMatch(/^---\nspec_version: "0\.2\.0"\ntitle: [^\n]+\nsummary: '[^'\n]+'\n---\n\n\S/)
    expect(section).not.toMatch(/<!--|-->/)
  })
})
