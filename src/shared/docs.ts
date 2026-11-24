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

/** True for the only names the documentation call accepts: the index, the similar-word list and `<topic id>.md`. */
export function isDocsFileName(v: unknown): v is string {
  if (v === DOCS_INDEX_FILE || v === SEARCH_WORDS_FILE) return true
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

// ------------------------------------------------------------------ similar words

/** The file of similar-word groups next to the index. */
export const SEARCH_WORDS_FILE = 'search-words.json'
export const MAX_DOCS_WORDS_BYTES = 64 * 1024
const MAX_WORD_GROUPS = 400
const MAX_GROUP_ENTRIES = 20
const MAX_ENTRY_LENGTH = 40
const MAX_ENTRY_WORDS = 4

/** Groups of words or short phrases that mean the same everywhere in the documentation. */
export interface SearchWords {
  groups: string[][]
}
export const NO_SEARCH_WORDS: SearchWords = { groups: [] }

/**
 * Reads search-words.json: `{ "version": 1, "groups": [["blend", "craft", "merge"], ["nft", "asset"]] }`.
 * Each entry is a lower-case word or a short phrase of words separated by single spaces.
 * Unknown keys, another version, too many or too long entries make the whole list invalid.
 */
export function parseSearchWords(json: string): SearchWords {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new Error('The similar-word list is not valid JSON')
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('words: expected an object')
  for (const k of Object.keys(raw)) if (k !== 'version' && k !== 'groups') throw new Error(`words: unknown key "${k}"`)
  const root = raw as Record<string, unknown>
  if ('version' in root && root.version !== 1) throw new Error('words.version: only version 1 is known')
  if (!Array.isArray(root.groups) || root.groups.length > MAX_WORD_GROUPS) throw new Error(`words.groups: expected at most ${MAX_WORD_GROUPS} groups`)
  const groups = root.groups.map((g, gi): string[] => {
    if (!Array.isArray(g) || g.length < 2 || g.length > MAX_GROUP_ENTRIES) throw new Error(`words.groups[${gi}]: expected 2 to ${MAX_GROUP_ENTRIES} entries`)
    return g.map((e, ei): string => {
      const field = `words.groups[${gi}][${ei}]`
      if (typeof e !== 'string' || e.length === 0 || e.length > MAX_ENTRY_LENGTH) throw new Error(`${field}: expected text of 1 to ${MAX_ENTRY_LENGTH} characters`)
      const w = words(e)
      if (w.join(' ') !== e || w.length > MAX_ENTRY_WORDS) throw new Error(`${field}: lower-case words separated by single spaces, at most ${MAX_ENTRY_WORDS}`)
      return e
    })
  })
  return { groups }
}

// ------------------------------------------------------------------ search

export interface SearchDoc {
  id: string
  title: string
  group: string
  /** Keywords of the index entry: the list, or one text. */
  keywords: string | readonly string[]
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

export interface SearchResult {
  hits: SearchHit[]
  /** No page has every word: the hits are the pages with the most of them. */
  partial: boolean
  /** Words of the documentation searched instead of a mistyped query word. */
  corrected: string[]
}

/** Lower-case words of a text; dots inside a word stay (eosio.code), at the ends they go. */
export function words(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9_.@]+/g) ?? []).map((w) => w.replace(/^\.+|\.+$/g, '')).filter((w) => w !== '')
}

/** Small words of a question, dropped from the query unless nothing else is left. */
const QUESTION_WORDS = new Set(['how', 'to', 'do', 'i', 'a', 'the', 'is', 'what', 'in', 'of', 'my', 'can', 'with', 'for', 'and', 'does', 'why'])

/**
 * The stem of a word: a plural ending (`ies` to `y`, `es`, `s`), then a verb
 * ending (`ing`, `ed`), then a final `e` go, never below 3 letters. Words with a
 * digit, `_`, `.` or `@` stay as they are.
 */
