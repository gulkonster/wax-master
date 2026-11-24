// The documentation: the Markdown subset, the index format, the search, and the
// checks that keep the shipped topics current (topic ids, links, commands,
// subset, and the table of features with their topics).

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  NO_SEARCH_WORDS,
  SEARCH_WORDS_FILE,
  allTopics,
  docsCommands,
  editDistance,
  isDocsFileName,
  isTopicId,
  parseDocsIndex,
  parseSearchWords,
  searchDocs,
  searchDocumentation,
  stem,
  topicFile,
  type SearchDoc
} from '../../src/shared/docs'
import { documentLinks, documentText, inlineText, parseMarkdown, type Block, type Inline } from '../../src/shared/markdown'
import { MENU_MODEL } from '../../src/shared/menu-model'
import { HELP_TOPICS } from '../../src/renderer/src/lib/help-topics'

const ROOT = join(__dirname, '../..')
const REAL_DOCS = join(ROOT, 'docs/help')
const FIXTURES = join(__dirname, '../fixtures/docs')
const RENDERER = join(ROOT, 'src/renderer/src')

/** Every text that reaches the screen, as one string per text node. */
function texts(nodes: readonly Inline[]): string[] {
  return nodes.flatMap((n) => (n.t === 'text' || n.t === 'code' ? [n.text] : n.t === 'app' ? [n.label] : texts(n.children)))
}
function blockTexts(blocks: readonly Block[]): string[] {
  return blocks.flatMap((b) => {
    switch (b.t) {
      case 'heading':
      case 'paragraph':
        return texts(b.children)
      case 'code':
        return [b.text]
      case 'list':
        return b.items.flatMap(texts)
      case 'table':
        return [...b.header, ...b.rows.flat()].flatMap(texts)
      case 'note':
        return b.paragraphs.flatMap(texts)
    }
  })
}

