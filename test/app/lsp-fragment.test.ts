import { describe, expect, it } from 'vitest'
import {
  headerSummary,
  includeTarget,
  isHeaderPath,
  isPiece,
  namedInInclude,
  pieceNotice,
} from '../../src/shared/lsp-fragment'

describe('isHeaderPath', () => {
  it('tells headers from sources', () => {
    expect(isHeaderPath('include/mytoken.hpp')).toBe(true)
    expect(isHeaderPath('include/tables.inc.hpp')).toBe(true)
    expect(isHeaderPath('a.h')).toBe(true)
    expect(isHeaderPath('src/mytoken.cpp')).toBe(false)
    expect(isHeaderPath('src/a.CC')).toBe(false)
    expect(isHeaderPath('src/a.cxx')).toBe(false)
    expect(isHeaderPath('src/a.c')).toBe(false)
    expect(isHeaderPath('')).toBe(false)
  })
})

describe('includeTarget', () => {
  it('reads angle and quote forms with offsets', () => {
    const a = '#include <eosio/asset.hpp>'
    expect(includeTarget(a)).toEqual({ start: 9, end: a.length, name: 'eosio/asset.hpp' })
    const b = '#include "helpers.hpp"'
    expect(includeTarget(b)).toEqual({ start: 9, end: b.length, name: 'helpers.hpp' })
  })
  it('allows spaces and a trailing comment', () => {
    const l = '  #  include   "x.hpp"  // the x'
    const t = includeTarget(l)!
    expect(t.name).toBe('x.hpp')
    expect(l.slice(t.start, t.end)).toBe('"x.hpp"')
    expect(includeTarget('#include<y>')).toEqual({ start: 8, end: 11, name: 'y' })
    const c = '#include <z.hpp> /* c */'
    const tc = includeTarget(c)!
    expect(c.slice(tc.start, tc.end)).toBe('<z.hpp>')
  })
  it('refuses other lines', () => {
    expect(includeTarget('// #include <a>')).toBeNull()
    expect(includeTarget('#define X <a>')).toBeNull()
    expect(includeTarget('#include')).toBeNull()
    expect(includeTarget('#include <>')).toBeNull()
    expect(includeTarget('int x; #include <a>')).toBeNull()
  })
})

describe('namedInInclude', () => {
  const rows = (file: string, text: string) => [{ file, text }]
  it('matches the file name in an include line of another file', () => {
    expect(namedInInclude(rows('src/main.cpp', '#include "helpers.hpp"'), 'include/helpers.hpp')).toBe(true)
    expect(namedInInclude(rows('src/main.cpp', '#include <include/helpers.hpp>'), 'include/helpers.hpp')).toBe(true)
    expect(namedInInclude(rows('src/main.cpp', '#include "../include/helpers.hpp"'), 'include/helpers.hpp')).toBe(true)
  })
  it('ignores non-include lines, the header itself and other names', () => {
    expect(namedInInclude(rows('src/main.cpp', '// helpers.hpp'), 'include/helpers.hpp')).toBe(false)
    expect(namedInInclude(rows('include/helpers.hpp', '#include "helpers.hpp"'), 'include/helpers.hpp')).toBe(false)
    expect(namedInInclude(rows('src/main.cpp', '#include "myhelpers.hpp"'), 'include/helpers.hpp')).toBe(false)
    expect(namedInInclude([], 'include/helpers.hpp')).toBe(false)
  })
})

describe('isPiece', () => {
  it('needs all three conditions', () => {
    expect(isPiece({ headerErrors: 7, mainFileErrors: 0, included: true })).toBe(true)
    expect(isPiece({ headerErrors: 0, mainFileErrors: 0, included: true })).toBe(false)
    expect(isPiece({ headerErrors: 7, mainFileErrors: 1, included: true })).toBe(false)
    expect(isPiece({ headerErrors: 7, mainFileErrors: null, included: true })).toBe(false)
    expect(isPiece({ headerErrors: 7, mainFileErrors: 0, included: false })).toBe(false)
  })
})

describe('texts', () => {
  it('headerSummary', () => {
    expect(headerSummary('include/mytoken.hpp', [{ line: 129, message: "expected ';' after class" }])).toBe(
      "include/mytoken.hpp has 1 error; first: line 129: expected ';' after class",
    )
    expect(
      headerSummary('a.hpp', [
        { line: 3, message: 'x' },
        { line: 9, message: 'y' },
      ]),
    ).toBe('a.hpp has 2 errors; first: line 3: x')
    expect(headerSummary('a.hpp', [])).toBeNull()
  })
  it('pieceNotice', () => {
    expect(pieceNotice('src/main.cpp')).toBe(
      'This header is not complete on its own: it uses what src/main.cpp includes before it. It is checked as part of that file, which has no errors.',
    )
  })
})
