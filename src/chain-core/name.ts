import { ChainCoreError } from './errors'

const CHARMAP = '.12345abcdefghijklmnopqrstuvwxyz'
const CHAR_INDEX: Record<string, number> = {}
for (let i = 0; i < CHARMAP.length; i++) CHAR_INDEX[CHARMAP[i]] = i

const UINT64_MAX = (1n << 64n) - 1n

/**
 * Returns an error message when `name` is not a valid Antelope name, otherwise null.
 * Valid names are 0..13 characters from `.12345a-z`; a 13th character must be one of `.1-5a-j`.
 */
export function nameProblem(name: string): string | null {
  if (typeof name !== 'string') return 'name must be a string'
  if (name.length > 13) return 'name is longer than 13 characters'
  for (let i = 0; i < name.length; i++) {
    const idx = CHAR_INDEX[name[i]]
    if (idx === undefined) return `invalid character "${name[i]}" in name`
    if (i === 12 && idx > 15) return 'the 13th character of a name must be one of ".12345abcdefghij"'
  }
  return null
}

export function isValidName(name: string): boolean {
  return nameProblem(name) === null
}

export function nameToUint64(name: string): bigint {
  const problem = nameProblem(name)
  if (problem) throw new ChainCoreError('', problem)
  let v = 0n
  for (let i = 0; i < name.length; i++) {
    const idx = BigInt(CHAR_INDEX[name[i]])
    if (i < 12) v |= idx << BigInt(64 - 5 * (i + 1))
    else v |= idx
  }
  return v
}

/** Converts a uint64 to its name; trailing dots are removed, as nodeos does. */
export function uint64ToName(value: bigint): string {
  if (typeof value !== 'bigint' || value < 0n || value > UINT64_MAX) {
    throw new ChainCoreError('', 'name value out of uint64 range')
  }
  let out = ''
  let v = value
  for (let i = 0; i < 13; i++) {
    if (i === 0) {
      out = CHARMAP[Number(v & 0xfn)] + out
      v >>= 4n
    } else {
      out = CHARMAP[Number(v & 0x1fn)] + out
      v >>= 5n
    }
  }
  return out.replace(/\.+$/, '')
}