describe('Markdown subset', () => {
  it('reads every supported construct', () => {
    const doc = parseMarkdown(readFileSync(join(FIXTURES, 'good/welcome.md'), 'utf8'))
    expect(doc.problems).toEqual([])
    expect(doc.blocks.map((b) => b.t)).toEqual(['heading', 'paragraph', 'heading', 'list', 'list', 'table', 'code', 'note', 'paragraph'])
    const [h1, p, h2, ol, ul, table, code, note, last] = doc.blocks
    expect(h1).toEqual({ t: 'heading', level: 1, children: [{ t: 'text', text: 'Welcome' }] })
    expect(h2).toMatchObject({ t: 'heading', level: 2 })
    expect(p).toEqual({
      t: 'paragraph',
      children: [
        { t: 'text', text: 'This page has ' },
        { t: 'bold', children: [{ t: 'text', text: 'bold' }] },
        { t: 'text', text: ', ' },
        { t: 'code', text: 'inline code' },
        { t: 'text', text: ' and a ' },
        { t: 'doc', topic: 'ram-basics', children: [{ t: 'text', text: 'link to RAM' }] },
        { t: 'text', text: '.' }
      ]
    })
    expect(ol).toMatchObject({ t: 'list', ordered: true, start: 1 })
    expect((ol as Extract<Block, { t: 'list' }>).items.map(inlineText)).toEqual(['Open the project.', 'Press Build.'])
    expect(ul).toMatchObject({ t: 'list', ordered: false })
    expect((ul as Extract<Block, { t: 'list' }>).items.map(inlineText)).toEqual(['One', 'Two with code'])
    const tb = table as Extract<Block, { t: 'table' }>
    expect(tb.header.map(inlineText)).toEqual(['Name', 'Value'])
    expect(tb.rows.map((r) => r.map(inlineText))).toEqual([['a', '1']])
    expect(code).toEqual({ t: 'code', lang: 'cpp', text: 'void hi() {}' })
    expect(note).toEqual({ t: 'note', paragraphs: [[{ t: 'text', text: 'Note: RAM is bought, not staked.' }]] })
    expect(last).toEqual({
      t: 'paragraph',
      children: [
        { t: 'app', command: 'deploy', label: 'Open Deploy' },
        { t: 'text', text: ' or read ' },
        { t: 'https', url: 'https://example.com/page', children: [{ t: 'text', text: 'the site' }] },
        { t: 'text', text: '.' }
      ]
    })
  })

  it('keeps the text of a code block exactly, including markup and indentation', () => {
    const doc = parseMarkdown('```\n  <b>**x**</b> [a](doc:b)\n\n# not a heading\n```')
    expect(doc.problems).toEqual([])
    expect(doc.blocks).toEqual([{ t: 'code', lang: '', text: '  <b>**x**</b> [a](doc:b)\n\n# not a heading' }])
  })

  it('joins paragraph lines, continues list items and reads backslash escapes', () => {
    const doc = parseMarkdown('one\ntwo\n\n- a\n  more\n- b\n\n\\*not italic\\* and \\[not a link\\](doc:x)')
    expect(doc.problems).toEqual([])
    expect(doc.blocks.map((b) => b.t)).toEqual(['paragraph', 'list', 'paragraph'])
    expect(blockTexts(doc.blocks)).toEqual(['one two', 'a more', 'b', '*not italic* and [not a link](doc:x)'])
  })

  it('shows HTML, scripts and entities as text and reports them', () => {
    const src = '<script>alert(1)</script>\n\nText <img src=x onerror=alert(1)> and &lt;b&gt; and <!-- c -->'
    const doc = parseMarkdown(src)
    expect(doc.blocks.every((b) => b.t === 'paragraph')).toBe(true)
    expect(blockTexts(doc.blocks).join('\n')).toBe('<script>alert(1)</script>\nText <img src=x onerror=alert(1)> and &lt;b&gt; and <!-- c -->')
    expect(doc.problems.map((p) => p.message)).toContain('HTML is not supported (shown as text)')
    expect(doc.problems.map((p) => p.message)).toContain('HTML entities are not supported (shown as text)')
  })

  it('keeps links of an unknown kind as text and reports them', () => {
    const cases = [
      '[x](javascript:alert(1))',
      '[x](javascript:alert)',
      '[x](http://example.com)',
      '[x](file:///C:/Windows/win.ini)',
      '[x](data:text/html,hi)',
      '[x](vbscript:msgbox)',
      '[x](https://)',
      '[x](https://user:pw@example.com)',
      '[x](//example.com)',
      '[x](../x.md)',
      '[x](doc:Bad_Id)',
      '[x](doc:a/b)',
      '[x](doc:con)',
      '[x](app:deploy?account=alice)',
      '[x](app:deploy;build)',
      '[x](app:format-disk)',
      '[x](app:)',
      '[x](app:save-all-and-quit)',
      '[x](app:focus-menu)',
      '[x](mailto:a@b.c)'
    ]
    for (const c of cases) {
      const doc = parseMarkdown(c)
      expect(doc.blocks, c).toEqual([{ t: 'paragraph', children: [{ t: 'text', text: c }] }])
      expect(doc.problems.length, c).toBeGreaterThan(0)
    }
  })

  it('reports images, deep headings, italics, rules, nested lists, nested notes, indented code and an open code block', () => {
    const cases: [string, string][] = [
      ['![logo](https://example.com/a.png)', 'images are not supported'],
      ['#### Deep', 'only headings #, ## and ### are supported'],
      ['some *italic* text', 'italic is not supported; use **bold**'],
      ['---', 'horizontal rules are not supported'],
      ['- a\n  - b', 'nested lists are not supported'],
      ['> a\n> > b', 'nested notes are not supported'],
      ['    indented code', 'indented code is not supported; use a ``` block'],
      ['```\nopen', 'code block is not closed with ```'],
      ['Title\n=====', 'underlined headings are not supported; use #'],
      ['[ref]: https://example.com', 'reference links are not supported']
    ]
    for (const [src, message] of cases) {
      const doc = parseMarkdown(src)
      expect(doc.problems.map((p) => p.message), src).toContain(message)
      // Whatever is outside the subset is still visible.
      expect(blockTexts(doc.blocks).join(' ').length, src).toBeGreaterThan(0)
    }
  })

  it('offers as buttons only the menu commands, none of which takes a parameter', () => {
    const commands = docsCommands()
    const fromMenu: string[] = []
    const walk = (items: (typeof MENU_MODEL)[number]['items']): void => {
      for (const i of items) {
        if (i.kind === 'command') fromMenu.push(i.command)
        else if (i.kind === 'submenu') walk(i.items)
      }
    }
    for (const m of MENU_MODEL) walk(m.items)
    expect([...commands].sort()).toEqual([...new Set(fromMenu)].sort())
    for (const c of commands) expect(c).toMatch(/^[a-z]+(-[a-z]+)*$/)
    expect(commands.has('save-all-and-quit' as never)).toBe(false)
    expect(commands.has('focus-menu' as never)).toBe(false)
    expect(commands.has('docs')).toBe(true)
  })

  it('the topic renderer builds elements only: no markup from text, no address attribute', () => {
    const src = readFileSync(join(RENDERER, 'lib/markdown.tsx'), 'utf8')
    for (const banned of ['innerHTML', 'dangerouslySetInnerHTML', 'href', 'createContextualFragment', 'DOMParser', 'insertAdjacentHTML', 'document.write']) {
      expect(src, banned).not.toContain(banned)
    }
    // External addresses go through the app's question that shows the address first.
    expect(src).toContain('window.wax.app.openExternal(n.url)')
  })
})

