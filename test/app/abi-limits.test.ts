// Limits of the ABI check: an ABI above the Deploy size limit is not checked,
// at most 50 findings are explained (the rest in one line), the source search
// reads at most 32 MB and leaves very long lines out.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'wm-abilim-'))
const h = vi.hoisted(() => ({ abiText: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => userData, isPackaged: false, getAppPath: () => process.cwd() },
  BrowserWindow: { fromWebContents: () => null },
  dialog: { showMessageBox: async () => ({ response: 0 }) }
}))

vi.mock('../../src/main/toolchain', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  return {
    // The compile writes the WASM and the ABI the test chose.
    buildProject: async (root: string) => {
      fs.writeFileSync(path.join(root, 'game.wasm'), 'w')
      fs.writeFileSync(path.join(root, 'game.abi'), h.abiText)
      return { code: 0, output: '' }
    },
    buildProjectShell: async () => ({ code: 0, output: '' }),
    fromWslPath: () => null,
    toolchainForProject: () => ({ id: 'wax-cdt-4.1.1wax01', fallback: false })
  }
})

import { MAX_ABI_JSON, MAX_EXPLAINED_FINDINGS, MAX_SEARCH_LINE, MAX_SOURCE_TOTAL, checkAbi, describeAbi, findPlace, moreFindingsLine, readSources } from '../../src/main/abi-check'
import { abiRefusal, runBuild } from '../../src/main/build'
import { openProject } from '../../src/main/projects'

/** An ABI with `n` tables whose struct is missing. */
function brokenAbi(n: number): string {
  const tables = Array.from({ length: n }, (_, i) => ({ name: `t${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`, type: `missing_${i}`, index_type: 'i64', key_names: [], key_types: [] }))
  return JSON.stringify({ version: 'eosio::abi/1.2', types: [], structs: [], actions: [], tables, ricardian_clauses: [], variants: [] })
}

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'wm-abilim-p-'))
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src', 'game.cpp'), 'int x;')
  writeFileSync(join(root, 'waxmaster.json'), JSON.stringify({ main: 'src/game.cpp', contract: 'game' }))
  return root
}

let output: string[] = []
const sender = { isDestroyed: () => false, send: (_ch: string, m: { text?: string }) => m?.text !== undefined && output.push(m.text) } as never

beforeEach(() => {
  output = []
})

describe('ABI size limit', () => {
  it('an ABI above the Deploy size limit is not checked; one Output line says so', async () => {
    openProject(project())
    h.abiText = brokenAbi(1) + ' '.repeat(MAX_ABI_JSON)
    const r = await runBuild(sender)
    expect(r.ok).toBe(true)
    expect(r.abiFindings).toEqual([])
    const lines = output.join('').split('\n').filter((l) => l.startsWith('ABI check'))
    expect(lines).toEqual(['ABI check skipped: game.abi is larger than 2 MB.'])
  })
})

describe('at most 50 findings are explained', () => {
  it('describeAbi explains 50; the rest are one line', () => {
    const text = brokenAbi(60)
    expect(checkAbi(text)).toHaveLength(60)
    expect(describeAbi(text, 'game.abi', [])).toHaveLength(MAX_EXPLAINED_FINDINGS)
    expect(moreFindingsLine(60)).toBe('ABI check: and 10 more of the same kind')
    expect(moreFindingsLine(50)).toBeNull()
  })

  it('the build shows 50 explanations and the one line, stores the same 50, and Deploy repeats the line', async () => {
    const root = project()
    openProject(root)
    h.abiText = brokenAbi(60)
    const r = await runBuild(sender)
    expect(r.outcome).toBe('abi-not-deployable')
    expect(r.abiFindings).toHaveLength(50)
    const all = output.join('')
    expect(all.split('\n').filter((l) => /^ABI check: table /.test(l))).toHaveLength(50)
    expect(all).toContain('ABI check: and 10 more of the same kind\n')
    const refusal = await abiRefusal(root, 'game.abi', h.abiText)
    expect(refusal).toContain('ABI check: and 10 more of the same kind')
    expect(refusal!.split('\n').filter((l) => /^ABI check: table /.test(l))).toHaveLength(50)
  })
})

describe('source search limits', () => {
  it('leaves lines longer than 2,000 characters out of the search and keeps the line numbers', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wm-abilim-s-'))
    const long = `struct missing_0 {}; // ${'x'.repeat(MAX_SEARCH_LINE)}`
    writeFileSync(join(root, 'a.hpp'), `${long}\nint y;\nstruct missing_0 { int z; };\n`)
    const sources = await readSources(root)
    expect(sources[0].lines[0]).toBe('')
    const place = findPlace(checkAbi(brokenAbi(1))[0], sources)
    expect(place).toMatchObject({ file: 'a.hpp', line: 3 })
  })

  it('reads at most 32 MB of sources in total', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wm-abilim-t-'))
    // Ten files of 4,000,000 bytes (long lines: they are left out of the search, so the arrays stay small).
    const line = 'y'.repeat(3999) + '\n'
    const body = line.repeat(1000)
    for (let i = 0; i < 10; i++) writeFileSync(join(root, `f${i}.hpp`), body)
    const sources = await readSources(root)
    expect(sources.length).toBe(Math.floor(MAX_SOURCE_TOTAL / Buffer.byteLength(body)))
    expect(sources.length).toBeLessThan(10)
  })
})
