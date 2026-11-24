// Draws a parsed documentation topic. Every node becomes a React element and
// every piece of file text is passed as a text child, so nothing in a topic
// can become markup. Links: doc:<topic> moves inside the viewer, https opens
// through the app's "show the address first" question, app:<command> is a
// button that runs one menu command.

import { useState } from 'react'
import type { MenuCommand } from '../../../shared/api'
import type { Block, Inline, MdDocument } from '../../../shared/markdown'
import { IconCopy } from '../components/Icons'
import { copyText } from './clipboard'
import { errorText, toast } from './toast'

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