export function stem(w: string): string {
  if (/[0-9_.@]/.test(w)) return w
  let s = w
  const cut = (end: string, add = ''): boolean => {
    if (!s.endsWith(end) || s.length - end.length + add.length < 3) return false
    s = s.slice(0, s.length - end.length) + add
    return true
  }
  if (!cut('ies', 'y') && !cut('es') && !s.endsWith('ss')) cut('s')
  if (!cut('ing')) cut('ed')
  if (s.length > 3 && s.endsWith('e')) s = s.slice(0, -1)
  return s
}

/** Edit distance with a swap of two neighbours counting as one; any result above `max` is `max + 1`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev2: number[] = []
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let low = i
    for (let j = 1; j <= b.length; j++) {
      let d = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2] + 1)
      cur.push(d)
      if (d < low) low = d
    }
    if (low > max) return max + 1
    prev2 = prev
    prev = cur
  }
  return Math.min(prev[b.length], max + 1)
}

/** One word of a text: the word, its stem, and where it starts. A word with `_`, `.` or `@` inside is followed by its parts. */
interface Tok {
  w: string
  s: string
  at: number
}

function tokens(text: string): Tok[] {
  const out: Tok[] = []
  for (const m of text.toLowerCase().matchAll(/[a-z0-9_.@]+/g)) {
    const w = m[0].replace(/^\.+|\.+$/g, '')
    if (w === '') continue
    const at = (m.index ?? 0) + m[0].indexOf(w)
    out.push({ w, s: stem(w), at })
    if (/[_.@]/.test(w)) for (const p of w.split(/[_.@]+/)) if (p !== '') out.push({ w: p, s: stem(p), at })
  }
  return out
}

const stemKey = (ws: readonly string[]): string => ws.map(stem).join(' ')

/** Field weights: title, keywords, headings, body. */
const FIELD_WEIGHT = [10, 8, 4, 1]
const BODY = 3
/** Kind of match. */
const EQUAL = 1
const STEM = 0.9
const START = 0.8
const SIMILAR = 0.6
const TYPO = 0.4
const MAX_BODY_COUNT = 5
const WHOLE_QUERY_BONUS = 5

interface Prepared {
  fields: Tok[][]
  /** Stem keys of the title and of each keyword. */
  whole: Set<string>
}

const preparedDocs = new WeakMap<SearchDoc, Prepared>()
function prepare(d: SearchDoc): Prepared {
  let p = preparedDocs.get(d)
  if (!p) {
    const keys = typeof d.keywords === 'string' ? [d.keywords] : d.keywords
    p = {
      // The keywords are kept apart by a word that cannot appear, so a phrase never spans two of them.
      fields: [tokens(d.title), tokens(keys.join(' \u0000 ')), tokens(d.headings), tokens(d.body)],
      whole: new Set([stemKey(words(d.title)), ...keys.map((k) => stemKey(words(k)))])
    }
    preparedDocs.set(d, p)
  }
  return p
}

/** Every letters-only word of the documents, with how often it appears. */
const vocabularies = new WeakMap<readonly SearchDoc[], Map<string, number>>()
function vocabulary(docs: readonly SearchDoc[]): Map<string, number> {
  let v = vocabularies.get(docs)
  if (!v) {
    v = new Map()
    for (const d of docs) for (const f of prepare(d).fields) for (const t of f) if (/^[a-z]+$/.test(t.w)) v.set(t.w, (v.get(t.w) ?? 0) + 1)
    vocabularies.set(docs, v)
  }
  return v
}

/** The entries of the groups by the stem key of each entry. */
interface WordIndex {
  byKey: Map<string, string[][]>
  longest: number
}
const wordIndexes = new WeakMap<SearchWords, WordIndex>()
function wordIndex(sw: SearchWords): WordIndex {
  let ix = wordIndexes.get(sw)
  if (!ix) {
    ix = { byKey: new Map(), longest: 1 }
    for (const g of sw.groups) {
      const entries = g.map((e) => e.split(' '))
      for (const e of entries) {
        const k = stemKey(e)
        ix.byKey.set(k, [...(ix.byKey.get(k) ?? []), ...entries])
        ix.longest = Math.max(ix.longest, e.length)
      }
    }
    wordIndexes.set(sw, ix)
  }
  return ix
}

