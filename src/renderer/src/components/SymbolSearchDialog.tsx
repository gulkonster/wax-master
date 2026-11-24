import { useEffect, useRef, useState } from 'react'
import { monaco } from '../lib/monaco'
import { engineReady, workspaceSymbols, type WorkspaceSymbol } from '../lib/lsp/engine'
import { Modal } from './Modal'

const KIND: Record<number, string> = {
  4: 'class',
  5: 'method',
  7: 'field',
  8: 'constructor',
  9: 'enum',
  10: 'interface',
  11: 'function',
  12: 'variable',
  13: 'constant',
  21: 'enum member',
  22: 'struct',
  25: 'type parameter',
  2: 'namespace'
}

/** Edit > Go to Symbol in Workspace: symbols of the project from the editor engine's index. */
export function SymbolSearchDialog({
  onClose,
  onPick
}: {
  onClose: () => void
  onPick: (uri: string, range: monaco.IRange) => void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<WorkspaceSymbol[]>([])
  const [selected, setSelected] = useState(0)
  const seq = useRef(0)
  const ready = engineReady()

  useEffect(() => {
    if (!ready || !query.trim()) {
      setItems([])
      return
    }
    const n = ++seq.current
    const t = setTimeout(() => {
      void workspaceSymbols(query.trim()).then((r) => {
        if (n !== seq.current) return
        // Project symbols first, then toolchain headers.
        r.sort((a, b) => Number(a.uri.startsWith('toolchain:')) - Number(b.uri.startsWith('toolchain:')))
        setItems(r.slice(0, 200))
        setSelected(0)
      })
    }, 150)
    return () => clearTimeout(t)
  }, [query, ready])

  const where = (s: WorkspaceSymbol): string => {
    const u = monaco.Uri.parse(s.uri)
    return u.scheme === 'project' ? u.path.slice(1) : u.path
  }

  return (
    <Modal size="l" name="symbol-search" help="editorSearch" title="Go to Symbol in Workspace" onClose={onClose}>
      <div className="find-files">
        <input
          className="input"
          autoFocus
          placeholder={ready ? 'Type a function, class or table name' : 'Code intelligence is not ready (see the status bar)'}
          value={query}
          disabled={!ready}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setSelected((i) => Math.min(items.length - 1, i + 1))
            else if (e.key === 'ArrowUp') setSelected((i) => Math.max(0, i - 1))
            else if (e.key === 'Enter' && items[selected]) onPick(items[selected].uri, items[selected].range)
          }}
        />
        <div className="find-files-results">
          {items.map((s, i) => (
            <div
              key={`${s.uri}:${s.range.startLineNumber}:${i}`}
              className={`find-files-line${i === selected ? ' selected' : ''}`}
              onClick={() => onPick(s.uri, s.range)}
            >
              <span className="find-files-text">
                <b>{s.container ? `${s.container}::` : ''}{s.name}</b> <span className="dim">{KIND[s.kind] ?? ''}</span>
              </span>
              <span className="find-files-ln dim">
                {where(s)}:{s.range.startLineNumber}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}
