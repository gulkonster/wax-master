// Update notice: asks the GitHub Releases API for the latest version at most
// once a day (can be turned off) and only offers to open the release page.
// Nothing is downloaded or installed by the app.

import { app } from 'electron'
import { getSettings, load, save } from './store'
import { request } from './rpc'
import { log } from './log'

const LATEST = 'https://api.github.com'
const PATH = '/repos/gulkonster/wax-master/releases/latest'
export const RELEASES_PAGE = 'https://github.com/gulkonster/wax-master/releases'
const DAY = 24 * 60 * 60 * 1000

export interface UpdateResult {
  current: string
  latest: string | null
  newer: boolean
  url: string
  error?: string
}

/** Compares dotted versions ("1.2.10" > "1.2.9"); a pre-release suffix sorts before the release. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): [number[], string] => {
    const [core, pre = ''] = v.replace(/^v/, '').split('-', 2)
    return [core.split('.').map((x) => Number.parseInt(x, 10) || 0), pre]
  }
  const [ca, pa] = parse(a)
  const [cb, pb] = parse(b)
  for (let i = 0; i < Math.max(ca.length, cb.length); i++) {
    const d = (ca[i] ?? 0) - (cb[i] ?? 0)
    if (d) return d > 0 ? 1 : -1
  }
  if (pa === pb) return 0
  if (!pa) return 1
  if (!pb) return -1
  return pa > pb ? 1 : -1
}

/** The version compared against the release; a test setting can pretend an older one. */
function currentVersion(): string {
  const s = load() as unknown as { settings: { updateTestVersion?: string } }
  const test = s.settings.updateTestVersion
  return typeof test === 'string' && /^\d+\.\d+\.\d+/.test(test) ? test : app.getVersion()
}

export async function checkForUpdates(): Promise<UpdateResult> {
  const current = currentVersion()
  try {
    const r = await request<{ tag_name?: string; html_url?: string; draft?: boolean; prerelease?: boolean }>(LATEST, PATH, { method: 'GET', timeoutMs: 10_000 })
    const latest = typeof r.tag_name === 'string' ? r.tag_name.replace(/^v/, '') : null
    const url = typeof r.html_url === 'string' && r.html_url.startsWith('https://github.com/gulkonster/wax-master/') ? r.html_url : RELEASES_PAGE
    return { current, latest, newer: !!latest && compareVersions(latest, current) > 0, url }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // No published release yet answers 404.
    return { current, latest: null, newer: false, url: RELEASES_PAGE, error: /404|Not Found/i.test(msg) ? undefined : msg }
  }
}

/** Daily check at start-up when allowed by the settings. */
export async function dailyCheck(notify: (r: UpdateResult) => void): Promise<void> {
  if (!getSettings().updateCheck) return
  const s = load() as unknown as { lastUpdateCheck?: number }
  if (s.lastUpdateCheck && Date.now() - s.lastUpdateCheck < DAY) return
  s.lastUpdateCheck = Date.now()
  save()
  const r = await checkForUpdates()
  if (r.error) log.warn(`Update check failed: ${r.error}`)
  if (r.newer) notify(r)
}
