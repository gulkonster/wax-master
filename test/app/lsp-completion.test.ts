import { describe, expect, it } from 'vitest'
import { keepCompletion, memberAccessBefore, rowLambdaAt, rowTypeOf, SNIPPETS } from '../../src/shared/lsp-completion'

const keep = (label: string, extra: { filterText?: string; insertText?: string } = {}, inInclude = false): boolean =>
  keepCompletion({ label, ...extra }, inInclude)

describe('keepCompletion', () => {
  it('drops the library internals of a name member list', () => {
    expect(keep('_bluegrass_meta_refl_field_ptr<std::size_t N>() const : void *')).toBe(false)
    expect(keep(' _bluegrass_meta_refl_valid() : void', { filterText: '_bluegrass_meta_refl_valid' })).toBe(false)
    expect(keep('_bluegrass_meta_refl_field_ptrs() const : std::array<void *, 3>')).toBe(false)
    for (const name of ['length', 'prefix', 'suffix', 'to_string', 'print', 'value']) expect(keep(name)).toBe(true)
  })

  it('drops internal_use_do_not_use beside the real require_auth', () => {
    expect(keep('internal_use_do_not_use::require_auth(uint64_t name) : void')).toBe(false)
    expect(keep('internal_use_do_not_use::require_recipient(uint64_t name) : void')).toBe(false)
    expect(keep('internal_use_do_not_use', { insertText: 'internal_use_do_not_use' })).toBe(false)
    expect(keep('require_auth(…) : [2 overloads]', { insertText: 'require_auth($0)' })).toBe(true)
    expect(keep('require_recipient(…) : [2 overloads]')).toBe(true)
  })

  it('drops the detail names of a prefix', () => {
    expect(keep('detail::check_types<auto Action, size_t I, typename T, typename Rest>')).toBe(false)
    expect(keep('bluegrass::meta::check_type<typename T>() : T')).toBe(false)
    expect(keep('bluegrass::meta::detail::enable_if_constructible_helper_t<class T>')).toBe(false)
    expect(keep('std::consume_header : std::codecvt_mode')).toBe(true)
    expect(keep('x', { insertText: 'impl::thing' })).toBe(false)
    expect(keep('x', { insertText: '_multi_index_detail::thing' })).toBe(false)
    expect(keep('x', { insertText: '_datastream_detail::thing' })).toBe(false)
    expect(keep('x', { insertText: 'std::__hash_table' })).toBe(false)
    expect(keep('check(…) : [7 overloads]', { insertText: 'check($0)' })).toBe(true)
    expect(keep('checksum256')).toBe(true)
  })

  it('drops the library scopes of an eosio:: list and keeps the names', () => {
    expect(keep('detail')).toBe(false)
    expect(keep('internal_use_do_not_use')).toBe(false)
    for (const name of ['name', 'asset', 'symbol', 'check(…) : [7 overloads]', 'require_auth(…) : [2 overloads]', 'contract', 'action', 'permission_level']) {
      expect(keep(name)).toBe(true)
    }
  })

  it('drops the macros of the app flags and keeps other names', () => {
    for (const macro of ['BOOST_DISABLE_ASSERTS', 'BOOST_EXCEPTION_DISABLE', '_GNU_SOURCE', '__eosio_cdt__', '__eosio_cdt_major__', '__eosio_cdt_minor__', '__eosio_cdt_patchlevel__']) {
      expect(keep(macro)).toBe(false)
    }
    for (const name of ['maximum_supply : const asset &', 'issuer : const name &', 'sym : symbol', 'eosio', 'mytoken', '_ds : datastream<const char *>', '_self : name', 'std']) {
      expect(keep(name)).toBe(true)
    }
  })

  it('reads the filter text and the edit text as well as the label', () => {
    expect(keep('anything', { filterText: '_bluegrass_x' })).toBe(false)
    expect(keepCompletion({ label: 'f', textEdit: { newText: 'detail::f' } }, false)).toBe(false)
    expect(keepCompletion({ label: 'f', textEdit: { newText: 'f($0)' } }, false)).toBe(true)
  })

  it('cleans an include list', () => {
    for (const name of ['__bit_reference>', '__config>', '__functional_03>', '_foo.h>', 'Availability.h>', 'AvailabilityInternal.h>']) {
      expect(keep(name, {}, true)).toBe(false)
    }
    for (const name of ['asset.hpp>', 'eosio.hpp>', 'multi_index.hpp>', 'singleton.hpp>', 'native/', 'vector>', 'string>']) {
      expect(keep(name, {}, true)).toBe(true)
    }
  })

  it('does not apply the include rule outside an include line', () => {
    expect(keep('Availability')).toBe(true)
    expect(keep('_self : name')).toBe(true)
  })
})

