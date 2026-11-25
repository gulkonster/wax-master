import { describe, expect, it } from 'vitest'
import type { Problem } from '../../src/shared/api'
import { mergeProblems } from '../../src/shared/problems-merge'

const P = (file: string, line: number, severity: Problem['severity'], source: Problem['source'], message = 'm', column = 1): Problem => ({
  file,
  line,
  column,
  severity,
  message,
  source
})
const none = new Set<string>()

describe('mergeProblems', () => {
  it('the same error from build and editor is one row (the editor row stays)', () => {
    const out = mergeProblems([P('src/a.cpp', 4, 'error', 'build', 'expected ;', 1)], [P('src/a.cpp', 4, 'error', 'editor', "Expected ';' after expression", 26)], none)
    expect(out).toHaveLength(1)
    expect(out[0].source).toBe('editor')
  })

  it('a different severity or line is not the same problem', () => {
    const out = mergeProblems([P('src/a.cpp', 4, 'warning', 'build'), P('src/a.cpp', 5, 'error', 'build')], [P('src/a.cpp', 4, 'error', 'editor')], none)
    expect(out).toHaveLength(3)
  })

  it('a build problem of a changed file is gone, other files stay', () => {
    const out = mergeProblems([P('src/a.cpp', 4, 'error', 'build'), P('src/b.cpp', 2, 'error', 'build')], [], new Set(['src/a.cpp']))
    expect(out.map((p) => p.file)).toEqual(['src/b.cpp'])
  })

  it('live problems of a changed file stay', () => {
    const out = mergeProblems([], [P('src/a.cpp', 4, 'error', 'editor')], new Set(['src/a.cpp']))
    expect(out).toHaveLength(1)
  })

  it('a problem without a place stays, also when files changed', () => {
    const out = mergeProblems([P('', 0, 'error', 'build', 'linker'), P('', 0, 'error', 'abi', 'abi')], [P('src/a.cpp', 1, 'error', 'editor')], new Set(['src/a.cpp', '']))
    expect(out.map((p) => p.message)).toEqual(['m', 'linker', 'abi'])
  })

  it('order: errors, warnings, notes; then file and line; no place last in its group; counts add up', () => {
    const build = [P('src/b.cpp', 1, 'info', 'build'), P('', 0, 'error', 'build', 'linker'), P('src/b.cpp', 9, 'error', 'build'), P('src/a.cpp', 3, 'warning', 'build')]
    const live = [P('src/b.cpp', 2, 'error', 'editor'), P('src/a.cpp', 7, 'error', 'editor')]
    const out = mergeProblems(build, live, none)
    expect(out.map((p) => `${p.severity}:${p.file}:${p.line}`)).toEqual([
      'error:src/a.cpp:7',
      'error:src/b.cpp:2',
      'error:src/b.cpp:9',
      'error::0',
      'warning:src/a.cpp:3',
      'info:src/b.cpp:1'
    ])
    expect(out).toHaveLength(build.length + live.length)
  })

  it('does not change its inputs', () => {
    const build = [P('src/b.cpp', 9, 'error', 'build'), P('src/a.cpp', 1, 'error', 'build')]
    mergeProblems(build, [], none)
    expect(build[0].file).toBe('src/b.cpp')
  })
})
