// Project folder rules: .git refusal (including other spellings), untrusted project values,
// the .wasm size limit, the notice about replaced values and the expected-stamp check on write.

import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, utimesSync, writeFileSync, ftruncateSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  data: '',
  handlers: new Map<string, (e: unknown, ...a: unknown[]) => Promise<unknown>>()
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => h.data,
    getAppPath: () => h.data,
    getVersion: () => '0.0.0',
    on: () => undefined
  },
  ipcMain: { handle: (ch: string, fn: (e: unknown, ...a: unknown[]) => Promise<unknown>) => h.handlers.set(ch, fn) },
  dialog: {},
  shell: {},
  protocol: {},
  session: {},
  net: {},
  utilityProcess: {},
  BrowserWindow: class {}
}))

import {
  createEntry,
  openProject,
  readProjectBytes,
  refuseGitPath,
  removeEntry,
  renameEntry,
  setMainFile,
  statProjectFile,
  writeProjectFile
} from '../../src/main/projects'
import { registerIpc } from '../../src/main/ipc'
import { openNotices } from '../../src/main/project-notices'
import { defaultBuildCommand, normalizeConfig, replacedConfigValues, replacedEosprojValues } from '../../src/shared/project'

let base: string
let root: string

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'waxm-hard-'))
  h.data = join(base, 'data')
  mkdirSync(h.data)
  root = join(base, 'proj')
  mkdirSync(join(root, 'src'), { recursive: true })
  mkdirSync(join(root, '.git', 'hooks'), { recursive: true })
  writeFileSync(join(root, 'src', 'a.cpp'), 'int x;')
  writeFileSync(join(root, '.git', 'config'), '')
  openProject(root)
  registerIpc(() => null)
})

afterAll(() => {
  rmSync(base, { recursive: true, force: true })
})

const GIT_PATHS = ['.git/hooks/pre-commit', '.GIT/hooks/x', '.Git/config', 'GIT~1/hooks/x', 'git~1/hooks/x', 'GIT~2', 'src/../.git/x', 'a\\.git\\x', 'sub/.git/hooks/x', 'sub/GIT~1']
const OK_PATHS = ['src/a.cpp', 'gitignore.txt', 'src/git.cpp', 'src/GIT~.cpp', 'src/mygit~1', '.github/workflows/x.yml', '.gitignore']

describe('.git refusal', () => {
  it('refuseGitPath refuses .git in any case, with either slash, and its short name GIT~1 (and GIT~n)', () => {
    for (const p of GIT_PATHS) expect(() => refuseGitPath(p), p).toThrow(/\.git/)
    for (const p of OK_PATHS) expect(() => refuseGitPath(p), p).not.toThrow()
  })
  it('write, create, rename (both names) and remove refuse those paths', async () => {
    for (const p of ['.git/hooks/x', '.GIT/hooks/x', 'GIT~1/hooks/x']) {
      await expect(writeProjectFile(p, 'x'), `write ${p}`).rejects.toThrow('.git')
      await expect(createEntry(p, false), `create ${p}`).rejects.toThrow('.git')
      await expect(createEntry(p, true), `create dir ${p}`).rejects.toThrow('.git')
      await expect(renameEntry(p, 'src/b.cpp'), `rename from ${p}`).rejects.toThrow('.git')
      await expect(renameEntry('src/a.cpp', p), `rename to ${p}`).rejects.toThrow('.git')
      await expect(removeEntry(p), `remove ${p}`).rejects.toThrow('.git')
    }
    // Nothing was created or moved.
    expect((await statProjectFile('src/a.cpp'))?.size).toBe(6)
    expect(await statProjectFile('.git/hooks/x')).toBeNull()
  })
  it('the handlers refuse the same paths', async () => {
    const ev = { senderFrame: { url: 'app://bundle/index.html' } } as { senderFrame: { url: string }; sender?: unknown }
    ev.sender = { mainFrame: ev.senderFrame, send: () => undefined, isDestroyed: () => false }
    for (const [channel, args] of [
      ['files:write', ['GIT~1/hooks/x', 'x']],
      ['files:create', ['.GIT/hooks/x', false]],
      ['files:rename', ['src/a.cpp', 'GIT~1/x']],
      ['files:remove', ['.git/config']]
    ] as [string, unknown[]][]) {
      await expect(h.handlers.get(channel)!(ev, ...args), channel).rejects.toThrow('.git')
    }
  })
})

