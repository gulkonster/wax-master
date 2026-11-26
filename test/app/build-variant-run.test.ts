// E64: Build, Deploy's check and Rebuild compile the testnet or the mainnet build for the
// network, with the matching -D flag, and a stored build counts only for its own network.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'wm-variant-'))
const h = vi.hoisted(() => ({ calls: [] as string[][] }))

vi.mock('electron', () => ({
  app: { getPath: () => userData, isPackaged: false, getAppPath: () => process.cwd() },
  BrowserWindow: { fromWebContents: () => null },
  dialog: { showMessageBox: async () => ({ response: 0 }) }
}))

vi.mock('../../src/main/toolchain', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  return {
    buildProject: async (root: string, args: string[]) => {
      h.calls.push(args)
      fs.writeFileSync(path.join(root, 'game.wasm'), 'w')
      fs.writeFileSync(path.join(root, 'game.abi'), JSON.stringify({ version: 'eosio::abi/1.2', types: [], structs: [], actions: [], tables: [], ricardian_clauses: [], variants: [] }))
      return { code: 0, output: '' }
    },
    buildProjectShell: async () => ({ code: 0, output: '' }),
    fromWslPath: () => null,
    toolchainForProject: () => ({ id: 'wax-cdt-4.1.1wax01', fallback: false })
  }
})

import { ensureBuilt, runBuild } from '../../src/main/build'
import { openProject } from '../../src/main/projects'

function project(source: string): string {
  const root = mkdtempSync(join(tmpdir(), 'wm-variant-p-'))
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src', 'game.cpp'), source)
  writeFileSync(join(root, 'waxmaster.json'), JSON.stringify({ main: 'src/game.cpp', contract: 'game' }))
  return root
}

const sender = { isDestroyed: () => false, send: () => undefined } as never
const flags = (args: string[]): string[] => args.filter((a) => a.startsWith('-DWAXMASTER_'))

describe('testnet and mainnet builds in the build path (E64)', () => {
  it('sources without the macros: one build for every network, no flag, no rebuild when the network changes', async () => {
    openProject(project('int x;'))
    h.calls.length = 0
    const r = await runBuild(sender, 'wax-testnet')
    expect(r.variant).toBe('any')
    expect(flags(h.calls[0])).toEqual([])
    const again = await ensureBuilt(sender, 'wax-mainnet')
    expect(again.upToDate).toBe(true)
    expect(again.variant).toBe('any')
  })

  it('sources with the macros: the flag of the network; switching network builds again, the same network does not', async () => {
    openProject(project('#ifdef WAXMASTER_TESTNET\nint test_only;\n#endif\n'))
    h.calls.length = 0
    expect((await runBuild(sender, 'wax-testnet')).variant).toBe('testnet')
    expect(flags(h.calls[0])).toEqual(['-DWAXMASTER_TESTNET'])
    const main = await ensureBuilt(sender, 'wax-mainnet')
    expect(main.upToDate).toBe(false)
    expect(main.variant).toBe('mainnet')
    expect(flags(h.calls[1])).toEqual(['-DWAXMASTER_MAINNET'])
    const same = await ensureBuilt(sender, 'wax-mainnet')
    expect(same.upToDate).toBe(true)
    expect(h.calls).toHaveLength(2)
  })
})
