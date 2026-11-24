import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '', isPackaged: false }, BrowserWindow: class {}, dialog: {} }))
import { classifyLine, countProblems, problemSeverity } from '../../src/shared/output-lines'
import { parseProblems } from '../../src/main/build'

const ROOT = 'C:\\Users\\me\\proj'

// Sample lines as the toolchain prints them.
const CLANG_ERROR = "/mnt/c/Users/me/proj/src/hello.cpp:12:5: error: use of undeclared identifier 'foo'"
const CLANG_FATAL = "/mnt/c/Users/me/proj/src/hello.cpp:1:10: fatal error: 'missing.hpp' file not found"
const CLANG_WARNING = '/mnt/c/Users/me/proj/src/hello.cpp:8:22: warning: abigen warning (Action <hi> does not have a ricardian contract)'
const CLANG_NOTE = "./include/hello.hpp:4:3: note: previous definition is here"
const ABIGEN_WARNING = 'Warning, action <hi> does not have a ricardian contract'
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
    ABIGEN_WARNING,
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
    expect(p[1].message).toBe('action <hi> does not have a ricardian contract')
  })

  it('gives the status bar the same counts as the coloured lines', () => {
    const p = parseProblems(output, ROOT)
    expect(countProblems(p)).toEqual({ errors: 2, warnings: 2 })
    const lines = output.split('\n').map(classifyLine).filter((c) => problemSeverity(c))
    expect(lines.filter((c) => c.severity === 'error')).toHaveLength(2)
    expect(lines.filter((c) => c.severity === 'warning')).toHaveLength(2)
  })
})
