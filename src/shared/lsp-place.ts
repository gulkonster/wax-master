// Where an engine error is drawn (decision B96). The engine reports a missing
// `;` at the next token and `Expected '}'` at a place with no width; its own fix
// carries the true place. Pure functions: no engine, no editor.

import type { LspDiagnostic, LspPosition, LspRange } from './lsp-diagnostics'

type Placed = LspDiagnostic

function before(a: LspPosition, b: LspPosition): boolean {
  return a.line < b.line || (a.line === b.line && a.character < b.character)
}

function isEmpty(r: LspRange): boolean {
  return r.start.line === r.end.line && r.start.character === r.end.character
}

/** The one insertion of a diagnostic's only fix, or null (two fixes, two edits, a replacement, another document). */
function soleInsertion(d: Placed, docUri: string): LspPosition | null {
  const actions = d.codeActions
  if (!actions || actions.length !== 1) return null
  const edit = actions[0].edit
  // The edits come in `changes`, or in `documentChanges` for a client that announces them (the window does).
  const docs = edit?.documentChanges ?? Object.entries(edit?.changes ?? {}).map(([uri, edits]) => ({ textDocument: { uri }, edits }))
  if (docs.length !== 1 || docs[0].textDocument.uri !== docUri) return null
  const edits = docs[0].edits
  if (edits.length !== 1) return null
  const e = edits[0]
  if (!isEmpty(e.range) || e.newText.length === 0) return null
  return e.range.start
}

/** The last non-blank character at or before (line, character - 1), or null. */
function lastNonBlankBefore(lines: string[], line: number, character: number): LspRange | null {
  for (let l = Math.min(line, lines.length - 1); l >= 0; l--) {
    const text = lines[l]
    const from = l === line ? Math.min(character, text.length) : text.length
    for (let c = from - 1; c >= 0; c--) {
      if (!/\s/.test(text[c])) return { start: { line: l, character: c }, end: { line: l, character: c + 1 } }
    }
  }
  return null
}

/** The range of one character at a place, or the last non-blank character before it when none stands there. */
function oneCharAt(lines: string[], pos: LspPosition): LspRange | null {
  const text = lines[pos.line] ?? ''
  if (pos.character < text.length) {
    return { start: pos, end: { line: pos.line, character: pos.character + 1 } }
  }
  return lastNonBlankBefore(lines, pos.line, pos.character)
}

/** The mistake is the character before the insertion; at column 1 it is the first character of the line. */
function beforeInsertion(lines: string[], at: LspPosition): LspRange | null {
  const text = lines[at.line] ?? ''
  const ch = Math.min(at.character, text.length)
  if (ch > 0) return { start: { line: at.line, character: ch - 1 }, end: { line: at.line, character: ch } }
  if (text.length > 0) return { start: { line: at.line, character: 0 }, end: { line: at.line, character: 1 } }
  return lastNonBlankBefore(lines, at.line, 0)
}

/** `<name>` or `"name"` on an #include line: its range and the name inside. */
function includeTarget(line: string): { start: number; end: number } | null {
  const m = /^\s*#\s*(?:include|import)\s*(<[^>]*>|"[^"]*")/.exec(line)
  if (!m) return null
  const start = m[0].length - m[1].length
  return { start, end: start + m[1].length }
}

const IN_INCLUDED = /^in included file:\s*/i

function includedFileMessage(d: LspDiagnostic, projectPathOf: (uri: string) => string): string | null {
  if (!IN_INCLUDED.test(d.message)) return null
  const related = d.relatedInformation ?? []
  const here = related.find((r) => /error occurred here/i.test(r.message)) ?? related[0]
  if (!here) return null
  const file = projectPathOf(here.location.uri)
  if (!file) return null
  return `${file}, line ${here.location.range.start.line + 1}: ${d.message.replace(IN_INCLUDED, '')}`
}

export function placeDiagnostics(
  list: LspDiagnostic[],
  lines: string[],
  docUri: string,
  projectPathOf: (uri: string) => string,
): LspDiagnostic[] {
  return list.map((d) => {
    const item = d as Placed
    let range = d.range
    let message = d.message

    // 4. An error from an included header: the whole header name, the message names the file and line.
    if (IN_INCLUDED.test(d.message)) {
      const target = includeTarget(lines[range.start.line] ?? '')
      if (target) {
        const text = includedFileMessage(d, projectPathOf)
        if (text !== null) message = text
        range = {
          start: { line: range.start.line, character: target.start },
          end: { line: range.start.line, character: target.end },
        }
      }
      return range === d.range && message === d.message ? d : { ...item, range, message }
    }

    // 1. A missing token: the character before the place the engine's own fix inserts it.
    const code = typeof d.code === 'string' ? d.code : ''
    if (code.startsWith('expected')) {
      const at = soleInsertion(item, docUri)
      if (at && before(at, range.start)) {
        const moved = beforeInsertion(lines, at)
        if (moved) return { ...item, range: moved }
      }
    }

    // 2. A range with no width: the character there, else the last non-blank character before it.
    if (isEmpty(range)) {
      const one = oneCharAt(lines, range.start)
      if (one) return { ...item, range: one }
    }
    return d
  })
}
