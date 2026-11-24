// The documentation shipped with the app: the index format, topic ids, file
// names, the commands a topic may offer as a button, and the search. Used by
// the main process (which file may be read), the editor page and the tests.

import type { MenuCommand } from './api'
import { MENU_MODEL, type MenuModelItem } from './menu-model'

/** The index file of the documentation folder. */
export const DOCS_INDEX_FILE = 'index.json'
/** Size limits of the files the main process reads. */
export const MAX_DOCS_INDEX_BYTES = 64 * 1024
export const MAX_DOCS_TOPIC_BYTES = 256 * 1024
export const MAX_TOPIC_ID = 64

/** A topic id: lower-case letters and digits in groups joined by single dashes. */
const TOPIC_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/
/** Names Windows reserves for devices; never a topic id, so never a file name. */
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/

export function isTopicId(v: unknown): v is string {
  return typeof v === 'string' && v.length <= MAX_TOPIC_ID && TOPIC_ID.test(v) && !RESERVED.test(v)
}

/** The file of a topic: `<id>.md` in the documentation folder. */
export function topicFile(id: string): string {
  return `${id}.md`
}

/** True for the only names the documentation call accepts: the index and `<topic id>.md`. */
export function isDocsFileName(v: unknown): v is string {
  if (v === DOCS_INDEX_FILE) return true
  return typeof v === 'string' && v.endsWith('.md') && isTopicId(v.slice(0, -3))
}

export interface DocsTopicEntry {
  id: string
  title: string
  /** Extra search words; a topic whose keywords hold the query ranks right after title matches. */
  keywords: string[]
}
export interface DocsGroup {
  id: string | null
  title: string
  topics: DocsTopicEntry[]
}
export interface DocsIndex {
  groups: DocsGroup[]
}

function text(v: unknown, field: string, max: number): string {
  if (typeof v !== 'string' || v.trim() === '' || v.length > max) throw new Error(`${field}: expected text of 1 to ${max} characters`)
  return v
}

/**
 * Reads index.json:
 * `{ "version": 1, "groups": [ { "id": "start", "title": "...", "topics": [ { "id": "...", "title": "...", "keywords": ["..."] } ] } ] }`.
 * `version`, the group `id` and `keywords` may be left out. Unknown keys, another version,
 * a malformed id or a topic id used twice make the whole index invalid.
 */
export function parseDocsIndex(json: string): DocsIndex {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new Error('The documentation index is not valid JSON')
  }
  const only = (o: unknown, keys: string[], field: string): Record<string, unknown> => {
    if (typeof o !== 'object' || o === null || Array.isArray(o)) throw new Error(`${field}: expected an object`)
    for (const k of Object.keys(o)) if (!keys.includes(k)) throw new Error(`${field}: unknown key "${k}"`)
    return o as Record<string, unknown>
  }
  const root = only(raw, ['version', 'groups'], 'index')
  if ('version' in root && root.version !== 1) throw new Error('index.version: only version 1 is known')
  if (!Array.isArray(root.groups) || root.groups.length === 0 || root.groups.length > 100) throw new Error('index.groups: expected 1 to 100 groups')
  const seen = new Set<string>()
  const groups = root.groups.map((g, gi): DocsGroup => {
    const go = only(g, ['id', 'title', 'topics'], `groups[${gi}]`)
    if ('id' in go && !isTopicId(go.id)) throw new Error(`groups[${gi}].id: lower-case letters, digits and single dashes`)
    if (!Array.isArray(go.topics) || go.topics.length === 0 || go.topics.length > 200) throw new Error(`groups[${gi}].topics: expected 1 to 200 topics`)
    return {
      id: typeof go.id === 'string' ? go.id : null,
      title: text(go.title, `groups[${gi}].title`, 80),
      topics: go.topics.map((t, ti): DocsTopicEntry => {
        const field = `groups[${gi}].topics[${ti}]`
        const to = only(t, ['id', 'title', 'keywords'], field)
        if (!isTopicId(to.id)) throw new Error(`${field}.id: lower-case letters, digits and single dashes, at most ${MAX_TOPIC_ID} characters`)
        if (seen.has(to.id)) throw new Error(`${field}.id: "${to.id}" is used twice`)
        seen.add(to.id)
        let keywords: string[] = []
        if ('keywords' in to) {
          if (!Array.isArray(to.keywords) || to.keywords.length > 40) throw new Error(`${field}.keywords: expected at most 40 words`)
          keywords = to.keywords.map((k, ki) => text(k, `${field}.keywords[${ki}]`, 60))
        }
        return { id: to.id, title: text(to.title, `${field}.title`, 120), keywords }
      })
    }
  })
  return { groups }
}

