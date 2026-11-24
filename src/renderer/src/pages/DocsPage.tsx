// The Documentation page: the topic tree on the left with the search field
// above it, the topic on the right with Back / Forward. The topics are files
// shipped with the app, so the page works without a network.

import { useEffect, useRef, useState } from 'react'
import type { DocsIndex, SearchResult } from '../../../shared/docs'
import { emit } from '../lib/bus'
import { go, loadDocsIndex, pageHistory, search } from '../lib/docs'
import { useStore } from '../lib/stores'
import { errorText } from '../lib/toast'
import { DocViewer } from '../components/Help'
import { ErrorBoundary } from '../components/ErrorBoundary'

export function DocsPage(): React.JSX.Element {
  const history = useStore(pageHistory)
  const [index, setIndex] = useState<DocsIndex | null>(null)
  const [indexError, setIndexError] = useState('')
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<SearchResult | null>(null)
  const [searchError, setSearchError] = useState('')
  const seq = useRef(0)
  const mainRef = useRef<HTMLDivElement>(null)
  // A new topic starts at its top. A block body: an effect may return only a
  // clean-up function, and scrollTo returns a promise in current Chromium.
  useEffect(() => {
    mainRef.current?.scrollTo(0, 0)
  }, [history.current])

  useEffect(() => {
    loadDocsIndex()
      .then((ix) => {
        setIndex(ix)
        // The first topic of the first group is the start page.
        if (!pageHistory.get().current) pageHistory.set(go(pageHistory.get(), ix.groups[0].topics[0].id))
      })
      .catch((e) => setIndexError(errorText(e)))
  }, [])

  useEffect(() => {
    const q = query.trim()
    const n = ++seq.current
    if (!q) {
      setResult(null)
      setSearchError('')
      return
    }
    const timer = setTimeout(() => {
      search(q)
        .then((r) => {
          if (n !== seq.current) return
          setResult(r)
          setSearchError('')
        })
        .catch((e) => n === seq.current && setSearchError(errorText(e)))
    }, 150)
    return () => clearTimeout(timer)
  }, [query])

  const open = (id: string): void => pageHistory.set(go(pageHistory.get(), id))

  return (
    <div className="docs-page">
      <div className="docs-side">
        <input
          className="input"
          type="search"
          placeholder="Search the documentation"
          aria-label="Search the documentation"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
        />
        <div className="docs-tree">
          {indexError && (
            <div className="doc-missing">
              <div className="error-text">The documentation could not be read.</div>
              <div className="hint">{indexError}</div>
            </div>
          )}
          {result !== null ? (
            <>
              {searchError && <div className="error-text">{searchError}</div>}
              {!searchError && result.corrected.length > 0 && <div className="hint">Showing results for {result.corrected.join(', ')}</div>}
              {!searchError && result.hits.length === 0 && <div className="hint">No topic contains every word of the search.</div>}
              {!searchError && result.partial && result.hits.length > 0 && <div className="hint">No page has all these words. Pages with some of them:</div>}
              {result.hits.map((h) => (
                <button key={h.id} type="button" className={`docs-item hit${h.id === history.current ? ' sel' : ''}`} onClick={() => open(h.id)}>
                  <span className="docs-item-title">{h.title}</span>
                  <span className="docs-item-group">{h.group}</span>
                  {h.snippet && <span className="docs-item-snippet">{h.snippet}</span>}
                </button>
              ))}
            </>
          ) : (
            index?.groups.map((g) => (
              <div key={g.title} className="docs-group">
                <div className="docs-group-title">{g.title}</div>
                {g.topics.map((t) => (
                  <button key={t.id} type="button" className={`docs-item${t.id === history.current ? ' sel' : ''}`} onClick={() => open(t.id)}>
                    <span className="docs-item-title">{t.title}</span>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
      <div ref={mainRef} className="page-scroll docs-main">
        <div className="docs-content">
          {/* Its own boundary: a topic that fails to draw leaves the tree and the search usable; another topic clears it. */}
          <ErrorBoundary what="This topic" resetKey={history.current ?? ''} onHome={() => emit('menu-run', 'home')}>
            <DocViewer history={history} setHistory={(h) => pageHistory.set(h)} onCommand={(c) => emit('menu-run', c)} showTitle />
          </ErrorBoundary>
        </div>
      </div>
    </div>
  )
}
