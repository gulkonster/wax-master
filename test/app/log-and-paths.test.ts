import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileSink, redact } from '../../src/main/log'
import { localAbsPath, relPath } from '../../src/shared/validate'

describe('log redaction, unquoted forms', () => {
  it('hides password=value', () => {
    expect(redact('login password=hunter2 ok')).toBe('login password=[redacted] ok')
  })
  it('hides passphrase: value', () => {
    const out = redact('passphrase: swordfish')
    expect(out).toBe('passphrase: [redacted]')
  })
  it('hides pass=value and is case-insensitive', () => {
    expect(redact('PASS=abc123')).not.toContain('abc123')
    expect(redact('Password: abc123')).not.toContain('abc123')
  })
  it('still hides quoted forms', () => {
    const out = redact('{"password":"correct horse","passphrase": "two words"}')
    expect(out).not.toContain('correct')
    expect(out).not.toContain('two words')
  })
  it('leaves unrelated text alone', () => {
    expect(redact('bypass the passage')).toBe('bypass the passage')
  })
})

describe('fileSink', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'waxm-log-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('appends lines', () => {
    const f = join(dir, 'main.log')
    const sink = fileSink(f, 1000)
    sink('one')
    sink('two')
    expect(readFileSync(f, 'utf8')).toBe('one\ntwo\n')
  })
  it('rotates to main.old.log and keeps one old file', () => {
    const f = join(dir, 'main.log')
    const sink = fileSink(f, 20)
    sink('a'.repeat(30))
    sink('second')
    expect(readFileSync(join(dir, 'main.old.log'), 'utf8')).toBe('a'.repeat(30) + '\n')
    expect(readFileSync(f, 'utf8')).toBe('second\n')
    writeFileSync(f, 'b'.repeat(40))
    sink('third')
    expect(readFileSync(join(dir, 'main.old.log'), 'utf8')).toBe('b'.repeat(40))
    expect(readFileSync(f, 'utf8')).toBe('third\n')
    expect(existsSync(join(dir, 'main.old.old.log'))).toBe(false)
  })
})

describe('relPath hardening', () => {
  it('refuses a colon anywhere', () => {
    expect(() => relPath('src/hello.cpp:stream', 'p')).toThrow()
    expect(() => relPath('a:b/c', 'p')).toThrow()
  })
  it('refuses Windows device names with or without extension', () => {
    for (const n of ['CON', 'nul', 'Aux.txt', 'prn.cpp', 'COM1', 'com9.log', 'LPT3', 'src/lpt1.x']) {
      expect(() => relPath(n, 'p'), n).toThrow()
    }
  })
  it('allows names that only start like a device name', () => {
    expect(relPath('console.cpp', 'p')).toBe('console.cpp')
    expect(relPath('com10.txt', 'p')).toBe('com10.txt')
  })
  it('refuses segments ending in a dot or space', () => {
    expect(() => relPath('src/a.', 'p')).toThrow()
    expect(() => relPath('src/a ', 'p')).toThrow()
    expect(() => relPath('dir./a', 'p')).toThrow()
  })
  it('refuses empty segments but allows one trailing slash', () => {
    expect(() => relPath('a//b', 'p')).toThrow()
    expect(relPath('src/', 'p')).toBe('src/')
    expect(() => relPath('src//', 'p')).toThrow()
  })
  it('refuses control characters', () => {
    expect(() => relPath('a\u0001b', 'p')).toThrow()
    expect(() => relPath('a\nb', 'p')).toThrow()
    expect(() => relPath('a\0b', 'p')).toThrow()
  })
  it('keeps normal paths working', () => {
    expect(relPath('src/hello.cpp', 'p')).toBe('src/hello.cpp')
    expect(relPath('include\\a.hpp', 'p')).toBe('include/a.hpp')
    expect(relPath('', 'p')).toBe('')
  })
})

describe('localAbsPath', () => {
  it('accepts drive paths', () => {
    expect(localAbsPath('C:\\Users\\me\\wax', 'p')).toBe('C:\\Users\\me\\wax')
    expect(localAbsPath('d:/work', 'p')).toBe('d:/work')
  })
  it('refuses UNC and device prefixes', () => {
    expect(() => localAbsPath('\\\\server\\share', 'p')).toThrow()
    expect(() => localAbsPath('\\\\?\\C:\\x', 'p')).toThrow()
    expect(() => localAbsPath('\\\\.\\PhysicalDrive0', 'p')).toThrow()
    expect(() => localAbsPath('//server/share', 'p')).toThrow()
  })
  it('refuses relative, drive-relative and .. paths', () => {
    expect(() => localAbsPath('work', 'p')).toThrow()
    expect(() => localAbsPath('C:work', 'p')).toThrow()
    expect(() => localAbsPath('\\work', 'p')).toThrow()
    expect(() => localAbsPath('C:\\a\\..\\b', 'p')).toThrow()
    expect(() => localAbsPath('C:/a/../b', 'p')).toThrow()
  })
  it('refuses stream colons, control characters and non-text', () => {
    expect(() => localAbsPath('C:\\a:stream', 'p')).toThrow()
    expect(() => localAbsPath('C:\\a\u0000b', 'p')).toThrow()
    expect(() => localAbsPath(5, 'p')).toThrow()
  })
})
