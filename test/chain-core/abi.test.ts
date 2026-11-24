import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ChainCoreError,
  abiFromBinary,
  abiToBinary,
  bytesToHex,
  compileAbi,
  decodeAction,
  decodeActionResult,
  decodeTableRow,
  decodeType,
  encodeAction,
  encodeType,
  hexToBytes,
  parseAbi,
  type AbiDef
} from '../../src/chain-core'

const sys = JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'chain', 'system-abis.json'), 'utf8')) as {
  raw: Record<string, string>
  abi: Record<string, AbiDef>
}

function abi(partial: Partial<AbiDef>): AbiDef {
  return { version: 'eosio::abi/1.2', types: [], structs: [], actions: [], tables: [], ricardian_clauses: [], error_messages: [], abi_extensions: [], ...partial }
}

const TOKEN = sys.abi['eosio.token']

describe('ABI binary form against real on-chain data', () => {
  for (const account of ['eosio.token', 'eosio']) {
    it(`${account}: abiToBinary(abiFromBinary(raw)) equals raw`, () => {
      const raw = new Uint8Array(Buffer.from(sys.raw[account], 'base64'))
      const def = abiFromBinary(raw)
      expect(bytesToHex(abiToBinary(def))).toBe(bytesToHex(raw))
    })
    it(`${account}: the JSON ABI from the node serializes to the raw bytes`, () => {
      const raw = new Uint8Array(Buffer.from(sys.raw[account], 'base64'))
      expect(bytesToHex(abiToBinary(sys.abi[account]))).toBe(bytesToHex(raw))
    })
    it(`${account}: the binary ABI parses to the JSON ABI the node reports`, () => {
      const raw = new Uint8Array(Buffer.from(sys.raw[account], 'base64'))
      const def = abiFromBinary(raw)
      expect(def.structs).toEqual(sys.abi[account].structs)
      expect(def.actions.map((a) => a.name)).toEqual(sys.abi[account].actions.map((a) => a.name))
      expect(def.version).toBe(sys.abi[account].version)
    })
  }
  it('rejects truncated and oversize binary ABIs', () => {
    const raw = new Uint8Array(Buffer.from(sys.raw['eosio.token'], 'base64'))
    expect(() => abiFromBinary(raw.slice(0, raw.length - 5))).toThrow()
    expect(() => abiFromBinary(new Uint8Array(2 * 1024 * 1024 + 1))).toThrow(/2 MB/)
    expect(() => abiFromBinary(new Uint8Array(0))).toThrow()
    expect(() => abiFromBinary(concat(raw, new Uint8Array([0, 0, 0])))).toThrow(/trailing/)
  })
  it('the real token ABI encodes transfers', () => {
    const data = { from: 'alice', to: 'bob', quantity: '1.0000 WAX', memo: 'hi' }
    const bytes = encodeAction(TOKEN, 'transfer', data)
    expect(decodeAction(TOKEN, 'transfer', bytes)).toEqual(data)
  })
})

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a)
  out.set(b, a.length)
  return out
}

