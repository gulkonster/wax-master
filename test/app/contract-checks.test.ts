import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { NAME_RULE, contractChecks, nameFault, replacedByCheck } from '../../src/shared/contract-checks'

const RULE = NAME_RULE

describe('nameFault', () => {
  it('accepts the names the builds accepted', () => {
    for (const n of ['', 'a', 'transfer', 'abcdefghijkl', 'abcdefghijklj', 'abcdefghijkl5', 'eosio.token', 'a.b', 'stat', 'accounts']) {
      expect(nameFault(n), n).toBeNull()
    }
  })
  it('names the first fault, in the order character, length, 13th character, dot', () => {
    expect(nameFault('abcdefghijklz')).toBe("the 13th character 'z' is not allowed")
    expect(nameFault('doit9')).toBe("'9' is not allowed")
    expect(nameFault('do_it')).toBe("'_' is not allowed")
    expect(nameFault('ok.')).toBe('it ends with a dot')
    expect(nameFault('BadName')).toBe("'B' is not allowed")
    expect(nameFault('EosioToken')).toBe("'E' is not allowed")
    expect(nameFault('accountstoolong')).toBe('it has 15 characters')
    expect(nameFault('abcdefghijklmnop')).toBe('it has 16 characters')
    expect(nameFault('averyveryverylongaction')).toBe('it has 23 characters')
    expect(nameFault('Averyveryverylongaction')).toBe("'A' is not allowed")
  })
  it('has the rule sentence of the decision', () => {
    expect(NAME_RULE).toBe(
      "Names use a-z, 1-5 and '.', at most 12 characters (a 13th may be 1-5 or a-j), and do not end with a dot."
    )
  })
})

describe('name literals', () => {
  it('reports a character fault over the whole literal with the suffix', () => {
    const text = 'typedef eosio::multi_index<"Accounts"_n, account> accounts;'
    const c = contractChecks(text)
    expect(c).toHaveLength(1)
    expect(c[0].code).toBe('name-literal')
    expect(c[0].severity).toBe(1)
    expect(c[0].range).toEqual({ start: { line: 0, character: 27 }, end: { line: 0, character: 39 } })
    expect(c[0].message).toBe(`"Accounts"_n is not a valid name: 'A' is not allowed. ${RULE}`)
  })
  it('reports the length', () => {
    const c = contractChecks('\n\ntypedef eosio::multi_index<"accountstoolong"_n, account> accounts;')
    expect(c[0].message).toBe(`"accountstoolong"_n is not a valid name: it has 15 characters. ${RULE}`)
    expect(c[0].range.start.line).toBe(2)
    expect(c[0].range.end.character - c[0].range.start.character).toBe('"accountstoolong"_n'.length)
  })
  it('reports the 13th character and the dot', () => {
    expect(contractChecks('auto a = "abcdefghijklz"_n;')[0].message).toContain("the 13th character 'z' is not allowed")
    expect(contractChecks('auto a = "ok."_n;')[0].message).toContain('it ends with a dot')
    expect(contractChecks('auto a = "abcdefghijklj"_n;')).toEqual([])
  })
  it('leaves valid, empty and other literals alone', () => {
    expect(contractChecks('auto a = "stat"_n; auto b = ""_n; auto c = "eosio.token"_n;')).toEqual([])
    expect(contractChecks('#include "Mytoken.hpp"\nprintf("Hello World");\nname n("BadName");')).toEqual([])
    expect(contractChecks('auto s = "Accounts"_nope;')).toEqual([])
  })
  it('skips comments', () => {
    expect(contractChecks('// auto a = "Accounts"_n;\n/* "Bad"_n\n "Bad"_n */ int x;')).toEqual([])
    expect(contractChecks('// [[eosio::action("Bad")]]\n/* ACTION Bad( */')).toEqual([])
  })
  it('does not take a comment mark inside a string for a comment', () => {
    const c = contractChecks('const char* u = "http://x"; auto a = "Bad"_n;')
    expect(c).toHaveLength(1)
  })
  it('survives an unterminated string without swallowing the rest', () => {
    const c = contractChecks('auto a = "oops;\nauto b = "Bad"_n;')
    expect(c).toHaveLength(1)
    expect(c[0].range.start.line).toBe(1)
  })
})

