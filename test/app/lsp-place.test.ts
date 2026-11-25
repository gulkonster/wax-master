import { describe, expect, it } from 'vitest'
import { placeDiagnostics } from '../../src/shared/lsp-place'
import type { LspDiagnostic, LspRange } from '../../src/shared/lsp-diagnostics'

const DOC = 'project:///src/mytoken.cpp'
const HEADER = 'project:///include/mytoken.hpp'
const TC = 'toolchain:///usr/opt/cdt/4.1.1wax01/include/'
const pathOf = (uri: string): string => {
  if (uri.startsWith('project:///')) return uri.slice('project:///'.length)
  if (uri.startsWith(TC)) return uri.slice(TC.length)
  return ''
}
const r = (l1: number, c1: number, l2: number, c2: number): LspRange => ({
  start: { line: l1, character: c1 },
  end: { line: l2, character: c2 },
})
type Fix = { title: string; edit?: { changes?: Record<string, { range: LspRange; newText: string }[]> } }
function withFix(d: LspDiagnostic, fixes: Fix[]): LspDiagnostic {
  return { ...d, codeActions: fixes } as LspDiagnostic
}
function insert(uri: string, line: number, ch: number, text = ';'): Fix {
  return { title: `insert '${text}'`, edit: { changes: { [uri]: [{ range: r(line, ch, line, ch), newText: text }] } } }
}

const SRC = [
  '#include <mytoken.hpp>', // 0
  '',
  'void mytoken::create(const name& issuer, const asset& maximum_supply) {', // 2
  '  require_auth(get_self())', // 3 (no ;)
  '',
  '  auto sym = maximum_supply.symbol;', // 5
  '  check(sym.is_valid(), "invalid symbol name");',
]

describe('placeDiagnostics: a missing token', () => {
  it('semi-1: the underline is the character before the insertion point', () => {
    const d = withFix(
      { range: r(5, 2, 5, 6), severity: 1, code: 'expected_semi_after_expr', message: "Expected ';' after expression (fix available)" },
      [insert(DOC, 3, 26)],
    )
    const [out] = placeDiagnostics([d], SRC, DOC, pathOf)
    expect(out.range).toEqual(r(3, 25, 3, 26))
    expect(out.message).toBe("Expected ';' after expression (fix available)")
    expect((out as { codeActions?: unknown }).codeActions).toEqual((d as { codeActions?: unknown }).codeActions)
  })

  it('semi-2: a declaration without its semicolon', () => {
    const lines = ['', '', '', '', '', '  auto sym = maximum_supply.symbol', '  check(sym.is_valid());']
    const d = withFix({ range: r(6, 2, 6, 7), severity: 1, code: 'expected_semi_declaration', message: "Expected ';' at end of declaration" }, [
      insert(DOC, 5, 34),
    ])
    expect(placeDiagnostics([d], lines, DOC, pathOf)[0].range).toEqual(r(5, 33, 5, 34))
  })

  it('semi-3 (header): the closing brace of the class', () => {
    const lines = Array.from({ length: 130 }, () => '')
    lines[127] = '}'
    const d = withFix({ range: r(128, 0, 128, 0), severity: 1, code: 'expected_after', message: "Expected ';' after class (fix available)" }, [
      insert(HEADER, 127, 1),
    ])
    expect(placeDiagnostics([d], lines, HEADER, pathOf)[0].range).toEqual(r(127, 0, 127, 1))
  })

  it('semi-4 and semi-5: a declaration list and a line end', () => {
    const lines = Array.from({ length: 130 }, () => '')
    lines[52] = '  void issue(const name& to, const asset& quantity, const std::string& memo)'
    lines[117] = '  using x = int  '
    const a = withFix({ range: r(53, 2, 53, 6), code: 'expected_semi_decl_list', message: 'm' }, [insert(HEADER, 52, 19)])
    const b = withFix({ range: r(118, 2, 118, 6), code: 'expected_semi_decl_list', message: 'm' }, [insert(HEADER, 117, 16)])
    const out = placeDiagnostics([a, b], lines, HEADER, pathOf)
    expect(out[0].range).toEqual(r(52, 18, 52, 19))
    expect(out[1].range).toEqual(r(117, 15, 117, 16))
  })

  it('an insertion at column 1 underlines the first character of that line', () => {
    const lines = ['int a', 'int b']
    const d = withFix({ range: r(1, 0, 1, 3), code: 'expected_semi_decl_list', message: 'm' }, [insert(DOC, 1, 0)])
    // the insertion must lie before the diagnostic start: here it equals it, so the fix is not before
    expect(placeDiagnostics([d], lines, DOC, pathOf)[0].range).toEqual(r(1, 0, 1, 3))
    const e = withFix({ range: r(2, 0, 2, 3), code: 'expected_semi_decl_list', message: 'm' }, [insert(DOC, 1, 0)])
    expect(placeDiagnostics([e], [...lines, 'int c'], DOC, pathOf)[0].range).toEqual(r(1, 0, 1, 1))
  })

  it('two fixes, two edits, a replacement, another document, no code prefix or a later place: not moved', () => {
    const base = { range: r(5, 2, 5, 6), code: 'expected_semi_after_expr', message: 'm' }
    const two = withFix(base, [insert(DOC, 3, 26), insert(DOC, 3, 26)])
    const twoEdits = withFix(base, [
      { title: 't', edit: { changes: { [DOC]: [{ range: r(3, 26, 3, 26), newText: ';' }, { range: r(3, 20, 3, 20), newText: ')' }] } } },
    ])
    const replace = withFix(base, [{ title: 't', edit: { changes: { [DOC]: [{ range: r(3, 25, 3, 26), newText: ';' }] } } }])
    const other = withFix(base, [insert(HEADER, 3, 26)])
    const noPrefix = withFix({ ...base, code: 'no_member' }, [insert(DOC, 3, 26)])
    const after = withFix(base, [insert(DOC, 6, 3)])
    for (const d of [two, twoEdits, replace, other, noPrefix, after]) {
      expect(placeDiagnostics([d], SRC, DOC, pathOf)[0].range).toEqual(base.range)
    }
  })
})

