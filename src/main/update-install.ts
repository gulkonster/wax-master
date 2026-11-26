// Download and install of a new version, only when the user asks (E58).
//
// The installer of the latest release is downloaded from the project's release address,
// checked against the same release's SHA256SUMS.txt and kept in the temp folder. Install
// checks the file once more, lets the app close (the local chain stops as at every quit)
// and starts the installer when the app is closing for good. The window never names a file:
// only a file this process downloaded and checked can be started.

import { app } from 'electron'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { createReadStream, createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { LATEST, PATH, compareVersions, currentVersion } from './updates'
import { request } from './rpc'
import { log } from './log'
import type { UpdateDownload, UpdateProgress } from '../shared/api'

const DOWNLOAD_PREFIX = 'https://github.com/gulkonster/wax-master/releases/download/'
const MAX_INSTALLER = 1024 * 1024 * 1024
const MAX_SUMS = 64 * 1024
const STALL_MS = 60_000
const MAX_REDIRECTS = 5

export interface ReleaseAsset {
  name: string
  url: string
  size: number
}

/** The installer and the checksum file of a release, from the API's asset list; null when one is missing or not on the project's download address. */
export function releaseFiles(version: string, assets: unknown): { installer: ReleaseAsset; sums: ReleaseAsset } | null {
  if (!Array.isArray(assets)) return null
  const pick = (name: string): ReleaseAsset | null => {
    const a = assets.find((x) => !!x && typeof x === 'object' && (x as { name?: unknown }).name === name) as
      | { browser_download_url?: unknown; size?: unknown }
      | undefined
    if (!a || typeof a.browser_download_url !== 'string' || !a.browser_download_url.startsWith(DOWNLOAD_PREFIX)) return null
    return { name, url: a.browser_download_url, size: typeof a.size === 'number' && a.size > 0 ? a.size : 0 }
  }
  const installer = pick(`WAX-Master-Setup-${version}.exe`)
  const sums = pick('SHA256SUMS.txt')
  return installer && sums ? { installer, sums } : null
}

/** The SHA-256 (lower case) that a SHA256SUMS.txt text gives for `file`, or null. */
export function sumFor(text: string, file: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line.trim())
    if (m && m[2] === file) return m[1].toLowerCase()
  }
  return null
}

/** The release address sends the file on to GitHub's file storage; nothing else is followed. */
export function allowedDownloadUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && (u.hostname === 'github.com' || u.hostname.endsWith('.githubusercontent.com'))
  } catch {
    return false
  }
}

/** GET with redirects followed by hand, each address checked. */
async function fetchChecked(url: string, signal: AbortSignal): Promise<Response> {
  let at = url
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    if (!allowedDownloadUrl(at)) throw new Error('The download was sent to an address that is not GitHub; nothing was installed.')
    const res = await fetch(at, { redirect: 'manual', signal, credentials: 'omit' })
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location')
      if (!next) throw new Error(`GitHub answered ${res.status} without an address.`)
      at = new URL(next, at).toString()
      continue
    }
    if (!res.ok || !res.body) throw new Error(`GitHub answered ${res.status} for ${url.split('/').pop()}.`)
    return res
  }
  throw new Error('Too many redirects for the download.')
}

export function updateFolder(): string {
  return join(app.getPath('temp'), 'wax-master-update')
}

/** Removes downloads of an earlier run (an installer that ran or was never used). */
export function cleanUpdateFolder(): void {
  try {
    rmSync(updateFolder(), { recursive: true, force: true })
  } catch {
    // A file still in use is removed next time.
  }
}

let ready: (UpdateDownload & { file: string }) | null = null
let running: { abort: AbortController; why: string | null } | null = null
let pendingInstaller: string | null = null

