import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BuildStateStore, projectFingerprint } from '../../src/main/build-state'

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'wm-fp-'))
  mkdirSync(join(root, 'src'))
  mkdirSync(join(root, '.git'))
  writeFileSync(join(root, 'src', 'hello.cpp'), 'int x;')
  writeFileSync(join(root, 'waxmaster.json'), '{}')
  writeFileSync(join(root, 'hello.wasm'), 'w')
  writeFileSync(join(root, 'hello.abi'), '{}')
  writeFileSync(join(root, '.git', 'HEAD'), 'ref')
  return root
}

const opts = { exclude: ['hello.wasm', 'hello.abi'], command: 'cdt-cpp -abigen', toolchain: 'wax-cdt-4.1.1wax01' }

describe('build fingerprint', () => {
  it('is stable while nothing changes', async () => {
    const root = project()
    expect(await projectFingerprint(root, opts)).toBe(await projectFingerprint(root, opts))
  })

  it('ignores the outputs and .git', async () => {
    const root = project()
    const before = await projectFingerprint(root, opts)
    writeFileSync(join(root, 'hello.wasm'), 'new code')
    writeFileSync(join(root, 'hello.abi'), '{"x":1}')
    writeFileSync(join(root, '.git', 'HEAD'), 'other')
    writeFileSync(join(root, '.git', 'index'), 'i')
    expect(await projectFingerprint(root, opts)).toBe(before)
  })

  it('changes with a source size, a modified time, a new file, the command or the toolchain', async () => {
    const root = project()
    const base = await projectFingerprint(root, opts)
    writeFileSync(join(root, 'src', 'hello.cpp'), 'int xy;')
    const sized = await projectFingerprint(root, opts)
    expect(sized).not.toBe(base)
    utimesSync(join(root, 'src', 'hello.cpp'), new Date(2020, 1, 1), new Date(2020, 1, 1))
    const timed = await projectFingerprint(root, opts)
    expect(timed).not.toBe(sized)
    writeFileSync(join(root, 'src', 'other.hpp'), '')
    const added = await projectFingerprint(root, opts)
    expect(added).not.toBe(timed)
    expect(await projectFingerprint(root, { ...opts, command: 'cdt-cpp -abigen -O3' })).not.toBe(added)
    expect(await projectFingerprint(root, { ...opts, toolchain: 'cdt-4.1.1' })).not.toBe(added)
  })
})

describe('stored build state', () => {
  it('keeps the result per project in memory and in the file, and reads it back', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wm-bs-'))
    const file = join(dir, 'build-state.json')
    const a = new BuildStateStore(() => file)
    const finding = { kind: 'table-type' as const, subject: 'coinconf', type: 'land_coinconf_s', text: 'ABI check: ...', place: { file: 'include/a.hpp', line: 3, column: 1 } }
    a.set('C:\\Proj\\One', { fingerprint: 'f1', result: 'abi-not-deployable', builtAt: 5, toolchain: 't', command: 'c', abiFindings: [finding], abiSha256: 'h' })
    const b = new BuildStateStore(() => file)
    expect(b.get('c:\\proj\\one\\')).toMatchObject({ fingerprint: 'f1', result: 'abi-not-deployable', abiFindings: [finding], abiSha256: 'h' })
    expect(b.get('C:\\Proj\\Two')).toBeNull()
    expect(JSON.parse(readFileSync(file, 'utf8')).version).toBe(1)
  })

  it('drops broken entries of the file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wm-bs-'))
    const file = join(dir, 'build-state.json')
    writeFileSync(file, JSON.stringify({ version: 1, projects: { 'c:\\x': { result: 'maybe', builtAt: 1, fingerprint: 'a' } } }))
    expect(new BuildStateStore(() => file).get('C:\\x')).toBeNull()
  })
})