/** One way a query word or phrase may appear in a text. */
interface Alt {
  words: string[]
  stems: string[]
  kind: 'query' | 'similar' | 'typo'
}
/** A query word, or a phrase of a similar-word group, with its alternatives. */
interface Unit {
  words: string[]
  alts: Alt[]
}

function alt(ws: string[], kind: Alt['kind']): Alt {
  return { words: ws, stems: ws.map(stem), kind }
}

/** The query word or phrase itself, then the other entries of its groups. */
function unit(ws: string[], ix: WordIndex, kind: 'query' | 'typo' = 'query'): Unit {
  const key = stemKey(ws)
  const alts = [alt(ws, kind)]
  const seen = new Set([key])
  for (const e of ix.byKey.get(key) ?? []) {
    const k = stemKey(e)
    if (seen.has(k)) continue
    seen.add(k)
    alts.push(alt(e, kind === 'typo' ? 'typo' : 'similar'))
  }
  return { words: ws, alts }
}

/** The query in units: a phrase of a similar-word group is one unit, unless `split` holds the place of its first word. */
function units(q: string[], ix: WordIndex, split: Set<number>): { list: Unit[]; starts: number[] } {
  const list: Unit[] = []
  const starts: number[] = []
  for (let i = 0; i < q.length; ) {
    let len = 1
    if (!split.has(i)) {
      for (let n = Math.min(ix.longest, q.length - i); n >= 2; n--) {
        if (ix.byKey.has(stemKey(q.slice(i, i + n)))) {
          len = n
          break
        }
      }
    }
    list.push(unit(q.slice(i, i + len), ix))
    starts.push(i)
    i += len
  }
  return { list, starts }
}

/** How well one alternative matches at word `i` of a field (0 for no match). */
function matchAt(f: Tok[], i: number, a: Alt): number {
  if (a.words.length === 1) {
    const t = f[i]
    const q = a.words[0]
    if (a.kind === 'query') return t.w === q ? EQUAL : t.s === a.stems[0] ? STEM : q.length >= 4 && t.w.startsWith(q) ? START : 0
    return t.w === q || t.s === a.stems[0] ? (a.kind === 'similar' ? SIMILAR : TYPO) : 0
  }
  if (i + a.words.length > f.length) return 0
  let kind = EQUAL
  for (let j = 0; j < a.words.length; j++) {
    const t = f[i + j]
    if (t.w === a.words[j]) continue
    if (t.s !== a.stems[j]) return 0
    kind = STEM
  }
  return a.kind === 'query' ? kind : a.kind === 'similar' ? SIMILAR : TYPO
}

interface UnitMatch {
  /** Best field weight times kind of match; 0 for no match. */
  best: number
  bodyHits: number
  /** Where the first body match starts, -1 for none. */
  firstBody: number
}

function matchUnit(p: Prepared, u: Unit): UnitMatch {
  let best = 0
  let bodyHits = 0
  let firstBody = -1
  p.fields.forEach((f, fi) => {
    for (let i = 0; i < f.length; i++) {
      let k = 0
      for (const a of u.alts) k = Math.max(k, matchAt(f, i, a))
      if (k === 0) continue
      best = Math.max(best, FIELD_WEIGHT[fi] * k)
      if (fi === BODY) {
        bodyHits++
        if (firstBody < 0) firstBody = f[i].at
      }
    }
  })
  return { best, bodyHits, firstBody }
}

function snippetAt(body: string, at: number): string {
  if (at < 0) return ''
  const start = Math.max(0, at - 60)
  const end = Math.min(body.length, at + 100)
  return `${start > 0 ? '...' : ''}${body.slice(start, end).replace(/\s+/g, ' ').trim()}${end < body.length ? '...' : ''}`
}

