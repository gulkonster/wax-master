import { describe, expect, it } from 'vitest'
import { normalizeConfig, defaultBuildCommand, safeProjectPath } from '../../src/shared/project'
import { wasmInfo } from '../../src/main/wasm-info'
import { classNameFor, templateFiles } from '../../src/main/templates'

describe('project files are untrusted', () => {
  it('drops paths that leave the project or look like options', () => {
    const c = normalizeConfig(
      { main: '../x.cpp', include: '-Xclang', resource: 'C:/Windows', output: '../escaped/out.bat', contract: 'Bad Name' },
      'hello'
    )
    expect(c.main).toBe('src/hello.cpp')
    expect(c.include).toBe('')
    expect(c.resource).toBe('')
    expect(c.output).toBe('')
    expect(c.contract).toBe('hello')
  })
  it('keeps valid values and prefixes paths with ./ in the command', () => {
    const c = normalizeConfig({ main: 'src\\a.cpp', output: 'build/a.wasm', contract: 'abc' }, 'x')
    expect(defaultBuildCommand(c)).toBe('cdt-cpp -abigen -I ./include -R ./resource -contract abc -o ./build/a.wasm ./src/a.cpp')
  })
  it('refuses option-like segments', () => {
    expect(safeProjectPath('src/-o.cpp')).toBe('')
    expect(safeProjectPath('./src/a.cpp')).toBe('src/a.cpp')
  })
})

describe('wasm reader on hostile input', () => {
  it('does not throw on garbage', () => {
    for (const b of [new Uint8Array(0), new Uint8Array([0, 0x61, 0x73, 0x6d]), new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 2, 0xff, 0xff, 0xff, 0xff, 0x0f]), new Uint8Array(1000).fill(0xff)]) {
      const r = wasmInfo(b)
      expect(r.valid).toBe(false)
    }
  })
  it('reads a minimal module with an import', () => {
    const name = (s: string): number[] => [s.length, ...Buffer.from(s)]
    const imp = [1, ...name('env'), ...name('prints'), 0, 0]
    const typeSec = [1, 4, 1, 0x60, 0, 0]
    const bytes = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, ...typeSec, 2, imp.length, ...imp])
    const r = wasmInfo(bytes)
    expect(r.valid).toBe(true)
    expect(r.imports).toEqual([{ module: 'env', name: 'prints', kind: 'function' }])
  })
})

describe('templates', () => {
  it('derive a valid class name', () => {
    expect(classNameFor('my.tok')).toBe('my_tok')
    expect(classNameFor('1abc')).toBe('c_1abc')
    const f = templateFiles('hello', 'my.tok')
    expect(f['include/my.tok.hpp']).toContain('[[eosio::contract("my.tok")]] my_tok')
  })
})
