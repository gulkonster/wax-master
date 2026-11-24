// The documentation: the Markdown subset, the index format, the search, and the
// checks that keep the shipped topics current (topic ids, links, commands,
// subset, and the table of features with their topics).

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { allTopics, docsCommands, isDocsFileName, isTopicId, parseDocsIndex, searchDocs, topicFile, type SearchDoc } from '../../src/shared/docs'
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
    expect(searchDocs('ram nothing', docs)).toEqual([])
    expect(searchDocs('   ', docs)).toEqual([])
    expect(searchDocs('faucet', docs)[0].snippet).toContain('faucet sends tokens')
  })
  it('treats regular expression characters in the query as text', () => {
    expect(() => searchDocs('a.b (x) [y] *z+ ?', docs)).not.toThrow()
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
  ['CPU / NET / RAM refusal', 'resourceRefusal'],
  ['ABI check', 'abiCheck']
]

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

  it('each page of the list has its "?"', () => {
    const pages: [string, string][] = [
      ['pages/NetworkPage.tsx', 'networkPage'],
      ['pages/ProjectSettings.tsx', 'projectSettings'],
      ['pages/SettingsPage.tsx', 'settings'],
      ['pages/Setup.tsx', 'setup'],
      ['pages/ContractPage.tsx', 'contractPage'],
      ['pages/AccountPage.tsx', 'accountPage']
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