/** The word of the documentation a mistyped query word most likely means, or null. */
function correction(q: string, vocab: Map<string, number>, ix: WordIndex): string | null {
  if (!/^[a-z]+$/.test(q) || q.length < 4) return null
  const max = q.length >= 8 ? 2 : 1
  let best: { w: string; d: number; n: number } | null = null
  const consider = (w: string, n: number): void => {
    if (w[0] !== q[0] || w === q) return
    const d = editDistance(q, w, max)
    if (d > max) return
    if (!best || d < best.d || (d === best.d && (n > best.n || (n === best.n && w < best.w)))) best = { w, d, n }
  }
  for (const [w, n] of vocab) consider(w, n)
  for (const k of ix.byKey.keys()) if (/^[a-z]+$/.test(k) && !vocab.has(k)) consider(k, 0)
  const found = best as { w: string } | null
  return found ? found.w : null
}

/**
 * Searches the documents. Small question words are dropped; words meet by
 * their stems, by the start of a word (query words of 4 letters or more), and
 * through the similar-word groups; a query word that finds nothing at all is
 * taken as a typing mistake for the nearest word of the documentation. Every
 * page gets one score: per query word the best field weight (title 10,
 * keywords 8, headings 4, body 1) times the kind of match, plus the body hits
 * (at most 5), plus 5 when the whole query is the title or one keyword. Pages
 * must match every query word; when none does, the pages that match the most
 * words are returned as a partial result.
 */
export function searchDocumentation(query: string, docs: readonly SearchDoc[], searchWords: SearchWords = NO_SEARCH_WORDS): SearchResult {
  const all = [...new Set(words(query))]
  const meaningful = all.filter((w) => !QUESTION_WORDS.has(w))
  const q = meaningful.length > 0 ? meaningful : all
  if (q.length === 0 || docs.length === 0) return { hits: [], partial: false, corrected: [] }
  const ix = wordIndex(searchWords)
  const pages = docs.map(prepare)

  // A group phrase that no page has is searched word by word.
  const split = new Set<number>()
  let built = units(q, ix, split)
  let matches = built.list.map((u) => pages.map((p) => matchUnit(p, u)))
  for (;;) {
    const lost = built.list.findIndex((u, ui) => u.words.length > 1 && matches[ui].every((m) => m.best === 0))
    if (lost < 0) break
    split.add(built.starts[lost])
    built = units(q, ix, split)
    matches = built.list.map((u) => pages.map((p) => matchUnit(p, u)))
  }

  // A single word that no page has: the nearest word of the documentation instead.
  const corrected: string[] = []
  const list = built.list
  list.forEach((u, ui) => {
    if (u.words.length > 1 || matches[ui].some((m) => m.best > 0)) return
    const c = correction(u.words[0], vocabulary(docs), ix)
    if (!c) return
    const typo = unit([c], ix, 'typo')
    const m = pages.map((p) => matchUnit(p, typo))
    if (!m.some((r) => r.best > 0)) return
    list[ui] = typo
    matches[ui] = m
    corrected.push(c)
  })

  const whole = stemKey(q)
  const scored = docs.map((d, order) => {
    let score = 0
    let count = 0
    let body = 0
    let first = -1
    for (const m of matches) {
      const r = m[order]
      if (r.best === 0) continue
      count++
      score += r.best
      body += r.bodyHits
      if (r.firstBody >= 0 && (first < 0 || r.firstBody < first)) first = r.firstBody
    }
    score += Math.min(MAX_BODY_COUNT, body)
    if (count === list.length && pages[order].whole.has(whole)) score += WHOLE_QUERY_BONUS
    return { d, order, score, count, first }
  })
  const most = Math.max(...scored.map((s) => s.count))
  if (most === 0) return { hits: [], partial: false, corrected }
  const hits = scored
    .filter((s) => s.count === most)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((s) => ({ id: s.d.id, title: s.d.title, group: s.d.group, snippet: snippetAt(s.d.body, s.first) }))
  return { hits, partial: most < list.length, corrected }
}

/** The pages `searchDocumentation` finds, without its notices. */
export function searchDocs(query: string, docs: readonly SearchDoc[], searchWords: SearchWords = NO_SEARCH_WORDS): SearchHit[] {
  return searchDocumentation(query, docs, searchWords).hits
}
