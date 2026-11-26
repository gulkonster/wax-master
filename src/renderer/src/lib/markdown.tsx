// Draws a parsed documentation topic. Every node becomes a React element and
// every piece of file text is passed as a text child, so nothing in a topic
// can become markup. Links: doc:<topic> moves inside the viewer, https opens
// through the app's "show the address first" question, app:<command> is a
// button that runs one menu command. A picture names one of the pictures
// built into the app; its address comes only from doc-pictures.ts.

import { useEffect, useRef, useState } from 'react'
import type { MenuCommand, ResolvedTheme } from '../../../shared/api'
import type { Block, Inline, MdDocument } from '../../../shared/markdown'
import { IconClose, IconCopy } from '../components/Icons'
import { copyText } from './clipboard'
import { popLayer, pushLayer, takeEscape } from './dialog-stack'
import { pictureUrl } from './doc-pictures'
import { currentTheme, onThemeChange } from './theme'
import { errorText, toast } from './toast'
import '../styles-docs.css'

export interface MarkdownHandlers {
  onDoc(topic: string): void
  onCommand(command: MenuCommand): void
}

function Inlines({ nodes, h }: { nodes: readonly Inline[]; h: MarkdownHandlers }): React.JSX.Element {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case 'text':
            return <span key={i}>{n.text}</span>
          case 'code':
            return (
              <code key={i} className="md-code">
                {n.text}
              </code>
            )
          case 'bold':
            return (
              <strong key={i}>
                <Inlines nodes={n.children} h={h} />
              </strong>
            )
          case 'doc':
            return (
              <button key={i} type="button" className="md-link" onClick={() => h.onDoc(n.topic)}>
                <Inlines nodes={n.children} h={h} />
              </button>
            )
          case 'https':
            return (
              <button key={i} type="button" className="md-link" title={n.url} onClick={() => void window.wax.app.openExternal(n.url)}>
                <Inlines nodes={n.children} h={h} />
              </button>
            )
          case 'app':
            return (
              <button key={i} type="button" className="btn sm md-do" onClick={() => h.onCommand(n.command)}>
                {n.label}
              </button>
            )
        }
      })}
    </>
  )
}

function CodeBlock({ text }: { text: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const copy = async (): Promise<void> => {
    try {
      await copyText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (e) {
      toast('Could not copy', errorText(e), 'error')
    }
  }
  return (
    <div className="cmd-block md-pre">
      <pre>{text}</pre>
      <button type="button" className="icon-btn" title={copied ? 'Copied' : 'Copy'} onClick={() => void copy()}>
        <IconCopy />
      </button>
    </div>
  )
}

/** The file of a picture in one theme; nothing when the app holds no such file. */
function PictureFile({ name, theme, caption }: { name: string; theme: ResolvedTheme; caption: string }): React.JSX.Element | null {
  const url = pictureUrl(name, theme)
  return url ? <img className="md-picture-img" src={url} alt={caption} draggable={false} /> : null
}

/** z-index of .modal-backdrop in styles.css; the enlarged picture goes one above the top dialog. */
const DIALOG_Z = 100

/** The picture at its own size over the window. Esc, a click or Close closes it, and only it. */
function PictureZoom({ name, theme, caption, onClose }: { name: string; theme: ResolvedTheme; caption: string; onClose(): void }): React.JSX.Element {
  const [layer, setLayer] = useState(0)
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const l = pushLayer()
    setLayer(l)
    closeRef.current?.focus()
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && takeEscape(e, l)) onClose()
    }
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('keydown', key)
      popLayer(l)
    }
  }, [onClose])
  return (
    <div className="md-zoom" role="dialog" aria-modal="true" aria-label={caption} style={layer ? { zIndex: DIALOG_Z + layer } : undefined} onClick={onClose}>
      <div className="md-zoom-inner">
        <PictureFile name={name} theme={theme} caption={caption} />
      </div>
      <button ref={closeRef} type="button" className="icon-btn md-zoom-close" title="Close" onClick={onClose}>
        <IconClose />
      </button>
    </div>
  )
}

/** A picture with its caption, in the file of the current theme; a click enlarges it. */
function Picture({ name, caption }: { name: string; caption: string }): React.JSX.Element {
  // Drawn outside a page (the drawing tests) there is no document; the dark theme is the default.
  const [theme, setTheme] = useState<ResolvedTheme>(() => (typeof document === 'undefined' ? 'dark' : currentTheme()))
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    setTheme(currentTheme())
    return onThemeChange(setTheme)
  }, [])
  const close = useRef(() => {
    setOpen(false)
    // The keyboard focus goes back to the picture.
    setTimeout(() => buttonRef.current?.focus(), 0)
  }).current
  const has = pictureUrl(name, theme) !== null
  return (
    <figure className="md-figure">
      {has && (
        <button ref={buttonRef} type="button" className="md-picture" title="Enlarge" onClick={() => setOpen(true)}>
          <PictureFile name={name} theme={theme} caption={caption} />
        </button>
      )}
      <figcaption>{caption}</figcaption>
      {open && has && <PictureZoom name={name} theme={theme} caption={caption} onClose={close} />}
    </figure>
  )
}

function BlockView({ b, h }: { b: Block; h: MarkdownHandlers }): React.JSX.Element {
  switch (b.t) {
    case 'heading': {
      const Tag = (['h1', 'h2', 'h3'] as const)[b.level - 1]
      return (
        <Tag className={`md-h${b.level}`}>
          <Inlines nodes={b.children} h={h} />
        </Tag>
      )
    }
    case 'paragraph':
      return (
        <p className="md-p">
          <Inlines nodes={b.children} h={h} />
        </p>
      )
    case 'code':
      return <CodeBlock text={b.text} />
    case 'list': {
      const items = b.items.map((it, i) => (
        <li key={i}>
          <Inlines nodes={it} h={h} />
        </li>
      ))
      return b.ordered ? (
        <ol className="md-list" start={b.start}>
          {items}
        </ol>
      ) : (
        <ul className="md-list">{items}</ul>
      )
    }
    case 'table':
      return (
        <div className="md-table-wrap">
          <table className="md-table">
            <thead>
              <tr>
                {b.header.map((c, i) => (
                  <th key={i}>
                    <Inlines nodes={c} h={h} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td key={ci}>
                      <Inlines nodes={c} h={h} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'note':
      return (
        <div className="md-note">
          {b.paragraphs.map((p, i) => (
            <p key={i}>
              <Inlines nodes={p} h={h} />
            </p>
          ))}
        </div>
      )
    case 'picture':
      return <Picture name={b.name} caption={b.caption} />
  }
}

export function Markdown({ doc, handlers }: { doc: MdDocument; handlers: MarkdownHandlers }): React.JSX.Element {
  return (
    <div className="md">
      {doc.blocks.map((b, i) => (
        <BlockView key={i} b={b} h={handlers} />
      ))}
    </div>
  )
}