describe('documentation index', () => {
  it('reads the fixture index with and without the optional keys', () => {
    const ix = parseDocsIndex(readFileSync(join(FIXTURES, 'good/index.json'), 'utf8'))
    expect(ix.groups.map((g) => [g.id, g.title])).toEqual([
      ['start', 'Start'],
      [null, 'More']
    ])
    expect(allTopics(ix)).toEqual([
      { id: 'welcome', title: 'Welcome', keywords: ['intro'] },
      { id: 'ram-basics', title: 'RAM basics', keywords: ['memory'] },
      { id: 'faucet', title: 'Testnet tokens', keywords: [] }
    ])
  })
  it('refuses a malformed index', () => {
    const topic = { id: 'a', title: 'A' }
    const bad: unknown[] = [
      'not json',
      [],
      {},
      { groups: [] },
      { version: 2, groups: [{ title: 'G', topics: [topic] }] },
      { groups: [{ title: 'G', topics: [] }] },
      { groups: [{ title: '', topics: [topic] }] },
      { groups: [{ title: 'G', topics: [topic], extra: 1 }] },
      { groups: [{ title: 'G', topics: [{ ...topic, file: '../x.md' }] }] },
      { groups: [{ title: 'G', topics: [{ id: '../x', title: 'A' }] }] },
      { groups: [{ title: 'G', topics: [{ id: 'A', title: 'A' }] }] },
      { groups: [{ title: 'G', topics: [{ id: 'nul', title: 'A' }] }] },
      { groups: [{ title: 'G', topics: [{ id: 'a', title: 7 }] }] },
      { groups: [{ title: 'G', topics: [{ ...topic, keywords: 'ram' }] }] },
      { groups: [{ title: 'G', topics: [{ ...topic, keywords: [7] }] }] },
      { groups: [{ title: 'G', topics: [topic, topic] }] },
      { groups: [{ title: 'G', topics: [topic] }, { title: 'H', topics: [topic] }] }
    ]
    for (const b of bad) expect(() => parseDocsIndex(typeof b === 'string' ? b : JSON.stringify(b)), JSON.stringify(b)).toThrow()
  })
  it('names files only as index.json and <topic id>.md', () => {
    for (const ok of ['index.json', 'a.md', 'first-contract.md', 'abi-check.md']) expect(isDocsFileName(ok), ok).toBe(true)
    for (const bad of ['', 'index.JSON', 'a.MD', 'A.md', '../a.md', 'a/b.md', 'a\\b.md', 'C:\\a.md', 'a.md:stream', 'a.txt', '.md', '-a.md', 'a--b.md', 'con.md', 'NUL.md', 'lpt1.md', 'a.md ', `${'a'.repeat(65)}.md`, 7, null]) {
      expect(isDocsFileName(bad), String(bad)).toBe(false)
    }
    expect(topicFile('first-contract')).toBe('first-contract.md')
    expect(isTopicId('first-contract')).toBe(true)
  })
})

