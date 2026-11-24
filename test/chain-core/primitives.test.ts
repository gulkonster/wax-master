import { describe, expect, it } from 'vitest'
import {
  SerialBuffer,
  base58Decode,
  base58Encode,
  bytesToHex,
  concatBytes,
  bytesEqual,
  decodeType,
  encodeType,
  formatAsset,
  hexToBytes,
  isValidName,
  nameToUint64,
  parseAsset,
  parseSymbol,
  uint64ToName,
  type AbiDef
} from '../../src/chain-core'

const EMPTY: AbiDef = { version: 'eosio::abi/1.1', types: [], structs: [], actions: [], tables: [], ricardian_clauses: [], error_messages: [], abi_extensions: [] }
const enc = (type: string, v: unknown): string => bytesToHex(encodeType(EMPTY, type, v))
const dec = (type: string, hex: string): unknown => decodeType(EMPTY, type, hexToBytes(hex))
const roundTrip = (type: string, v: unknown, hex: string): void => {
  expect(enc(type, v)).toBe(hex)
  expect(dec(type, hex)).toEqual(v)
}

describe('hex and bytes helpers', () => {
  it('hex round trip and validation', () => {
    expect(bytesToHex(new Uint8Array([0, 1, 254, 255]))).toBe('0001feff')
    expect(Array.from(hexToBytes('00FFaB'))).toEqual([0, 255, 171])
    expect(() => hexToBytes('abc')).toThrow(/odd/)
    expect(() => hexToBytes('zz')).toThrow(/invalid hex/)
    expect(hexToBytes('')).toHaveLength(0)
  })
  it('concat and equality', () => {
    expect(bytesToHex(concatBytes(new Uint8Array([1]), new Uint8Array(), new Uint8Array([2, 3])))).toBe('010203')
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true)
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false)
    expect(bytesEqual(new Uint8Array([1]), new Uint8Array([1, 0]))).toBe(false)
  })
  it('SerialBuffer varints', () => {
    for (const v of [0, 1, 127, 128, 16383, 16384, 2 ** 31, 4294967295]) {
      const b = new SerialBuffer()
      b.pushVaruint32(v)
      expect(new SerialBuffer(b.asUint8Array()).getVaruint32()).toBe(v)
    }
    for (const v of [0, -1, 1, -64, 63, -2147483648, 2147483647]) {
      const b = new SerialBuffer()
      b.pushVarint32(v)
      expect(new SerialBuffer(b.asUint8Array()).getVarint32()).toBe(v)
    }
    expect(() => new SerialBuffer(hexToBytes('ffffffff7f')).getVaruint32()).toThrow(/overflow/)
    expect(() => new SerialBuffer(hexToBytes('80')).getVaruint32()).toThrow(/past end/)
  })
  it('SerialBuffer grows and reads back little endian values and floats', () => {
    const b = new SerialBuffer()
    for (let i = 0; i < 1000; i++) b.pushUint32(i)
    b.pushFloat32(1.5)
    b.pushFloat64(-2.25)
    b.pushInt16(-2)
    b.pushString('hé')
    const r = new SerialBuffer(b.asUint8Array())
    for (let i = 0; i < 1000; i++) expect(r.getUint32()).toBe(i)
    expect(r.getFloat32()).toBe(1.5)
    expect(r.getFloat64()).toBe(-2.25)
    expect(r.getInt16()).toBe(-2)
    expect(r.getString()).toBe('hé')
    expect(r.remaining).toBe(0)
  })
})

describe('base58', () => {
  it('round trips including leading zeros', () => {
    for (const hex of ['', '00', '0000ff', 'ff', '00112233445566778899aabbccddeeff']) {
      expect(bytesToHex(base58Decode(base58Encode(hexToBytes(hex))))).toBe(hex)
    }
    expect(base58Encode(hexToBytes('0000'))).toBe('11')
    expect(base58Encode(new TextEncoder().encode('hello world'))).toBe('StV1DL6CwTryKyV')
  })
  it('rejects invalid characters', () => {
    expect(() => base58Decode('0OIl')).toThrow(/invalid base58/)
  })
})

