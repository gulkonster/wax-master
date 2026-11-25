// Plain-text backup helpers: file name, content, the sync-folder check and the
// write that never replaces a file. Keys are made in the test and never printed.

import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { KEY_BACKUP_WARNING, keyBackupFileName, keyBackupText, recoveryCodeText, syncFolderOf, writeNewFile } from '../../src/main/key-backup'

describe('key backup file', () => {
  it('default name: label and the first 8 characters of the key after its prefix', () => {
    const pub = 'PUB_K1_6MRyAjQq8ud7hVNYcfnVPJqcVpscN5So8BhtHuGYqET5BoDq9B'
    expect(keyBackupFileName('deploy key', pub)).toBe('wax-master-key-deploy-key-6MRyAjQq.txt')
    expect(keyBackupFileName('a/b\\c:d*?', pub)).toBe('wax-master-key-a-b-c-d-6MRyAjQq.txt')
    expect(keyBackupFileName('', pub)).toBe('wax-master-key-6MRyAjQq.txt')
  })

  it('content: title, date, label, both key forms, accounts and the closing sentence', () => {
    const text = keyBackupText({
      date: new Date('2026-11-24T10:00:00Z'),
      label: 'deploy',
      publicKey: 'PUB_K1_pub',
      publicKeyLegacy: 'EOSpub',
      privateKey: 'PVT_K1_priv',
      privateKeyWif: '5priv',
      network: 'WAX Testnet',
      accounts: ['alice@active', 'bob@owner']
    })
    const lines = text.split('\r\n')
    expect(lines[0]).toBe('WAX Master key backup')
    for (const part of ['Date: 2026-11-24', 'Label: deploy', '  PUB_K1_pub', '  EOSpub', '  PVT_K1_priv', '  5priv', '  alice@active', '  bob@owner']) {
      expect(lines).toContain(part)
    }
    expect(text).toContain('on WAX Testnet:')
    expect(text).toContain(KEY_BACKUP_WARNING)
    const unread = keyBackupText({ date: new Date(), label: '', publicKey: 'p', publicKeyLegacy: 'p', privateKey: 'k', privateKeyWif: 'k', network: 'N', accounts: null })
    expect(unread).toContain('(could not be read from N)')
    expect(unread).toContain('Label: (no label)')
  })

  it('a label or network name with line breaks is written as one line', () => {
    const label = `x\r\nPrivate key:\r\n  PVT_K1_fake\n${'y'.repeat(10_000)}`
    const text = keyBackupText({
      date: new Date('2026-11-24T10:00:00Z'),
      label,
      publicKey: 'PUB_K1_pub',
      publicKeyLegacy: 'EOSpub',
      privateKey: 'PVT_K1_priv',
      privateKeyWif: '5priv',
      network: 'Net\r\nPrivate key:',
      accounts: null
    })
    const lines = text.split('\r\n')
    expect(lines.filter((l) => l.startsWith('Label:'))).toHaveLength(1)
    expect(lines.filter((l) => l.startsWith('Private key:'))).toHaveLength(1)
    expect(lines.filter((l) => l.includes('PVT_K1_fake'))).toHaveLength(1)
    expect(lines.find((l) => l.startsWith('Label:'))!.length).toBeLessThanOrEqual('Label: '.length + 64)
    expect(text.split(/\r\n/).every((l) => !/[\r\n]/.test(l))).toBe(true)
  })

  it('recovery code file', () => {
    const t = recoveryCodeText('AAAAA-BBBBB-CCCCC-DDDDD-EEEEE', new Date('2026-11-24T00:00:00Z'))
    expect(t).toContain('Code: AAAAA-BBBBB-CCCCC-DDDDD-EEEEE')
    expect(t).toContain('Date: 2026-11-24')
  })

  it('never replaces an existing file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wm-kb-'))
    const file = join(dir, 'k.txt')
    writeNewFile(file, 'first')
    expect(() => writeNewFile(file, 'second')).toThrow()
    expect(readFileSync(file, 'utf8')).toBe('first')
  })
})

describe('sync folder check', () => {
  const home = resolve(tmpdir(), 'home-user')
  const env = { USERPROFILE: home, OneDrive: join(home, 'OneDrive') }
  const cases: [string, string | null][] = [
    [join(home, 'OneDrive', 'Documents', 'k.txt'), 'OneDrive'],
    [join(home, 'onedrive', 'k.txt'), 'OneDrive'],
    [join(home, 'OneDrive - Contoso', 'k.txt'), 'OneDrive'],
    [join(home, 'Dropbox', 'keys', 'k.txt'), 'Dropbox'],
    [join(home, 'Dropbox (Personal)', 'k.txt'), 'Dropbox'],
    [join(resolve(tmpdir(), 'G'), 'My Drive', 'k.txt'), 'Google Drive'],
    [join(home, 'Google Drive', 'k.txt'), 'Google Drive'],
    [join(home, 'iCloudDrive', 'k.txt'), 'iCloud Drive'],
    [join(home, 'Documents', 'k.txt'), null],
    [join(home, 'OneDriveBackupNotes', 'k.txt'), null],
    [join(resolve(tmpdir(), 'usb'), 'keys', 'k.txt'), null]
  ]
  for (const [path, want] of cases) {
    it(`${path.split(sep).slice(-3).join('/')}: ${want ?? 'not synchronized'}`, () => {
      expect(syncFolderOf(path, env)).toBe(want)
    })
  }
  it('a OneDrive folder named only by the environment is found too', () => {
    const custom = resolve(tmpdir(), 'cloud-x')
    expect(syncFolderOf(join(custom, 'k.txt'), { OneDriveCommercial: custom })).toBe('OneDrive')
    expect(syncFolderOf(join(custom, 'k.txt'), {})).toBeNull()
  })
})
