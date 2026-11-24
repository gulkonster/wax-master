// Every shipped documentation topic is drawn through the same components the
// Documentation page and the help window use, so a topic that makes the
// drawing fail fails here instead of emptying the window.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createElement, type FunctionComponent } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { allTopics, parseDocsIndex, topicFile } from '../../src/shared/docs'
import { inlineText, parseMarkdown, type MdDocument } from '../../src/shared/markdown'

const DOCS = join(__dirname, '../../docs/help')
const index = parseDocsIndex(readFileSync(join(DOCS, 'index.json'), 'utf8'))
const topics = allTopics(index)

interface Handlers {
  onDoc(topic: string): void
  onCommand(command: string): void
}
// The components are .tsx files; the test settings have no JSX, so they are loaded by path.
const HELP = '../../src/renderer/src/components/Help'
const PAGE = '../../src/renderer/src/pages/DocsPage'
const loadHelp = async (): Promise<{
  TopicView: FunctionComponent<{ doc: MdDocument; title: string | null; handlers: Handlers }>
  DocViewer: FunctionComponent<{ history: unknown; setHistory(h: unknown): void; onCommand(c: string): void; showTitle?: boolean }>
}> => (await import(/* @vite-ignore */ HELP)) as never
const loadPage = async (): Promise<{ DocsPage: FunctionComponent }> => (await import(/* @vite-ignore */ PAGE)) as never

const handlers: Handlers = { onDoc: () => undefined, onCommand: () => undefined }

describe('documentation drawing', () => {
  it('the index lists topics', () => {
    expect(topics.length).toBeGreaterThan(0)
  })

  for (const t of topics) {
    it(`draws the topic ${t.id}`, async () => {
      const { TopicView } = await loadHelp()
      const doc = parseMarkdown(readFileSync(join(DOCS, topicFile(t.id)), 'utf8'))
      const html = renderToStaticMarkup(createElement(TopicView, { doc, title: t.title, handlers }))
      expect(html.startsWith('<')).toBe(true)
      expect(html).toContain('class="md"')
      // The first heading, or the index title when the text has none, is on the page.
      const first = doc.blocks[0]
      const heading = first?.t === 'heading' ? inlineText(first.children) : t.title
      const escaped = heading.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;')
      expect(html).toContain(escaped)
      // Nothing of the file becomes markup.
      expect(html).not.toMatch(/<(script|iframe|img|a)\b/)
    })
  }

  it('draws the Documentation page and the topic viewer before anything is loaded', async () => {
    const { DocsPage } = await loadPage()
    const page = renderToStaticMarkup(createElement(DocsPage))
    expect(page).toContain('docs-page')
    expect(page).toContain('Search the documentation')
    const { DocViewer } = await loadHelp()
    const viewer = renderToStaticMarkup(
      createElement(DocViewer, { history: { back: [], current: topics[0].id, forward: [] }, setHistory: () => undefined, onCommand: () => undefined, showTitle: true })
    )
    expect(viewer).toContain('Loading...')
  })
})

