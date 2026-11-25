import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '../..')
const LC = join(ROOT, 'resources', 'local-chain')

type Manifest = {
  source: { tag: string; commit: string; sha256: string; license: string }
  contracts: { name: string; files: { file: string; bytes: number; sha256: string }[] }[]
}

const manifest = JSON.parse(readFileSync(join(LC, 'contracts.json'), 'utf8')) as Manifest

describe('local chain contracts', () => {
  it('names the pinned source', () => {
    expect(manifest.source.tag).toBe('wax-3.4.1')
    expect(manifest.source.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(manifest.source.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(manifest.source.license).toBe('MIT')
  })

  it('lists the four contracts with a wasm and an abi each', () => {
    expect(manifest.contracts.map((c) => c.name)).toEqual(['eosio.boot', 'eosio.system', 'eosio.token', 'eosio.msig'])
    for (const c of manifest.contracts) expect(c.files.map((f) => f.file)).toEqual([`${c.name}.wasm`, `${c.name}.abi`])
  })

  it('the files match their recorded size and SHA-256', () => {
    for (const c of manifest.contracts) {
      for (const f of c.files) {
        const data = readFileSync(join(LC, 'contracts', f.file))
        expect(data.length).toBe(f.bytes)
        expect(createHash('sha256').update(data).digest('hex')).toBe(f.sha256)
      }
    }
  })

  it('the wasm files are WebAssembly and the abi files are Antelope ABIs', () => {
    for (const c of manifest.contracts) {
      expect([...readFileSync(join(LC, 'contracts', `${c.name}.wasm`)).subarray(0, 4)]).toEqual([0, 0x61, 0x73, 0x6d])
      const abi = JSON.parse(readFileSync(join(LC, 'contracts', `${c.name}.abi`), 'utf8')) as { version: string; actions: unknown[] }
      expect(abi.version).toMatch(/^eosio::abi\//)
      expect(abi.actions.length).toBeGreaterThan(0)
    }
  })
})

describe('local chain features', () => {
  const features = (JSON.parse(readFileSync(join(LC, 'features.json'), 'utf8')) as { features: string[] }).features

  it('holds the 19 features of WAX Mainnet in its order', () => {
    expect(features).toHaveLength(19)
    expect(new Set(features).size).toBe(19)
    expect(features[0]).toBe('PREACTIVATE_FEATURE')
    expect(features[18]).toBe('WEBAUTHN_KEY')
    for (const f of features) expect(f).toMatch(/^[A-Z0-9_]+$/)
  })
})

describe('local chain packaging', () => {
  it('ships the local-chain folder and lists the system contracts in the notices', () => {
    const yml = readFileSync(join(ROOT, 'electron-builder.yml'), 'utf8')
    expect(yml).toMatch(/- from: resources\n\s+to: resources\n\s+filter:\n\s+- 'templates\/\*\*'\n\s+- 'local-chain\/\*\*'\n/)
    expect(readFileSync(join(ROOT, 'THIRD_PARTY_NOTICES.md'), 'utf8')).toContain('wax-system-contracts wax-3.4.1')
  })
})