describe('placeDiagnostics: a range with no width', () => {
  it('brace-1: Expected } lands on the last } of the file', () => {
    const lines = ['void f() {', '  g();', '}', '', '']
    const d: LspDiagnostic = {
      range: r(4, 0, 4, 0),
      severity: 1,
      code: 'expected',
      message: "Expected '}'",
      relatedInformation: [{ location: { uri: DOC, range: r(0, 9, 0, 10) }, message: "To match this '{'" }],
    }
    const [out] = placeDiagnostics([d], lines, DOC, pathOf)
    expect(out.range).toEqual(r(2, 0, 2, 1))
    expect(out.relatedInformation).toEqual(d.relatedInformation)
  })

  it('a character stands there: it is underlined', () => {
    const d: LspDiagnostic = { range: r(0, 2, 0, 2), code: 'x', message: 'm' }
    expect(placeDiagnostics([d], ['abcd'], DOC, pathOf)[0].range).toEqual(r(0, 2, 0, 3))
  })

  it('past the end of the line: the last non-blank character before it', () => {
    const d: LspDiagnostic = { range: r(1, 5, 1, 5), code: 'x', message: 'm' }
    expect(placeDiagnostics([d], ['one', 'two  '], DOC, pathOf)[0].range).toEqual(r(1, 2, 1, 3))
  })

  it('nothing before it: the range stays', () => {
    const d: LspDiagnostic = { range: r(0, 0, 0, 0), code: 'x', message: 'm' }
    expect(placeDiagnostics([d], [''], DOC, pathOf)[0].range).toEqual(r(0, 0, 0, 0))
  })

  it('a range with width stays, and the same object comes back', () => {
    const d: LspDiagnostic = { range: r(0, 1, 0, 3), code: 'no_member', message: 'm' }
    expect(placeDiagnostics([d], ['abcd'], DOC, pathOf)[0]).toBe(d)
  })
})

describe('placeDiagnostics: In included file', () => {
  const inc = ['#include <mytoken.hpp>', '#include "other.hpp"', '  #  include <vector>']
  it('semi-3: whole header name with its brackets, file and line in the message', () => {
    const d: LspDiagnostic = {
      range: r(0, 9, 0, 10),
      severity: 1,
      code: 'expected_after',
      message: "In included file: expected ';' after class",
      relatedInformation: [{ location: { uri: HEADER, range: r(128, 0, 128, 0) }, message: 'Error occurred here' }],
    }
    const [out] = placeDiagnostics([d], inc, DOC, pathOf)
    expect(out.range).toEqual(r(0, 9, 0, 22))
    expect(out.message).toBe("include/mytoken.hpp, line 129: expected ';' after class")
    expect(out.relatedInformation).toEqual(d.relatedInformation)
  })

  it('mi-1: the "Error occurred here" note is chosen among several, quotes are covered', () => {
    const d: LspDiagnostic = {
      range: r(1, 9, 1, 10),
      code: 'no_member_template_suggest',
      message: "In included file: no template named 'multi_indx' in namespace 'eosio'; did you mean 'multi_index'?",
      relatedInformation: [
        { location: { uri: TC + 'eosiolib/contracts/eosio/multi_index.hpp', range: r(437, 0, 437, 1) }, message: "'multi_index' declared here" },
        { location: { uri: HEADER, range: r(122, 0, 122, 1) }, message: 'Error occurred here' },
      ],
    }
    const [out] = placeDiagnostics([d], inc, DOC, pathOf)
    expect(out.range).toEqual(r(1, 9, 1, 20))
    expect(out.message).toBe("include/mytoken.hpp, line 123: no template named 'multi_indx' in namespace 'eosio'; did you mean 'multi_index'?")
  })

  it('a toolchain header: its path under the include folder', () => {
    const d: LspDiagnostic = {
      range: r(2, 12, 2, 13),
      code: 'x',
      message: 'In included file: unknown type name',
      relatedInformation: [{ location: { uri: TC + 'eosiolib/core/eosio/asset.hpp', range: r(29, 0, 29, 1) }, message: 'Error occurred here' }],
    }
    const [out] = placeDiagnostics([d], inc, DOC, pathOf)
    expect(out.range).toEqual(r(2, 13, 2, 21))
    expect(out.message).toBe('eosiolib/core/eosio/asset.hpp, line 30: unknown type name')
  })

  it('not on an #include line: unchanged', () => {
    const d: LspDiagnostic = { range: r(0, 0, 0, 1), message: 'In included file: oops', relatedInformation: [] }
    expect(placeDiagnostics([d], ['int x;'], DOC, pathOf)[0]).toBe(d)
  })

  it('no related place: only the range widens', () => {
    const d: LspDiagnostic = { range: r(0, 9, 0, 10), message: 'In included file: oops' }
    const [out] = placeDiagnostics([d], inc, DOC, pathOf)
    expect(out.range).toEqual(r(0, 9, 0, 22))
    expect(out.message).toBe('In included file: oops')
  })
})
