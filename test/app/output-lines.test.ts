import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '', isPackaged: false }, BrowserWindow: class {}, dialog: {} }))
import { NAME_HINT, classifyLine, countProblems, isNameRuleError, orderProblems, placeToolchainProblems, problemSeverity, uniqueProblems } from '../../src/shared/output-lines'
import { parseProblems } from '../../src/main/build'

const ROOT = 'C:\\Users\\me\\proj'

// Sample lines as the toolchain prints them.
const CLANG_ERROR = "/mnt/c/Users/me/proj/src/hello.cpp:12:5: error: use of undeclared identifier 'foo'"
const CLANG_FATAL = "/mnt/c/Users/me/proj/src/hello.cpp:1:10: fatal error: 'missing.hpp' file not found"
const CLANG_WARNING = '/mnt/c/Users/me/proj/src/hello.cpp:8:22: warning: abigen warning (Action <hi> does not have a ricardian contract)'
const CLANG_NOTE = "./include/hello.hpp:4:3: note: previous definition is here"
const ABIGEN_WARNING = 'Warning, action <hi> does not have a ricardian contract'
const ABIGEN_CLAUSE_WARNING = 'Warning, empty ricardian clause file'
const ABIGEN_ERROR = 'Error, unable to find the contract class'
const LINKER_ERROR = 'wasm-ld: error: hello.cpp.o: undefined symbol: foo'
const LLD_ERROR = 'ld.lld: error: duplicate symbol: bar'
const LLD_WARNING = 'ld.lld: warning: function signature mismatch: baz'
const SOURCE_LINE = '  void hello::hi(name user) {'
const CARET = '                     ^'

describe('output line classifier', () => {
  it('colours clang errors red and puts the link on file:line:column only', () => {
    const c = classifyLine(CLANG_ERROR)
    expect(c.severity).toBe('error')
    expect(c.kind).toBe('diagnostic')
    expect(CLANG_ERROR.slice(c.loc!.start, c.loc!.end)).toBe('/mnt/c/Users/me/proj/src/hello.cpp:12:5')
    expect(c.loc).toMatchObject({ line: 12, column: 5 })
    expect(classifyLine(CLANG_FATAL).severity).toBe('error')
  })

  it('colours warnings yellow, never red', () => {
    for (const l of [CLANG_WARNING, ABIGEN_WARNING, LLD_WARNING, 'warning: overriding the module target triple', '3 warnings generated.']) {
      expect(classifyLine(l).severity, l).toBe('warning')
    }
  })

  it('colours errors red, never yellow', () => {
    for (const l of [CLANG_ERROR, CLANG_FATAL, ABIGEN_ERROR, LINKER_ERROR, LLD_ERROR, 'error: linker command failed with exit code 1', 'Error: no contract found', '2 errors generated.', '1 warning and 1 error generated.', 'Build failed (exit 1).', 'ABI check: table `x` uses the type `y`, but the ABI does not define it.']) {
      expect(classifyLine(l).severity, l).toBe('error')
    }
  })

  it('colours notes and the app neutral lines grey, and everything else as plain text', () => {
    expect(classifyLine(CLANG_NOTE).severity).toBe('note')
    expect(classifyLine('> cdt-cpp -abigen -contract hello -o ./hello.wasm src/hello.cpp').severity).toBe('note')
    expect(classifyLine('Build finished in 3.2 s.').severity).toBe('note')
    expect(classifyLine(SOURCE_LINE).severity).toBe('plain')
    expect(classifyLine(CARET).severity).toBe('plain')
    expect(classifyLine('In file included from src/hello.cpp:1:').severity).toBe('plain')
    expect(classifyLine('Why: the code declares a table type for `coinconf`, and ...').severity).toBe('plain')
  })

  it('does not take indented source text for a message', () => {
    expect(classifyLine('    check(false, "x: error: y");').severity).toBe('plain')
    expect(classifyLine('    // warning: not a diagnostic').severity).toBe('plain')
  })

  it('removes colour codes before classifying', () => {
    expect(classifyLine('\x1b[1m/mnt/c/p/a.cpp:1:2: \x1b[0;1;35mwarning: \x1b[0mx').severity).toBe('warning')
  })

  it('does not count summaries and app lines as problems of their own', () => {
    expect(problemSeverity(classifyLine('3 warnings generated.'))).toBeNull()
    expect(problemSeverity(classifyLine('Build failed (exit 1).'))).toBeNull()
    expect(problemSeverity(classifyLine('ABI check: table `x` ...'))).toBeNull()
    expect(problemSeverity(classifyLine(CLANG_NOTE))).toBe('info')
  })
})

