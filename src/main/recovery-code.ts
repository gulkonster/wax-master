// Vault recovery code: 125 random bits written as 25 characters of Crockford
// base32 in five groups of five. Input ignores case, spaces and dashes and reads
// O as 0 and I and L as 1.

import { randomBytes } from 'node:crypto'

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export const CODE_CHARS = 25

/** A new code from the system generator, in the shown form XXXXX-XXXXX-XXXXX-XXXXX-XXXXX. */
export function newRecoveryCode(): string {
  const bytes = randomBytes(16)
  let bits = 0n
  for (const b of bytes) bits = (bits << 8n) | BigInt(b)
  bytes.fill(0)
  // 128 bits from the generator; the top three are dropped, 125 remain.
  let out = ''
  for (let i = CODE_CHARS - 1; i >= 0; i--) out += ALPHABET[Number((bits >> BigInt(i * 5)) & 31n)]
  return formatRecoveryCode(out)
}

/** Groups 25 plain characters as XXXXX-XXXXX-XXXXX-XXXXX-XXXXX. */
export function formatRecoveryCode(plain: string): string {
  return plain.match(/.{1,5}/g)!.join('-')
}

/**
 * The 25 plain characters of a typed code, or null when it cannot be a code.
 * The result is what the vault key is derived from, so every spelling of one
 * code gives the same key.
 */
export function normalizeRecoveryCode(typed: string): string | null {
  const s = typed
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
  if (s.length !== CODE_CHARS) return null
  for (const c of s) if (!ALPHABET.includes(c)) return null
  return s
}
