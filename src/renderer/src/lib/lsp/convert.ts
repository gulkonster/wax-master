// Conversions between language-server shapes (0-based lines and characters)
// and Monaco shapes (1-based lines and columns).

import { monaco } from '../monaco'
import type { LspDiagnostic, LspPosition, LspRange } from '../../../../shared/lsp-diagnostics'

export interface MarkupContent {
  kind: 'markdown' | 'plaintext'
  value: string
}
export type MarkedString = string | { language: string; value: string }

export interface LspLocation {
  uri: string
  range: LspRange
}
export interface LspLocationLink {
  originSelectionRange?: LspRange
  targetUri: string
  targetRange: LspRange
  targetSelectionRange: LspRange
}

export function toPosition(p: monaco.IPosition): LspPosition {
  return { line: p.lineNumber - 1, character: p.column - 1 }
}

export function toLspRange(r: monaco.IRange): LspRange {
  return {
    start: { line: r.startLineNumber - 1, character: r.startColumn - 1 },
    end: { line: r.endLineNumber - 1, character: r.endColumn - 1 }
  }
}

export function toRange(r: LspRange): monaco.IRange {
  return {
    startLineNumber: r.start.line + 1,
    startColumn: r.start.character + 1,
    endLineNumber: r.end.line + 1,
    endColumn: r.end.character + 1
  }
}

function escapeMarkdown(s: string): string {
  return s.replace(/[\\`*_{}[\]()#+\-.!<>|]/g, '\\$&')
}

export function toMarkdown(v: MarkupContent | MarkedString | MarkedString[] | undefined | null): monaco.IMarkdownString[] {
  if (v === undefined || v === null) return []
  if (Array.isArray(v)) return v.flatMap((x) => toMarkdown(x))
  if (typeof v === 'string') return v ? [{ value: v }] : []
  if ('kind' in v) {
    if (!v.value) return []
    return [{ value: v.kind === 'markdown' ? v.value : escapeMarkdown(v.value) }]
  }
  return [{ value: '```' + v.language + '\n' + v.value + '\n```' }]
}

export function toDocumentation(v: string | MarkupContent | undefined): string | monaco.IMarkdownString | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v === 'string') return v
  return v.kind === 'markdown' ? { value: v.value } : v.value
}

/** Location | Location[] | LocationLink[] -> Monaco locations. */
export function toLocations(v: LspLocation | LspLocation[] | LspLocationLink[] | null | undefined): monaco.languages.Location[] {
  if (!v) return []
  const list = Array.isArray(v) ? v : [v]
  return list.map((x) =>
    'targetUri' in x
      ? { uri: monaco.Uri.parse(x.targetUri), range: toRange(x.targetSelectionRange ?? x.targetRange) }
      : { uri: monaco.Uri.parse(x.uri), range: toRange(x.range) }
  )
}

const LSP_COMPLETION_KIND: Record<number, monaco.languages.CompletionItemKind> = {
  1: monaco.languages.CompletionItemKind.Text,
  2: monaco.languages.CompletionItemKind.Method,
  3: monaco.languages.CompletionItemKind.Function,
  4: monaco.languages.CompletionItemKind.Constructor,
  5: monaco.languages.CompletionItemKind.Field,
  6: monaco.languages.CompletionItemKind.Variable,
  7: monaco.languages.CompletionItemKind.Class,
  8: monaco.languages.CompletionItemKind.Interface,
  9: monaco.languages.CompletionItemKind.Module,
  10: monaco.languages.CompletionItemKind.Property,
  11: monaco.languages.CompletionItemKind.Unit,
  12: monaco.languages.CompletionItemKind.Value,
  13: monaco.languages.CompletionItemKind.Enum,
  14: monaco.languages.CompletionItemKind.Keyword,
  15: monaco.languages.CompletionItemKind.Snippet,
  16: monaco.languages.CompletionItemKind.Color,
  17: monaco.languages.CompletionItemKind.File,
  18: monaco.languages.CompletionItemKind.Reference,
  19: monaco.languages.CompletionItemKind.Folder,
  20: monaco.languages.CompletionItemKind.EnumMember,
  21: monaco.languages.CompletionItemKind.Constant,
  22: monaco.languages.CompletionItemKind.Struct,
  23: monaco.languages.CompletionItemKind.Event,
  24: monaco.languages.CompletionItemKind.Operator,
  25: monaco.languages.CompletionItemKind.TypeParameter
}

export function toCompletionKind(k: number | undefined): monaco.languages.CompletionItemKind {
  return (k !== undefined ? LSP_COMPLETION_KIND[k] : undefined) ?? monaco.languages.CompletionItemKind.Text
}

/** LSP SymbolKind is 1-based; Monaco's is the same list starting at 0. */
export function toSymbolKind(k: number): monaco.languages.SymbolKind {
  return Math.max(0, Math.min(25, k - 1)) as monaco.languages.SymbolKind
}

export function toSeverity(s: number | undefined): monaco.MarkerSeverity {
  switch (s) {
    case 2:
      return monaco.MarkerSeverity.Warning
    case 3:
      return monaco.MarkerSeverity.Info
    case 4:
      return monaco.MarkerSeverity.Hint
    default:
      return monaco.MarkerSeverity.Error
  }
}

export function toMarker(d: LspDiagnostic): monaco.editor.IMarkerData {
  const r = { ...toRange(d.range) } as { -readonly [K in keyof monaco.IRange]: number }
  // Zero-width ranges are invisible; underline at least one character.
  if (r.startLineNumber === r.endLineNumber && r.startColumn === r.endColumn) r.endColumn = r.startColumn + 1
  // A hint with the "unnecessary" tag (an unused include) is drawn faded, without an underline.
  const unnecessary = d.severity === 4 && !!d.tags?.includes(1)
  return {
    ...r,
    severity: unnecessary ? monaco.MarkerSeverity.Hint : toSeverity(d.severity),
    message: d.message,
    source: d.source ?? 'clangd',
    code: d.code === undefined ? undefined : String(d.code),
    tags: unnecessary ? [monaco.MarkerTag.Unnecessary] : (d.tags?.filter((t) => t === 1 || t === 2) as monaco.MarkerTag[] | undefined),
    relatedInformation: d.relatedInformation?.map((ri) => ({
      resource: monaco.Uri.parse(ri.location.uri),
      message: ri.message,
      ...toRange(ri.location.range)
    }))
  }
}

export function rangesOverlap(a: monaco.IRange, b: monaco.IRange): boolean {
  if (a.endLineNumber < b.startLineNumber || b.endLineNumber < a.startLineNumber) return false
  if (a.endLineNumber === b.startLineNumber && a.endColumn < b.startColumn) return false
  if (b.endLineNumber === a.startLineNumber && b.endColumn < a.startColumn) return false
  return true
}