describe('ABI parsing', () => {
  it('accepts versions 1.0, 1.1 and 1.2 and fills defaults', () => {
    for (const v of ['eosio::abi/1.0', 'eosio::abi/1.1', 'eosio::abi/1.2']) {
      const def = parseAbi({ version: v, structs: [{ name: 's', fields: [{ name: 'a', type: 'uint8' }] }], actions: [{ name: 'act', type: 's' }] })
      expect(def.tables).toEqual([])
      expect(def.structs[0].base).toBe('')
      expect(def.actions[0].ricardian_contract).toBe('')
      expect(def.variants).toBeUndefined()
      expect(Array.from(encodeAction(def, 'act', { a: 9 }))).toEqual([9])
    }
  })
  it('rejects other versions and shapes', () => {
    expect(() => parseAbi({ version: 'eosio::abi/2.0' })).toThrow(/version/)
    expect(() => parseAbi({})).toThrow(/version/)
    expect(() => parseAbi('not json')).toThrow(/JSON/)
    expect(() => parseAbi([])).toThrow(/object/)
    expect(() => parseAbi({ version: 'eosio::abi/1.0', structs: 'x' })).toThrow(/array/)
    expect(() => parseAbi({ version: 'eosio::abi/1.0', structs: [{ fields: [] }] })).toThrow(/structs\[0\]\.name/)
  })
  it('accepts and ignores kv_tables, parses JSON text, enforces the 2 MB text limit', () => {
    const text = JSON.stringify({ version: 'eosio::abi/1.2', kv_tables: { t: { type: 'x' } }, structs: [] })
    const def = parseAbi(text)
    expect('kv_tables' in def).toBe(false)
    const big = JSON.stringify({ version: 'eosio::abi/1.0', ricardian_clauses: [{ id: 'a', body: 'x'.repeat(2 * 1024 * 1024) }] })
    expect(() => parseAbi(big)).toThrow(/2 MB/)
  })
  it('writes trailing extensions only when they carry data', () => {
    const none = bytesToHex(abiToBinary(parseAbi({ version: 'eosio::abi/1.2' })))
    const emptyVariants = bytesToHex(abiToBinary(parseAbi({ version: 'eosio::abi/1.2', variants: [], action_results: [] })))
    expect(emptyVariants).toBe(none + '00')
    expect(abiFromBinary(hexToBytes(emptyVariants)).variants).toEqual([])
    const withVariant = parseAbi({ version: 'eosio::abi/1.2', variants: [{ name: 'v', types: ['uint8'] }], action_results: [] })
    const back = abiFromBinary(abiToBinary(withVariant))
    expect(back.variants).toEqual(withVariant.variants)
    expect(back.action_results).toBeUndefined()
    const withResult = parseAbi({
      version: 'eosio::abi/1.2',
      structs: [],
      action_results: [{ name: 'act', result_type: 'uint8' }]
    })
    const back2 = abiFromBinary(abiToBinary(withResult))
    expect(back2.variants).toEqual([])
    expect(back2.action_results).toEqual(withResult.action_results)
    expect(abiFromBinary(hexToBytes(none)).variants).toBeUndefined()
  })
})

describe('ABI validation', () => {
  it('unknown types', () => {
    expect(() => compileAbi(abi({ structs: [{ name: 's', base: '', fields: [{ name: 'a', type: 'nope' }] }] }))).toThrow(/unknown type "nope"/)
    expect(() => compileAbi(abi({ structs: [{ name: 's', base: '', fields: [{ name: 'a', type: 'nope[]?' }] }] }))).toThrow(/unknown type/)
    expect(() => compileAbi(abi({ actions: [{ name: 'a', type: 'missing', ricardian_contract: '' }] }))).toThrow(/actions\[0\]\.type/)
  })
  it('duplicate names', () => {
    const s = { name: 's', base: '', fields: [] }
    expect(() => compileAbi(abi({ structs: [s, s] }))).toThrow(/duplicate/)
    expect(() => compileAbi(abi({ structs: [s], types: [{ new_type_name: 's', type: 'uint8' }] }))).toThrow(/duplicate/)
  })
  it('alias and base cycles', () => {
    expect(() => compileAbi(abi({ types: [{ new_type_name: 'a', type: 'b' }, { new_type_name: 'b', type: 'a' }] }))).toThrow(/circular/)
    expect(() => compileAbi(abi({ types: [{ new_type_name: 'a', type: 'a' }] }))).toThrow(/circular/)
    expect(() =>
      compileAbi(
        abi({
          structs: [
            { name: 'x', base: 'y', fields: [] },
            { name: 'y', base: 'x', fields: [] }
          ]
        })
      )
    ).toThrow(/circular|too deeply/)
    expect(() => compileAbi(abi({ structs: [{ name: 'x', base: 'uint8', fields: [] }] }))).toThrow(/not a struct/)
  })
  it('binary extension fields must be last', () => {
    expect(() =>
      compileAbi(
        abi({
          structs: [
            {
              name: 's',
              base: '',
              fields: [
                { name: 'a', type: 'uint8$' },
                { name: 'b', type: 'uint8' }
              ]
            }
          ]
        })
      )
    ).toThrow(/follows a binary extension/)
  })
  it('alias chains deeper than the limit are rejected', () => {
    const types = [{ new_type_name: 't0', type: 'uint8' }]
    for (let i = 1; i < 40; i++) types.push({ new_type_name: `t${i}`, type: `t${i - 1}` })
    expect(() => compileAbi(abi({ types }))).toThrow(/too deeply/)
  })
})