describe('rowLambdaAt', () => {
  const at = (text: string): ReturnType<typeof rowLambdaAt> => rowLambdaAt(text, text.length)

  it('finds the parameter of an emplace lambda', () => {
    const text = 'void f() {\n  stats statstable(get_self(), 0);\n  statstable.emplace(get_self(), [&](auto& s) {\n    s.'
    const r = at(text)
    expect(r?.param).toBe('s')
    expect(text.slice(0, r!.tableExprEnd).endsWith('statstable')).toBe(true)
    expect(text.slice(r!.tableExprEnd).startsWith('.emplace(')).toBe(true)
  })

  it('finds modify, also with an iterator argument and a pointer access', () => {
    expect(at('t.modify(st, same_payer, [&](auto& row) { row.')?.param).toBe('row')
    expect(at('t.modify(*it, get_self(), [=](auto& r) { r.')?.param).toBe('r')
    const text = 'self->tbl.modify(st, same_payer, [&](auto& r) { r.'
    const r = at(text)
    expect(r?.param).toBe('r')
    expect(text.slice(0, r!.tableExprEnd)).toBe('self->tbl')
  })

  it('accepts the spacing variants and mutable', () => {
    expect(at('t.emplace(p, [&](auto &s) { s.')?.param).toBe('s')
    expect(at('t.emplace(p, [&]( auto&  s ) { s.')?.param).toBe('s')
    expect(at('t.emplace(p, [&](auto& s) mutable { s.')?.param).toBe('s')
    expect(at('t.emplace(p, [this, &x](auto& s)\n{\n  s.')?.param).toBe('s')
    expect(at('t . emplace ( p, [&](auto& s) { s.')?.param).toBe('s')
  })

  it('keeps counting through nested blocks and brackets', () => {
    const text = 't.emplace(p, [&](auto& s) {\n  if (a[0]) {\n    for (auto x : v) { f(x); }\n    s.'
    expect(at(text)?.param).toBe('s')
  })

  it('skips strings and comments with brackets', () => {
    const text = 't.emplace(p, [&](auto& s) {\n  // } not closed\n  const char* a = "}{)";\n  char c = \'}\';\n  /* } */\n  s.'
    expect(at(text)?.param).toBe('s')
    expect(at("t.emplace(p, [&](auto& s) { auto n = 1'000; s.")?.param).toBe('s')
    expect(at('t.emplace(p, [&](auto& s) { auto r = R"x(})x"; s.')?.param).toBe('s')
  })

  it('finds the table expression of a call', () => {
    const text = 'get_table().emplace(p, [&](auto& s) { s.'
    const r = at(text)
    expect(text.slice(0, r!.tableExprEnd)).toBe('get_table()')
  })

  it('answers null when the cursor is not in such a lambda', () => {
    expect(at('t.emplace(p, [&](auto& s) { s.x = 1; }); ')).toBeNull()
    expect(at('t.emplace(p, [&](auto& s) { s.x = 1; });\nstd::for_each(a, b, [&](auto& s) { s.')).toBeNull()
    expect(at('t.emplace(p, [&](currency_stats& s) { s.')).toBeNull()
    expect(at('t.emplace(p, [&](auto s) { s.')).toBeNull()
    expect(at('t.emplace(p, [&](const auto& s) { s.')).toBeNull()
    expect(at('t.find(p, [&](auto& s) { s.')).toBeNull()
    expect(at('emplace(p, [&](auto& s) { s.')).toBeNull()
    expect(at('auto f = [&](auto& s) { s.')).toBeNull()
    expect(at('void f() { s.')).toBeNull()
    expect(at('')).toBeNull()
  })

  it('answers null for a lambda only named in a comment or string', () => {
    expect(at('// t.emplace(p, [&](auto& s) {\n s.')).toBeNull()
    expect(at('const char* a = "t.emplace(p, [&](auto& s) {"; s.')).toBeNull()
  })

  it('follows the cursor offset, not the end of the text', () => {
    const text = 't.emplace(p, [&](auto& s) { s.a = 1; });\nint x = 0;'
    expect(rowLambdaAt(text, text.indexOf('s.a') + 2)?.param).toBe('s')
    expect(rowLambdaAt(text, text.indexOf('int x'))).toBeNull()
  })

  it('finds the inner call when lambdas are nested', () => {
    const text = 'a.emplace(p, [&](auto& x) {\n  b.modify(it, p, [&](auto& y) {\n    y.'
    const r = rowLambdaAt(text, text.length)
    expect(r?.param).toBe('y')
    expect(text.slice(0, r!.tableExprEnd).endsWith('\n  b')).toBe(true)
  })
})

describe('memberAccessBefore', () => {
  it('reads the identifier and the typed part', () => {
    expect(memberAccessBefore('    s.')).toEqual({ id: 's', typed: '' })
    expect(memberAccessBefore('    s.sup')).toEqual({ id: 's', typed: 'sup' })
    expect(memberAccessBefore('x = row->is')).toEqual({ id: 'row', typed: 'is' })
    expect(memberAccessBefore('  s')).toBeNull()
    expect(memberAccessBefore('  f().')).toBeNull()
  })
})

