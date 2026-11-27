// Plain-text backup files (one key, or the vault recovery code): names,
// contents and a write that never replaces a file.
// Only the main process builds and writes these files.

import { writeFileSync } from 'node:fs'
import { cleanLabel } from './vault'

export const KEY_BACKUP_WARNING =
  'Anyone who has this file controls every account that uses this key. Move it to a safe offline place and delete it from this computer.'

/** Default name: wax-master-key-<label>-<first 8 characters of the public key after its prefix>.txt */
export function keyBackupFileName(label: string, publicKey: string): string {
  const clean = label
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 40)
  const short = publicKey.replace(/^PUB_K1_|^EOS/, '').slice(0, 8)
  return clean ? `wax-master-key-${clean}-${short}.txt` : `wax-master-key-${short}.txt`
}

export interface KeyBackupContent {
  date: Date
  label: string
  publicKey: string
  publicKeyLegacy: string
  privateKey: string
  privateKeyWif: string
  network: string
  /** account@permission lines; null when the network could not be asked. */
  accounts: string[] | null
}

export function keyBackupText(c: KeyBackupContent): string {
  // Label and network name are written as one line each, so they cannot add lines of their own.
  const label = cleanLabel(c.label)
  const network = cleanLabel(c.network)
  const accounts =
    c.accounts === null
      ? [`  (could not be read from ${network})`]
      : c.accounts.length === 0
        ? [`  (none found on ${network})`]
        : c.accounts.map((a) => `  ${a}`)
  return [
    'WAX Master key backup',
    '',
    `Date: ${c.date.toISOString().slice(0, 10)}`,
    `Label: ${label || '(no label)'}`,
    '',
    'Public key:',
    `  ${c.publicKey}`,
    `  ${c.publicKeyLegacy}`,
    '',
    'Private key:',
    `  ${c.privateKey}`,
    `  ${c.privateKeyWif}`,
    '',
    `Accounts and permissions seen for this key on ${network}:`,
    ...accounts,
    '',
    KEY_BACKUP_WARNING,
    ''
  ].join('\r\n')
}

export const RECOVERY_CODE_TEXT = 'With this code the vault can be opened without the password. Keep it away from this computer. It is not shown again.'
export const RECOVERY_CODE_FILE = 'wax-master-recovery-code.txt'

export function recoveryCodeText(code: string, date: Date): string {
  return [
    'WAX Master vault recovery code',
    '',
    `Date: ${date.toISOString().slice(0, 10)}`,
    `Code: ${code}`,
    '',
    'With this code the vault can be opened without the password. Keep it away from this computer.',
    ''
  ].join('\r\n')
}

/** Writes a new file; refuses when the file exists (never replaces one). */
export function writeNewFile(path: string, text: string): void {
  writeFileSync(path, text, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
}

export const FILE_EXISTS = 'A file with this name already exists. Choose another name; an existing file is never replaced.'