describe('encoding and decoding with ABIs', () => {
  const A = abi({
    types: [{ new_type_name: 'account_name', type: 'name' }],
    structs: [
      { name: 'base', base: '', fields: [{ name: 'id', type: 'uint32' }] },
      {
        name: 'row',
        base: 'base',
        fields: [
          { name: 'owner', type: 'account_name' },
          { name: 'vals', type: 'uint16[]' },
          { name: 'opt', type: 'string?' },
          { name: 'v', type: 'choice' },
          { name: 'ext', type: 'uint8$' },
          { name: 'ext2', type: 'string$' }
        ]
      },
      { name: 'tree', base: '', fields: [{ name: 'kids', type: 'tree[]' }] },
      { name: 'list', base: '', fields: [{ name: 'rows', type: 'row[]' }] },
      { name: 'empty', base: '', fields: [] },
      { name: 'many', base: '', fields: [{ name: 'e', type: 'empty[]' }] }
    ],
    actions: [{ name: 'put', type: 'row', ricardian_contract: '' }],
    tables: [{ name: 'rows', index_type: 'i64', key_names: [], key_types: [], type: 'row' }],
    variants: [{ name: 'choice', types: ['uint8', 'string', 'row?'] }],
    action_results: [{ name: 'put', result_type: 'uint32' }]
  })
  const row = { id: 7, owner: 'alice', vals: [1, 2, 3], opt: null, v: ['string', 'x'] }

  it('round trips structs with base, alias, array, optional, variant', () => {
    const bytes = encodeAction(A, 'put', row)
    expect(decodeAction(A, 'put', bytes)).toEqual(row)
    expect(decodeTableRow(A, 'rows', bytes)).toEqual(row)
    expect(decodeActionResult(A, 'put', hexToBytes('2a000000'))).toBe(42)
  })
  it('binary extension fields: omitted, partial and full', () => {
    const full = { ...row, ext: 5, ext2: 'z' }
    expect(decodeAction(A, 'put', encodeAction(A, 'put', full))).toEqual(full)
    const partial = { ...row, ext: 5 }
    expect(decodeAction(A, 'put', encodeAction(A, 'put', partial))).toEqual(partial)
    expect(() => encodeAction(A, 'put', { ...row, ext2: 'z' })).toThrow(/ext2: field is set after a missing binary extension/)
  })
  it('error messages name the field path', () => {
    expect(() => encodeAction(A, 'put', { ...row, vals: [1, 'x'] })).toThrow('put.vals[1]: ')
    expect(() => encodeAction(A, 'put', { ...row, owner: 'UPPER' })).toThrow(/put\.owner: invalid character/)
    const { owner: _o, ...noOwner } = row
    void _o
    expect(() => encodeAction(A, 'put', noOwner)).toThrow('put.owner: missing required field')
    expect(() => encodeAction(A, 'put', { ...row, v: ['nope', 1] })).toThrow(/put\.v: "nope" is not a case/)
    expect(() => encodeAction(A, 'put', { ...row, v: 5 })).toThrow(/put\.v: expected a variant/)
    expect(() => encodeAction(A, 'put', 5)).toThrow(/put: expected an object/)
    expect(() => encodeAction(A, 'put', { ...row, vals: 'x' })).toThrow(/put\.vals: expected an array/)
    expect(() => encodeAction(A, 'nothing', {})).toThrow(/nothing: action is not defined/)
    try {
      encodeAction(TOKEN, 'transfer', { from: 'a', to: 'b', quantity: 'bad', memo: '' })
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(ChainCoreError)
      expect((e as ChainCoreError).path).toBe('transfer.quantity')
      expect((e as Error).message).toMatch(/^transfer\.quantity: invalid asset/)
    }
  })
  it('decode errors name the field path and detect trailing bytes', () => {
    const bytes = encodeAction(A, 'put', row)
    expect(() => decodeAction(A, 'put', concat(bytes, new Uint8Array([1, 0, 9])))).toThrow(/put: 1 unexpected trailing/)
    expect(decodeAction(A, 'put', concat(bytes, new Uint8Array([1, 0, 9])), { allowTrailing: true })).toBeTruthy()
    expect(() => decodeAction(A, 'put', bytes.slice(0, 6))).toThrow(/^put\.owner|put\.owner/)
    expect(() => decodeType(A, 'row', hexToBytes('07000000' + '0000000000000000' + '00' + '02' + '03'))).toThrow()
  })
  it('variant index out of range and bad optional flag', () => {
    expect(() => decodeType(A, 'choice', hexToBytes('09'))).toThrow(/out of range/)
    expect(() => decodeType(A, 'string?', hexToBytes('02'))).toThrow(/invalid optional/)
    expect(decodeType(A, 'choice', hexToBytes('010161'))).toEqual(['string', 'a'])
  })
  it('array length checks against the remaining bytes', () => {
    // 4 billion element claim with no data
    expect(() => decodeType(A, 'uint8[]', hexToBytes('ffffffff0f'))).toThrow(/exceeds the remaining data/)
    expect(() => decodeType(A, 'uint8[]', hexToBytes('05010203'))).toThrow(/past end/)
    // empty structs have no bytes, a small number of them is fine
    expect(decodeType(A, 'many', hexToBytes('03'))).toEqual({ e: [{}, {}, {}] })
    expect(() => decodeType(A, 'many', hexToBytes('ffffffff0f'))).toThrow(/exceeds/)
  })
  it('recursion depth limit', () => {
    let nested: unknown = { kids: [] }
    for (let i = 0; i < 40; i++) nested = { kids: [nested] }
    expect(() => encodeType(A, 'tree', nested)).toThrow(/too deep/)
    let shallow: unknown = { kids: [] }
    for (let i = 0; i < 5; i++) shallow = { kids: [shallow] }
    const bytes = encodeType(A, 'tree', shallow)
    expect(decodeType(A, 'tree', bytes)).toEqual(shallow)
    // decoding hostile data: kids count 1 repeated
    const hostile = new Uint8Array(200).fill(1)
    expect(() => decodeType(A, 'tree', hostile)).toThrow(/too deep/)
  })
  it('extended_asset works with and without an ABI declaration', () => {
    const v = { quantity: '1.0000 WAX', contract: 'eosio.token' }
    expect(decodeType(A, 'extended_asset', encodeType(A, 'extended_asset', v))).toEqual(v)
    const declared = abi({ structs: [{ name: 'extended_asset', base: '', fields: [{ name: 'quantity', type: 'asset' }, { name: 'contract', type: 'name' }] }] })
    expect(bytesToHex(encodeType(declared, 'extended_asset', v))).toBe(bytesToHex(encodeType(A, 'extended_asset', v)))
  })
  it('does not let __proto__ keys pollute prototypes', () => {
    const P = abi({ structs: [{ name: 's', base: '', fields: [{ name: '__proto__', type: 'uint8' }] }] })
    const out = decodeType(P, 's', hexToBytes('05')) as Record<string, unknown>
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype)
    expect(Object.keys(out)).toEqual(['__proto__'])
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})
