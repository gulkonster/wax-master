import { useEffect, useRef, useState } from 'react'
import type { SearchResult } from '../../../shared/api'
import { emit } from '../lib/bus'
import { errorText } from '../lib/toast'
import { Modal } from './Modal'

/** Edit > Find in Files: plain-text search over the project's text files. */
export function FindInFilesDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [query, setQuery] = useState(lastQuery)
  const [matchCase, setMatchCase] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [result, setResult] = useState<SearchResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)

  const search = async (): Promise<void> => {
    const q = query
    lastQuery = q
    if (!q) {
      setResult(null)
      return
    }
    const n = ++seq.current
    setBusy(true)
    setError('')
    try {
      const r = await window.wax.files.search(q, matchCase, wholeWord)
      if (n === seq.current) setResult(r)
    } catch (e) {
      if (n === seq.current) setError(errorText(e))
    } finally {
      if (n === seq.current) setBusy(false)
    }
  }

  useEffect(() => {
    if (query) void search()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchCase, wholeWord])

  const files = new Map<string, SearchResult['matches']>()
  for (const m of result?.matches ?? []) files.set(m.file, [...(files.get(m.file) ?? []), m])

  return (
    <Modal title="Find in Files" onClose={onClose} wide>
      <div className="find-files">
        <div className="find-files-bar">
          <input
            className="input"
            autoFocus
            placeholder="Text to find in the project"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void search()}
          />
          <label className="check">
            <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> Match case
          </label>
          <label className="check">
            <input type="checkbox" checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} /> Whole word
          </label>
          <button className="btn purple" onClick={() => void search()} disabled={!query || busy}>
            Find
          </button>
        </div>
        {error && <div className="error-text">{error}</div>}
        {result && (
          <div className="find-files-summary">
            {result.matches.length} result{result.matches.length === 1 ? '' : 's'} in {files.size} file{files.size === 1 ? '' : 's'}
            {result.truncated ? ' (list cut at its limit)' : ''}
          </div>
        )}
        <div className="find-files-results">
          {[...files.entries()].map(([file, matches]) => (
            <div key={file} className="find-files-file">
              <div className="find-files-name">{file}</div>
              {matches.map((m, i) => (
                <div
                  key={i}
                  className="find-files-line"
                  title={`${file}:${m.line}:${m.column}`}
                  onClick={() => {
                    emit('reveal', { file: m.file, line: m.line, column: m.column })
                    onClose()
                  }}
                >
                  <span className="find-files-ln">{m.line}</span>
                  <span className="find-files-text">{m.text}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}

let lastQuery = ''