describe('rowTypeOf', () => {
  it('reads the row of the recorded hover answers', () => {
    expect(rowTypeOf('### type-alias `stats` \n\nType: `class eosio::multi_index<14289235522390851584, mytoken::currency_stats>`')).toBe('mytoken::currency_stats')
    expect(rowTypeOf("stats (aka multi_index<operator\"\"_n<char, 's', 't', 'a', 't'>(), currency_stats>)")).toBe('currency_stats')
    expect(rowTypeOf('Type: `class eosio::multi_index<"stat"_n, mytoken::currency_stats>`')).toBe('mytoken::currency_stats')
    expect(rowTypeOf("private: typedef eosio::multi_index<operator\"\" _n < char, 's', 't', 'a', 't'>(),\n    currency_stats > stats")).toBe('currency_stats')
  })

  it('keeps a qualifier and drops class and struct', () => {
    expect(rowTypeOf('multi_index<1, a::b::row>')).toBe('a::b::row')
    expect(rowTypeOf('multi_index<1, struct row>')).toBe('row')
    expect(rowTypeOf('multi_index<1, const class ns::row>')).toBe('ns::row')
    expect(rowTypeOf('multi_index<1, ::row>')).toBe('::row')
  })

  it('ignores the index arguments after the row', () => {
    expect(rowTypeOf('multi_index<1, account, indexed_by<2, const_mem_fun<account, uint64_t, &account::by_owner>>>')).toBe('account')
    expect(rowTypeOf('Type: `multi_index<"people"_n, person, indexed_by<"byage"_n, f>>::index<"byage"_n, f>`')).toBe('person')
  })

  it('gives the row of the enclosing multi_index of a secondary index', () => {
    expect(rowTypeOf('Type: `class eosio::multi_index<1, mytoken::account, eosio::indexed_by<2, x>>::index<2, x>`')).toBe('mytoken::account')
  })

  it('answers null when there is no row to read', () => {
    expect(rowTypeOf('')).toBeNull()
    expect(rowTypeOf('### variable `x`\n\nType: `int`')).toBeNull()
    expect(rowTypeOf('multi_index<1>')).toBeNull()
    expect(rowTypeOf('multi_index<1, auto>')).toBeNull()
    expect(rowTypeOf('multi_index<1, 5>')).toBeNull()
    expect(rowTypeOf('multi_index<1, row')).toBeNull()
  })
})

describe('SNIPPETS', () => {
  const FILL = /\$\{(\d+):([^}]*)\}/g

  /** The snippet with every placeholder replaced by its default text, as the editor inserts it unedited. */
  function filled(body: string): string {
    return body.replace(FILL, (_all, _n, text: string) => text).replace(/\$0/g, '')
  }

  const body = (label: string): string => SNIPPETS.find((s) => s.label === label)!.body

  it('has the eleven labels', () => {
    expect(SNIPPETS.map((s) => s.label)).toEqual(['action', 'table', 'notify', 'find', 'emplace', 'modify', 'erase', 'require_auth', 'check', 'inline', 'singleton'])
  })

  it('puts the class members and the statements in their places', () => {
    expect(SNIPPETS.filter((s) => s.where === 'member').map((s) => s.label)).toEqual(['action', 'table', 'notify', 'singleton'])
    expect(SNIPPETS.filter((s) => s.where === 'statement')).toHaveLength(7)
  })

  it('has a detail and a body each', () => {
    for (const s of SNIPPETS) {
      expect(s.detail.length).toBeGreaterThan(0)
      expect(s.body.length).toBeGreaterThan(0)
    }
  })

  it('has well-formed placeholders, and repeated numbers carry the same default', () => {
    for (const s of SNIPPETS) {
      const defaults = new Map<string, string>()
      for (const m of s.body.matchAll(FILL)) {
        const known = defaults.get(m[1])
        if (known !== undefined) expect(m[2]).toBe(known)
        defaults.set(m[1], m[2])
      }
      expect(filled(s.body)).not.toMatch(/\$\{/)
      expect(filled(s.body)).not.toMatch(/\$\d/)
    }
  })

  it('uses the attribute form and the name literals', () => {
    expect(filled(body('action'))).toContain('[[eosio::action]]')
    expect(filled(body('table'))).toContain('struct [[eosio::table]] row')
    expect(filled(body('table'))).toContain('primary_key() const')
    expect(filled(body('table'))).toContain('typedef eosio::multi_index<"rows"_n, row> rows_table;')
    expect(filled(body('notify'))).toContain('[[eosio::on_notify("eosio.token::transfer")]]')
    expect(filled(body('notify'))).toContain('const name& from, const name& to, const asset& quantity, const std::string& memo')
    expect(filled(body('find'))).toContain('.find(')
    expect(filled(body('find'))).toContain('check(found != statstable.end()')
    expect(body('emplace')).toContain('auto& ${3:row}')
    expect(body('modify')).toContain('auto& ${4:row}')
    expect(filled(body('inline'))).toContain('action(permission_level{get_self(), "active"_n}')
    expect(filled(body('inline'))).toContain('.send();')
    expect(filled(body('singleton'))).toContain('eosio::singleton<"config"_n')
  })

  it('has a table name that is valid and at most twelve characters', () => {
    const name = /multi_index<"\$\{3:([^}]*)\}"_n/.exec(body('table'))![1]
    expect(name).toMatch(/^[a-z1-5.]{1,12}$/)
  })
})
