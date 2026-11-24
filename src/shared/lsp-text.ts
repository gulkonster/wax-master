// Applies language-server text edits to plain text (for files that are not
// open in the editor, e.g. other files touched by a rename).

import type { LspRange } from './lsp-diagnostics'

export interface LspTextEdit {
  range: LspRange
  newText: string
}

function lineStarts(text: string): number[] {
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1)
  return starts
}

function offsetOf(starts: number[], text: string, line: number, character: number): number {
  if (line >= starts.length) return text.length
  const lineStart = starts[line]
  let lineEnd = line + 1 < starts.length ? starts[line + 1] - 1 : text.length
  if (lineEnd > lineStart && text.charCodeAt(lineEnd - 1) === 13) lineEnd--
  return Math.min(lineStart + Math.max(0, character), lineEnd)
}

/** Edits refer to the original text and must not overlap (as the protocol requires). */
export function applyTextEdits(text: string, edits: LspTextEdit[]): string {
  const starts = lineStarts(text)
  const spans = edits
    .map((e, i) => ({
      start: offsetOf(starts, text, e.range.start.line, e.range.start.character),
      end: offsetOf(starts, text, e.range.end.line, e.range.end.character),
      text: e.newText,
      i
    }))
    .sort((a, b) => b.start - a.start || b.i - a.i)
  let out = text
  for (const s of spans) out = out.slice(0, s.start) + s.text + out.slice(Math.max(s.start, s.end))
  return out
}