describe('Problems from the same classifier', () => {
  const output = [
    '> cdt-cpp -abigen ...',
    CLANG_WARNING,
    SOURCE_LINE,
    CARET,
    ABIGEN_CLAUSE_WARNING,
    CLANG_ERROR,
    CLANG_NOTE,
    LINKER_ERROR,
    '1 warning and 1 error generated.',
    'Build failed (exit 1).'
  ].join('\n')

  it('lists diagnostics with project-relative places and messages without a place', () => {
    const p = parseProblems(output, ROOT)
    expect(p.map((x) => [x.severity, x.file, x.line])).toEqual([
      ['warning', 'src/hello.cpp', 8],
      ['warning', '', 0],
      ['error', 'src/hello.cpp', 12],
      ['info', 'include/hello.hpp', 4],
      ['error', '', 0]
    ])
    expect(p[1].message).toBe('empty ricardian clause file')
  })

  it('gives the status bar the same counts as the coloured lines', () => {
    const p = parseProblems(output, ROOT)
    expect(countProblems(p)).toEqual({ errors: 2, warnings: 2 })
    const lines = output.split('\n').map(classifyLine).filter((c) => problemSeverity(c))
    expect(lines.filter((c) => c.severity === 'error')).toHaveLength(2)
    expect(lines.filter((c) => c.severity === 'warning')).toHaveLength(2)
  })
})

describe('Problems: each warning once, errors first', () => {
  it('lists a missing Ricardian section once per action, with its place, and the empty clause file once', () => {
    // As cdt-cpp 4.1 prints it for a project without its two Ricardian files.
    const actions = ['create', 'issue']
    const output = [
      ...actions.map((a, i) => `/mnt/c/Users/me/proj/src/token.cpp:${i + 3}:18: warning: abigen warning (Action <${a}> does not have a ricardian contract)`),
      '2 warnings generated.',
      'Warning, empty ricardian clause file',
      'Warning, empty ricardian clause file',
      ...actions.map((a) => `Warning, action <${a}> does not have a ricardian contract`),
      ...actions.map((a) => `Warning, action <${a}> does not have a ricardian contract`)
    ].join('\n')
    const p = parseProblems(output, ROOT)
    expect(p.map((x) => [x.file, x.line, x.message])).toEqual([
      ['src/token.cpp', 3, 'abigen warning (Action <create> does not have a ricardian contract)'],
      ['src/token.cpp', 4, 'abigen warning (Action <issue> does not have a ricardian contract)'],
      ['', 0, 'empty ricardian clause file']
    ])
    expect(countProblems(p)).toEqual({ errors: 0, warnings: 3 })
  })

  it('keeps a Ricardian warning without a place when the compiler gave none', () => {
    const p = parseProblems([ABIGEN_WARNING, ABIGEN_WARNING].join('\n'), ROOT)
    expect(p.map((x) => x.message)).toEqual(['action <hi> does not have a ricardian contract'])
  })

  it('keeps two different diagnostics at one place', () => {
    const base = { file: 'a.cpp', line: 1, column: 1, severity: 'error', source: 'build' }
    expect(uniqueProblems([{ ...base, message: 'x' }, { ...base, message: 'y' }, { ...base, message: 'x' }])).toHaveLength(2)
  })

  it('orders errors before warnings before notes, the build order within each', () => {
    const list = [
      { severity: 'warning', id: 1 },
      { severity: 'info', id: 2 },
      { severity: 'warning', id: 3 },
      { severity: 'error', id: 4 },
      { severity: 'error', id: 5 }
    ]
    expect(orderProblems(list).map((x) => x.id)).toEqual([4, 5, 1, 3, 2])
  })
})

