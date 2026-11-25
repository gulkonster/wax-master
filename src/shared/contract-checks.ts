// Antelope's naming rules, checked on the source text while typing. The chain
// fixes them, so a mistake can be said exactly before the build: a name is up
// to 12 characters of a-z, 1-5 and '.', a 13th character of 1-5 or a-j, and
// never ends with a dot. Pure functions, no engine involved.

import type { LspDiagnostic, LspRange } from './lsp-diagnostics'

export interface Check {
  range: LspRange
  severity: 1 | 2
  code: 'name-literal' | 'action-name' | 'table-name' | 'notify-name'
  message: string
}

export const NAME_RULE =
  "Names use a-z, 1-5 and '.', at most 12 characters (a 13th may be 1-5 or a-j), and do not end with a dot."

const BASE_CHAR = /^[a-z1-5.]$/
const LAST_CHAR = /^[a-j1-5]$/

/** The reason a name is not valid (first fault: a character, the length, the 13th character, the dot); null when valid. */
export function nameFault(name: string): string | null {
  for (const ch of name) {
    if (!BASE_CHAR.test(ch)) return `'${ch}' is not allowed`
  }
  if (name.length > 13) return `it has ${name.length} characters`
  if (name.length === 13 && !LAST_CHAR.test(name[12])) return `the 13th character '${name[12]}' is not allowed`
  if (name.endsWith('.')) return 'it ends with a dot'
  return null
}

/** True when the engine diagnostic is a follow-up of a bad `"..."_n` that a check already names. */
export function replacedByCheck(d: LspDiagnostic, checks: Check[]): boolean {
  if (d.code !== 'constexpr_var_requires_const_init' && d.code !== 'expr_not_cce') return false
  return checks.some((c) => c.code === 'name-literal' && touches(c.range, d.range))
}

function before(a: { line: number; character: number }, b: { line: number; character: number }): boolean {
  return a.line < b.line || (a.line === b.line && a.character < b.character)
}

function touches(a: LspRange, b: LspRange): boolean {
  return !before(a.end, b.start) && !before(b.end, a.start)
}

/** Text with comments blanked (same offsets, newlines kept). Strings are left as they are. */
function maskComments(text: string): string {
  const out = text.split('')
  const n = text.length
  let i = 0
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' '
  }
  while (i < n) {
    const c = text[i]
    const next = text[i + 1]
    if (c === '/' && next === '/') {
      let j = i
      while (j < n && text[j] !== '\n') j++
      blank(i, j)
      i = j
    } else if (c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2)
      const j = end < 0 ? n : end + 2
      blank(i, j)
      i = j
    } else if (c === '"') {
      i = skipString(text, i)
    } else if (c === "'") {
      const prev = i > 0 ? text[i - 1] : ''
      if (/[0-9a-zA-Z_]/.test(prev)) {
        i++ // digit separator
      } else {
        i = skipChar(text, i)
      }
    } else {
      i++
    }
  }
  return out.join('')
}

/** Index after the string literal that opens at `start`; ends at a newline when it is not closed. */
function skipString(text: string, start: number): number {
  const n = text.length
  if (start > 0 && text[start - 1] === 'R') {
    const open = text.indexOf('(', start)
    if (open > 0 && open - start - 1 <= 16 && !/[\s"\\()]/.test(text.slice(start + 1, open))) {
      const close = text.indexOf(')' + text.slice(start + 1, open) + '"', open)
      return close < 0 ? n : close + (open - start) + 1
    }
  }
  let i = start + 1
  while (i < n) {
    const c = text[i]
    if (c === '\\') i += 2
    else if (c === '"') return i + 1
    else if (c === '\n') return i
    else i++
  }
  return n
}

function skipChar(text: string, start: number): number {
  const n = text.length
  let i = start + 1
  while (i < n) {
    const c = text[i]
    if (c === '\\') i += 2
    else if (c === "'") return i + 1
    else if (c === '\n') return i
    else i++
  }
  return n
}

interface Lines {
  at(offset: number): { line: number; character: number }
}

function lineIndex(text: string): Lines {
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1)
  return {
    at(offset: number) {
      let lo = 0
      let hi = starts.length - 1
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (starts[mid] <= offset) lo = mid
        else hi = mid - 1
      }
      return { line: lo, character: offset - starts[lo] }
    }
  }
}

