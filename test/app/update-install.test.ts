import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const temp = mkdtempSync(join(tmpdir(), 'wm-update-test-'))
vi.mock('electron', () => ({ app: { getPath: () => temp, getVersion: () => '1.0.0', isPackaged: false, quit: vi.fn() } }))
vi.mock('../../src/main/store', () => ({ load: () => ({ settings: {} }), save: () => undefined, getSettings: () => ({ updateCheck: true }) }))
vi.mock('../../src/main/log', () => ({ log: { info: () => undefined, warn: () => undefined } }))
const release = { tag_name: 'v1.1.0', assets: [] as unknown[] }
vi.mock('../../src/main/rpc', () => ({ request: async () => release }))

import { allowedDownloadUrl, cancelUpdateDownload, downloadUpdate, installUpdate, releaseFiles, sumFor, updateFolder } from '../../src/main/update-install'

const BASE = 'https://github.com/gulkonster/wax-master/releases/download/v1.1.0/'
const NAME = 'WAX-Master-Setup-1.1.0.exe'
const body = new Uint8Array(300_000).map((_, i) => i % 251)
const sha = createHash('sha256').update(body).digest('hex')

function setRelease(): void {
  release.tag_name = 'v1.1.0'
  release.assets = [
    { name: NAME, browser_download_url: BASE + NAME, size: body.length },
    { name: 'SHA256SUMS.txt', browser_download_url: BASE + 'SHA256SUMS.txt', size: 100 }
  ]
}

/** GitHub as seen by the app: the release address redirects to the file storage. */
function github(opts: { sums?: string; installer?: Uint8Array; redirectTo?: string; slow?: boolean } = {}): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: { signal: AbortSignal }) => {
      if (url.startsWith(BASE)) {
        const file = url.slice(BASE.length)
        return new Response(null, { status: 302, headers: { location: (opts.redirectTo ?? 'https://release-assets.githubusercontent.com/x/') + file } })
      }
      if (url.endsWith('SHA256SUMS.txt')) return new Response(opts.sums ?? `${sha}  ${NAME}\n`)
      if (url.endsWith(NAME)) {
        const data = opts.installer ?? body
        const stream = new ReadableStream<Uint8Array>({
          async start(c) {
            for (let i = 0; i < data.length; i += 50_000) {
              if (init.signal.aborted) return c.error(new Error('aborted'))
              c.enqueue(data.slice(i, i + 50_000))
              if (opts.slow) await new Promise((r) => setTimeout(r, 30))
            }
            c.close()
          }
        })
        return new Response(stream, { headers: { 'content-length': String(data.length) } })
      }
      return new Response('', { status: 404 })
    })
  )
}

beforeEach(() => setRelease())
afterEach(() => {
  vi.unstubAllGlobals()
  rmSync(updateFolder(), { recursive: true, force: true })
})

describe('update download helpers', () => {
  it('finds the installer and the checksum file of the release, only on the project address', () => {
    expect(releaseFiles('1.1.0', release.assets)?.installer.url).toBe(BASE + NAME)
    expect(releaseFiles('1.1.0', [{ name: NAME, browser_download_url: 'https://evil.example/' + NAME }, release.assets[1]])).toBeNull()
    expect(releaseFiles('1.1.0', [release.assets[0]])).toBeNull()
    expect(releaseFiles('1.1.0', null)).toBeNull()
  })
  it('reads the line of the file from SHA256SUMS.txt', () => {
    const t = `${'a'.repeat(64)}  other.exe\r\n${'B'.repeat(64)} *${NAME}\n`
    expect(sumFor(t, NAME)).toBe('b'.repeat(64))
    expect(sumFor(t, 'missing.exe')).toBeNull()
  })
  it('follows only https addresses of GitHub', () => {
    expect(allowedDownloadUrl('https://github.com/x')).toBe(true)
    expect(allowedDownloadUrl('https://objects.githubusercontent.com/x')).toBe(true)
    expect(allowedDownloadUrl('http://github.com/x')).toBe(false)
    expect(allowedDownloadUrl('https://githubusercontent.com.evil.example/x')).toBe(false)
    expect(allowedDownloadUrl('https://evil.example/x')).toBe(false)
  })
})

describe('downloadUpdate', () => {
  it('downloads, reports progress and keeps a file whose SHA-256 matches', async () => {
    github()
    const seen: number[] = []
    const r = await downloadUpdate((p) => seen.push(p.received))
    expect(r).toEqual({ version: '1.1.0', bytes: body.length, sha256: sha })
    expect(seen.at(-1)).toBe(body.length)
    expect(existsSync(join(updateFolder(), NAME))).toBe(true)
  })
  it('deletes a file that does not match and says why', async () => {
    github({ installer: body.map((b) => (b + 1) % 256) })
    await expect(downloadUpdate(() => undefined)).rejects.toThrow(/does not match SHA256SUMS.txt.*nothing was installed/s)
    expect(readdirSync(updateFolder())).toEqual([])
  })
  it('refuses a checksum file without a line for the installer', async () => {
    github({ sums: `${sha}  other.exe\n` })
    await expect(downloadUpdate(() => undefined)).rejects.toThrow(/no line for WAX-Master-Setup-1.1.0.exe/)
  })
  it('refuses a redirect away from GitHub', async () => {
    github({ redirectTo: 'https://evil.example/' })
    await expect(downloadUpdate(() => undefined)).rejects.toThrow(/not GitHub/)
  })
  it('refuses a release that is not newer', async () => {
    release.tag_name = 'v1.0.0'
    github()
    await expect(downloadUpdate(() => undefined)).rejects.toThrow(/No newer version/)
  })
  it('stops on Cancel and leaves no file', async () => {
    github({ slow: true })
    const run = downloadUpdate(() => undefined)
    setTimeout(() => cancelUpdateDownload(), 40)
    await expect(run).rejects.toThrow('Download cancelled; nothing was installed.')
    expect(existsSync(join(updateFolder(), NAME))).toBe(false)
  })
  it('installs only from an installed app', async () => {
    github()
    await downloadUpdate(() => undefined)
    await expect(installUpdate(() => undefined)).rejects.toThrow(/development build/)
  })
})
