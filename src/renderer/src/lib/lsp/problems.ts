// The live part of the Problems list: what the editor engine and the naming
// checks report for the documents the engine has open, as `Problem` rows with
// the source 'editor' (errors and warnings only). The engine module stores each
// document's state here after every diagnostics or checks update; listeners of
// the bus event 'live-problems' get the list at most every 200 ms.

import { emit } from '../bus'
import type { Problem } from '../../../../shared/api'
import { replacedByCheck, type Check } from '../../../../shared/contract-checks'
import type { LspDiagnostic } from '../../../../shared/lsp-diagnostics'

/** One diagnostic as shown in the editor, with the engine's own form of it. */
export interface ShownDiagnostic {
  shown: LspDiagnostic
  raw: LspDiagnostic
}

interface LiveDocument {
  diagnostics: ShownDiagnostic[]
  checks: Check[]
}

export const LIVE_PROBLEMS_EVENT = 'live-problems'
const EMIT_EVERY_MS = 200

const documents = new Map<string, LiveDocument>()
let timer: ReturnType<typeof setTimeout> | null = null

function decode(path: string): string {
  try {
    return path.split('/').map(decodeURIComponent).join('/')
  } catch {
    return ''
  }
}

/** project:///src/a.cpp -> src/a.cpp; '' for any other address. */
export function projectPathOf(uri: string): string {
  const m = /^project:(?:\/\/)?\/(.*)$/.exec(uri)
  return m ? decode(m[1]) : ''
}

/**
 * The name a message gives a file: the project-relative path of a project file,
 * the path under the include folder of a toolchain header, '' for anything else.
 */
export function placeNameOf(uri: string): string {
  const rel = projectPathOf(uri)
  if (rel) return rel
  const m = /^toolchain:(?:\/\/)?(\/.*)$/.exec(uri)
  if (!m) return ''
  const path = decode(m[1])
  const i = path.indexOf('/include/')
  return i >= 0 ? path.slice(i + '/include/'.length) : path
}

const IN_INCLUDED = /^in included file:\s*/i

/**
 * True when an `In included file` diagnostic repeats a header error that a
 * naming check of that header replaces (the copy on the
 * `#include` line goes with the original). One of its related places (for a
 * bad `"..."_n` the "requested here" note) must touch the checked literal.
 * `checksOf` gives the checks of an open project header, null otherwise.
 */
export function replacedInHeader(d: LspDiagnostic, checksOf: (uri: string) => Check[] | null): boolean {
  if (!IN_INCLUDED.test(d.message)) return false
  return (d.relatedInformation ?? []).some((r) => {
    const checks = checksOf(r.location.uri)
    return !!checks && replacedByCheck({ ...d, range: r.location.range }, checks)
  })
}

function severityOf(s: number | undefined): Problem['severity'] | null {
  if (s === undefined || s === 1) return 'error'
  if (s === 2) return 'warning'
  return null
}

function upperFirst(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

function fromDiagnostic(file: string, item: ShownDiagnostic): Problem | null {
  const severity = severityOf(item.shown.severity)
  if (!severity) return null
  // An error inside an included header is listed at its place in that header, when it is a project file.
  if (IN_INCLUDED.test(item.raw.message)) {
    const related = item.raw.relatedInformation ?? []
    const here = related.find((r) => /error occurred here/i.test(r.message)) ?? related[0]
    const headerFile = here ? projectPathOf(here.location.uri) : ''
    if (here && headerFile) {
      const inner = item.shown.message.replace(/^.*?, line \d+: /, '').replace(IN_INCLUDED, '')
      return {
        file: headerFile,
        line: here.location.range.start.line + 1,
        column: here.location.range.start.character + 1,
        severity,
        message: upperFirst(inner),
        source: 'editor'
      }
    }
  }
  return {
    file,
    line: item.shown.range.start.line + 1,
    column: item.shown.range.start.character + 1,
    severity,
    message: item.shown.message,
    source: 'editor'
  }
}

function fromCheck(file: string, c: Check): Problem {
  return {
    file,
    line: c.range.start.line + 1,
    column: c.range.start.character + 1,
    severity: c.severity === 1 ? 'error' : 'warning',
    message: c.message,
    source: 'editor'
  }
}

function schedule(): void {
  if (timer) return
  timer = setTimeout(() => {
    timer = null
    emit(LIVE_PROBLEMS_EVENT, liveProblems())
  }, EMIT_EVERY_MS)
}

/** Stores what the editor shows for one open document (null: the document is closed). */
export function setLiveDocument(uri: string, state: LiveDocument | null): void {
  if (state) documents.set(uri, state)
  else if (!documents.delete(uri)) return
  schedule()
}

/** Forgets the engine diagnostics of every document; the checks stay. */
export function clearLiveDiagnostics(): void {
  for (const d of documents.values()) d.diagnostics = []
  schedule()
}

/** Errors and warnings of every open document, from the engine and the checks. */
export function liveProblems(): Problem[] {
  const out: Problem[] = []
  for (const [uri, doc] of documents) {
    const file = projectPathOf(uri)
    if (!file) continue
    for (const item of doc.diagnostics) {
      const p = fromDiagnostic(file, item)
      if (p) out.push(p)
    }
    for (const c of doc.checks) out.push(fromCheck(file, c))
  }
  return out
}