describe('documentation search', () => {
  const docs: SearchDoc[] = [
    { id: 'welcome', title: 'Welcome', group: 'Start', keywords: 'intro', headings: 'Steps', body: 'Open the project. Buy RAM for the account. Read about random numbers.' },
    { id: 'ram-basics', title: 'RAM basics', group: 'Start', keywords: 'memory', headings: '', body: 'RAM holds rows. Buy RAM. RAM is paid.' },
    { id: 'faucet', title: 'Testnet tokens', group: 'More', keywords: 'faucet free', headings: 'Recovery', body: 'The faucet sends tokens. It does not sell RAM.' }
  ]
  it('puts title matches first, then keywords, then headings, then text; more matches first inside a tier', () => {
    expect(searchDocs('RAM', docs).map((h) => h.id)).toEqual(['ram-basics', 'welcome', 'faucet'])
    expect(searchDocs('faucet', docs).map((h) => h.id)).toEqual(['faucet'])
    expect(searchDocs('recovery', docs).map((h) => h.id)).toEqual(['faucet'])
    expect(searchDocs('memory', docs).map((h) => h.id)).toEqual(['ram-basics'])
  })
  it('matches whole words, and the start of a word for query words of four letters or more', () => {
    // "ram" does not find "random".
    expect(searchDocs('ram', [docs[0]]).length).toBe(1)
    expect(searchDocs('rand', docs).map((h) => h.id)).toEqual(['welcome'])
    expect(searchDocs('ran', docs)).toEqual([])
    expect(searchDocs('proj', docs).map((h) => h.id)).toEqual(['welcome'])
  })
  it('needs every word, ignores case and punctuation, and gives a snippet', () => {
    expect(searchDocs('buy ram', docs).map((h) => h.id)).toEqual(['ram-basics', 'welcome'])
    expect(searchDocs('BUY, RAM!', docs).map((h) => h.id)).toEqual(['ram-basics', 'welcome'])
    expect(searchDocumentation('buy ram', docs).partial).toBe(false)
    expect(searchDocs('   ', docs)).toEqual([])
    expect(searchDocs('faucet', docs)[0].snippet).toContain('faucet sends tokens')
  })
  it('lists the pages with the most of the words when no page has them all', () => {
    const r = searchDocumentation('ram nothing', docs)
    expect(r.partial).toBe(true)
    expect(r.hits.map((h) => h.id)).toEqual(['ram-basics', 'welcome', 'faucet'])
    const two = searchDocumentation('buy ram nothing', docs)
    expect([two.partial, two.hits.map((h) => h.id)]).toEqual([true, ['ram-basics', 'welcome']])
    expect(searchDocumentation('zzzz qqqq', docs)).toEqual({ hits: [], partial: false, corrected: [] })
  })
  it('treats regular expression characters in the query as text', () => {
    expect(() => searchDocs('a.b (x) [y] *z+ ?', docs)).not.toThrow()
  })

  const code: SearchDoc[] = [
    { id: 'auth', title: 'Authority checks', group: 'Writing', keywords: ['require_auth', 'has_auth'], headings: '', body: 'Call require_auth(user) first. The eosio.code permission sends inline actions.' },
    { id: 'notify', title: 'Notifications', group: 'Writing', keywords: ['on_notify'], headings: 'Listening', body: 'An on_notify handler listens to transfers. Staking rewards are paid later.' },
    { id: 'single', title: 'Singletons', group: 'Writing', keywords: ['config'], headings: 'Entries', body: 'A singleton keeps one row of settings. The fees are low.' },
    { id: 'nft', title: 'NFT blend', group: 'NFTs', keywords: ['blend', 'short name'], headings: '', body: 'Blend two assets into a new one. Premium accounts have a short name.' }
  ]
  it('finds a word joined by _ . or @ by its parts', () => {
    expect(searchDocs('require auth', code).map((h) => h.id)).toEqual(['auth'])
    expect(searchDocs('on notify', code).map((h) => h.id)).toEqual(['notify'])
    expect(searchDocs('eosio code', code).map((h) => h.id)).toEqual(['auth'])
    expect(searchDocs('require_auth', code).map((h) => h.id)).toEqual(['auth'])
  })
  it('drops the small words of a question unless nothing else is left', () => {
    expect(searchDocs('how do i buy ram', docs)).toEqual(searchDocs('buy ram', docs))
    expect(searchDocs('what is the singleton for', code).map((h) => h.id)).toEqual(['single'])
    expect(searchDocs('the', [{ ...docs[0], body: 'the end' }]).length).toBe(1)
  })
  it('meets plural and verb forms through a short stem rule', () => {
    expect(new Set(['staking', 'staked', 'stakes', 'stake'].map(stem))).toEqual(new Set(['stak']))
    expect([stem('entries'), stem('entry'), stem('fees'), stem('fee'), stem('uses'), stem('classes'), stem('class'), stem('settings'), stem('setting')]).toEqual([
      'entry',
      'entry',
      'fee',
      'fee',
      'use',
      'class',
      'class',
      'sett',
      'sett'
    ])
    // Never below three letters; words with a digit, _, . or @ stay.
    expect([stem('bed'), stem('ties'), stem('require_auth'), stem('eosio.code'), stem('v2s'), stem('ram')]).toEqual(['bed', 'tie', 'require_auth', 'eosio.code', 'v2s', 'ram'])
    expect(searchDocs('stake', code).map((h) => h.id)).toEqual(['notify'])
    expect(searchDocs('entry', code).map((h) => h.id)).toEqual(['single'])
    expect(searchDocs('fee', code).map((h) => h.id)).toEqual(['single'])
  })
  it('measures typing mistakes with a swap of neighbours as one edit', () => {
    expect(editDistance('stakng', 'staking', 2)).toBe(1)
    expect(editDistance('singelton', 'singleton', 2)).toBe(1)
    expect(editDistance('kitten', 'sitting', 3)).toBe(3)
    expect(editDistance('abcd', 'dcba', 1)).toBe(2)
  })
  it('searches the nearest word of the documentation for a word that finds nothing, with the same first letter', () => {
    expect(searchDocumentation('singelton', code)).toMatchObject({ corrected: ['singleton'], partial: false, hits: [{ id: 'single' }] })
    // 4 to 7 letters: one edit; 8 or more: two.
    expect(searchDocumentation('notfy', code).corrected).toEqual(['notify'])
    expect(searchDocumentation('ntfy', code).corrected).toEqual([])
    expect(searchDocumentation('notifcatins', code).corrected).toEqual(['notifications'])
    // Another first letter, fewer than 4 letters, or a word with a digit: no guess.
    expect(searchDocumentation('xingleton', code).hits).toEqual([])
    expect(searchDocumentation('rwo', code).hits).toEqual([])
    expect(searchDocumentation('singl3ton', code).corrected).toEqual([])
    // A word found by its stem or the start of a word is not a mistake.
    expect(searchDocumentation('staked', code).corrected).toEqual([])
    // "ram" does not find "random", and no guess turns it into another word.
    expect(searchDocumentation('ram', [docs[0], { ...docs[1], title: 'Rooms', body: 'random', keywords: '' }])).toMatchObject({ corrected: [], hits: [{ id: 'welcome' }] })
  })
  it('a word or phrase of a similar-word group also searches the others', () => {
    const sw = parseSearchWords(JSON.stringify({ version: 1, groups: [['blend', 'craft', 'merge'], ['premium name', 'short name', 'name bid'], ['stake', 'lock']] }))
    expect(searchDocs('craft', code)).toEqual([])
    expect(searchDocs('craft', code, sw).map((h) => h.id)).toEqual(['nft'])
    expect(searchDocs('crafting', code, sw).map((h) => h.id)).toEqual(['nft'])
    expect(searchDocs('premium name', code, sw).map((h) => h.id)).toEqual(['nft'])
    expect(searchDocs('name bid', code, sw).map((h) => h.id)).toEqual(['nft'])
    // A group phrase no page has is searched word by word.
    expect(searchDocs('name bid', [{ ...code[3], keywords: [], body: 'Bid on a name.' }], sw).map((h) => h.id)).toEqual(['nft'])
    expect(searchDocs('lock', code, sw).map((h) => h.id)).toEqual(['notify'])
    // The snippet starts at the first word that matched, of whatever kind.
    expect(searchDocs('lock', code, sw)[0].snippet).toBe('An on_notify handler listens to transfers. Staking rewards are paid later.')
    expect(searchDocs('stakes', code)[0].snippet).toContain('Staking rewards')
  })
  it('ranks by one score: field weight times kind of match, body hits, the whole query as title or keyword', () => {
    const rank: SearchDoc[] = [
      { id: 'body', title: 'One', group: 'G', keywords: [], headings: '', body: 'blend blend blend blend blend blend blend' },
      { id: 'head', title: 'Two', group: 'G', keywords: [], headings: 'Blend', body: 'blend' },
      { id: 'key', title: 'Three', group: 'G', keywords: ['blend'], headings: '', body: '' },
      { id: 'title', title: 'Blend', group: 'G', keywords: [], headings: '', body: '' },
      { id: 'similar', title: 'Craft', group: 'G', keywords: [], headings: '', body: '' }
    ]
    const sw = { groups: [['blend', 'craft']] }
    // title 10 + 5, keyword 8 + 5, similar title 6, body 1 + 5 (capped), heading 4 + 1.
    expect(searchDocs('blend', rank, sw).map((h) => h.id)).toEqual(['title', 'key', 'body', 'similar', 'head'])
    // Equal scores keep the order of the index.
    expect(searchDocs('blend', [rank[3], { ...rank[3], id: 'title2' }]).map((h) => h.id)).toEqual(['title', 'title2'])
  })
  it('an empty or broken similar-word list changes nothing else', () => {
    for (const q of ['ram', 'buy ram', 'faucet', 'recovery', 'ram nothing', 'singelton']) {
      expect(searchDocumentation(q, [...docs, ...code], NO_SEARCH_WORDS)).toEqual(searchDocumentation(q, [...docs, ...code]))
      expect(searchDocumentation(q, [...docs, ...code], { groups: [] })).toEqual(searchDocumentation(q, [...docs, ...code]))
    }
    const bad: unknown[] = [
      'not json',
      [],
      { groups: [['a', 'b']], extra: 1 },
      { version: 2, groups: [] },
      { groups: [['alone']] },
      { groups: [['Blend', 'craft']] },
      { groups: [['blend', 'craft  merge']] },
      { groups: [['blend', ' craft']] },
      { groups: [['blend', 7]] },
      { groups: [['blend', 'x'.repeat(41)]] },
      { groups: [['blend', 'one two three four five']] },
      { groups: [Array.from({ length: 21 }, (_, i) => `w${i}`)] },
      { groups: Array.from({ length: 401 }, () => ['a', 'b']) },
      { groups: 'blend' }
    ]
    for (const b of bad) expect(() => parseSearchWords(typeof b === 'string' ? b : JSON.stringify(b)), JSON.stringify(b)).toThrow()
    expect(parseSearchWords('{"groups":[]}')).toEqual({ groups: [] })
    expect(isDocsFileName(SEARCH_WORDS_FILE)).toBe(true)
  })
})

