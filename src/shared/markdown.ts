// The Markdown subset of the documentation, parsed into plain data. The page
// builds interface elements from this data only; no text of a file is ever
// treated as markup. Supported: headings (#, ##, ###), paragraphs, **bold**,
// `inline code`, fenced code blocks, lists (- or * , and 1.), tables, links
// (doc:<topic>, https://..., app:<menu command>), notes (lines starting
// with >) and pictures (a line `![caption](img:<name>)` on its own, naming one
// of the pictures built into the app). Anything else stays visible as plain text and is reported as a
// problem, which the documentation tests refuse.

import type { MenuCommand } from './api'
import { docsCommands, isTopicId } from './docs'

export type Inline =
  | { t: 'text'; text: string }
  | { t: 'code'; text: string }
  | { t: 'bold'; children: Inline[] }
  | { t: 'doc'; topic: string; children: Inline[] }
  | { t: 'https'; url: string; children: Inline[] }
  | { t: 'app'; command: MenuCommand; label: string }

export type Block =
  | { t: 'heading'; level: 1 | 2 | 3; children: Inline[] }
  | { t: 'paragraph'; children: Inline[] }
  | { t: 'code'; lang: string; text: string }
  | { t: 'list'; ordered: boolean; start: number; items: Inline[][] }
  | { t: 'table'; header: Inline[][]; rows: Inline[][][] }
  | { t: 'note'; paragraphs: Inline[][] }
  | { t: 'picture'; name: string; caption: string }

export interface MdProblem {
  line: number
  message: string
}

export interface MdDocument {
  blocks: Block[]
  problems: MdProblem[]
}

const COMMANDS = docsCommands()

/** A picture name: lower-case letters, digits and single hyphens, at most 40 characters. */
export function isPictureName(name: unknown): name is string {
  return typeof name === 'string' && name.length <= 40 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)
}

/** The problem text of a picture line that is not of the one supported form. */
export const PICTURE_FORM = 'pictures are written ![caption](img:<name>)'

const PICTURE_LINE = /^!\[(.*)\]\(([^()\s]*)\)$/

/** A line meant as a picture: the whole line is `![...](...)`, or it names an img: target. */
function looksLikePicture(line: string): boolean {
  return line.startsWith('![') && (PICTURE_LINE.test(line) || line.includes('](img:'))
}