describe('name', () => {
  it('known values', () => {
    expect(nameToUint64('eosio')).toBe(6138663577826885632n)
    expect(nameToUint64('eosio.token')).toBe(6138663591592764928n)
    expect(nameToUint64('')).toBe(0n)
    expect(nameToUint64('a')).toBe(3458764513820540928n)
    expect(uint64ToName(6138663577826885632n)).toBe('eosio')
  })
  it('13 character names and the 13th character rule', () => {
    expect(uint64ToName(nameToUint64('zzzzzzzzzzzzj'))).toBe('zzzzzzzzzzzzj')
    expect(isValidName('zzzzzzzzzzzzk')).toBe(false)
    expect(isValidName('aaaaaaaaaaaaj')).toBe(true)
    expect(isValidName('aaaaaaaaaaaaa')).toBe(true)
    expect(nameToUint64('zzzzzzzzzzzzj')).toBe(0xffffffffffffffffn)
  })
  it('rejects bad names', () => {
    for (const bad of ['UPPER', 'has space', 'a'.repeat(14), 'six6', '0', 'a-b', 'a_b', 'é']) {
      expect(isValidName(bad), bad).toBe(false)
      expect(() => nameToUint64(bad)).toThrow()
    }
  })
  it('round trips every length and dots', () => {
    for (const n of ['a', 'ab', 'a.b', '.a', 'abcde12345.ab', 'a1b2c3d4e5aaa', 'eosio.msig']) {
      expect(uint64ToName(nameToUint64(n))).toBe(n)
    }
    expect(uint64ToName(nameToUint64('a.'))).toBe('a')
  })
  it('uint64 bounds', () => {
    expect(() => uint64ToName(-1n)).toThrow()
    expect(() => uint64ToName(1n << 64n)).toThrow()
    expect(uint64ToName(0n)).toBe('')
  })
})

describe('integers', () => {
  const cases: [string, bigint, bigint, number][] = [
    ['int8', -128n, 127n, 1],
    ['uint8', 0n, 255n, 1],
    ['int16', -32768n, 32767n, 2],
    ['uint16', 0n, 65535n, 2],
    ['int32', -2147483648n, 2147483647n, 4],
    ['uint32', 0n, 4294967295n, 4],
    ['int64', -(1n << 63n), (1n << 63n) - 1n, 8],
    ['uint64', 0n, (1n << 64n) - 1n, 8],
    ['int128', -(1n << 127n), (1n << 127n) - 1n, 16],
    ['uint128', 0n, (1n << 128n) - 1n, 16]
  ]
  for (const [type, min, max, size] of cases) {
    it(`${type} limits`, () => {
      for (const v of [min, max, 0n]) {
        const hex = enc(type, v.toString())
        expect(hex.length).toBe(size * 2)
        const back = dec(type, hex)
        expect(BigInt(back as string | number)).toBe(v)
      }
      expect(() => enc(type, (max + 1n).toString())).toThrow(/out of range/)
      expect(() => enc(type, (min - 1n).toString())).toThrow(/out of range/)
    })
  }
  it('64 and 128 bit output are decimal strings, smaller ones numbers', () => {
    expect(dec('uint64', 'ffffffffffffffff')).toBe('18446744073709551615')
    expect(dec('int64', 'ffffffffffffffff')).toBe('-1')
    expect(dec('uint32', 'ffffffff')).toBe(4294967295)
    expect(dec('int8', 'ff')).toBe(-1)
  })
  it('accepts numbers, bigints and strings on input; rejects junk', () => {
    expect(enc('uint64', 5)).toBe(enc('uint64', '5'))
    expect(enc('uint64', 5n)).toBe(enc('uint64', '5'))
    expect(() => enc('uint64', 1.5)).toThrow(/integer/)
    expect(() => enc('uint64', 2 ** 60)).toThrow(/safe integer/)
    expect(() => enc('uint8', '0x10')).toThrow(/decimal/)
    expect(() => enc('uint8', '')).toThrow()
    expect(() => enc('uint8', null)).toThrow()
    expect(() => enc('uint8', true)).toThrow()
  })
  it('byte layout is little endian', () => {
    expect(enc('uint16', 0x0102)).toBe('0201')
    expect(enc('int32', -2)).toBe('feffffff')
    expect(enc('int128', '-1')).toBe('ff'.repeat(16))
  })
  it('varints', () => {
    roundTrip('varuint32', 0, '00')
    roundTrip('varuint32', 300, 'ac02')
    roundTrip('varuint32', 4294967295, 'ffffffff0f')
    roundTrip('varint32', -1, '01')
    roundTrip('varint32', 1, '02')
    roundTrip('varint32', -2147483648, 'ffffffff0f')
    expect(() => enc('varuint32', -1)).toThrow(/out of range/)
    expect(() => enc('varuint32', 4294967296)).toThrow(/out of range/)
    expect(() => enc('varint32', 2147483648)).toThrow(/out of range/)
  })
})