// ------------------------------------------------------------------ the checks of the shipped topics

/** Every problem of one documentation folder, as readable lines. */
function checkDocs(dir: string): string[] {
  const out: string[] = []
  let topics: { id: string; title: string }[]
  try {
    topics = allTopics(parseDocsIndex(readFileSync(join(dir, 'index.json'), 'utf8')))
  } catch (e) {
    return [`index.json: ${e instanceof Error ? e.message : String(e)}`]
  }
  const ids = new Set(topics.map((t) => t.id))
  const commands = docsCommands()
  for (const t of topics) {
    const file = join(dir, topicFile(t.id))
    if (!existsSync(file)) {
      out.push(`${t.id}: file ${topicFile(t.id)} is missing`)
      continue
    }
    const text = readFileSync(file, 'utf8')
    const doc = parseMarkdown(text)
    for (const p of doc.problems) out.push(`${t.id}:${p.line}: ${p.message}`)
    const links = documentLinks(doc)
    for (const d of links.docs) if (!ids.has(d)) out.push(`${t.id}: doc:${d} names no topic`)
    for (const c of links.commands) if (!commands.has(c)) out.push(`${t.id}: app:${c} is not a menu command`)
    // Every app: target in the raw text is exactly one menu command, nothing after it.
    for (const m of text.matchAll(/\]\(app:([^)\s]*)\)/g)) if (!commands.has(m[1] as never)) out.push(`${t.id}: app:${m[1]} is not a menu command without parameters`)
    if (documentText(doc).body.trim() === '') out.push(`${t.id}: the topic is empty`)
  }
  return out
}

