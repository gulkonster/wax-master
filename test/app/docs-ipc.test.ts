// The one documentation call: only index.json, search-words.json and <topic id>.md of the shipped
// folder, nothing outside it, nothing over the size limits; sender rules and
// malformed input like every editor call.

import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

type Fn = (e: unknown, ...a: unknown[]) => Promise<unknown>

const h = vi.hoisted(() => ({
  appDir: '',
  handlers: new Map<string, (e: unknown, ...a: unknown[]) => Promise<unknown>>()
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => h.appDir,
    getAppPath: () => h.appDir,
    getVersion: () => '0.0.0',
    on: () => undefined
  },
  ipcMain: { handle: (ch: string, fn: Fn) => h.handlers.set(ch, fn) },
  dialog: {},
  shell: {},
  protocol: {},
  session: {},
  net: {},
  utilityProcess: {},
  BrowserWindow: class {}
}))

import { registerIpc } from '../../src/main/ipc'
import { docsDir, readDocsFile } from '../../src/main/docs'
import { MAX_DOCS_INDEX_BYTES, MAX_DOCS_TOPIC_BYTES, MAX_DOCS_WORDS_BYTES, SEARCH_WORDS_FILE } from '../../src/shared/docs'

function event(url: string, mainFrame = true): unknown {
  const frame = { url }
  return { senderFrame: frame, sender: { id: 1, mainFrame: mainFrame ? frame : {}, send: () => undefined, isDestroyed: () => false } }
}
const good = event('app://bundle/index.html')

let help = ''
let outside = ''

beforeAll(() => {
  h.appDir = mkdtempSync(join(tmpdir(), 'wm-docs-'))
  help = join(h.appDir, 'docs', 'help')
  mkdirSync(help, { recursive: true })
  writeFileSync(join(help, 'index.json'), '{"groups":[{"title":"G","topics":[{"id":"a","title":"A"}]}]}')
  writeFileSync(join(help, 'a.md'), '\uFEFF# A\n\nText.')
  writeFileSync(join(help, SEARCH_WORDS_FILE), '{"groups":[["blend","craft"]]}')
  writeFileSync(join(help, 'big.md'),'x'.repeat(MAX_DOCS_TOPIC_BYTES + 1))
  writeFileSync(join(help, 'binary.md'), 'a\u0000b')
  mkdirSync(join(help, 'folder.md'))
  outside = join(h.appDir, 'secret.md')
  writeFileSync(outside, 'outside the folder')
  writeFileSync(join(h.appDir, 'docs', 'up.md'), 'one level up')
  registerIpc(() => null)
})

describe('reading a documentation file', () => {
  it('the folder is docs/help of the source tree when not installed', () => {
    expect(docsDir()).toBe(help)
  })
  it('reads the index and a topic (without a byte order mark)', () => {
    expect(readDocsFile(help, 'index.json')).toContain('"groups"')
    expect(readDocsFile(help, 'a.md')).toBe('# A\n\nText.')
  })
  it('refuses every other name, before touching the disk', () => {
    for (const name of ['../up.md', '..\\up.md', '../../secret.md', 'C:\\Windows\\win.ini', '/etc/passwd', 'a/b.md', 'a.md:stream', 'A.md', 'a.txt', 'index.JSON', 'con.md', '', '.md', 7, null, undefined, {}]) {
      expect(() => readDocsFile(help, name), String(name)).toThrow('Unknown documentation file')
    }
  })
  it('refuses a file over its size limit, a file that is not text, a folder and a missing file', () => {
    expect(() => readDocsFile(help, 'big.md')).toThrow('larger than')
    expect(() => readDocsFile(help, 'binary.md')).toThrow('not text')
    expect(() => readDocsFile(help, 'folder.md')).toThrow('Unknown documentation file')
    expect(() => readDocsFile(help, 'missing.md')).toThrow('missing')
  })
  it('reads the similar-word list, which has its own limit', () => {
    expect(readDocsFile(help, SEARCH_WORDS_FILE)).toContain('blend')
    const dir = mkdtempSync(join(tmpdir(), 'wm-docs-words-'))
    writeFileSync(join(dir, SEARCH_WORDS_FILE), ' '.repeat(MAX_DOCS_WORDS_BYTES + 1))
    expect(() => readDocsFile(dir, SEARCH_WORDS_FILE)).toThrow('larger than')
    for (const name of ['search-words.JSON', 'words.json', '../search-words.json']) expect(() => readDocsFile(help, name), name).toThrow('Unknown documentation file')
  })
  it('the index has its own, smaller limit', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wm-docs-big-'))
    writeFileSync(join(dir, 'index.json'), ' '.repeat(MAX_DOCS_INDEX_BYTES + 1))
    expect(() => readDocsFile(dir, 'index.json')).toThrow('larger than')
  })
  it('refuses a link in the folder that points outside it', (ctx) => {
    try {
      symlinkSync(outside, join(help, 'link.md'), 'file')
    } catch {
      // Creating links needs a right this account may not have; nothing to check then.
      ctx.skip()
      return
    }
    expect(() => readDocsFile(help, 'link.md')).toThrow('Unknown documentation file')
  })
})

describe('docs:read', () => {
  const foreign: [string, unknown][] = [
    ['a foreign origin', event('https://example.com/index.html')],
    ['the confirmation page', event('app://bundle/confirm.html')],
    ['the terminal page', event('app://bundle/terminal.html')],
    ['the terminal frame', event('app://terminal/terminal.html', false)],
    ['a sub frame of the editor page', event('app://bundle/index.html', false)]
  ]
  for (const [name, ev] of foreign) {
    it(`refuses ${name}`, async () => {
      await expect(h.handlers.get('docs:read')!(ev, 'index.json')).rejects.toThrow('Refused')
    })
  }
  for (const bad of [[7], [null], [{}], [['a.md']], ['x'.repeat(81)], ['../up.md'], ['..\\..\\secret.md'], ['C:/x.md'], ['a.md', 'extra'], ['notes.txt'], []]) {
    it(`refuses ${JSON.stringify(bad).slice(0, 40)}`, async () => {
      await expect(h.handlers.get('docs:read')!(good, ...bad)).rejects.toThrow()
    })
  }
  it('answers the editor page with the similar-word list', async () => {
    await expect(h.handlers.get('docs:read')!(good, SEARCH_WORDS_FILE)).resolves.toContain('craft')
  })
  it('answers the editor page with the file text', async () => {
    await expect(h.handlers.get('docs:read')!(good, 'a.md')).resolves.toBe('# A\n\nText.')
  })
  it('the editor preload exposes the call', () => {
    const preload = readFileSync(join(__dirname, '../../src/preload/index.ts'), 'utf8')
    expect(preload).toContain("call('docs:read')")
  })
})