describe('untrusted values in waxmaster.json', () => {
  it('replaces /mnt/c/x and option-like values by their defaults', () => {
    const c = normalizeConfig(
      {
        main: '/mnt/c/x.cpp',
        include: '/mnt/c/x',
        resource: '--abigen_output=x',
        output: '--abigen_output=x.wasm',
        contract: 'abc'
      },
      'hello'
    )
    expect(c.main).toBe('src/abc.cpp')
    expect(c.include).toBe('')
    expect(c.resource).toBe('')
    expect(c.output).toBe('')
    expect(defaultBuildCommand(c)).toBe('cdt-cpp -abigen -I ./include -R ./resource -contract abc -o ./abc.wasm src/abc.cpp')
  })
  it('replaces a main file that is an option or sits behind an option-like folder', () => {
    expect(normalizeConfig({ main: '--abigen_output=x.cpp' }, 'hello').main).toBe('src/hello.cpp')
    expect(normalizeConfig({ main: 'src/--abigen_output=x/a.cpp' }, 'hello').main).toBe('src/hello.cpp')
    expect(normalizeConfig({ main: 'src/a.cpp' }, 'hello').main).toBe('src/a.cpp')
  })
  it('reports the replaced names and nothing for empty, missing or good values', () => {
    expect(replacedConfigValues({ main: '/mnt/c/x.cpp', include: '--x', resource: 'res', output: 'a.bin', contract: 'Bad', deploy: { target: 'zip' } })).toEqual([
      'contract',
      'main',
      'include',
      'output',
      'deploy.target'
    ])
    expect(replacedConfigValues({})).toEqual([])
    expect(replacedConfigValues({ main: '', include: '', output: '' })).toEqual([])
    expect(replacedConfigValues({ main: 'src/a.cpp', output: 'a.wasm', contract: 'abc', cdt: 'wax-cdt-4.1.1wax01', deploy: { target: 'wasm' } })).toEqual([])
    expect(replacedConfigValues({ main: 7 })).toEqual(['main'])
  })
})

describe('untrusted values in .eosproj', () => {
  let eos: string

  beforeAll(() => {
    eos = join(base, 'eos')
    mkdirSync(join(eos, 'src'), { recursive: true })
    writeFileSync(join(eos, 'src', 'a.cpp'), 'int x;')
    writeFileSync(
      join(eos, '.eosproj'),
      JSON.stringify({
        main: '--abigen_output=x.cpp',
        contract: 'abc',
        include: '/mnt/c/x',
        resource: '--abigen_output=x',
        output: '/mnt/c/x.wasm',
        scripts: { build: 'cdt-cpp x' }
      })
    )
  })

  it('does not offer an unsafe main file and does not import unsafe folders', () => {
    const p = openProject(eos)
    expect(p.needsMainFile).toBe(true)
    expect(p.candidates).toEqual(['src/a.cpp'])
    const set = setMainFile('src/a.cpp')
    expect(set.config.include).toBe('')
    expect(set.config.resource).toBe('')
    expect(set.config.output).toBe('')
    expect(set.config.contract).toBe('abc')
  })
  it('gives one notice that names the left-out values', () => {
    const rmEos = join(base, 'eos2')
    mkdirSync(rmEos)
    writeFileSync(join(rmEos, '.eosproj'), JSON.stringify({ main: '--x.cpp', include: '/mnt/c/x', resource: 'res', contract: 'ok' }))
    const n = openNotices(rmEos)
    expect(n).toHaveLength(1)
    expect(n[0]).toContain('.eosproj')
    expect(n[0]).toContain('main, include')
    expect(n[0]).not.toContain('resource')
    expect(replacedEosprojValues({ main: 'src/a.cpp', include: 'include', output: 'a.wasm', contract: 'abc' })).toEqual([])
    expect(replacedEosprojValues({ output: '--abigen_output=x', contract: 'BAD NAME' })).toEqual(['output', 'contract'])
  })
  it('gives one notice for waxmaster.json and none for a good one', () => {
    const d = join(base, 'cfg')
    mkdirSync(d)
    writeFileSync(join(d, 'waxmaster.json'), JSON.stringify({ main: 'src/a.cpp', include: '/mnt/c/x', output: '--abigen_output=x.wasm' }))
    const n = openNotices(d)
    expect(n).toHaveLength(1)
    expect(n[0]).toContain('waxmaster.json: include, output')
    writeFileSync(join(d, 'waxmaster.json'), JSON.stringify({ main: 'src/a.cpp' }))
    expect(openNotices(d)).toEqual([])
    expect(openNotices(join(base, 'does-not-exist'))).toEqual([])
  })
})