describe('the checks find what they look for (fixtures)', () => {
  it('finds nothing in a correct folder', () => {
    expect(checkDocs(join(FIXTURES, 'good'))).toEqual([])
  })
  it('finds a missing file, a dead topic link, commands with parameters or unknown, HTML, other link kinds and deep headings', () => {
    const found = checkDocs(join(FIXTURES, 'bad'))
    expect(found).toContain('missing-file: file missing-file.md is missing')
    expect(found).toContain('broken: doc:nowhere names no topic')
    expect(found).toContain('broken: app:deploy?account=alice is not a menu command without parameters')
    expect(found).toContain('broken: app:format-disk is not a menu command without parameters')
    expect(found).toContain('broken:3: HTML is not supported (shown as text)')
    expect(found.some((f) => f.startsWith('broken:7: link target "http://example.com"'))).toBe(true)
    expect(found).toContain('broken:7: link not understood (shown as text)')
    expect(found).toContain('broken:9: only headings #, ## and ### are supported')
  })
})

describe('shipped documentation (docs/help)', () => {
  it('has an index, and the folder holds only the index and topic files', () => {
    expect(existsSync(join(REAL_DOCS, 'index.json'))).toBe(true)
    for (const name of readdirSync(REAL_DOCS)) {
      expect(statSync(join(REAL_DOCS, name)).isFile(), name).toBe(true)
      expect(isDocsFileName(name), name).toBe(true)
    }
  })
  it('every topic id is unique and has its file; every doc: link resolves; every app: command exists without parameters; only the subset is used', () => {
    expect(checkDocs(REAL_DOCS)).toEqual([])
  })
})

/**
 * Feature areas and their topics. A new area gets a row here and a topic in
 * docs/help; a row whose topic does not exist fails.
 */
const FEATURE_TOPICS: [string, keyof typeof HELP_TOPICS][] = [
  ['Deploy dialog', 'deploy'],
  ['Create Account dialog', 'createAccount'],
  ['Create Testnet Account dialog', 'testnetAccount'],
  ['Manage Keypairs dialog', 'manageKeypairs'],
  ['Change key dialog', 'changeKey'],
  ['Add Network dialog', 'addNetwork'],
  ['Manage Networks dialog', 'manageNetworks'],
  ['Network page', 'networkPage'],
  ['Project Settings page', 'projectSettings'],
  ['Settings page', 'settings'],
  ['Setup page', 'setup'],
  ['Contract page', 'contractPage'],
  ['Account page', 'accountPage'],
  ['Wallet overview (Account page header)', 'walletOverview'],
  ['Wallet tokens and transfer', 'walletTransfers'],
  ['Wallet RAM', 'walletRam'],
  ['Wallet CPU / NET', 'walletCpuNet'],
  ['Wallet testnet faucet', 'walletFaucet'],
  ['Wallet transactions', 'walletTransactions'],
  ['Wallet keys and permissions', 'walletPermissions'],
  ['Wallet permission threshold', 'walletThreshold'],
  ['Wallet new permission', 'walletNewPermission'],
  ['Wallet eosio.code switch', 'walletEosioCode'],
  ['Wallet linked actions', 'walletLinks'],
  ['Wallet create account', 'walletCreateAccount'],
  ['Wallet contract', 'walletContract'],
  ['Wallet voting and rewards', 'walletVoting'],
  ['Wallet PowerUp', 'walletPowerup'],
  ['Wallet name bids', 'walletNameBids'],
  ['Home page (projects)', 'home'],
  ['New Project dialog', 'newProject'],
  ['Choose the main file dialog', 'mainFile'],
  ['New file, folder and rename dialogs of the project tree', 'projectTree'],
  ['Unsaved changes dialog', 'unsavedChanges'],
  ['File changed on disk dialog', 'fileChanged'],
  ['Find in Files and Go to Symbol dialogs', 'editorSearch'],
  ['Add toolchain dialog', 'toolchains'],
  ['WASM view (a .wasm file opened from the tree)', 'wasmView'],
  ['About dialog', 'about'],
  ['New version dialog', 'updateAvailable'],
  ['Not in this build dialog', 'comingLater'],
  ['Vault dialogs (create, unlock, password, import)', 'vault'],
  ['Key backup dialogs (no backup, back up, delete key)', 'keyBackup'],
  ['Clear Contract Code dialog', 'clearCode'],
  ['Edit network dialog', 'editNetwork'],
  ['Starred accounts dialog', 'starredAccounts'],
  ['Transaction inspector dialog', 'inspector'],
  ['Open Transaction by Id dialog', 'openTransaction'],
  ['Settings: Appearance', 'settingsAppearance'],
  ['Settings: Editor', 'settingsEditor'],
  ['Settings: Key vault', 'settingsVault'],
  ['Settings: Updates', 'settingsUpdates'],
  ['Settings: Data and Clear All App Data dialog', 'settingsData'],
  ['CPU / NET / RAM refusal', 'resourceRefusal'],
  ['Refused transaction (inspector, Contract page result, wallet forms)', 'txRefusal'],
  ['ABI check', 'abiCheck'],
  ['Ricardian warning in Problems', 'ricardianWarning']
]

