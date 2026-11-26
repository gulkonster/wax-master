// Every shipped documentation topic is drawn through the same components the
// Documentation page and the help window use, so a topic that makes the
// drawing fail fails here instead of emptying the window.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
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
// The picture map is built by the page bundler (import.meta.glob), so it is loaded by path too.
const PICTURES = '../../src/renderer/src/lib/doc-pictures'
const pictureAddresses = async (): Promise<Set<string>> => {
  const m = (await import(/* @vite-ignore */ PICTURES)) as { pictureNames(): string[]; pictureUrl(name: string, theme: string): string | null }
  const out = new Set<string>()
  for (const n of m.pictureNames()) for (const t of ['dark', 'light']) out.add(m.pictureUrl(n, t) ?? '')
  out.delete('')
  return out
}

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
      // Nothing of the file becomes markup; a picture is drawn only inside its figure, from the map.
      const allowed = await pictureAddresses()
      const figures = [...html.matchAll(/<figure class="md-figure">([\s\S]*?)<\/figure>/g)].map((m) => m[1])
      const outside = html.replace(/<figure class="md-figure">[\s\S]*?<\/figure>/g, '')
      expect(outside).not.toMatch(/<(script|iframe|img|a|figure)\b/)
      for (const f of figures) {
        expect(f).not.toMatch(/<(script|iframe|a|figure)\b/)
        for (const img of f.matchAll(/<img\b[^>]*>/g)) {
          const src = /\ssrc="([^"]*)"/.exec(img[0])?.[1]
          expect(src !== undefined && allowed.has(src), img[0]).toBe(true)
        }
      }
      const pictures = doc.blocks.filter((b) => b.t === 'picture').length
      expect(figures.length).toBe(pictures)
    })
  }

  it('draws a picture of the map in its figure with its caption, and only the caption for a name the map does not hold', async () => {
    vi.resetModules()
    vi.doMock('../../src/renderer/src/lib/doc-pictures', () => ({
      pictureUrl: (name: string, theme: string) => (name === 'sample' ? `/assets/sample-${theme}-x1.png` : null),
      pictureNames: () => ['sample']
    }))
    try {
      const { TopicView } = await loadHelp()
      const doc = parseMarkdown('# Pictures\n\n![The sample screen, \"quoted\" & plain.](img:sample)\n\n![A screen the app does not hold.](img:missing)\n')
      expect(doc.problems.map((p) => p.message)).toEqual([])
      const html = renderToStaticMarkup(createElement(TopicView, { doc, title: 'Pictures', handlers }))
      expect(html).toContain(
        '<figure class="md-figure"><button type="button" class="md-picture" title="Enlarge"><img class="md-picture-img" src="/assets/sample-dark-x1.png" alt="The sample screen, &quot;quoted&quot; &amp; plain." draggable="false"/></button><figcaption>The sample screen, &quot;quoted&quot; &amp; plain.</figcaption></figure>'
      )
      expect(html).toContain('<figure class="md-figure"><figcaption>A screen the app does not hold.</figcaption></figure>')
      expect(html.match(/<img\b/g)?.length).toBe(1)
    } finally {
      vi.doUnmock('../../src/renderer/src/lib/doc-pictures')
      vi.resetModules()
    }
  })

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