/** The picture of a line that is exactly `![caption](img:<name>)`, or null. */
function pictureOf(line: string): { name: string; caption: string } | null {
  const m = PICTURE_LINE.exec(line)
  if (!m || !m[2].startsWith('img:')) return null
  const name = m[2].slice(4)
  const caption = m[1]
  if (!isPictureName(name)) return null
  // Plain text only: 1 to 200 characters, no markup, no bracket, no entity.
  if (caption.trim() === '' || caption !== caption.trim() || caption.length > 200) return null
  if (/[[\]`*<>\\]/.test(caption) || /&#?[A-Za-z0-9]+;/.test(caption)) return null
  return { name, caption }
}

/** How a link target is read: one of the three kinds, or null (the link stays text). */
export function linkTarget(target: string): { t: 'doc'; topic: string } | { t: 'https'; url: string } | { t: 'app'; command: MenuCommand } | null {
  if (target.startsWith('doc:')) {
    const id = target.slice(4)
    return isTopicId(id) ? { t: 'doc', topic: id } : null
  }
  if (target.startsWith('app:')) {
    const c = target.slice(4)
    return COMMANDS.has(c as MenuCommand) ? { t: 'app', command: c as MenuCommand } : null
  }
  if (target.startsWith('https://')) {
    try {
      const u = new URL(target)
      return u.protocol === 'https:' && u.hostname !== '' && u.username === '' && u.password === '' ? { t: 'https', url: u.toString() } : null
    } catch {
      return null
    }
  }
  return null
}

const ESCAPABLE = '\\`*_[]()#+-.!|>~<'

/** Inline parser. `report` collects constructs outside the subset; they stay as text. */
function parseInline(src: string, line: number, report: (line: number, message: string) => void, inBold = false, inLink = false): Inline[] {
  const out: Inline[] = []
  let buf = ''
  const flush = (): void => {
    if (buf) out.push({ t: 'text', text: buf })
    buf = ''
  }
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === '\\' && i + 1 < src.length && ESCAPABLE.includes(src[i + 1])) {
      buf += src[i + 1]
      i += 2
      continue
    }
    if (c === '`') {
      let n = 1
      while (src[i + n] === '`') n++
      const fence = '`'.repeat(n)
      const end = src.indexOf(fence, i + n)
      if (end > i + n - 1 && src[end + n] !== '`') {
        flush()
        const inner = src.slice(i + n, end)
        out.push({ t: 'code', text: inner.length > 2 && inner.startsWith(' ') && inner.endsWith(' ') ? inner.slice(1, -1) : inner })
        i = end + n
        continue
      }
      buf += fence
      i += n
      continue
    }
    if (c === '*' && src[i + 1] === '*' && !inBold) {
      const end = src.indexOf('**', i + 2)
      if (end > i + 2) {
        flush()
        out.push({ t: 'bold', children: parseInline(src.slice(i + 2, end), line, report, true, inLink) })
        i = end + 2
        continue
      }
    }
    if (c === '!' && src[i + 1] === '[') {
      report(line, 'images are not supported')
      buf += '!'
      i++
      continue
    }
    if (c === '[' && !inLink) {
      const m = /^\[([^\]\n]+)\]\(([^()\s]*)\)/.exec(src.slice(i))
      if (m) {
        const target = linkTarget(m[2])
        if (target) {
          flush()
          if (target.t === 'app') out.push({ t: 'app', command: target.command, label: m[1] })
          else if (target.t === 'doc') out.push({ t: 'doc', topic: target.topic, children: parseInline(m[1], line, report, inBold, true) })
          else out.push({ t: 'https', url: target.url, children: parseInline(m[1], line, report, inBold, true) })
        } else {
          report(line, `link target "${m[2]}" is not doc:<topic>, https://... or app:<menu command>`)
          buf += m[0]
        }
        i += m[0].length
        continue
      }
      if (/^\[[^\]\n]+\]:\s/.test(src.slice(i))) report(line, 'reference links are not supported')
      else if (/^\[[^\]\n]*\]\(/.test(src.slice(i))) report(line, 'link not understood (shown as text)')
    }
    if (c === '<' && /^<\/?[A-Za-z!?]/.test(src.slice(i, i + 3))) report(line, 'HTML is not supported (shown as text)')
    if (c === '&' && /^&#?[A-Za-z0-9]+;/.test(src.slice(i))) report(line, 'HTML entities are not supported (shown as text)')
    if (c === '*' && src[i + 1] !== '*' && src[i - 1] !== '*' && /^\*[^\s*][^*]*\*(?!\*)/.test(src.slice(i))) report(line, 'italic is not supported; use **bold**')
    buf += c
    i++
  }
  flush()
  return out
}