describe('bool, floats', () => {
  it('bool', () => {
    roundTrip('bool', true, '01')
    roundTrip('bool', false, '00')
    expect(enc('bool', 'true')).toBe('01')
    expect(enc('bool', 0)).toBe('00')
    expect(() => enc('bool', 2)).toThrow()
    expect(() => dec('bool', '02')).toThrow(/invalid bool/)
  })
  it('float32 and float64', () => {
    roundTrip('float32', 0.5, '0000003f')
    roundTrip('float64', 0.1, '9a9999999999b93f')
    expect(dec('float32', enc('float32', 0.1))).toBe(0.1)
    expect(dec('float32', enc('float32', 3.4028234663852886e38))).toBe(3.4028235e38)
    expect(() => enc('float32', 1e39)).toThrow(/out of range/)
    expect(Object.is(dec('float64', enc('float64', -0)), -0)).toBe(true)
    expect(dec('float64', enc('float64', 'NaN'))).toBe('NaN')
    expect(dec('float64', enc('float64', Infinity))).toBe('Infinity')
    expect(dec('float64', enc('float64', '-inf'))).toBe('-Infinity')
    expect(enc('float64', '1.5')).toBe(enc('float64', 1.5))
    expect(() => enc('float64', 'abc')).toThrow(/number/)
    expect(dec('float64', enc('float64', Number.MIN_VALUE))).toBe(Number.MIN_VALUE)
    expect(dec('float64', enc('float64', Number.MAX_VALUE))).toBe(Number.MAX_VALUE)
  })
  it('float128 is 16 raw bytes as hex', () => {
    roundTrip('float128', '00000000000000000000000000000040', '00000000000000000000000000000040')
    expect(() => enc('float128', '00')).toThrow(/16 bytes/)
  })
})

describe('time types', () => {
  it('time_point keeps milliseconds and microseconds', () => {
    roundTrip('time_point', '1970-01-01T00:00:00.000', '0000000000000000')
    roundTrip('time_point', '2030-01-02T03:04:05.678', enc('time_point', '2030-01-02T03:04:05.678'))
    expect(dec('time_point', enc('time_point', '2030-01-02T03:04:05.678901'))).toBe('2030-01-02T03:04:05.678901')
    expect(dec('time_point', enc('time_point', '2030-01-02T03:04:05'))).toBe('2030-01-02T03:04:05.000')
    expect(enc('time_point', '2030-01-02T03:04:05.5Z')).toBe(enc('time_point', '2030-01-02T03:04:05.500'))
    expect(enc('time_point', '1970-01-01T00:00:00.000001')).toBe('0100000000000000')
  })
  it('time_point_sec', () => {
    roundTrip('time_point_sec', '1970-01-01T00:00:00', '00000000')
    roundTrip('time_point_sec', '2106-02-07T06:28:15', 'ffffffff')
    expect(() => enc('time_point_sec', '2106-02-07T06:28:16')).toThrow(/out of range/)
    expect(enc('time_point_sec', '2030-01-02T03:04:05.999Z')).toBe(enc('time_point_sec', '2030-01-02T03:04:05'))
  })
  it('block_timestamp_type counts half seconds from 2000', () => {
    roundTrip('block_timestamp_type', '2000-01-01T00:00:00.000', '00000000')
    roundTrip('block_timestamp_type', '2000-01-01T00:00:00.500', '01000000')
    roundTrip('block_timestamp_type', '2000-01-01T00:00:01.000', '02000000')
    expect(enc('block_timestamp_type', '2000-01-01T00:00:00.700')).toBe('01000000')
    expect(() => enc('block_timestamp_type', '1999-12-31T23:59:59.500')).toThrow(/out of range/)
  })
  it('rejects malformed times', () => {
    for (const bad of ['', 'now', '2030-13-01T00:00:00', '2030-02-30T00:00:00', '2030-01-01T24:00:00', '2030-01-01 00:00:00', '1969-12-31T23:59:59', '2030-01-01T00:00:60']) {
      expect(() => enc('time_point_sec', bad), bad).toThrow()
    }
    expect(() => enc('time_point_sec', 5)).toThrow()
    expect(enc('time_point_sec', '2024-02-29T00:00:00')).toHaveLength(8)
    expect(() => enc('time_point_sec', '2023-02-29T00:00:00')).toThrow()
  })
})