describe('Problems: an error inside the toolchain points at the project line', () => {
  const TC = '/usr/opt/cdt/4.1.1wax01/bin/../include/eosiolib'
  const first = (out: string): [string, number, number, string] => {
    const p = parseProblems(out, ROOT).find((x) => x.severity === 'error')!
    return [p.file, p.line, p.column, p.message]
  }

  it('mi-3: a name longer than 12 characters in "..."_n is placed at the literal in the header', () => {
    const out = [
      `${TC}/contracts/eosio/../../core/eosio/name.hpp:324:19: error: constexpr variable 'x' must be initialized by a constant expression`,
      "./include/mytoken.hpp:123:47: note: in instantiation of function template specialization 'operator\"\"_n<char, 'a', 'c'>' requested here",
      `${TC}/contracts/eosio/../../core/eosio/name.hpp:81:13: note: non-constexpr function 'check' cannot be used in a constant expression`,
      './include/mytoken.hpp:123:30: error: non-type template argument is not a constant expression'
    ].join('\n')
    expect(first(out)).toEqual(['include/mytoken.hpp', 123, 47, "constexpr variable 'x' must be initialized by a constant expression [name.hpp:324]"])
    const errors = parseProblems(out, ROOT).filter((x) => x.severity === 'error')
    expect(errors.map((x) => [x.file, x.line, x.column])).toEqual([
      ['include/mytoken.hpp', 123, 47],
      ['include/mytoken.hpp', 123, 30]
    ])
  })

  it('mi-5: a row without primary_key is placed at the table declaration', () => {
    const out = [
      `${TC}/contracts/eosio/multi_index.hpp:442:96: error: no member named 'primary_key' in 'mytoken::account'`,
      "./include/mytoken.hpp:95:14: note: in instantiation of template class 'eosio::multi_index<3607749779137757184, mytoken::account>' requested here",
      `${TC}/contracts/eosio/multi_index.hpp:1820:31: error: no member named 'primary_key' in 'eosio::multi_index<3607749779137757184, mytoken::account>::item'`,
      "./include/mytoken.hpp:96:29: note: in instantiation of function template specialization 'eosio::multi_index<3607749779137757184, mytoken::account>::find<unsigned long long>' requested here"
    ].join('\n')
    const errors = parseProblems(out, ROOT).filter((x) => x.severity === 'error')
    expect(errors.map((x) => [x.file, x.line, x.column])).toEqual([
      ['include/mytoken.hpp', 95, 14],
      ['include/mytoken.hpp', 96, 29]
    ])
    expect(errors[0].message).toBe("no member named 'primary_key' in 'mytoken::account' [multi_index.hpp:442]")
  })

  it('mi-6: find() with a string takes the first project note after each error', () => {
    const out = [
      `${TC}/contracts/eosio/multi_index.hpp:1820:45: error: comparison between pointer and integer ('uint64_t' (aka 'unsigned long long') and 'const char *')`,
      "src/mytoken.cpp:12:30: note: in instantiation of function template specialization 'eosio::multi_index<14289235522390851584, mytoken::currency_stats>::find<const char *>' requested here",
      `${TC}/contracts/eosio/multi_index.hpp:338:47: error: cannot initialize return object of type 'uint64_t' (aka 'unsigned long long') with an lvalue of type 'const char *'`,
      `${TC}/contracts/eosio/multi_index.hpp:1825:54: note: in instantiation of function template specialization 'eosio::_multi_index_detail::to_raw_key<const char *>' requested here`,
      "src/mytoken.cpp:12:30: note: in instantiation of function template specialization 'eosio::multi_index<14289235522390851584, mytoken::currency_stats>::find<const char *>' requested here",
      'Error while processing src/mytoken.cpp.',
      'abigen error'
    ].join('\n')
    const errors = parseProblems(out, ROOT).filter((x) => x.severity === 'error')
    expect(errors.slice(0, 2).map((x) => [x.file, x.line, x.column])).toEqual([
      ['src/mytoken.cpp', 12, 30],
      ['src/mytoken.cpp', 12, 30]
    ])
    expect(errors[0].message.endsWith('[multi_index.hpp:1820]')).toBe(true)
    expect(errors[1].message.endsWith('[multi_index.hpp:338]')).toBe(true)
  })

  it('mi-9: a pointer in a row is placed at the first project note, skipping toolchain notes', () => {
    // The probe recorded the first eight lines only; the project note is the line the compiler prints after them.
    const out = [
      `${TC}/contracts/eosio/../../core/eosio/datastream.hpp:614:4: error: static_assert failed due to requirement '!_datastream_detail::is_pointer()' "Pointers should not be serialized"`,
      `${TC}/contracts/eosio/../../core/eosio/datastream.hpp:985:10: note: in instantiation of function template specialization 'eosio::operator>><const char *, const char *, nullptr>' requested here`,
      `${TC}/../include/bluegrass/meta/for_each.hpp:819:13: note: in instantiation of function template specialization 'bluegrass::meta::detail::for_each_field_impl_apply<const char *&>' requested here`,
      `${TC}/contracts/eosio/multi_index.hpp:822:16: note: in instantiation of function template specialization 'eosio::operator>><eosio::datastream<const char *>, mytoken::account, nullptr>' requested here`,
      "/usr/opt/cdt/4.1.1wax01/bin/../include/libcxx/memory:3003:32: note: in instantiation of function template specialization 'item::item' requested here",
      "./include/mytoken.hpp:96:29: note: in instantiation of function template specialization 'eosio::multi_index<3607749779137757184, mytoken::account>::find<unsigned long long>' requested here"
    ].join('\n')
    expect(first(out)).toEqual([
      'include/mytoken.hpp',
      96,
      29,
      `static_assert failed due to requirement '!_datastream_detail::is_pointer()' "Pointers should not be serialized" [datastream.hpp:614]`
    ])
  })

  it('name-5: an error that is already in the project stays as it is', () => {
    const out = [
      "src/mytoken.cpp:18:7: error: no member named 'isuer' in 'mytoken::currency_stats'",
      `${TC}/contracts/eosio/multi_index.hpp:1579:13: note: in instantiation of function template specialization 'x' requested here`,
      "src/mytoken.cpp:15:14: note: in instantiation of function template specialization 'y' requested here"
    ].join('\n')
    expect(first(out)).toEqual(['src/mytoken.cpp', 18, 7, "no member named 'isuer' in 'mytoken::currency_stats'"])
  })

  it('stays as it is without a project note, and a note after the next error is not taken', () => {
    const out = [
      `${TC}/core/eosio/check.hpp:66:16: error: something deep`,
      `${TC}/core/eosio/name.hpp:81:13: note: in call to 'name()'`,
      'src/a.cpp:3:1: error: second',
      "src/a.cpp:9:9: note: in instantiation of template class 'z' requested here"
    ].join('\n')
    const p = parseProblems(out, ROOT).filter((x) => x.severity === 'error')
    expect(p[0].file).toBe(`${TC}/core/eosio/check.hpp`)
    expect(p[0].message).toBe('something deep')
    expect(p[1].file).toBe('src/a.cpp')
  })

  it('takes an "in call to" note too, and leaves a Windows path outside the project alone', () => {
    const list = [
      { file: '/usr/x/h.hpp', line: 5, column: 1, severity: 'error', message: 'bad', source: 'build' },
      { file: 'src/a.cpp', line: 2, column: 3, severity: 'info', message: "in call to 'f()'", source: 'build' }
    ]
    expect(placeToolchainProblems(list)[0]).toMatchObject({ file: 'src/a.cpp', line: 2, column: 3, message: 'bad [h.hpp:5]' })
    expect(placeToolchainProblems([{ ...list[0], file: 'D:/other/h.hpp' }, list[1]])[0].file).toBe('src/a.cpp')
  })
})

describe('name rule errors of the build', () => {
  it('knows the two refusals of the ABI generator', () => {
    expect(isNameRuleError('abigen error (name not properly normalized)')).toBe(true)
    expect(isNameRuleError('abigen error (Name {averyveryverylongaction} is more than 13 characters long)')).toBe(true)
    expect(isNameRuleError("no member named 'x' in 'y'")).toBe(false)
    expect(NAME_HINT).toContain('do not end with a dot')
  })
})