const IDENT_START = /[A-Za-z_]/
const IDENT_CHAR = /[A-Za-z0-9_]/

export function contractChecks(text: string): Check[] {
  const masked = maskComments(text)
  const lines = lineIndex(text)
  const checks: Check[] = []
  const range = (from: number, to: number): LspRange => ({ start: lines.at(from), end: lines.at(to) })

  // 1. every "..."_n
  {
    let i = 0
    while (i < masked.length) {
      const c = masked[i]
      if (c === '"') {
        const end = skipString(masked, i)
        const closed = end - 1 > i && masked[end - 1] === '"'
        if (closed && masked[end] === '_' && masked[end + 1] === 'n' && !IDENT_CHAR.test(masked[end + 2] ?? '')) {
          const inner = masked.slice(i + 1, end - 1)
          const fault = nameFault(inner)
          if (fault !== null) {
            const source = masked.slice(i, end + 2)
            checks.push({
              range: range(i, end + 2),
              severity: 1,
              code: 'name-literal',
              message: `${source} is not a valid name: ${fault}. ${NAME_RULE}`
            })
          }
          i = end + 2
        } else {
          i = end
        }
      } else if (c === "'") {
        const prev = i > 0 ? masked[i - 1] : ''
        i = /[0-9a-zA-Z_]/.test(prev) ? i + 1 : skipChar(masked, i)
      } else {
        i++
      }
    }
  }

  // 2. attributes: [[eosio::action ...]], [[eosio::table("...")]], [[eosio::on_notify("...")]]
  {
    let i = 0
    while (i < masked.length) {
      const c = masked[i]
      if (c === '"') {
        i = skipString(masked, i)
        continue
      }
      if (c === "'") {
        const prev = i > 0 ? masked[i - 1] : ''
        i = /[0-9a-zA-Z_]/.test(prev) ? i + 1 : skipChar(masked, i)
        continue
      }
      if (c === '[' && masked[i + 1] === '[') {
        const close = groupEnd(masked, i)
        if (close < 0) {
          i += 2
          continue
        }
        checkAttributeGroup(masked, i, close, range, checks)
        i = close
        continue
      }
      i++
    }
  }

  // 3. ACTION f(
  {
    const re = /(^|[^A-Za-z0-9_])ACTION\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g
    let m: RegExpExecArray | null
    while ((m = re.exec(masked)) !== null) {
      const wordStart = m.index + m[1].length
      const lineStart = masked.lastIndexOf('\n', wordStart) + 1
      if (/^\s*#\s*define\b/.test(masked.slice(lineStart, wordStart))) continue
      const start = m.index + m[0].lastIndexOf(m[2])
      pushAction(m[2], start, start + m[2].length, range, checks)
    }
  }

  checks.sort(
    (a, b) => a.range.start.line - b.range.start.line || a.range.start.character - b.range.start.character
  )
  return checks
}

function pushAction(
  name: string,
  from: number,
  to: number,
  range: (a: number, b: number) => LspRange,
  checks: Check[]
): void {
  const fault = nameFault(name)
  if (fault === null) return
  checks.push({
    range: range(from, to),
    severity: 1,
    code: 'action-name',
    message:
      `Action name '${name}' is not valid: ${fault}. ${NAME_RULE} ` +
      'The action name is the function name unless [[eosio::action("name")]] gives another.'
  })
}

/** Index after the `]]` that closes the group opened by `[[` at `start`, or -1. */
function groupEnd(masked: string, start: number): number {
  let depth = 0
  let i = start
  while (i < masked.length) {
    const c = masked[i]
    if (c === '"') {
      i = skipString(masked, i)
      continue
    }
    if (c === '[') depth++
    else if (c === ']') {
      depth--
      if (depth === 0) return i + 1
      if (depth < 0) return -1
    } else if (c === ';' || c === '{' || c === '}') return -1
    i++
  }
  return -1
}

interface Item {
  from: number
  to: number
}

/** The top-level comma separated items of a group, as offsets inside it. */
function groupItems(masked: string, from: number, to: number): Item[] {
  const items: Item[] = []
  let depth = 0
  let begin = from
  let i = from
  while (i < to) {
    const c = masked[i]
    if (c === '"') {
      i = skipString(masked, i)
      continue
    }
    if (c === '(' || c === '[' || c === '<') depth++
    else if (c === ')' || c === ']' || c === '>') depth--
    else if (c === ',' && depth === 0) {
      items.push({ from: begin, to: i })
      begin = i + 1
    }
    i++
  }
  items.push({ from: begin, to: to })
  return items
}

function checkAttributeGroup(
  masked: string,
  open: number,
  close: number,
  range: (a: number, b: number) => LspRange,
  checks: Check[]
): void {
  const items = groupItems(masked, open + 2, close - 2)
  let hasBareAction = false
  for (const item of items) {
    const body = masked.slice(item.from, item.to)
    const m = /^(\s*eosio::)(action|table|on_notify)\s*(\(\s*)?/.exec(body)
    if (!m) continue
    const kind = m[2]
    if (m[3] === undefined) {
      if (kind === 'action') hasBareAction = true
      continue
    }
    if (body[m[0].length] !== '"') continue
    const abs = item.from + m[0].length
    const end = skipString(masked, abs)
    if (masked[end - 1] !== '"' || end - 1 <= abs) continue
    const value = masked.slice(abs + 1, end - 1)
    if (kind === 'action') {
      const fault = nameFault(value)
      if (fault !== null) {
        checks.push({
          range: range(abs, end),
          severity: 1,
          code: 'action-name',
          message:
            `Action name '${value}' is not valid: ${fault}. ${NAME_RULE} ` +
            'The action name is the function name unless [[eosio::action("name")]] gives another.'
        })
      }
    } else if (kind === 'table') {
      const fault = nameFault(value)
      if (fault !== null) {
        checks.push({
          range: range(abs, end),
          severity: 1,
          code: 'table-name',
          message: `Table name '${value}' is not valid: ${fault}. ${NAME_RULE}`
        })
      }
    } else {
      const message = notifyFault(value)
      if (message !== null) {
        checks.push({ range: range(abs, end), severity: 1, code: 'notify-name', message })
      }
    }
  }
  if (hasBareAction && !items.some((it) => /^\s*eosio::action\s*\(/.test(masked.slice(it.from, it.to)))) {
    const fn = functionNameAfter(masked, close)
    if (fn) pushAction(fn.name, fn.from, fn.to, range, checks)
  }
}

function notifyFault(value: string): string | null {
  const head = `Notification '${value}' is not valid: `
  const parts = value.split('::')
  if (parts.length !== 2) {
    return `${head}it must be two parts joined by '::', like "eosio.token::transfer". A part may be '*' for any.`
  }
  for (const part of parts) {
    if (part === '*') continue
    const fault = nameFault(part)
    if (fault !== null) return `${head}'${part}' is not a valid name: ${fault}. ${NAME_RULE} A part may be '*' for any.`
  }
  return null
}

/** The function name of the declaration that follows an attribute group. */
function functionNameAfter(masked: string, from: number): { name: string; from: number; to: number } | null {
  let i = from
  for (;;) {
    while (i < masked.length && /\s/.test(masked[i])) i++
    if (masked[i] === '[' && masked[i + 1] === '[') {
      const end = groupEnd(masked, i)
      if (end < 0) return null
      i = end
    } else break
  }
  while (i < masked.length) {
    const c = masked[i]
    if (c === '(') {
      let e = i
      while (e > from && /\s/.test(masked[e - 1])) e--
      let s = e
      while (s > from && IDENT_CHAR.test(masked[s - 1])) s--
      if (s === e || !IDENT_START.test(masked[s])) return null
      return { name: masked.slice(s, e), from: s, to: e }
    }
    if (c === ';' || c === '{' || c === '}' || c === '=') return null
    if (c === '"') {
      i = skipString(masked, i)
      continue
    }
    i++
  }
  return null
}