describe('string and bytes', () => {
  it('strings', () => {
    roundTrip('string', '', '00')
    roundTrip('string', 'abc', '03616263')
    roundTrip('string', 'é中😀', enc('string', 'é中😀'))
    const long = 'x'.repeat(300)
    expect(enc('string', long).startsWith('ac02')).toBe(true)
    expect(dec('string', enc('string', long))).toBe(long)
    expect(() => enc('string', 5)).toThrow()
    expect(() => dec('string', '05616263')).toThrow(/past end/)
  })
  it('bytes', () => {
    roundTrip('bytes', '', '00')
    roundTrip('bytes', '00ff', '0200ff')
    expect(enc('bytes', '00FF')).toBe('0200ff')
    expect(enc('bytes', new Uint8Array([1, 2]))).toBe('020102')
    expect(() => enc('bytes', 'abc')).toThrow(/odd/)
    expect(() => enc('bytes', 12)).toThrow()
  })
  it('checksums enforce size', () => {
    roundTrip('checksum160', '00'.repeat(20), '00'.repeat(20))
    roundTrip('checksum256', 'ab'.repeat(32), 'ab'.repeat(32))
    roundTrip('checksum512', 'cd'.repeat(64), 'cd'.repeat(64))
    expect(() => enc('checksum256', '00'.repeat(31))).toThrow(/32 bytes/)
    expect(() => enc('checksum160', '00'.repeat(32))).toThrow(/20 bytes/)
    expect(enc('checksum256', 'AB'.repeat(32))).toBe('ab'.repeat(32))
  })
})