const FENCE = /^```\s*([A-Za-z0-9+#_-]*)\s*$/
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const UL = /^([-*])\s+(.*)$/
const OL = /^(\d{1,9})\.\s+(.*)$/
const TABLE_SEP = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/
const RULE = /^(\*\s*){3,}$|^(-\s*){3,}$|^(_\s*){3,}$/

function splitRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  const cells: string[] = []
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') {
      cur += '\\|'
      i++
    } else if (s[i] === '|') {
      cells.push(cur.trim())
      cur = ''
    } else cur += s[i]
  }
  cells.push(cur.trim())
  return cells
}

/** Parses one topic. Never throws; whatever is outside the subset is kept as text and listed in `problems`. */
export function parseMarkdown(source: string): MdDocument {
  const lines = source.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  const problems: MdProblem[] = []
  const report = (line: number, message: string): void => {
    problems.push({ line, message })
  }
  const inline = (s: string, line: number): Inline[] => parseInline(s, line, report)
  const isBlank = (s: string | undefined): boolean => s === undefined || s.trim() === ''
  const startsBlock = (s: string, next: string | undefined): boolean => {
    const t = s.trimStart()
    return FENCE.test(t) || HEADING.test(t) || UL.test(t) || OL.test(t) || t.startsWith('>') || (t.startsWith('|') && next !== undefined && TABLE_SEP.test(next.trim()))
  }

  // Lines read and reported as a picture line; every other line meant as a picture is reported below.
  const pictureLines = new Set<number>()

  let i = 0
  while (i < lines.length) {
    const raw = lines[i]
    const ln = i + 1
    if (isBlank(raw)) {
      i++
      continue
    }
    const indent = raw.length - raw.trimStart().length
    const line = raw.trim()

    // A picture: the line on its own, with a blank line (or the start or end of the file) around it.
    if (indent < 4 && isBlank(lines[i - 1]) && isBlank(lines[i + 1]) && PICTURE_LINE.test(line)) {
      const pic = pictureOf(line)
      pictureLines.add(i)
      if (pic) {
        blocks.push({ t: 'picture', name: pic.name, caption: pic.caption })
      } else {
        // Another target, a bad name or caption: the line stays text as it is.
        report(ln, 'images are not supported')
        report(ln, PICTURE_FORM)
        blocks.push({ t: 'paragraph', children: [{ t: 'text', text: line }] })
      }
      i++
      continue
    }

    // Fenced code block: the text is kept exactly.
    const fence = FENCE.exec(raw.trimStart())
    if (fence && indent < 4) {
      const body: string[] = []
      i++
      while (i < lines.length && lines[i].trim() !== '```') body.push(lines[i++])
      if (i >= lines.length) report(ln, 'code block is not closed with ```')
      else i++
      blocks.push({ t: 'code', lang: fence[1], text: body.join('\n') })
      continue
    }
    if (indent >= 4) report(ln, 'indented code is not supported; use a ``` block')

    const h = HEADING.exec(line)
    if (h) {
      if (h[1].length > 3) {
        report(ln, 'only headings #, ## and ### are supported')
        blocks.push({ t: 'paragraph', children: inline(line, ln) })
      } else {
        blocks.push({ t: 'heading', level: h[1].length as 1 | 2 | 3, children: inline(h[2], ln) })
      }
      i++
      continue
    }

    if (RULE.test(line)) {
      report(ln, 'horizontal rules are not supported')
      blocks.push({ t: 'paragraph', children: [{ t: 'text', text: line }] })
      i++
      continue
    }

    if (line.startsWith('>')) {
      const paragraphs: Inline[][] = []
      let cur: string[] = []
      let curLine = ln
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        const content = lines[i].trim().replace(/^>\s?/, '')
        if (content.trim() === '') {
          if (cur.length) paragraphs.push(inline(cur.join(' '), curLine))
          cur = []
        } else {
          if (!cur.length) curLine = i + 1
          if (startsBlock(content, undefined) && !content.startsWith('>')) report(i + 1, 'a note holds plain paragraphs only')
          if (content.startsWith('>')) report(i + 1, 'nested notes are not supported')
          cur.push(content.trim())
        }
        i++
      }
      if (cur.length) paragraphs.push(inline(cur.join(' '), curLine))
      blocks.push({ t: 'note', paragraphs })
      continue
    }

    if (line.startsWith('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1].trim())) {
      const head = splitRow(line)
      const header = head.map((c) => inline(c, ln))
      const rows: Inline[][][] = []
      i += 2
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const cells = splitRow(lines[i])
        if (cells.length !== head.length) report(i + 1, `table row has ${cells.length} cells, the header ${head.length}`)
        const row: Inline[][] = []
        for (let c = 0; c < head.length; c++) row.push(inline(cells[c] ?? '', i + 1))
        rows.push(row)
        i++
      }
      blocks.push({ t: 'table', header, rows })
      continue
    }

    const ul = UL.exec(line)
    const ol = OL.exec(line)
    if (ul || ol) {
      const ordered = !!ol
      const start = ol ? parseInt(ol[1], 10) : 1
      const items: Inline[][] = []
      let text: string[] = []
      let itemLine = ln
      const push = (): void => {
        if (text.length) items.push(inline(text.join(' '), itemLine))
        text = []
      }
      while (i < lines.length && !isBlank(lines[i])) {
        const r = lines[i]
        const ind = r.length - r.trimStart().length
        const t = r.trim()
        const mu = UL.exec(t)
        const mo = OL.exec(t)
        if (mu || mo) {
          if (ind > 0) report(i + 1, 'nested lists are not supported')
          if (!!mo !== ordered && ind === 0) break
          push()
          itemLine = i + 1
          text.push((mu ? mu[2] : mo![2]).trim())
        } else if (ind >= 2) {
          text.push(t)
        } else if (startsBlock(t, lines[i + 1])) {
          break
        } else {
          text.push(t)
        }
        i++
      }
      push()
      blocks.push({ t: 'list', ordered, start, items })
      continue
    }

    // Paragraph: lines up to a blank line or the start of another block.
    const para: string[] = [line]
    i++
    while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines[i], lines[i + 1]) && !RULE.test(lines[i].trim())) {
      if (/^(=+|-+)\s*$/.test(lines[i].trim())) report(i + 1, 'underlined headings are not supported; use #')
      para.push(lines[i].trim())
      i++
    }
    blocks.push({ t: 'paragraph', children: inline(para.join(' '), ln) })
  }

  // A line meant as a picture that is not one stays text (as read above) and is reported.
  let inCode = false
  for (let n = 0; n < lines.length; n++) {
    const t = lines[n].trim()
    if (!inCode && FENCE.test(lines[n].trimStart())) inCode = true
    else if (inCode && t === '```') inCode = false
    else if (!inCode && !pictureLines.has(n) && looksLikePicture(t)) report(n + 1, PICTURE_FORM)
  }
  return { blocks, problems }
}