export function allTopics(index: DocsIndex): DocsTopicEntry[] {
  return index.groups.flatMap((g) => g.topics)
}

/** The menu commands a topic may offer as a button: every command item of the menu (none takes a parameter). */
export function docsCommands(): ReadonlySet<MenuCommand> {
  const out = new Set<MenuCommand>()
  const walk = (items: readonly MenuModelItem[]): void => {
    for (const i of items) {
      if (i.kind === 'command') out.add(i.command)
      else if (i.kind === 'submenu') walk(i.items)
    }
  }
  for (const m of MENU_MODEL) walk(m.items)
  return out
}

// ------------------------------------------------------------------ search

export interface SearchDoc {
  id: string
  title: string
  group: string
  /** Keywords of the index entry. */
  keywords: string
  /** Text of the headings. */
  headings: string
  /** Plain text of the whole topic. */
  body: string
}

export interface SearchHit {
  id: string
  title: string
  group: string
  /** A short piece of text around the first match; empty for a title match without body match. */
  snippet: string
}

/** Lower-case words of a text; dots inside a word stay (eosio.code), at the ends they go. */
export function words(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9_.@]+/g) ?? []).map((w) => w.replace(/^\.+|\.+$/g, '')).filter((w) => w !== '')
}

/** A word of the text matches a word of the query when equal, or when it starts with a query word of 4 or more letters. */
function matches(textWord: string, q: string): boolean {
  return textWord === q || (q.length >= 4 && textWord.startsWith(q))
}

function countAll(textWords: string[], query: string[]): number {
  let total = 0
  for (const q of query) {
    const n = textWords.filter((w) => matches(w, q)).length
    if (n === 0) return 0
    total += n
  }
  return total
}

function snippet(body: string, query: string[]): string {
  const lower = body.toLowerCase()
  let at = -1
  for (const q of query) {
    const re = new RegExp(`(^|[^a-z0-9_.@])${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
    const m = re.exec(lower)
    if (m && (at < 0 || m.index < at)) at = m.index + m[1].length
  }
  if (at < 0) return ''
  const start = Math.max(0, at - 60)
  const end = Math.min(body.length, at + 100)
  return `${start > 0 ? '...' : ''}${body.slice(start, end).replace(/\s+/g, ' ').trim()}${end < body.length ? '...' : ''}`
}

/**
 * Plain word search: every query word must appear. Topics whose title holds
 * every word come first, then those whose keywords do, then those whose
 * headings do, then the rest; inside each tier, more matches first, then the
 * order of the index.
 */
export function searchDocs(query: string, docs: readonly SearchDoc[]): SearchHit[] {
  const q = [...new Set(words(query))]
  if (q.length === 0) return []
  const scored: { hit: SearchHit; tier: number; count: number; order: number }[] = []
  docs.forEach((d, order) => {
    const title = countAll(words(d.title), q)
    const keys = countAll(words(d.keywords), q)
    const head = countAll(words(d.headings), q)
    const body = countAll(words(d.body), q)
    if (title === 0 && keys === 0 && head === 0 && body === 0) return
    const tier = title > 0 ? 0 : keys > 0 ? 1 : head > 0 ? 2 : 3
    scored.push({ hit: { id: d.id, title: d.title, group: d.group, snippet: snippet(d.body, q) }, tier, count: body + head, order })
  })
  scored.sort((a, b) => a.tier - b.tier || b.count - a.count || a.order - b.order)
  return scored.map((s) => s.hit)
}
