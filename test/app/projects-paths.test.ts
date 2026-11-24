import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const h = vi.hoisted(() => ({ data: '' }))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => h.data,
    getAppPath: () => h.data,
    on: () => undefined
  }
}))

import { openProject, registerExternal, resolveInProject } from '../../src/main/projects'

let base: string
let root: string
let outside: string

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'waxm-'))
  h.data = join(base, 'data')
  mkdirSync(h.data)
  root = join(base, 'proj')
  outside = join(base, 'outside')
  mkdirSync(join(root, 'src'), { recursive: true })
  mkdirSync(outside)
  writeFileSync(join(outside, 'secret.txt'), 'x')
  writeFileSync(join(root, 'src', 'a.cpp'), 'int x;')
  symlinkSync(outside, join(root, 'link'), 'junction')
  openProject(root)
})

afterAll(() => {
  rmSync(base, { recursive: true, force: true })
})

describe('resolveInProject', () => {
  it('resolves a normal and a not-yet-existing nested path', () => {
    expect(resolveInProject('src/a.cpp')).toBe(join(root, 'src', 'a.cpp'))
    expect(resolveInProject('src/new/deeper/b.cpp')).toBe(join(root, 'src', 'new', 'deeper', 'b.cpp'))
  })
  it('refuses ..', () => {
    expect(() => resolveInProject('../outside/secret.txt')).toThrow()
    expect(() => resolveInProject('src/../../outside')).toThrow()
  })
  it('refuses an absolute path', () => {
    expect(() => resolveInProject(join(outside, 'secret.txt'))).toThrow()
  })
  it('refuses a junction pointing outside the project', () => {
    expect(() => resolveInProject('link/secret.txt')).toThrow()
    expect(() => resolveInProject('link/new/file.txt')).toThrow()
  })
})

describe('registerExternal', () => {
  it('reads a small text file', () => {
    const f = join(base, 'ok.txt')
    writeFileSync(f, 'hello')
    expect(registerExternal(f).content).toBe('hello')
  })
  it('refuses a binary file', () => {
    const f = join(base, 'bin.dat')
    writeFileSync(f, Buffer.from([1, 2, 0, 3]))
    expect(() => registerExternal(f)).toThrow(/binary/)
  })
  it('refuses a file over 5 MB', () => {
    const f = join(base, 'big.txt')
    writeFileSync(f, Buffer.alloc(5 * 1024 * 1024 + 1, 97))
    expect(() => registerExternal(f)).toThrow(/too large/)
  })
})