/** Plain text of inline content (for search and for titles). */
export function inlineText(nodes: readonly Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.t) {
        case 'text':
        case 'code':
          return n.text
        case 'app':
          return n.label
        default:
          return inlineText(n.children)
      }
    })
    .join('')
}

/** Plain text of the headings and of the whole topic, for the search. */
export function documentText(doc: MdDocument): { headings: string; body: string } {
  const heads: string[] = []
  const parts: string[] = []
  for (const b of doc.blocks) {
    switch (b.t) {
      case 'heading':
        heads.push(inlineText(b.children))
        parts.push(inlineText(b.children))
        break
      case 'paragraph':
        parts.push(inlineText(b.children))
        break
      case 'code':
        parts.push(b.text)
        break
      case 'list':
        for (const it of b.items) parts.push(inlineText(it))
        break
      case 'table':
        parts.push(b.header.map(inlineText).join(' '))
        for (const r of b.rows) parts.push(r.map(inlineText).join(' '))
        break
      case 'note':
        for (const p of b.paragraphs) parts.push(inlineText(p))
        break
      case 'picture':
        parts.push(b.caption)
        break
    }
  }
  return { headings: heads.join('\n'), body: parts.join('\n') }
}

/** Every link of a topic, for the link tests. */
export function documentLinks(doc: MdDocument): { docs: string[]; urls: string[]; commands: MenuCommand[] } {
  const out = { docs: [] as string[], urls: [] as string[], commands: [] as MenuCommand[] }
  const walk = (nodes: readonly Inline[]): void => {
    for (const n of nodes) {
      if (n.t === 'doc') out.docs.push(n.topic)
      else if (n.t === 'https') out.urls.push(n.url)
      else if (n.t === 'app') out.commands.push(n.command)
      if (n.t === 'bold' || n.t === 'doc' || n.t === 'https') walk(n.children)
    }
  }
  for (const b of doc.blocks) {
    if (b.t === 'heading' || b.t === 'paragraph') walk(b.children)
    else if (b.t === 'list') b.items.forEach(walk)
    else if (b.t === 'table') [...b.header, ...b.rows.flat()].forEach(walk)
    else if (b.t === 'note') b.paragraphs.forEach(walk)
  }
  return out
}
