import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ dataDir: '' }))
vi.mock('electron', () => ({ app: { getPath: () => h.dataDir, isPackaged: false, getAppPath: () => h.dataDir }, BrowserWindow: class {}, dialog: {} }))
import { abiProblems, checkAbi, checkProjectAbi, describeAbi, explain, readSources } from '../../src/main/abi-check'
import { classifyLine } from '../../src/shared/output-lines'

const dir = join(__dirname, '../fixtures/abi')
const read = (name: string): string => readFileSync(join(dir, name), 'utf8')

const OK_ABI = JSON.stringify({
  version: 'eosio::abi/1.2',
  types: [{ new_type_name: 'ids', type: 'uint64[]' }],
  structs: [
    { name: 'base_s', base: '', fields: [{ name: 'id', type: 'uint64' }] },
    { name: 'row', base: 'base_s', fields: [{ name: 'list', type: 'ids' }, { name: 'q', type: 'asset?' }, { name: 'e', type: 'extended_asset$' }] },
    { name: 'hi', base: '', fields: [{ name: 'user', type: 'name' }] }
  ],
  actions: [{ name: 'hi', type: 'hi', ricardian_contract: '' }],
  tables: [{ name: 'rows', type: 'row', index_type: 'i64', key_names: [], key_types: [] }],
  ricardian_clauses: [],
  variants: [{ name: 'v', types: ['uint8', 'row'] }],
  action_results: [{ name: 'hi', result_type: 'row' }]
})

describe('ABI check', () => {
  it('accepts a consistent ABI', () => {
    expect(checkAbi(OK_ABI)).toEqual([])
  })

  it('finds a table whose struct is missing (table coinconf, type land_coinconf_s)', () => {
    const f = checkAbi(read('foreign-table.abi'))
    expect(f).toEqual([{ kind: 'table-type', subject: 'coinconf', type: 'land_coinconf_s' }])
  })

  it('collects every inconsistency, not only the first', () => {
    const f = checkAbi(read('many-faults.abi'))
    const keys = f.map((x) => `${x.kind}:${x.subject}:${x.type}`)
    expect(keys).toEqual(
      expect.arrayContaining([
        'action-type:ghost:ghost',
        'base-type:row:base_s',
        'field-type:extra:extra_s?',
        'variant-type:choice:nothing_s',
        'alias-type:amounts:amount_s[]',
        'result-type:pay:receipt_s',
        'duplicate:row:',
        'duplicate:pay:',
        'duplicate:rows:'
      ])
    )
    expect(f).toHaveLength(9)
  })

  it('reports an ABI that is not valid JSON', () => {
    const f = checkAbi('{ not json')
    expect(f).toHaveLength(1)
    expect(f[0].kind).toBe('invalid')
  })

  it('reports what the reader refuses beyond missing types (a base that is not a struct)', () => {
    const abi = JSON.parse(OK_ABI)
    abi.structs[1].base = 'ids'
    const f = checkAbi(JSON.stringify(abi))
    expect(f).toHaveLength(1)
    expect(f[0].kind).toBe('invalid')
    expect(explain(f[0], null)).toMatch(/^ABI check: the ABI is not valid: .*base/)
  })
})

describe('ABI check explanation and source place', () => {
  it("gives the shipped text for the owner's case with file and line, and names the other contract", async () => {
    const findings = describeAbi(read('foreign-table.abi'), 'game.abi', await readSources(join(dir, 'project')))
    expect(findings).toHaveLength(1)
    const f = findings[0]
    expect(f.place).toEqual({ file: 'include/game.hpp', line: 25, column: 30 })
    expect(f.text).toBe(
      [
        'ABI check: table `coinconf` uses the type `land_coinconf_s`, but the ABI does not define it. The chain refuses such an ABI, so Deploy is stopped.',
        'Why: the code declares a table type for `coinconf` (include/game.hpp:25), and the struct `land_coinconf_s` is not marked as a table. Older compilers (CDT 1.8) left such a table out of the ABI; this one writes the table entry without the struct.',
        'Fix, one of:',
        '(a) The table belongs to another contract and is only read here: move the struct `land_coinconf_s` and its typedef out of the contract class, for example into `namespace lands { ... }` above the class. The compiler then leaves the table out of this ABI.',
        '(b) The table belongs to this contract: mark the struct, `struct [[eosio::table("coinconf")]] land_coinconf_s`. The table and the struct are then both in the ABI.'
      ].join('\n')
    )
  })

  it('leaves the place out of the Why line when the search finds nothing, and points Problems at the ABI entry', () => {
    const findings = describeAbi(read('foreign-table.abi'), 'game.abi', [])
    expect(findings[0].text).toContain('Why: the code declares a table type for `coinconf`, and the struct')
    expect(findings[0].text).toContain('namespace <other contract> { ... }')
    expect(findings[0].place?.file).toBe('game.abi')
    expect(findings[0].place?.line).toBeGreaterThan(1)
  })

  it('gives every kind one explanation in the same form (what, why, fix)', () => {
    for (const f of checkAbi(read('many-faults.abi'))) {
      const lines = explain(f, null).split('\n')
      expect(lines).toHaveLength(3)
      expect(lines[0]).toMatch(/^ABI check: .*The chain refuses such an ABI, so Deploy is stopped\.$/)
      expect(lines[1]).toMatch(/^Why: /)
      expect(lines[2]).toMatch(/^Fix: /)
    }
  })

  it('checks the ABI file of a project folder', async () => {
    expect(await checkProjectAbi(dir, 'foreign-table.abi')).toHaveLength(1)
  })

  it('turns findings into Problems (source abi, error) and Output lines in the error colour', async () => {
    const findings = describeAbi(read('foreign-table.abi'), 'game.abi', await readSources(join(dir, 'project')))
    const p = abiProblems(findings)
    expect(p[0]).toMatchObject({ file: 'include/game.hpp', line: 25, severity: 'error', source: 'abi' })
    expect(p[0].message.startsWith('table `coinconf`')).toBe(true)
    const first = findings[0].text.split('\n')[0]
    expect(classifyLine(first)).toMatchObject({ severity: 'error', kind: 'app' })
  })
})

describe('Deploy refusal', () => {
  it('stops Deploy with the same explanation as the build, and lets a consistent ABI through', async () => {
    const { mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    h.dataDir = mkdtempSync(join(tmpdir(), 'wm-abi-'))
    const { abiRefusal } = await import('../../src/main/build')
    const text = await abiRefusal(join(dir, 'project'), 'game.abi', read('foreign-table.abi'))
    expect(text).toContain('ABI check: table `coinconf` uses the type `land_coinconf_s`')
    expect(text).toContain('(include/game.hpp:25)')
    expect(await abiRefusal(join(dir, 'project'), 'game.abi', OK_ABI)).toBeNull()
  })
})