export function cancelUpdateDownload(): void {
  if (!running) return
  running.why = 'Download cancelled; nothing was installed.'
  running.abort.abort()
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

export async function downloadUpdate(progress: (p: UpdateProgress) => void): Promise<UpdateDownload> {
  if (running) throw new Error('A download is already running.')
  const job = { abort: new AbortController(), why: null as string | null }
  running = job
  ready = null
  let file: string | null = null
  let stall: NodeJS.Timeout | null = null
  const watch = (): void => {
    if (stall) clearTimeout(stall)
    stall = setTimeout(() => {
      job.why = `The download stopped: no data for ${STALL_MS / 1000} s. Nothing was installed; try again.`
      job.abort.abort()
    }, STALL_MS)
  }
  try {
    watch()
    const r = await request<{ tag_name?: string; assets?: unknown }>(LATEST, PATH, { method: 'GET', timeoutMs: 15_000 })
    const version = typeof r.tag_name === 'string' ? r.tag_name.replace(/^v/, '') : ''
    if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version)) throw new Error('The latest release has no version number; nothing was downloaded.')
    const current = currentVersion()
    if (compareVersions(version, current) <= 0) throw new Error(`No newer version: the latest release is ${version} and you have ${current}.`)
    const files = releaseFiles(version, r.assets)
    if (!files) throw new Error(`Release ${version} has no WAX-Master-Setup-${version}.exe or no SHA256SUMS.txt; nothing was downloaded. Use the release page.`)
    if (files.installer.size > MAX_INSTALLER) throw new Error(`The installer of release ${version} is larger than 1 GB; nothing was downloaded.`)

    const sumsText = await (await fetchChecked(files.sums.url, job.abort.signal)).text()
    if (sumsText.length > MAX_SUMS) throw new Error('SHA256SUMS.txt is too large; nothing was downloaded.')
    const expected = sumFor(sumsText, files.installer.name)
    if (!expected) throw new Error(`SHA256SUMS.txt of release ${version} has no line for ${files.installer.name}; nothing was downloaded.`)

    cleanUpdateFolder()
    mkdirSync(updateFolder(), { recursive: true })
    file = join(updateFolder(), files.installer.name)
    const res = await fetchChecked(files.installer.url, job.abort.signal)
    const total = Number(res.headers.get('content-length')) || files.installer.size
    const hash = createHash('sha256')
    const out = createWriteStream(file)
    let received = 0
    let shown = 0
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        // Stopped (Cancel or no data): ends here even if the stream did not end itself.
        if (job.abort.signal.aborted) throw new Error('aborted')
        watch()
        received += chunk.length
        if (received > MAX_INSTALLER) throw new Error('The download is larger than 1 GB; it was stopped and nothing was installed.')
        hash.update(chunk)
        if (!out.write(chunk)) await once(out, 'drain')
        if (Date.now() - shown > 250) {
          shown = Date.now()
          progress({ received, total })
        }
      }
    } finally {
      out.end()
      await once(out, 'close')
    }
    progress({ received, total })
    const got = hash.digest('hex')
    if (got !== expected) {
      throw new Error(
        `The downloaded installer does not match SHA256SUMS.txt of release ${version} (expected ${expected}, got ${got}). ` +
          'It was deleted and nothing was installed. Try again later, or download it from the release page and verify it there.'
      )
    }
    ready = { version, file, bytes: received, sha256: got }
    log.info(`Update ${version} downloaded and checked (${received} bytes, SHA-256 ${got})`)
    return { version, bytes: received, sha256: got }
  } catch (e) {
    if (file) rmSync(file, { force: true })
    if (job.why) throw new Error(job.why)
    throw e
  } finally {
    if (stall) clearTimeout(stall)
    running = null
  }
}

/** Checks the downloaded installer once more and lets the app close; the installer starts at will-quit. */
export async function installUpdate(allowQuit: () => void): Promise<void> {
  if (!app.isPackaged) throw new Error('Only an installed WAX Master can install an update; this is a development build.')
  const r = ready
  if (!r || !existsSync(r.file)) throw new Error('No checked download is waiting; press Download and install again.')
  if ((await sha256File(r.file)) !== r.sha256) {
    rmSync(r.file, { force: true })
    ready = null
    throw new Error('The downloaded installer changed after it was checked; it was deleted and nothing was installed. Download it again.')
  }
  pendingInstaller = r.file
  log.info(`Update ${r.version}: WAX Master closes and the installer starts`)
  allowQuit()
  app.quit()
}

/** At will-quit: starts the checked installer, on its own, once the app is closing for good. */
export function runPendingInstaller(): void {
  const f = pendingInstaller
  if (!f) return
  pendingInstaller = null
  try {
    spawn(f, [], { detached: true, stdio: 'ignore', windowsHide: false }).unref()
  } catch (e) {
    log.warn(`The update installer did not start: ${e instanceof Error ? e.message : String(e)}`)
  }
}