describe('symbol, symbol_code, asset', () => {
  it('symbol', () => {
    roundTrip('symbol', '4,WAX', '0457415800000000')
    roundTrip('symbol', '0,A', '0041000000000000')
    roundTrip('symbol', '18,ABCDEFG', enc('symbol', '18,ABCDEFG'))
    for (const bad of ['19,WAX', '4,wax', '4,', ',WAX', '4,ABCDEFGH', 'WAX', '4, WAX', '-1,WAX']) {
      expect(() => enc('symbol', bad), bad).toThrow()
    }
    expect(parseSymbol('4,WAX')).toEqual({ precision: 4, code: 'WAX' })
    expect(() => dec('symbol', '0400000000000000')).toThrow(/empty/)
    expect(() => dec('symbol', '0461786100000000')).toThrow(/invalid symbol code/)
  })
  it('symbol_code', () => {
    roundTrip('symbol_code', 'WAX', '5741580000000000')
    expect(() => enc('symbol_code', 'wax')).toThrow()
    expect(() => enc('symbol_code', '')).toThrow()
    expect(() => enc('symbol_code', 'TOOLONGCODE')).toThrow()
  })
  it('asset basics and precision edges', () => {
    roundTrip('asset', '1.00000000 WAX', '00e1f50500000000' + '0857415800000000')
    roundTrip('asset', '0 A', '0000000000000000' + '0041000000000000')
    roundTrip('asset', '0.0001 WAX', '0100000000000000' + '0457415800000000')
    roundTrip('asset', '-0.0001 WAX', 'ffffffffffffffff' + '0457415800000000')
    roundTrip('asset', '-1.5 A', 'f1ffffffffffffff' + '0141000000000000')
    roundTrip('asset', '123 B', '7b00000000000000' + '0042000000000000')
    roundTrip('asset', '0.000000000000000001 TKN', '0100000000000000' + '12544b4e00000000')
  })
  it('asset amount limits (|amount| < 2^62)', () => {
    roundTrip('asset', '4611686018427387903 A', 'ffffffffffffff3f' + '0041000000000000')
    roundTrip('asset', '-4611686018427387903 A', '01000000000000c0' + '0041000000000000')
    expect(() => enc('asset', '4611686018427387904 A')).toThrow(/out of range/)
    expect(() => enc('asset', '-4611686018427387904 A')).toThrow(/out of range/)
  })
  it('asset rejects malformed text', () => {
    for (const bad of ['1.0000', '1.0000WAX', '1.0000 wax', '.5 WAX', '1. WAX', '+1 WAX', '1,0 WAX', '1.0000  WAX', ' 1.0000 WAX', '1.0000 WAX ', '1.0000 TOOLONGCODE', '1.0 ', '', 'abc WAX', '1e3 WAX', '0.1234567890123456789 WAX']) {
      expect(() => enc('asset', bad), JSON.stringify(bad)).toThrow()
    }
    expect(() => enc('asset', 5)).toThrow()
  })
  it('parse and format helpers', () => {
    expect(parseAsset('-0.05 USD')).toEqual({ amount: -5n, symbol: { precision: 2, code: 'USD' } })
    expect(formatAsset({ amount: -5n, symbol: { precision: 2, code: 'USD' } })).toBe('-0.05 USD')
    expect(formatAsset({ amount: 100000000n, symbol: { precision: 8, code: 'WAX' } })).toBe('1.00000000 WAX')
    expect(formatAsset({ amount: 7n, symbol: { precision: 0, code: 'X' } })).toBe('7 X')
    expect(formatAsset({ amount: 0n, symbol: { precision: 3, code: 'X' } })).toBe('0.000 X')
  })
})

describe('keys as ABI types', () => {
  it('public_key accepts legacy and new, prints the new form (or legacy on request)', () => {
    const legacy = 'EOS6MRyAjQq8ud7hVNYcfnVPJqcVpscN5So8BhtHuGYqET5GDW5CV'
    const bytes = encodeType(EMPTY, 'public_key', legacy)
    expect(bytes).toHaveLength(34)
    expect(bytes[0]).toBe(0)
    const newForm = decodeType(EMPTY, 'public_key', bytes) as string
    expect(newForm.startsWith('PUB_K1_')).toBe(true)
    expect(decodeType(EMPTY, 'public_key', bytes, { legacyKeys: true })).toBe(legacy)
    expect(bytesToHex(encodeType(EMPTY, 'public_key', newForm))).toBe(bytesToHex(bytes))
  })
  it('public_key rejects bad checksums, bad points and bad types', () => {
    expect(() => enc('public_key', 'EOS6MRyAjQq8ud7hVNYcfnVPJqcVpscN5So8BhtHuGYqET5GDW5CW')).toThrow()
    expect(() => enc('public_key', 'EOS')).toThrow()
    expect(() => enc('public_key', 'KEY_whatever')).toThrow(/unrecognized/)
    expect(() => enc('public_key', 5)).toThrow()
    expect(() => dec('public_key', '09' + '00'.repeat(33))).toThrow(/unknown public key type/)
  })
  it('nameToUint64 helper output is stable for names used on chain', () => {
    expect(nameToUint64('transfer')).toBe(14829575313431724032n)
  })
})