describe('.wasm size limit', () => {
  it('reads a file at the limit and refuses one byte over 50 MB', async () => {
    openProject(root)
    const limit = 50 * 1024 * 1024
    const fd = openSync(join(root, 'big.wasm'), 'w')
    ftruncateSync(fd, limit + 1)
    closeSync(fd)
    await expect(readProjectBytes('big.wasm')).rejects.toThrow('larger than 50 MB')
    const fd2 = openSync(join(root, 'ok.wasm'), 'w')
    ftruncateSync(fd2, 1024)
    closeSync(fd2)
    expect((await readProjectBytes('ok.wasm')).length).toBe(1024)
    await expect(readProjectBytes('ok.wasm', 512)).rejects.toThrow('larger than')
  })
  it('files:wasmInfo goes through the same limit', async () => {
    const ev = { senderFrame: { url: 'app://bundle/index.html' } } as { senderFrame: { url: string }; sender?: unknown }
    ev.sender = { mainFrame: ev.senderFrame, send: () => undefined, isDestroyed: () => false }
    await expect(h.handlers.get('files:wasmInfo')!(ev, 'big.wasm')).rejects.toThrow('larger than 50 MB')
  })
})

describe('files:write with an expected stamp', () => {
  const ev = { senderFrame: { url: 'app://bundle/index.html' } } as { senderFrame: { url: string }; sender?: unknown }
  ev.sender = { mainFrame: ev.senderFrame, send: () => undefined, isDestroyed: () => false }
  const write = (...a: unknown[]): Promise<unknown> => h.handlers.get('files:write')!(ev, ...a)

  it('writes when the stamp matches, refuses with "changed on disk" when it does not', async () => {
    openProject(root)
    const first = (await write('src/w.cpp', 'one')) as { mtimeMs: number; size: number }
    const second = (await write('src/w.cpp', 'two', first)) as { mtimeMs: number; size: number }
    expect(readFileSync(join(root, 'src', 'w.cpp'), 'utf8')).toBe('two')
    // Someone else changes the file (same size, another time).
    const t = new Date(second.mtimeMs + 5000)
    utimesSync(join(root, 'src', 'w.cpp'), t, t)
    await expect(write('src/w.cpp', 'three', second)).rejects.toThrow('changed on disk')
    expect(readFileSync(join(root, 'src', 'w.cpp'), 'utf8')).toBe('two')
    // A changed size is refused too.
    writeFileSync(join(root, 'src', 'w.cpp'), 'longer text')
    const now = (await statProjectFile('src/w.cpp'))!
    await expect(write('src/w.cpp', 'four', { mtimeMs: now.mtimeMs, size: now.size + 1 })).rejects.toThrow('changed on disk')
    // With the stamp of what is on disk now, the write goes through.
    await write('src/w.cpp', 'five', now)
    expect(readFileSync(join(root, 'src', 'w.cpp'), 'utf8')).toBe('five')
  })
  it('without a stamp the write is unchanged; a missing file is created; bad stamps are refused', async () => {
    await write('src/n.cpp', 'new')
    await write('src/gone.cpp', 'recreated', { mtimeMs: 1, size: 1 })
    expect(readFileSync(join(root, 'src', 'gone.cpp'), 'utf8')).toBe('recreated')
    await expect(write('src/n.cpp', 'x', 'text')).rejects.toThrow()
    await expect(write('src/n.cpp', 'x', { mtimeMs: 'now', size: 1 })).rejects.toThrow()
    await expect(write('src/n.cpp', 'x', { mtimeMs: 1, size: -1 })).rejects.toThrow()
    await expect(write('src/n.cpp', 'x', { mtimeMs: 1 })).rejects.toThrow()
    expect(readFileSync(join(root, 'src', 'n.cpp'), 'utf8')).toBe('new')
  })
})
