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
