// The topic viewer shared by the Documentation page and the help window, and
// that window itself (shown over an open dialog, so the dialog and its input stay).

import { useEffect, useState } from 'react'
import type { MenuCommand } from '../../../shared/api'
import type { MdDocument } from '../../../shared/markdown'
import { emit } from '../lib/bus'
import { emptyHistory, go, goBack, goForward, loadTopic, topicTitle, type DocsHistory } from '../lib/docs'
import { Markdown, type MarkdownHandlers } from '../lib/markdown'
import { errorText } from '../lib/toast'
import { IconArrowLeft, IconArrowRight } from './Icons'
import { Modal } from './Modal'
import { ErrorBoundary } from './ErrorBoundary'

type Loaded = { id: string; doc: MdDocument; title: string | null } | { id: string; error: string }

/** One topic with Back / Forward. */
export function DocViewer({
  history,
  setHistory,
  onCommand,
  showTitle = false
}: {
  history: DocsHistory
  setHistory: (h: DocsHistory) => void
  onCommand: (c: MenuCommand) => void
  /** The page shows the title of a topic whose text has no heading of its own. */
  showTitle?: boolean
}): React.JSX.Element {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const id = history.current
  useEffect(() => {
    if (!id) return
    let live = true
    void (async () => {
      try {
        const [doc, title] = await Promise.all([loadTopic(id), topicTitle(id).catch(() => null)])
        if (live) setLoaded({ id, doc, title })
      } catch (e) {
        if (live) setLoaded({ id, error: errorText(e) })
      }
    })()
    return () => {
      live = false
    }
  }, [id])

  const shown = loaded && loaded.id === id ? loaded : null
  return (
    <div className="doc-viewer">
      <div className="doc-nav">
        <button type="button" className="icon-btn" title="Back" aria-label="Back" disabled={!history.back.length} onClick={() => setHistory(goBack(history))}>
          <IconArrowLeft />
        </button>
        <button type="button" className="icon-btn" title="Forward" aria-label="Forward" disabled={!history.forward.length} onClick={() => setHistory(goForward(history))}>
          <IconArrowRight />
        </button>
      </div>
      {!id && <div className="hint">Pick a topic on the left.</div>}
      {id && !shown && <div className="hint">Loading...</div>}
      {shown && 'error' in shown && (
        <div className="doc-missing">
          <div className="error-text">This topic could not be opened.</div>
          <div className="hint">{shown.error}</div>
        </div>
      )}
      {shown && 'doc' in shown && (
        <TopicView doc={shown.doc} title={showTitle ? shown.title : null} handlers={{ onDoc: (t) => setHistory(go(history, t)), onCommand }} />
      )}
    </div>
  )
}

/** One loaded topic: its title when the text has no heading of its own, then the text. */
export function TopicView({ doc, title, handlers }: { doc: MdDocument; title: string | null; handlers: MarkdownHandlers }): React.JSX.Element {
  return (
    <>
      {title && doc.blocks[0]?.t !== 'heading' && <h1 className="md-h1">{title}</h1>}
      <Markdown doc={doc} handlers={handlers} />
    </>
  )
}

/** The help window over an open dialog. */
export function HelpDialog({ topic, onClose, onHome }: { topic: string; onClose: () => void; onHome: () => void }): React.JSX.Element {
  const [history, setHistory] = useState<DocsHistory>(() => go(emptyHistory, topic))
  const [title, setTitle] = useState('Help')
  useEffect(() => setHistory((h) => go(h, topic)), [topic])
  useEffect(() => {
    if (!history.current) return
    let live = true
    topicTitle(history.current)
      .then((t) => live && setTitle(t ?? 'Help'))
      .catch(() => live && setTitle('Help'))
    return () => {
      live = false
    }
  }, [history])
  return (
    <Modal
      size="l"
      name="help"
      title={title}
      onClose={onClose}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      }
    >
      <ErrorBoundary what="This topic" resetKey={history.current ?? ''} onHome={onHome}>
        <DocViewer
          history={history}
          setHistory={setHistory}
          onCommand={(c) => {
            onClose()
            emit('menu-run', c)
          }}
        />
      </ErrorBoundary>
    </Modal>
  )
}
