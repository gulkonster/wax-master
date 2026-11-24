// The documentation in the editor page: files read once through the one main
// process call and kept, the page's history, the search, and openHelp(topic).

import {
  DOCS_INDEX_FILE,
  NO_SEARCH_WORDS,
  SEARCH_WORDS_FILE,
  allTopics,
  parseSearchWords,
  parseDocsIndex,
  searchDocumentation,
  topicFile,
  type DocsIndex,
  type SearchDoc,
  type SearchResult,
  type SearchWords
} from '../../../shared/docs'
import { documentText, parseMarkdown, type MdDocument } from '../../../shared/markdown'
import { emit } from './bus'
import { Store } from './stores'

let indexPromise: Promise<DocsIndex> | null = null
const topics = new Map<string, Promise<MdDocument>>()

export function loadDocsIndex(): Promise<DocsIndex> {
  if (!indexPromise) {
    indexPromise = window.wax.docs.read(DOCS_INDEX_FILE).then(parseDocsIndex)
    // A failed read is tried again the next time.
    indexPromise.catch(() => {
      indexPromise = null
    })
  }
  return indexPromise
}

export function loadTopic(id: string): Promise<MdDocument> {
  let p = topics.get(id)
  if (!p) {
    p = window.wax.docs.read(topicFile(id)).then(parseMarkdown)
    topics.set(id, p)
    p.catch(() => topics.delete(id))
  }
  return p
}

let searchDocsPromise: Promise<SearchDoc[]> | null = null

/** Every topic as plain text, read on the first search. A topic that cannot be read is searched by its title only. */
function loadSearchDocs(): Promise<SearchDoc[]> {
  if (!searchDocsPromise) {
    searchDocsPromise = loadDocsIndex().then((index) =>
      Promise.all(
        index.groups.flatMap((g) =>
          g.topics.map(async (t): Promise<SearchDoc> => {
            try {
              return { id: t.id, title: t.title, group: g.title, keywords: t.keywords, ...documentText(await loadTopic(t.id)) }
            } catch {
              return { id: t.id, title: t.title, group: g.title, keywords: t.keywords, headings: '', body: '' }
            }
          })
        )
      )
    )
    searchDocsPromise.catch(() => {
      searchDocsPromise = null
    })
  }
  return searchDocsPromise
}

let searchWordsPromise: Promise<SearchWords> | null = null

/** The similar-word groups, read on the first search. A missing or malformed list leaves the search without them. */
function loadSearchWords(): Promise<SearchWords> {
  if (!searchWordsPromise) {
    searchWordsPromise = window.wax.docs
      .read(SEARCH_WORDS_FILE)
      .then(parseSearchWords)
      .catch(() => NO_SEARCH_WORDS)
  }
  return searchWordsPromise
}

export async function search(query: string): Promise<SearchResult> {
  const [docs, searchWords] = await Promise.all([loadSearchDocs(), loadSearchWords()])
  return searchDocumentation(query, docs, searchWords)
}

export async function topicTitle(id: string): Promise<string | null> {
  const index = await loadDocsIndex()
  return allTopics(index).find((t) => t.id === id)?.title ?? null
}

/** Back / Forward of one viewer. */
export interface DocsHistory {
  back: string[]
  current: string | null
  forward: string[]
}

export const emptyHistory: DocsHistory = { back: [], current: null, forward: [] }

export function go(h: DocsHistory, id: string): DocsHistory {
  if (h.current === id) return h
  return { back: h.current ? [...h.back, h.current].slice(-100) : h.back, current: id, forward: [] }
}
export function goBack(h: DocsHistory): DocsHistory {
  if (!h.back.length) return h
  return { back: h.back.slice(0, -1), current: h.back[h.back.length - 1], forward: h.current ? [h.current, ...h.forward] : h.forward }
}
export function goForward(h: DocsHistory): DocsHistory {
  if (!h.forward.length) return h
  return { back: h.current ? [...h.back, h.current] : h.back, current: h.forward[0], forward: h.forward.slice(1) }
}

/** The Documentation page's history; it stays while the user visits other views. */
export const pageHistory = new Store<DocsHistory>(emptyHistory)

/**
 * Opens a topic: on the Documentation page, or, when a dialog is open, in a
 * help window on top of it, so the dialog and what was typed in it stay.
 */
export function openHelp(topicId: string): void {
  emit('open-help', topicId)
}