/**
 * Every dialog (by its Modal name) and the help place of its "?". A dialog
 * whose place comes from its caller or its form has `null` here; the test still
 * requires a help attribute on it. A new dialog without a row here fails.
 */
const DIALOG_HELP: Record<string, keyof typeof HELP_TOPICS | null> = {
  'unsaved-changes': 'unsavedChanges',
  'update-available': 'updateAvailable',
  about: 'about',
  'create-account': 'createAccount',
  'change-key': 'changeKey',
  'no-backup': 'keyBackup',
  deploy: 'deploy',
  'find-in-files': 'editorSearch',
  'symbol-search': 'editorSearch',
  transaction: 'inspector',
  'manage-keypairs': 'manageKeypairs',
  'create-vault': 'vault',
  'backup-key': 'keyBackup',
  'backup-all': 'keyBackup',
  'vault-password-action': 'vault',
  'create-keypair': 'manageKeypairs',
  'import-keypair': 'manageKeypairs',
  'import-vault': 'vault',
  'delete-key': 'keyBackup',
  'main-file': 'mainFile',
  'text-input': null,
  'clear-code': 'clearCode',
  'add-network': 'addNetwork',
  'remove-network': 'manageNetworks',
  'manage-networks': 'manageNetworks',
  'edit-network': 'editNetwork',
  'starred-accounts': 'starredAccounts',
  'new-project': 'newProject',
  'testnet-account': 'testnetAccount',
  'add-toolchain': 'toolchains',
  'unlock-vault': 'vault',
  'permission-change': null,
  'coming-later': 'comingLater',
  'file-changed': 'fileChanged',
  'clear-data': 'settingsData'
}
/** Dialogs without a "?": the help window shows the documentation itself. */
const DIALOGS_WITHOUT_HELP = new Set(['help'])