describe('project file in the fingerprint', () => {
  const config = (deploy: unknown, extra: Record<string, unknown> = {}): string =>
    JSON.stringify({ main: 'src/hello.cpp', contract: 'hello', buildCommand: '', ...extra, ...(deploy === undefined ? {} : { deploy }) }, null, 2)

  it('saving another deploy account, permission or target leaves the fingerprint equal', async () => {
    const root = project()
    writeFileSync(join(root, 'waxmaster.json'), config({ account: 'alice', permission: 'active', target: 'both' }))
    const base = await projectFingerprint(root, opts)
    writeFileSync(join(root, 'waxmaster.json'), config({ account: 'bobbyaccount', permission: 'owner', target: 'wasm' }))
    utimesSync(join(root, 'waxmaster.json'), new Date(2021, 1, 1), new Date(2021, 1, 1))
    expect(await projectFingerprint(root, opts)).toBe(base)
    // Key order and formatting do not count either.
    writeFileSync(join(root, 'waxmaster.json'), JSON.stringify({ deploy: { account: 'x' }, buildCommand: '', contract: 'hello', main: 'src/hello.cpp' }))
    expect(await projectFingerprint(root, opts)).toBe(base)
    writeFileSync(join(root, 'waxmaster.json'), config(undefined))
    expect(await projectFingerprint(root, opts)).toBe(base)
  })

  it('changing contract, main or buildCommand changes it', async () => {
    const root = project()
    writeFileSync(join(root, 'waxmaster.json'), config({ account: 'alice' }))
    const base = await projectFingerprint(root, opts)
    for (const extra of [{ contract: 'other' }, { main: 'src/other.cpp' }, { buildCommand: 'make' }]) {
      writeFileSync(join(root, 'waxmaster.json'), config({ account: 'alice' }, extra))
      expect(await projectFingerprint(root, opts)).not.toBe(base)
    }
  })

  it('an unparsable file counts by size and time; a waxmaster.json below the root counts like any file', async () => {
    const root = project()
    writeFileSync(join(root, 'waxmaster.json'), '{ not json')
    const a = await projectFingerprint(root, opts)
    utimesSync(join(root, 'waxmaster.json'), new Date(2020, 1, 1), new Date(2020, 1, 1))
    expect(await projectFingerprint(root, opts)).not.toBe(a)
    writeFileSync(join(root, 'src', 'waxmaster.json'), config({ account: 'alice' }))
    const b = await projectFingerprint(root, opts)
    writeFileSync(join(root, 'src', 'waxmaster.json'), config({ account: 'bobbyaccount' }))
    expect(await projectFingerprint(root, opts)).not.toBe(b)
  })
})

describe('stored findings read back', () => {
  const base = { kind: 'table-type', subject: 's', type: 't', text: 'ABI check: x' }
  function readBack(findings: unknown[]): { place: unknown; text: string }[] {
    const dir = mkdtempSync(join(tmpdir(), 'wm-bs-'))
    const file = join(dir, 'build-state.json')
    writeFileSync(file, JSON.stringify({ version: 1, projects: { 'c:\\p': { result: 'abi-not-deployable', builtAt: 1, fingerprint: 'a', abiFindings: findings } } }))
    return new BuildStateStore(() => file).get('C:\\p')!.abiFindings as unknown as { place: unknown; text: string }[]
  }

  it('keeps a place only with a relative path and whole line and column numbers of 1 or more', () => {
    const places = [
      { file: 'include/a.hpp', line: 3, column: 1 },
      { file: '../outside.hpp', line: 3, column: 1 },
      { file: 'include/../../x.hpp', line: 3, column: 1 },
      { file: 'C:\\Windows\\x.hpp', line: 3, column: 1 },
      { file: 'c:x.hpp', line: 3, column: 1 },
      { file: '/etc/passwd', line: 3, column: 1 },
      { file: '\\\\server\\share\\x.hpp', line: 3, column: 1 },
      { file: 'a.hpp', line: 0, column: 1 },
      { file: 'a.hpp', line: 1.5, column: 1 },
      { file: 'a.hpp', line: 2, column: -1 },
      { file: 'a.hpp', line: '2', column: 1 },
      { file: 7, line: 2, column: 1 }
    ]
    const got = readBack(places.map((place) => ({ ...base, place })))
    expect(got.map((f) => f.place)).toEqual([{ file: 'include/a.hpp', line: 3, column: 1 }, ...Array(places.length - 1).fill(null)])
  })

  it('cuts a stored text at 4,000 characters and keeps at most 50 findings', () => {
    const got = readBack(Array.from({ length: 80 }, () => ({ ...base, text: 'y'.repeat(10_000), place: null })))
    expect(got).toHaveLength(50)
    expect(got[0].text.length).toBe(4000)
  })
})
