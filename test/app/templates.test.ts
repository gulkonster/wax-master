import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { allTopics, parseDocsIndex } from '../../src/shared/docs'
import { EXAMPLES, TEMPLATE_IDS, TEMPLATES } from '../../src/shared/project'
import { EXAMPLE_FILES, classNameFor, fillTemplate, readExampleFolders, templateFiles } from '../../src/main/templates'

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

  it('says what other contracts see and what the rows cost in bytes', () => {
    const flat = hpp.replace(/\s*\n\s*\*\s*/g, ' ')
    expect(flat).toContain(
      'A contract compiled with the standard token header still fails in its own get_balance for an account without a row, as it does for an account that never held the token.'
    )
    expect(flat).toContain('A row is 128 bytes; the first row of an account costs 112 bytes more for its table.')
    expect(flat).toContain(
      "The holder who sends a part takes over the 128 bytes; the 112 stay with the payer of the account's first row until the account's last row is removed."
    )
    // The comment above add_balance belongs to it: no blank line between them.
    expect(cpp).toMatch(/\/\/ first receipt\.\nvoid mytoken::add_balance\(/)
  })

  it('describes the template in New Project', () => {
    expect(TEMPLATES.find((t) => t.id === 'token')?.description).toBe(
      'A token contract (create, issue, transfer, retire); balance rows are removed at zero.'
    )
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

describe('example projects', () => {
  const index = parseDocsIndex(readFileSync(join(__dirname, '../../docs/help/index.json'), 'utf8'))
  const topicIds = new Set(allTopics(index).map((t) => t.id))
  const examplesGroup = index.groups.find((g) => g.id === 'examples')?.topics.map((t) => t.id) ?? []
  const root = join(__dirname, '../../resources/templates/examples')
  const pending = join(__dirname, '../../resources/examples-pending')

  const list = (dir: string, base = ''): string[] =>
    readdirSync(join(dir, base), { withFileTypes: true }).flatMap((d) =>
      d.isDirectory() ? list(dir, join(base, d.name)) : [join(base, d.name).replace(/\\/g, '/')]
    )

  it('ships one folder per listed example, each with exactly the example files', () => {
    expect(readdirSync(root).sort()).toEqual(EXAMPLES.map((e) => e.id).sort())
    for (const e of EXAMPLES) expect(list(join(root, e.id)).sort(), e.id).toEqual([...EXAMPLE_FILES].sort())
  })

  it('reads example folders by name from the bundled paths', () => {
    const m = readExampleFolders({
      '../../resources/templates/examples/staking/src/contract.cpp': 'a',
      '../../resources/templates/examples/staking/README.md': 'b',
      '../../resources/templates/project/hello/src/contract.cpp': 'c'
    })
    expect([...m.keys()]).toEqual(['staking'])
    expect([...m.get('staking')!.entries()]).toEqual([
      ['src/contract.cpp', 'a'],
      ['README.md', 'b']
    ])
  })

  it('New Project accepts every template and listed example id', () => {
    expect(TEMPLATE_IDS).toEqual(['empty', 'hello', 'token', 'transfer-listener', 'staking'])
    for (const e of EXAMPLES) expect(e.name, e.id).toMatch(/^[a-z1-5.]{1,12}$/)
  })

  /** The files of an example as New Project writes them for the contract "my.ex". */
  const pendingFiles = (id: string): Record<string, string> => {
    const fill = (rel: string): string => fillTemplate(readFileSync(join(pending, id, rel), 'utf8'), 'my.ex', classNameFor('my.ex'))
    return {
      'src/my.ex.cpp': fill('src/contract.cpp'),
      'include/my.ex.hpp': fill('include/contract.hpp'),
      'resource/my.ex.contracts.md': fill('resource/contract.contracts.md'),
      'resource/my.ex.clauses.md': fill('resource/contract.clauses.md'),
      'README.md': fill('README.md')
    }
  }

  const cases: { id: string; topic: string; files: () => Record<string, string> }[] = [
    ...EXAMPLES.map((e) => ({ id: e.id, topic: e.topic, files: () => templateFiles(e.id, 'my.ex') })),
    { id: 'random-number', topic: 'example-random-number', files: () => pendingFiles('random-number') }
  ]

  for (const c of cases) {
    describe(c.id, () => {
      const f = c.files()

      it('writes source, header, both Ricardian files and the README with the names filled in', () => {
        expect(Object.keys(f).sort()).toEqual(['README.md', 'include/my.ex.hpp', 'resource/my.ex.clauses.md', 'resource/my.ex.contracts.md', 'src/my.ex.cpp'])
        for (const text of Object.values(f)) {
          expect(text).not.toMatch(/%CONTRACT%|%CLASS%|\r/)
          expect(text.endsWith('\n')).toBe(true)
        }
        expect(f['src/my.ex.cpp'].startsWith('#include <my.ex.hpp>\n')).toBe(true)
        expect(f['include/my.ex.hpp']).toContain('class [[eosio::contract("my.ex")]] my_ex : public contract {')
      })

      it('is small: under 150 lines of code', () => {
        expect((f['src/my.ex.cpp'] + f['include/my.ex.hpp']).split('\n').length).toBeLessThan(150)
      })

      it('has one finished Ricardian section per action and a clause file', () => {
        const md = f['resource/my.ex.contracts.md']
        expect(md.slice(0, md.indexOf('<h1')).trim()).toBe('')
        const sections = sectionsOf(md)
        const actions = actionsOf(f['include/my.ex.hpp'])
        expect(actions.length).toBeGreaterThan(0)
        expect([...sections.keys()].sort()).toEqual([...actions].sort())
        for (const a of actions) {
          expect(sections.get(a)!.trim(), a).toMatch(/^---\nspec_version: "0\.2\.0"\ntitle: [^\n]+\nsummary: '[^'\n]+'\n---\n\n\S/)
          expect(sections.get(a), a).not.toMatch(/TODO|<!--|-->/)
        }
        const clauses = f['resource/my.ex.clauses.md']
        expect(clauses.trimStart().startsWith('<h1 class="clause">')).toBe(true)
        expect(clauses).not.toMatch(/TODO/)
      })

      it('has a README with the warning line and numbered steps done in the app', () => {
        const readme = f['README.md']
        expect(readme).toContain('not audited; do not hold real value with it unchanged')
        const steps = readme.slice(readme.indexOf('## Steps in WAX Master'))
        expect(steps).toMatch(/^1\. File > New Project\. Under \*\*Examples\*\* choose \*\*/m)
        expect(steps).toContain('keep the name `my.ex`')
        for (const s of ['Contract > Build', 'Contract > Deploy', 'Keys and permissions', 'eosio.code', 'Run query']) expect(steps, s).toContain(s)
      })

      it('has its documentation page in the Examples group', () => {
        expect(topicIds.has(c.topic), c.topic).toBe(true)
        expect(examplesGroup).toContain(c.topic)
      })
    })
  }

  it('transfer listener: listens to eosio.token only, skips outgoing transfers, withdraws with an inline transfer', () => {
    const f = templateFiles('transfer-listener', 'listener')
    const hpp = cppCode(f['include/listener.hpp'])
    const cpp = cppCode(f['src/listener.cpp'])
    expect(hpp).toContain('[[eosio::on_notify("eosio.token::transfer")]]')
    expect(hpp).not.toContain('"*::transfer"')
    expect(cpp).toContain('if (from == get_self() || to != get_self()) return;')
    expect(cpp).toContain('deposits.emplace(get_self(),')
    expect(cpp).toContain('require_auth(owner);')
    expect(cpp).toMatch(/action\(permission_level\{get_self\(\), "active"_n\}, "eosio\.token"_n, "transfer"_n,/)
    expect(actionsOf(f['include/listener.hpp'])).toEqual(['withdraw'])
  })

  it('staking: memo stake, one 5-minute constant, claim after the waiting time with an inline transfer', () => {
    const f = templateFiles('staking', 'staking')
    const hpp = cppCode(f['include/staking.hpp'])
    const cpp = cppCode(f['src/staking.cpp'])
    expect(hpp).toContain('static constexpr uint32_t UNSTAKE_SECONDS = 5 * 60;')
    expect(cpp.match(/UNSTAKE_SECONDS/g)?.length).toBe(1)
    expect(hpp).toContain('[[eosio::on_notify("eosio.token::transfer")]]')
    expect(cpp).toContain('check(memo == "stake", "send with the memo stake");')
    expect(cpp).toContain('check(time_point_sec(current_time_point()) >= row.claim_after, "the waiting time is not over yet");')
    expect(cpp).toMatch(/action\(permission_level\{get_self\(\), "active"_n\}, "eosio\.token"_n, "transfer"_n,/)
    expect(actionsOf(f['include/staking.hpp'])).toEqual(['unstake', 'claim'])
  })

  it('random number: not listed in New Project; requestrand inline, the answer by the randnotify notification', () => {
    expect(EXAMPLES.map((e) => e.id)).not.toContain('random-number')
    const f = pendingFiles('random-number')
    const hpp = cppCode(f['include/my.ex.hpp'])
    const cpp = cppCode(f['src/my.ex.cpp'])
    expect(cpp).toContain('static constexpr name ORNG = "orng.wax"_n;')
    expect(cpp).toMatch(/action\(permission_level\{get_self\(\), "active"_n\}, ORNG, "requestrand"_n,\s*std::make_tuple\(id, signing_value, get_self\(\)\)\)/)
    expect(hpp).toContain('[[eosio::on_notify("orng.wax::randnotify")]]')
    expect(hpp).toContain('void on_randnotify(uint64_t request_id, name dapp, uint64_t assoc_id, checksum256 rnd);')
    // The handler returns, never fails, and never pays RAM with another account.
    const handler = cpp.slice(cpp.indexOf('::on_randnotify('))
    expect(handler).toContain('if (dapp != get_self()) return;')
    expect(handler).toContain('if (it == rolls.end() || it->result != 0) return;')
    expect(handler).not.toMatch(/check\(|require_find|\.get\(|emplace/)
    expect(actionsOf(f['include/my.ex.hpp'])).toEqual(['roll'])
    expect(hpp).not.toMatch(/void receiverand/)
  })

  it('ships the listed example folders with the app, and not the pending ones', () => {
    const yml = readFileSync(join(__dirname, '../../electron-builder.yml'), 'utf8')
    expect(yml).toMatch(/- from: resources\n\s+to: resources\n\s+filter:\n\s+- 'templates\/\*\*'\n/)
    expect(yml).not.toContain('examples-pending')
  })
})