describe('actions', () => {
  it('checks the function name after the attribute on the same line', () => {
    const c = contractChecks('  [[eosio::action]] void doThing(name x) {}')
    expect(c).toHaveLength(1)
    expect(c[0].code).toBe('action-name')
    expect(c[0].range).toEqual({ start: { line: 0, character: 25 }, end: { line: 0, character: 32 } })
    expect(c[0].message).toBe(
      `Action name 'doThing' is not valid: 'T' is not allowed. ${RULE} ` +
        'The action name is the function name unless [[eosio::action("name")]] gives another.'
    )
  })
  it('handles the attribute on its own line', () => {
    const c = contractChecks('  [[eosio::action]]\n  void do_it(name x);')
    expect(c).toHaveLength(1)
    expect(c[0].range.start).toEqual({ line: 1, character: 7 })
    expect(c[0].message).toContain("'_' is not allowed")
  })
  it('handles several attributes in one group and in several groups', () => {
    expect(contractChecks('[[eosio::action, eosio::read_only]] void doit9();')[0].message).toContain("'9' is not allowed")
    expect(contractChecks('[[eosio::read_only]] [[eosio::action]] uint64_t Getit();')[0].message).toContain("'G'")
    expect(contractChecks('[[eosio::action]] [[eosio::read_only]] uint64_t Getit();')[0].message).toContain("'G'")
    expect(contractChecks('[[eosio::action, eosio::read_only]] uint64_t getit();')).toEqual([])
  })
  it('handles ACTION', () => {
    const c = contractChecks('ACTION DoIt(name x) {}')
    expect(c).toHaveLength(1)
    expect(c[0].range.start.character).toBe(7)
    expect(contractChecks('ACTION doit(name x) {}')).toEqual([])
    expect(contractChecks('#define ACTION Bad(\nACTION ok() {}')).toEqual([])
  })
  it('handles a qualified return type', () => {
    const c = contractChecks('[[eosio::action]] std::vector<name> Listing(name x);')
    expect(c).toHaveLength(1)
    expect(c[0].range.start.character).toBe(36)
    expect(contractChecks('[[eosio::action]] std::vector<name> listing(name x);')).toEqual([])
  })
  it('takes the text of the attribute over the function name', () => {
    expect(contractChecks('[[eosio::action("ok")]] void doThing(name x);')).toEqual([])
    const c = contractChecks('[[eosio::action("ok.")]] void doit();')
    expect(c).toHaveLength(1)
    expect(c[0].message).toContain("Action name 'ok.' is not valid: it ends with a dot.")
    expect(c[0].range).toEqual({ start: { line: 0, character: 16 }, end: { line: 0, character: 21 } })
    expect(contractChecks('[[eosio::action("x")]] void doThing(name x);')).toEqual([])
  })
  it('reports a long function name', () => {
    const c = contractChecks('[[eosio::action]] void averyveryverylongaction();')
    expect(c[0].message).toContain("Action name 'averyveryverylongaction' is not valid: it has 23 characters. ")
  })
  it('does not check a struct with a table attribute and no name', () => {
    expect(contractChecks('struct [[eosio::table]] BadName { uint64_t id; uint64_t primary_key() const { return id; } };')).toEqual([])
  })
})

describe('tables and notifications', () => {
  it('checks the table name', () => {
    const c = contractChecks('struct [[eosio::table("BadName"), eosio::contract("Whatever")]] row {};')
    expect(c).toHaveLength(1)
    expect(c[0].code).toBe('table-name')
    expect(c[0].message).toBe(`Table name 'BadName' is not valid: 'B' is not allowed. ${RULE}`)
    expect(contractChecks('struct [[eosio::table("stat"), eosio::contract("y")]] row {};')).toEqual([])
  })
  it('checks on_notify', () => {
    expect(contractChecks('[[eosio::on_notify("*::transfer")]] void f();')).toEqual([])
    expect(contractChecks('[[eosio::on_notify("eosio.token::transfer")]] void f();')).toEqual([])
    const c = contractChecks('[[eosio::on_notify("EosioToken::transfer")]] void f();')
    expect(c).toHaveLength(1)
    expect(c[0].code).toBe('notify-name')
    expect(c[0].message).toContain("Notification 'EosioToken::transfer' is not valid: in 'EosioToken', 'E' is not allowed.")
    expect(contractChecks('[[eosio::on_notify("transfer")]] void f();')[0].code).toBe('notify-name')
    expect(contractChecks('[[eosio::on_notify("a::b::c")]] void f();')[0].code).toBe('notify-name')
  })
  it('does not take the contract attribute or other brackets for names', () => {
    expect(contractChecks('class [[eosio::contract("MyToken")]] mytoken {}; int a[2][3]; auto f = [&](auto& x) { return x[0][1]; };')).toEqual([])
  })
})

describe('replacedByCheck', () => {
  const checks = contractChecks('typedef eosio::multi_index<"accountstoolong"_n, account> accounts;')
  const at = (a: number, b: number) => ({ start: { line: 0, character: a }, end: { line: 0, character: b } })
  it('drops the two constant-expression errors that touch the literal', () => {
    expect(replacedByCheck({ range: at(44, 46), code: 'constexpr_var_requires_const_init', message: 'x' }, checks)).toBe(true)
    expect(replacedByCheck({ range: at(27, 46), code: 'expr_not_cce', message: 'x' }, checks)).toBe(true)
  })
  it('keeps other codes and other places', () => {
    expect(replacedByCheck({ range: at(27, 46), code: 'typecheck_member_reference_struct_union', message: 'x' }, checks)).toBe(false)
    expect(replacedByCheck({ range: at(60, 62), code: 'expr_not_cce', message: 'x' }, checks)).toBe(false)
    expect(replacedByCheck({ range: at(27, 46), code: 'expr_not_cce', message: 'x' }, [])).toBe(false)
  })
})

describe('shipped templates and examples', () => {
  const root = join(__dirname, '../../resources/templates')
  const folders = [
    ...readdirSync(join(root, 'examples')).map((n) => join(root, 'examples', n)),
    ...readdirSync(join(root, 'project')).map((n) => join(root, 'project', n)),
    join(root, 'hello')
  ]
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n)
      return statSync(p).isDirectory() ? walk(p) : /\.(cpp|hpp|h|inc)$/.test(n) ? [p] : []
    })
  it('covers thirteen folders', () => {
    expect(folders).toHaveLength(13)
  })
  for (const folder of folders) {
    it(`gives no check: ${folder.slice(root.length + 1).replace(/\\/g, '/')}`, () => {
      for (const file of walk(folder)) {
        expect(contractChecks(readFileSync(file, 'utf8')), file).toEqual([])
      }
    })
  }
})
