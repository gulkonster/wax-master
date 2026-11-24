// Find in Files: plain-text search over the open project's text files.

import { promises as fsp, type Dirent } from 'node:fs'
import { join, relative, sep } from 'node:path'
import type { SearchMatch, SearchResult } from '../shared/api'
import { currentProject } from './projects'

const SKIP_DIRS = new Set(['.git', 'node_modules'])
const SKIP_EXT = /\.(wasm|png|jpe?g|gif|ico|zip|gz|7z|exe|dll|so|o|a|pdf|bin)$/i
const MAX_FILE = 2 * 1024 * 1024
const MAX_FILES = 5000
const MAX_MATCHES = 2000
const MAX_LINE = 300

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function searchPattern(query: string, matchCase: boolean, wholeWord: boolean): RegExp {
  const body = escapeRegExp(query)
  return new RegExp(wholeWord ? `(?<![A-Za-z0-9_])${body}(?![A-Za-z0-9_])` : body, matchCase ? 'g' : 'gi')
}

/** Finds `query` in one file's text; at most `limit` matches. */
export function searchText(file: string, text: string, re: RegExp, limit: number): SearchMatch[] {
  const out: SearchMatch[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length && out.length < limit; i++) {
    const line = lines[i].replace(/\r$/, '')
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(line)) && out.length < limit) {
      const start = Math.max(0, m.index - 80)
      out.push({
        file,
        line: i + 1,
        column: m.index + 1,
        length: m[0].length,
        text: (start > 0 ? '…' : '') + line.slice(start, start + MAX_LINE)
      })
      if (m[0].length === 0) re.lastIndex++
    }
  }
  return out
}

export async function searchProject(query: string, matchCase: boolean, wholeWord: boolean): Promise<SearchResult> {
  const p = currentProject()
  if (!p) throw new Error('No project is open')
  const result: SearchResult = { matches: [], filesSearched: 0, truncated: false }
  if (!query) return result
  const re = searchPattern(query, matchCase, wholeWord)
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 12 || result.truncated) return
    let entries: Dirent[]
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const e of entries) {
      if (result.truncated) return
      if (e.isSymbolicLink() || SKIP_DIRS.has(e.name)) continue
      const abs = join(dir, e.name)
      if (e.isDirectory()) {
        await walk(abs, depth + 1)
        continue
      }
      if (!e.isFile() || SKIP_EXT.test(e.name)) continue
      if (result.filesSearched >= MAX_FILES) {
        result.truncated = true
        return
      }
      let buf: Buffer
      try {
        const st = await fsp.stat(abs)
        if (st.size > MAX_FILE) continue
        buf = await fsp.readFile(abs)
      } catch {
        continue
      }
      if (buf.subarray(0, 8000).includes(0)) continue
      result.filesSearched++
      const rel = relative(p.root, abs).split(sep).join('/')
      const found = searchText(rel, buf.toString('utf8'), re, MAX_MATCHES - result.matches.length)
      result.matches.push(...found)
      if (result.matches.length >= MAX_MATCHES) result.truncated = true
    }
  }
  await walk(p.root, 0)
  return result
}