/** The opening tag of every Modal in a source text: its name and its help attribute. */
function modalTags(text: string): { name: string; help: string | null; tag: string }[] {
  const out: { name: string; help: string | null; tag: string }[] = []
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (!/<Modal\b/.test(lines[i])) continue
    // A one-line tag ends on its own line; a multi-line tag ends at a line holding only ">".
    let tag = lines[i]
    if (!/>\s*$/.test(lines[i]) || /<Modal\s*$/.test(lines[i])) {
      let j = i + 1
      while (j < lines.length && !/^\s*>\s*$/.test(lines[j])) tag += '\n' + lines[j++]
    }
    const name = /\bname="([^"]+)"/.exec(tag)?.[1] ?? ''
    const help = /\bhelp=(?:"([^"]+)"|\{[^}]+\})/.exec(tag)
    out.push({ name, help: help ? (help[1] ?? '{}') : null, tag })
  }
  return out
}

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) sources(p, out)
    else if (/\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

describe('context help', () => {
  const index = existsSync(join(REAL_DOCS, 'index.json')) ? parseDocsIndex(readFileSync(join(REAL_DOCS, 'index.json'), 'utf8')) : null
  const ids = new Set(index ? allTopics(index).map((t) => t.id) : [])

  it('the feature table covers every help place, and every topic of it exists', () => {
    expect(FEATURE_TOPICS.map(([, p]) => p).sort()).toEqual(Object.keys(HELP_TOPICS).sort())
    for (const [feature, place] of FEATURE_TOPICS) expect(ids.has(HELP_TOPICS[place]), `${feature}: ${HELP_TOPICS[place]}`).toBe(true)
  })

  it('every "?" and "Read more" names a help place; every place is used', () => {
    const used = new Set<string>()
    for (const f of sources(RENDERER)) {
      const text = readFileSync(f, 'utf8')
      for (const m of text.matchAll(/\b(?:place|help)="([^"]+)"/g)) {
        expect(Object.keys(HELP_TOPICS), `${f}: ${m[1]}`).toContain(m[1])
        used.add(m[1])
      }
      // Topics are opened by place, never by a literal id.
      expect(/openHelp\(\s*['"`]/.test(text), f).toBe(false)
    }
    expect([...used].sort()).toEqual(Object.keys(HELP_TOPICS).sort())
  })

  it('each dialog of the list has its "?" in the title row', () => {
    const dialogs: [string, string, string][] = [
      ['components/DeployDialog.tsx', 'deploy', 'deploy'],
      ['components/AccountDialogs.tsx', 'create-account', 'createAccount'],
      ['components/AccountDialogs.tsx', 'change-key', 'changeKey'],
      ['components/TestnetAccountDialog.tsx', 'testnet-account', 'testnetAccount'],
      ['components/KeysDialog.tsx', 'manage-keypairs', 'manageKeypairs'],
      ['components/NetworkDialogs.tsx', 'add-network', 'addNetwork'],
      ['components/NetworkDialogs.tsx', 'manage-networks', 'manageNetworks']
    ]
    for (const [file, name, place] of dialogs) {
      const text = readFileSync(join(RENDERER, file), 'utf8').replace(/\r\n/g, '\n')
      expect(text, `${file} ${name}`).toMatch(new RegExp(`name="${name}"\\s+help="${place}"`))
    }
    const modal = readFileSync(join(RENDERER, 'components/Modal.tsx'), 'utf8')
    expect(modal).toContain('{help && <HelpButton place={help} />}')
  })

  it('every dialog of the program has its "?", and the list of dialogs is complete', () => {
    const found = new Map<string, string | null>()
    for (const f of sources(RENDERER)) {
      for (const m of modalTags(readFileSync(f, 'utf8'))) {
        expect(m.name, `${f}: a Modal without a name\n${m.tag}`).not.toBe('')
        found.set(m.name, m.help)
        if (DIALOGS_WITHOUT_HELP.has(m.name)) continue
        expect(m.help, `${f}: dialog "${m.name}" has no help place`).not.toBeNull()
        expect(Object.keys(DIALOG_HELP), `${f}: dialog "${m.name}" is not in the list of dialogs`).toContain(m.name)
        const want = DIALOG_HELP[m.name]
        if (want) expect(m.help, `${f}: dialog "${m.name}"`).toBe(want)
      }
    }
    expect([...found.keys()].sort()).toEqual([...Object.keys(DIALOG_HELP), ...DIALOGS_WITHOUT_HELP].sort())
  })

  it('every text-input dialog names its help place', () => {
    for (const f of sources(RENDERER)) {
      const text = readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
      for (const m of text.matchAll(/<InputDialog\b([\s\S]*?)\/>/g)) expect(m[1], f).toMatch(/\bhelp="[A-Za-z]+"/)
    }
    expect(readFileSync(join(RENDERER, 'components/Modal.tsx'), 'utf8')).toContain('help={props.help}')
  })

  it('every section of the Account page and every group of the Settings page has its "?"', () => {
    const sections: [string, string][] = [
      ['pages/account/TokensSection.tsx', 'walletTransfers'],
      ['pages/account/TransferSection.tsx', 'walletTransfers'],
      ['pages/account/RamSection.tsx', 'walletRam'],
      ['pages/account/CpuNetSection.tsx', 'walletCpuNet'],
      ['pages/account/PermissionsSection.tsx', 'walletPermissions'],
      ['pages/account/LinksSection.tsx', 'walletLinks'],
      ['pages/account/ContractSection.tsx', 'walletContract'],
      ['pages/account/CreateAccountSection.tsx', 'walletCreateAccount'],
      ['pages/account/VotingSection.tsx', 'walletVoting'],
      ['pages/account/PowerupSection.tsx', 'walletPowerup'],
      ['pages/account/NameBidsSection.tsx', 'walletNameBids'],
      ['pages/account/FaucetSection.tsx', 'walletFaucet'],
      ['pages/account/TransactionsSection.tsx', 'walletTransactions']
    ]
    for (const [file, place] of sections) expect(readFileSync(join(RENDERER, file), 'utf8'), file).toContain(`<HelpButton place="${place}" />`)
    // A new section file gets a row above.
    const files = readdirSync(join(RENDERER, 'pages/account')).filter((n) => n.endsWith('Section.tsx'))
    expect(files.map((n) => `pages/account/${n}`).sort()).toEqual(sections.map(([f]) => f).sort())

    const settings = readFileSync(join(RENDERER, 'pages/SettingsPage.tsx'), 'utf8').replace(/\r\n/g, '\n')
    const groups = [...settings.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => m[1])
    expect(groups.length).toBeGreaterThan(0)
    for (const g of groups) expect(g, g.trim()).toMatch(/<HelpButton place="settings[A-Z]\w*" \/>/)
  })

  it('each page of the list has its "?"', () => {
    const pages: [string, string][] = [
      ['pages/NetworkPage.tsx', 'networkPage'],
      ['pages/ProjectSettings.tsx', 'projectSettings'],
      ['pages/SettingsPage.tsx', 'settings'],
      ['pages/Setup.tsx', 'setup'],
      ['pages/ContractPage.tsx', 'contractPage'],
      ['pages/AccountPage.tsx', 'accountPage'],
      ['pages/Home.tsx', 'home'],
      ['pages/WasmInfoView.tsx', 'wasmView']
    ]
    for (const [file, place] of pages) expect(readFileSync(join(RENDERER, file), 'utf8'), file).toContain(`<HelpButton place="${place}" />`)
  })

  it('Help > Documentation opens the page; the web address is the project page', () => {
    const help = MENU_MODEL.find((m) => m.label === 'Help')!.items
    expect(help[0]).toEqual({ kind: 'command', label: 'Documentation', command: 'docs' })
    expect(help[1]).toEqual({ kind: 'link', label: 'Project Page', url: 'https://github.com/gulkonster/wax-master#readme' })
    const app = readFileSync(join(RENDERER, 'App.tsx'), 'utf8')
    expect(app).toMatch(/case 'docs':\s+actions\.setView\('docs'\)/)
  })

  it('the documentation files are shipped as extra resources', () => {
    const yml = readFileSync(join(ROOT, 'electron-builder.yml'), 'utf8').replace(/\r\n/g, '\n')
    expect(yml).toContain("  - from: docs/help\n    to: resources/docs\n    filter:\n      - '*.md'\n      - index.json\n")
  })
})
