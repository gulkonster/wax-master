// Code intelligence for C++ files: a language-server client on Monaco's
// provider API. The engine (clangd) runs in the toolchain distro; this module
// keeps open documents in sync, shows its diagnostics as markers (owner
// "clangd", placed and worded by the shared modules), runs the naming checks
// (owner "checks") and answers Monaco's completion, hover, navigation, rename,
// outline, formatting and quick-fix requests.

import { monaco } from '../monaco'
import { emit } from '../bus'
import { toast } from '../toast'
import type { EditorStatus } from '../../../../shared/api'
import { FLAG_SETUP, keepDiagnostic, rewriteDiagnostic, type FlagSetup, type LspDiagnostic, type LspRange } from '../../../../shared/lsp-diagnostics'
import { contractChecks, replacedByCheck, type Check } from '../../../../shared/contract-checks'
import { placeDiagnostics } from '../../../../shared/lsp-place'
import { cleanDoc, cleanMessage, prettyNames } from '../../../../shared/lsp-messages'
import { applyTextEdits, type LspTextEdit } from '../../../../shared/lsp-text'
import { headerSummary, includeTarget, isHeaderPath, isPiece, namedInInclude, pieceNotice } from '../../../../shared/lsp-fragment'
import { keepCompletion, memberAccessBefore, rowLambdaAt, rowTypeOf, SNIPPETS } from '../../../../shared/lsp-completion'
import { LspClient, isCancelled, type RpcMessage } from './client'
import * as conv from './convert'
import { sortTextFor } from './sort'
import { disposeBackgroundModels, ensureModel, ensureModels, isBackground, markBackgroundSaved, projectUri, relOf } from './models'
import { setEngineView } from './status'
import { clearLiveDiagnostics, placeNameOf, replacedInHeader, setLiveDocument, type ShownDiagnostic } from './problems'

const LANGUAGE = 'cpp'
const OWNER = 'clangd'
const CHECKS_OWNER = 'checks'
const CHECKS_SOURCE = 'WAX Master'
const CHECK_DELAY_MS = 300
const COMMAND_ID = 'wax.engine.command'
/** Other documents are rebuilt against an unsaved header this long after its last change (B97 point 2). */
const HEADER_TOUCH_MS = 400
/** Project files the engine opens without a tab, per project (B97 point 3). */
const MAX_BACKGROUND = 12

interface ServerCaps {
  textDocumentSync?: number | { change?: number }
  completionProvider?: { triggerCharacters?: string[]; resolveProvider?: boolean }
  signatureHelpProvider?: { triggerCharacters?: string[]; retriggerCharacters?: string[] }
  renameProvider?: boolean | { prepareProvider?: boolean }
  codeActionProvider?: boolean | { codeActionKinds?: string[] }
  [k: string]: unknown
}

interface SyncedDoc {
  model: monaco.editor.ITextModel
  sub: monaco.IDisposable
  opened: boolean
  /** Rebuild requests sent without a text change; added to the model's version so versions only grow. */
  touches: number
}

interface LspWorkspaceEdit {
  changes?: Record<string, LspTextEdit[]>
  documentChanges?: ({ textDocument: { uri: string }; edits: LspTextEdit[] } | { kind: string })[]
}

interface LspCommand {
  title: string
  command: string
  arguments?: unknown[]
}

interface LspCodeAction {
  title: string
  kind?: string
  diagnostics?: LspDiagnostic[]
  isPreferred?: boolean
  edit?: LspWorkspaceEdit
  command?: LspCommand
}

interface LspCompletionItem {
  label: string
  kind?: number
  detail?: string
  documentation?: string | conv.MarkupContent
  sortText?: string
  filterText?: string
  insertText?: string
  insertTextFormat?: number
  textEdit?: LspTextEdit | { newText: string; insert: LspRange; replace: LspRange }
  additionalTextEdits?: LspTextEdit[]
  preselect?: boolean
  deprecated?: boolean
  tags?: number[]
}

interface LspDocumentSymbol {
  name: string
  detail?: string
  kind: number
  tags?: number[]
  range: LspRange
  selectionRange: LspRange
  children?: LspDocumentSymbol[]
}

interface LspSymbolInformation {
  name: string
  kind: number
  containerName?: string
  location: conv.LspLocation
}

export interface WorkspaceSymbol {
  name: string
  kind: monaco.languages.SymbolKind
  container: string
  uri: string
  range: monaco.IRange
}

let client: LspClient | null = null
let caps: ServerCaps = {}
let ready = false
let setup: FlagSetup = FLAG_SETUP
let mainStatus: EditorStatus | null = null
let users = 0
let unsubscribe: (() => void)[] = []
let providers: monaco.IDisposable[] = []
let indexing: { title: string; percentage?: number } | null = null
const fileStatus = new Map<string, string>()
const docs = new Map<string, SyncedDoc>()
/** As the engine published them (fix addresses in the document key form). */
const engineDiagnostics = new Map<string, LspDiagnostic[]>()
/** As the editor shows them, each with the engine's form (code action requests send the engine's ranges). */
const shownDiagnostics = new Map<string, ShownDiagnostic[]>()
const checkTimers = new Map<string, ReturnType<typeof setTimeout>>()
/** The project's main source file (project-relative), from the project's settings. */
let mainFile: string | null = null
/** Documents the engine has open without a tab (opened or still loading); a tab that opens one adopts it. */
const backgroundDocs = new Set<string>()
/** Headers changed since the last rebuild request to the other documents. */
const touchedHeaders = new Set<string>()
let headerTouchTimer: ReturnType<typeof setTimeout> | null = null
/** Header path -> named in an `#include` line of another project file (one file search per header and session). */
const includedIn = new Map<string, boolean | 'pending'>()
/** Document -> `<line>\n<line text>` -> the file that include line opens ('' when none, 'pending' while asked). */
const includeTargets = new Map<string, Map<string, string>>()
/** Errors of a project document's own (before the piece rule), for the include-line summary of B97 point 4. */
const ownErrors = new Map<string, { line: number; message: string }[]>()
/** Header -> documents whose include-line summary or piece state depends on it. */
const dependents = new Map<string, Set<string>>()
/** Errors of the main file after the filter; null while not known. */
let mainErrors: number | null = null

const CLIENT_CAPABILITIES = {
  general: { positionEncodings: ['utf-16'] },
  window: { workDoneProgress: true, showMessage: {} },
  workspace: {
    applyEdit: true,
    workspaceEdit: { documentChanges: true },
    symbol: { symbolKind: { valueSet: Array.from({ length: 26 }, (_, i) => i + 1) } },
    executeCommand: {},
    didChangeWatchedFiles: { dynamicRegistration: false }
  },
  textDocument: {
    synchronization: { didSave: true, willSave: false, dynamicRegistration: false },
    completion: {
      contextSupport: true,
      completionItem: {
        snippetSupport: true,
        documentationFormat: ['markdown', 'plaintext'],
        deprecatedSupport: true,
        tagSupport: { valueSet: [1] },
        resolveSupport: { properties: ['documentation', 'detail'] }
      },
      completionItemKind: { valueSet: Array.from({ length: 25 }, (_, i) => i + 1) }
    },
    hover: { contentFormat: ['markdown', 'plaintext'] },
    signatureHelp: {
      contextSupport: true,
      signatureInformation: {
        documentationFormat: ['markdown', 'plaintext'],
        parameterInformation: { labelOffsetSupport: true },
        activeParameterSupport: true
      }
    },
    definition: { linkSupport: false },
    declaration: { linkSupport: false },
    references: {},
    documentHighlight: {},
    documentSymbol: { hierarchicalDocumentSymbolSupport: true, symbolKind: { valueSet: Array.from({ length: 26 }, (_, i) => i + 1) } },
    formatting: {},
    rangeFormatting: {},
    rename: { prepareSupport: true },
    codeAction: {
      isPreferredSupport: true,
      codeActionLiteralSupport: {
        codeActionKind: { valueSet: ['', 'quickfix', 'refactor', 'refactor.extract', 'refactor.inline', 'refactor.rewrite', 'source'] }
      }
    },
    publishDiagnostics: { codeActionsInline: true, relatedInformation: true, tagSupport: { valueSet: [1, 2] }, codeDescriptionSupport: true }
  }
}

function key(uri: string | monaco.Uri): string {
  return typeof uri === 'string' ? monaco.Uri.parse(uri).toString() : uri.toString()
}

function activeClient(): LspClient | null {
  return client && ready && !client.isClosed ? client : null
}

function docUri(model: monaco.editor.ITextModel): string | null {
  const k = model.uri.toString()
  return docs.get(k)?.opened && activeClient() ? k : null
}

function fileName(uri: string): string {
  const p = monaco.Uri.parse(uri).path
  return p.slice(p.lastIndexOf('/') + 1)
}

function updateView(): void {
  const s = mainStatus
  if (!s || s.state === 'off') {
    setEngineView({ state: 'off', detail: s?.detail ?? 'Code intelligence is off.' })
    return
  }
  if (s.state === 'error') {
    setEngineView({ state: 'error', detail: s.detail })
    return
  }
  if (s.state === 'starting' || !ready) {
    setEngineView({ state: 'starting', detail: 'Starting the editor engine...' })
    return
  }
  if (indexing) {
    const pct = indexing.percentage !== undefined ? `${indexing.percentage}%` : ''
    setEngineView({ state: 'indexing', detail: `Indexing the project and the toolchain headers ${pct}`.trim(), progress: pct || undefined })
    return
  }
  const busy = [...fileStatus.entries()].find(([, st]) => st && st !== 'idle')
  if (busy) {
    setEngineView({ state: 'indexing', detail: `Parsing ${fileName(busy[0])}...`, progress: `parsing ${fileName(busy[0])}` })
    return
  }
  setEngineView({ state: 'ready', detail: 'Code intelligence is ready.' })
}

// ---- document sync -------------------------------------------------------

function syncKind(): number {
  const s = caps.textDocumentSync
  if (typeof s === 'number') return s
  return s?.change ?? 1
}

function versionOf(d: SyncedDoc): number {
  return d.model.getVersionId() + d.touches
}

function sendOpen(d: SyncedDoc): void {
  const c = activeClient()
  if (!c || d.opened || d.model.isDisposed()) return
  d.opened = true
  c.notify('textDocument/didOpen', {
    textDocument: { uri: d.model.uri.toString(), languageId: 'cpp', version: versionOf(d), text: d.model.getValue() }
  })
  applyStoredMarkers(d.model)
}

/** A project header (not a C or C++ source file). */
function isProjectHeader(k: string): boolean {
  return k.startsWith('project:') && isHeaderPath(relOf(monaco.Uri.parse(k)))
}

/** A file shown in a tab: the engine follows its content. Only C++ files. A tab that opens a background document adopts it. */
export function openDocument(model: monaco.editor.ITextModel): void {
  if (model.getLanguageId() !== LANGUAGE) return
  if (model.uri.scheme !== 'project' && model.uri.scheme !== 'toolchain') return
  const k = model.uri.toString()
  if (docs.has(k)) {
    backgroundDocs.delete(k)
    return
  }
  const header = isProjectHeader(k)
  const d: SyncedDoc = {
    model,
    opened: false,
    touches: 0,
    sub: model.onDidChangeContent((e) => {
      scheduleChecks(k)
      if (header) scheduleHeaderTouch(k)
      const c = activeClient()
      if (!c || !d.opened) return
      const changes =
        syncKind() === 2 && !e.isFlush
          ? e.changes.map((ch) => ({ range: conv.toLspRange(ch.range), rangeLength: ch.rangeLength, text: ch.text }))
          : [{ text: model.getValue() }]
      c.notify('textDocument/didChange', { textDocument: { uri: k, version: versionOf(d) }, contentChanges: changes })
    })
  }
  docs.set(k, d)
  sendOpen(d)
  refreshDocument(k)
}

/** Forgets a document in the engine and in the window; the model itself stays. */
function forgetDocument(k: string): void {
  const d = docs.get(k)
  if (!d) return
  d.sub.dispose()
  docs.delete(k)
  backgroundDocs.delete(k)
  fileStatus.delete(k)
  const t = checkTimers.get(k)
  if (t) clearTimeout(t)
  checkTimers.delete(k)
  engineDiagnostics.delete(k)
  shownDiagnostics.delete(k)
  includeTargets.delete(k)
  ownErrors.delete(k)
  setLiveDocument(k, null)
  if (!d.model.isDisposed()) {
    monaco.editor.setModelMarkers(d.model, OWNER, [])
    monaco.editor.setModelMarkers(d.model, CHECKS_OWNER, [])
  }
  if (d.opened) activeClient()?.notify('textDocument/didClose', { textDocument: { uri: k } })
}

export function closeDocument(model: monaco.editor.ITextModel): void {
  const k = model.uri.toString()
  if (!docs.has(k)) return
  forgetDocument(k)
  // Headers that are pieces of the main file are judged again at their next update (the main file is then opened in the background).
  if (k === mainKey()) mainErrors = null
  updateView()
}

export function documentSaved(model: monaco.editor.ITextModel): void {
  const k = model.uri.toString()
  // Which files name a header in an include line is searched again after any save.
  includedIn.clear()
  if (docs.get(k)?.opened) activeClient()?.notify('textDocument/didSave', { textDocument: { uri: k } })
}

/** The project's main source file (project-relative path; null when the project has none yet). */
export function setEngineMainFile(rel: string | null): void {
  const next = rel || null
  if (next === mainFile) return
  mainFile = next
  mainErrors = null
  for (const k of docs.keys()) if (isProjectHeader(k)) refreshDocument(k)
}

function mainKey(): string | null {
  return mainFile ? projectUri(mainFile).toString() : null
}

// ---- headers: unsaved changes, background documents, pieces ---------------

/** 400 ms after the last change of an open header, every other open project document is rebuilt against it. */
function scheduleHeaderTouch(k: string): void {
  touchedHeaders.add(k)
  if (headerTouchTimer) clearTimeout(headerTouchTimer)
  headerTouchTimer = setTimeout(() => {
    headerTouchTimer = null
    const c = activeClient()
    const changed = new Set(touchedHeaders)
    touchedHeaders.clear()
    if (!c) return
    for (const [uri, d] of docs) {
      if (changed.has(uri) || !d.opened || !uri.startsWith('project:') || d.model.isDisposed()) continue
      d.touches++
      c.notify('textDocument/didChange', { textDocument: { uri, version: versionOf(d) }, contentChanges: [] })
    }
  }, HEADER_TOUCH_MS)
}

/** Opens a project file in the engine without a tab (at most 12 per project). */
function openBackground(k: string): void {
  if (docs.has(k) || backgroundDocs.has(k) || !activeClient()) return
  if (backgroundDocs.size >= MAX_BACKGROUND) return
  const uri = monaco.Uri.parse(k)
  if (uri.scheme !== 'project') return
  backgroundDocs.add(k)
  const session = client?.session
  void ensureModel(uri).then((model) => {
    if (!backgroundDocs.has(k) || docs.has(k) || client?.session !== session || !activeClient()) {
      // A tab opened it meanwhile, or the engine was restarted; after the project closed, a model loaded for nothing goes.
      if (!docs.has(k) && model && !model.isDisposed() && isBackground(model.uri) && users === 0) model.dispose()
      backgroundDocs.delete(k)
      return
    }
    if (!model || model.isDisposed() || model.getLanguageId() !== LANGUAGE) {
      backgroundDocs.delete(k)
      return
    }
    openDocument(model)
    // openDocument adopts a document that is already there; this one stays in the background.
    backgroundDocs.add(k)
  })
}

/** Closes the background documents (engine restart, project closed). */
function closeBackgroundDocs(): void {
  for (const k of [...backgroundDocs]) forgetDocument(k)
  backgroundDocs.clear()
}

function addDependent(header: string, doc: string): void {
  let set = dependents.get(header)
  if (!set) dependents.set(header, (set = new Set()))
  set.add(doc)
}

/**
 * The file an include line opens, from the engine's definition of the include target
 * (the engine's document links name their targets in a form the window cannot read).
 * Undefined while asked; the document is refreshed when the answer comes.
 */
function includeTargetOf(k: string, line: number, text: string): string | undefined {
  let byLine = includeTargets.get(k)
  if (!byLine) includeTargets.set(k, (byLine = new Map()))
  const id = `${line}\n${text}`
  const known = byLine.get(id)
  if (known !== undefined) return known === 'pending' ? undefined : known
  const t = includeTarget(text)
  if (!t) {
    byLine.set(id, '')
    return ''
  }
  byLine.set(id, 'pending')
  void request<conv.LspLocation | conv.LspLocation[]>('textDocument/definition', {
    textDocument: { uri: k },
    position: { line, character: t.start + 1 }
  }).then((r) => {
    const map = includeTargets.get(k)
    if (!map || map.get(id) !== 'pending') return
    const first = conv.toLocations(r)[0]
    map.set(id, first ? first.uri.toString() : '')
    if (docs.has(k)) refreshDocument(k)
  })
  return undefined
}

/** Whether a header is named in an include line of another project file; undefined while the search runs. */
function headerIncluded(rel: string, k: string): boolean | undefined {
  const known = includedIn.get(rel)
  if (known === 'pending') return undefined
  if (known !== undefined) return known
  includedIn.set(rel, 'pending')
  const name = rel.slice(rel.lastIndexOf('/') + 1)
  window.wax.files
    .search(name, true, false)
    .then((r) => r.matches.filter((m) => /^\s*#/.test(m.text)).map((m) => ({ file: m.file, text: m.text })))
    .catch(() => [])
    .then((lines) => {
      if (includedIn.get(rel) !== 'pending') return
      includedIn.set(rel, namedInInclude(lines, rel))
      if (docs.has(k)) refreshDocument(k)
    })
  return undefined
}

function errorCount(list: ShownDiagnostic[], checks: Check[]): number {
  return list.filter((s) => (s.shown.severity ?? 1) === 1).length + checks.filter((c) => c.severity === 1).length
}

/**
 * B98: a project header whose errors come from being parsed alone. Gives the notice for
 * line 1 when the header is a piece; null otherwise. Opens the main file in the background
 * when it has no tab.
 */
function pieceState(k: string, headerErrors: number): string | null {
  if (headerErrors === 0 || !isProjectHeader(k) || !mainFile) return null
  const main = mainKey()
  if (!main || main === k) return null
  if (!docs.has(main)) openBackground(main)
  const included = headerIncluded(relOf(monaco.Uri.parse(k)), k)
  if (!isPiece({ headerErrors, mainFileErrors: mainErrors, included: included === true })) return null
  return pieceNotice(mainFile)
}

monaco.editor.onWillDisposeModel((m) => closeDocument(m))

// ---- diagnostics ---------------------------------------------------------

function applyStoredMarkers(model: monaco.editor.ITextModel): void {
  const list = shownDiagnostics.get(model.uri.toString()) ?? []
  monaco.editor.setModelMarkers(model, OWNER, list.map((s) => conv.toMarker(s.shown)))
}

/** Project C++ documents get the naming checks; toolchain headers do not. */
function checked(k: string): boolean {
  return docs.has(k) && k.startsWith('project:')
}

function checkMarker(c: Check): monaco.editor.IMarkerData {
  return {
    ...conv.toRange(c.range),
    severity: c.severity === 1 ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
    message: c.message,
    source: CHECKS_SOURCE,
    code: c.code
  }
}

/** The text a range covers. */
function textIn(lines: string[], r: LspRange): string {
  if (r.start.line === r.end.line) return (lines[r.start.line] ?? '').slice(r.start.character, r.end.character)
  const parts = [(lines[r.start.line] ?? '').slice(r.start.character)]
  for (let l = r.start.line + 1; l < r.end.line; l++) parts.push(lines[l] ?? '')
  parts.push((lines[r.end.line] ?? '').slice(0, r.end.character))
  return parts.join('\n')
}

function cleanDiagnostic(d: LspDiagnostic): LspDiagnostic {
  return {
    ...d,
    message: cleanMessage(d.message),
    relatedInformation: d.relatedInformation?.map((ri) => ({ ...ri, message: cleanMessage(ri.message) }))
  }
}

/**
 * Runs one document through the window's pipeline: the filter (with the
 * underlined text and the toolchain version), the rewrite, the diagnostics a
 * naming check replaces, the place, the words. Sets both marker owners and
 * the document's live problems.
 */
function refreshDocument(k: string): void {
  const found = monaco.editor.getModel(monaco.Uri.parse(k))
  const model = found && !found.isDisposed() ? found : null
  const lines = model ? model.getLinesContent() : []
  const checks = model && checked(k) ? contractChecks(model.getValue()) : []
  const cdtVersion = mainStatus?.cdtVersion ?? ''
  const headerChecks = new Map<string, Check[] | null>()
  const checksOfOpen = (uri: string): Check[] | null => {
    const h = key(uri)
    if (!headerChecks.has(h)) {
      const m = checked(h) ? monaco.editor.getModel(monaco.Uri.parse(h)) : null
      headerChecks.set(h, m && !m.isDisposed() ? contractChecks(m.getValue()) : null)
    }
    return headerChecks.get(h) ?? null
  }
  const open = docs.has(k)
  const kept: ShownDiagnostic[] = []
  /** Include lines whose `In included file` diagnostic the filter dropped (B97 point 4). */
  const droppedIncludeLines = new Map<number, LspDiagnostic>()
  for (const raw of engineDiagnostics.get(k) ?? []) {
    const ctx = { cdtVersion, underlined: textIn(lines, raw.range) }
    const included = IN_INCLUDED_FILE.test(raw.message)
    if (included && open) openRelatedHeaders(k, raw)
    if (!keepDiagnostic(raw, k, setup, ctx)) {
      if (included && !droppedIncludeLines.has(raw.range.start.line)) droppedIncludeLines.set(raw.range.start.line, raw)
      continue
    }
    const d = rewriteDiagnostic(raw, ctx)
    if (replacedByCheck(d, checks) || replacedInHeader(d, checksOfOpen)) continue
    kept.push({ shown: d, raw })
  }
  const placed = placeDiagnostics(
    kept.map((s) => s.shown),
    lines,
    k,
    placeNameOf
  )
  let shown: ShownDiagnostic[] = placed.map((d, i) => ({ shown: cleanDiagnostic(d), raw: kept[i].raw }))
  if (open && k.startsWith('project:')) shown = [...shown, ...includeSummaries(k, lines, droppedIncludeLines, shown)]
  // The document's own errors, before the piece rule hides them.
  const own = shown.filter((s) => (s.shown.severity ?? 1) === 1)
  const ownBefore = JSON.stringify(ownErrors.get(k) ?? [])
  if (open) ownErrors.set(k, own.map((s) => ({ line: s.shown.range.start.line + 1, message: s.shown.message })))
  else ownErrors.delete(k)
  const notice = open && engineDiagnostics.has(k) ? pieceState(k, own.length) : null
  if (notice) {
    shown = shown.filter((s) => (s.shown.severity ?? 1) !== 1)
    const notes: LspDiagnostic = { range: { start: { line: 0, character: 0 }, end: { line: 0, character: (lines[0] ?? '').length } }, severity: 3, message: notice, source: CHECKS_SOURCE }
    shown.unshift({ shown: notes, raw: notes })
  }
  shownDiagnostics.set(k, shown)
  if (model) {
    monaco.editor.setModelMarkers(model, OWNER, shown.map((s) => conv.toMarker(s.shown)))
    monaco.editor.setModelMarkers(model, CHECKS_OWNER, checks.map(checkMarker))
  }
  if (open) setLiveDocument(k, { diagnostics: shown, checks })
  afterRefresh(k, ownBefore, errorCount(shown, checks))
}

const IN_INCLUDED_FILE = /^in included file/i

/** B97 point 3: the project headers an `In included file` diagnostic names are opened in the background. */
function openRelatedHeaders(k: string, raw: LspDiagnostic): void {
  for (const r of raw.relatedInformation ?? []) {
    const h = key(r.location.uri)
    if (h !== k && isProjectHeader(h) && !docs.has(h)) openBackground(h)
  }
}

/**
 * B97 point 4: an include line whose diagnostic the filter dropped gets one error when the
 * header it opens is a project file with errors of its own.
 */
function includeSummaries(k: string, lines: string[], dropped: Map<number, LspDiagnostic>, shown: ShownDiagnostic[]): ShownDiagnostic[] {
  const out: ShownDiagnostic[] = []
  for (const line of dropped.keys()) {
    const text = lines[line] ?? ''
    const t = includeTarget(text)
    if (!t) continue
    const target = includeTargetOf(k, line, text)
    if (!target || !isProjectHeader(target) || target === k) continue
    addDependent(target, k)
    if (!docs.has(target)) {
      openBackground(target)
      continue
    }
    if (shown.some((s) => s.shown.range.start.line === line && (s.shown.severity ?? 1) === 1)) continue
    const message = headerSummary(placeNameOf(target), ownErrors.get(target) ?? [])
    if (!message) continue
    const d: LspDiagnostic = { range: { start: { line, character: t.start }, end: { line, character: t.end } }, severity: 1, message, source: CHECKS_SOURCE }
    out.push({ shown: d, raw: d })
  }
  return out
}

/** Keeps what depends on a document up to date: include-line summaries and the piece state of headers. */
function afterRefresh(k: string, ownBefore: string, errors: number): void {
  if (JSON.stringify(ownErrors.get(k) ?? []) !== ownBefore) {
    for (const d of dependents.get(k) ?? []) if (d !== k && docs.has(d)) refreshDocument(d)
  }
  if (k === mainKey() && docs.has(k) && engineDiagnostics.has(k)) {
    if (errors !== mainErrors) {
      mainErrors = errors
      for (const h of docs.keys()) if (h !== k && isProjectHeader(h) && (ownErrors.get(h)?.length ?? 0) > 0) refreshDocument(h)
    }
  }
}

/** The checks run 300 ms after the last change of a document. */
function scheduleChecks(k: string): void {
  const t = checkTimers.get(k)
  if (t) clearTimeout(t)
  checkTimers.set(
    k,
    setTimeout(() => {
      checkTimers.delete(k)
      if (docs.has(k)) refreshDocument(k)
    }, CHECK_DELAY_MS)
  )
}

/** The addresses in a diagnostic's fixes in the same form as the document keys. */
function withKeyedFixes(d: LspDiagnostic): LspDiagnostic {
  if (!d.codeActions) return d
  return {
    ...d,
    codeActions: d.codeActions.map((a) => {
      const changes = a.edit?.changes
      if (!changes) return a
      return { ...a, edit: { ...a.edit, changes: Object.fromEntries(Object.entries(changes).map(([u, e]) => [key(u), e])) } }
    })
  }
}

function onDiagnostics(params: unknown): void {
  const p = params as { uri: string; diagnostics: LspDiagnostic[] }
  if (!p || typeof p.uri !== 'string' || !Array.isArray(p.diagnostics)) return
  const k = key(p.uri)
  engineDiagnostics.set(k, p.diagnostics.map(withKeyedFixes))
  refreshDocument(k)
}

function clearMarkers(): void {
  engineDiagnostics.clear()
  shownDiagnostics.clear()
  for (const m of monaco.editor.getModels()) monaco.editor.setModelMarkers(m, OWNER, [])
  clearLiveDiagnostics()
}

/** A diagnostic as the engine sent it, without the inline fixes, for a code action request. */
function engineForm(d: LspDiagnostic): LspDiagnostic {
  const rest = { ...d }
  delete rest.codeActions
  return rest
}

/** Documentation from the toolchain headers without comment marks and with names in source form. */
function cleanDocumentation(v: string | monaco.IMarkdownString | undefined): string | monaco.IMarkdownString | undefined {
  if (v === undefined) return undefined
  if (typeof v === 'string') return cleanDoc(prettyNames(v))
  return { ...v, value: cleanDoc(prettyNames(v.value)) }
}

// ---- edits ---------------------------------------------------------------

function collectEdits(edit: LspWorkspaceEdit): Map<string, LspTextEdit[]> {
  const out = new Map<string, LspTextEdit[]>()
  const add = (uri: string, edits: LspTextEdit[]): void => {
    const k = key(uri)
    out.set(k, [...(out.get(k) ?? []), ...edits])
  }
  for (const [uri, edits] of Object.entries(edit.changes ?? {})) add(uri, edits)
  for (const dc of edit.documentChanges ?? []) {
    if ('textDocument' in dc && Array.isArray(dc.edits)) add(dc.textDocument.uri, dc.edits)
  }
  return out
}

/**
 * Applies a workspace edit. Files open in a tab are changed in their editor
 * model (unsaved, with undo); other project files are changed on disk through
 * the files API. Toolchain headers are never changed. With `forMonaco`, edits
 * for open files are returned for Monaco to apply instead.
 */
async function applyWorkspaceEdit(edit: LspWorkspaceEdit, forMonaco = false): Promise<monaco.languages.IWorkspaceTextEdit[]> {
  const result: monaco.languages.IWorkspaceTextEdit[] = []
  const written: string[] = []
  for (const [k, edits] of collectEdits(edit)) {
    const uri = monaco.Uri.parse(k)
    if (uri.scheme !== 'project') continue
    const open = docs.get(k)
    if (open) {
      const ops = edits.map((e) => ({ range: conv.toRange(e.range), text: e.newText }))
      if (forMonaco) {
        for (const op of ops) result.push({ resource: uri, textEdit: op, versionId: undefined })
      } else {
        open.model.pushStackElement()
        open.model.pushEditOperations([], ops, () => null)
        open.model.pushStackElement()
      }
      continue
    }
    const rel = relOf(uri)
    const bg = monaco.editor.getModel(uri)
    let text: string
    if (bg) text = bg.getValue()
    else {
      const f = await window.wax.files.read(rel)
      if (f.binary || f.tooLarge) continue
      text = f.content
    }
    const next = applyTextEdits(text, edits)
    await window.wax.files.write(rel, next)
    if (bg) {
      bg.setValue(next)
      markBackgroundSaved(bg)
    }
    written.push(k)
  }
  if (written.length) {
    activeClient()?.notify('workspace/didChangeWatchedFiles', { changes: written.map((uri) => ({ uri, type: 2 })) })
    emit('files-written', written)
  }
  return result
}

function monacoEdits(edit: LspWorkspaceEdit): monaco.languages.IWorkspaceTextEdit[] {
  const out: monaco.languages.IWorkspaceTextEdit[] = []
  for (const [k, edits] of collectEdits(edit)) {
    const uri = monaco.Uri.parse(k)
    if (uri.scheme !== 'project' || !monaco.editor.getModel(uri)) continue
    for (const e of edits) out.push({ resource: uri, textEdit: { range: conv.toRange(e.range), text: e.newText }, versionId: undefined })
  }
  return out
}

// ---- navigation helpers --------------------------------------------------

async function request<T>(method: string, params: unknown, token?: monaco.CancellationToken): Promise<T | null> {
  const c = activeClient()
  if (!c) return null
  try {
    return await c.request<T>(method, params, token)
  } catch (err) {
    if (!isCancelled(err)) console.warn(`${method} failed`, err)
    return null
  }
}

async function locations(
  method: string,
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  token: monaco.CancellationToken,
  extra: Record<string, unknown> = {}
): Promise<monaco.languages.Location[]> {
  const uri = docUri(model)
  if (!uri) return []
  const r = await request<conv.LspLocation | conv.LspLocation[]>(method, { textDocument: { uri }, position: conv.toPosition(position), ...extra }, token)
  const locs = conv.toLocations(r).filter((l) => l.uri.scheme === 'project' || l.uri.scheme === 'toolchain')
  await ensureModels(locs.map((l) => l.uri))
  return locs.filter((l) => monaco.editor.getModel(l.uri))
}

/** The other file of a header/source pair, or null. */
export async function switchHeaderSource(model: monaco.editor.ITextModel): Promise<string | null> {
  const uri = docUri(model)
  if (!uri) return null
  const r = await request<string>('textDocument/switchSourceHeader', { uri })
  return typeof r === 'string' && (r.startsWith('project:') || r.startsWith('toolchain:')) ? r : null
}

export async function workspaceSymbols(query: string): Promise<WorkspaceSymbol[]> {
  const r = await request<LspSymbolInformation[]>('workspace/symbol', { query })
  if (!Array.isArray(r)) return []
  return r
    .filter((s) => s.location && /^(project|toolchain):/.test(s.location.uri))
    .map((s) => ({
      name: s.name,
      kind: conv.toSymbolKind(s.kind),
      container: s.containerName ?? '',
      uri: s.location.uri,
      // The cursor goes to where the symbol starts.
      range: conv.toRange({ start: s.location.range.start, end: s.location.range.start })
    }))
}

export function engineReady(): boolean {
  return !!activeClient()
}

// ---- providers -----------------------------------------------------------

const lspItems = new WeakMap<monaco.languages.CompletionItem, LspCompletionItem>()

function completionItem(item: LspCompletionItem, defaultRange: monaco.IRange): monaco.languages.CompletionItem {
  let range: monaco.IRange | monaco.languages.CompletionItemRanges = defaultRange
  let insertText = item.insertText ?? item.label
  if (item.textEdit) {
    insertText = item.textEdit.newText
    range =
      'range' in item.textEdit
        ? conv.toRange(item.textEdit.range)
        : { insert: conv.toRange(item.textEdit.insert), replace: conv.toRange(item.textEdit.replace) }
  }
  const out: monaco.languages.CompletionItem = {
    label: item.label.trim(),
    kind: conv.toCompletionKind(item.kind),
    detail: item.detail,
    documentation: cleanDocumentation(conv.toDocumentation(item.documentation)),
    sortText: sortTextFor(item),
    filterText: item.filterText,
    insertText,
    insertTextRules: item.insertTextFormat === 2 ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
    range,
    preselect: item.preselect,
    tags: item.deprecated || item.tags?.includes(1) ? [monaco.languages.CompletionItemTag.Deprecated] : undefined,
    additionalTextEdits: item.additionalTextEdits?.map((e) => ({ range: conv.toRange(e.range), text: e.newText }))
  }
  lspItems.set(out, item)
  return out
}

const SYMBOL_FIELD = 8
const SYMBOL_METHOD = 6
const SYMBOL_FUNCTION = 12

/** The hover text at an offset of the document, '' when the engine has none. */
async function hoverText(uri: string, model: monaco.editor.ITextModel, offset: number, token: monaco.CancellationToken): Promise<string> {
  const r = await request<{ contents: conv.MarkupContent | conv.MarkedString | conv.MarkedString[] } | null>(
    'textDocument/hover',
    { textDocument: { uri }, position: conv.toPosition(model.getPositionAt(offset)) },
    token
  )
  return r ? conv.toMarkdown(r.contents).map((m) => m.value).join('\n') : ''
}

/**
 * B102 point 2: inside `<table>.emplace(..., [&](auto& row) { row.` the engine has no list. The
 * row type comes from the hover of the table object, its members from a workspace symbol search.
 * While the lambda is still open the engine's hover on the table object can be empty; then the
 * nearest earlier use of the same name (its declaration, as a rule) is asked once.
 */
async function rowMembers(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  lineBefore: string,
  range: monaco.IRange,
  token: monaco.CancellationToken
): Promise<monaco.languages.CompletionItem[]> {
  const uri = docUri(model)
  const access = memberAccessBefore(lineBefore)
  if (!uri || !access || !/\.\s*\w*$/.test(lineBefore) || /->\s*\w*$/.test(lineBefore)) return []
  const text = model.getValue()
  const lambda = rowLambdaAt(text, model.getOffsetAt(position))
  if (!lambda || lambda.param !== access.id) return []
  let row = rowTypeOf(await hoverText(uri, model, lambda.tableExprEnd - 1, token))
  if (!row) {
    const name = /([A-Za-z_]\w*)$/.exec(text.slice(0, lambda.tableExprEnd))?.[1]
    if (name) {
      const before = text.slice(0, lambda.tableExprEnd - name.length)
      const uses = [...before.matchAll(new RegExp(`\\b${name}\\b`, 'g'))]
      const last = uses[uses.length - 1]
      if (last?.index !== undefined) row = rowTypeOf(await hoverText(uri, model, last.index, token))
    }
  }
  if (!row || token.isCancellationRequested) return []
  const symbols = await request<LspSymbolInformation[]>('workspace/symbol', { query: `${row}::` }, token)
  if (!Array.isArray(symbols)) return []
  const sameRow = (container: string): boolean => container === row || container.endsWith(`::${row}`) || row.endsWith(`::${container}`)
  const out: monaco.languages.CompletionItem[] = []
  const seen = new Set<string>()
  for (const s of symbols) {
    if (!sameRow(s.containerName ?? '') || seen.has(s.name) || !keepCompletion({ label: s.name }, false)) continue
    const field = s.kind === SYMBOL_FIELD
    if (!field && s.kind !== SYMBOL_METHOD && s.kind !== SYMBOL_FUNCTION) continue
    seen.add(s.name)
    out.push({
      label: s.name,
      kind: field ? monaco.languages.CompletionItemKind.Field : monaco.languages.CompletionItemKind.Method,
      detail: `${field ? 'field' : 'function'} of ${row}`,
      sortText: `${field ? '0' : '1'}${s.name}`,
      insertText: s.name,
      range
    })
  }
  return out
}

/**
 * B102 point 3 and B116: the snippets, after the engine's items. A snippet that needs a header
 * the document does not name adds its include line after the last one (at line 1 without one).
 */
function snippetItems(model: monaco.editor.ITextModel, range: monaco.IRange): monaco.languages.CompletionItem[] {
  const lines = model.getLinesContent()
  const text = lines.join('\n')
  let lastInclude = -1
  lines.forEach((l, i) => {
    if (includeTarget(l)) lastInclude = i
  })
  return SNIPPETS.map((s) => {
    const item: monaco.languages.CompletionItem = {
      label: s.label,
      kind: monaco.languages.CompletionItemKind.Snippet,
      detail: s.detail,
      documentation: { value: '```cpp\n' + s.body.replace(/\$\{\d+:([^}]*)\}/g, '$1').replace(/\$\d+/g, '') + '\n```' },
      sortText: `~${s.label}`,
      insertText: s.body,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      range
    }
    if (s.include && !text.includes(s.include)) {
      const line = `#include <${s.include}>`
      const at = lastInclude + 2
      item.additionalTextEdits =
        at <= lines.length
          ? [{ range: { startLineNumber: at, startColumn: 1, endLineNumber: at, endColumn: 1 }, text: `${line}\n` }]
          : [{ range: { startLineNumber: lines.length, startColumn: lines[lines.length - 1].length + 1, endLineNumber: lines.length, endColumn: lines[lines.length - 1].length + 1 }, text: `\n${line}` }]
    }
    return item
  })
}

function codeAction(a: LspCodeAction | LspCommand): monaco.languages.CodeAction {
  if (typeof (a as LspCommand).command === 'string') {
    const cmd = a as LspCommand
    return { title: cmd.title, command: { id: COMMAND_ID, title: cmd.title, arguments: [cmd] } }
  }
  const ca = a as LspCodeAction
  return {
    title: ca.title,
    kind: ca.kind,
    isPreferred: ca.isPreferred,
    diagnostics: ca.diagnostics?.map(conv.toMarker),
    edit: ca.edit ? { edits: monacoEdits(ca.edit) } : undefined,
    command: ca.command ? { id: COMMAND_ID, title: ca.command.title, arguments: [ca.command] } : undefined
  }
}

function toDocumentSymbol(s: LspDocumentSymbol): monaco.languages.DocumentSymbol {
  return {
    name: s.name,
    detail: s.detail ?? '',
    kind: conv.toSymbolKind(s.kind),
    tags: (s.tags ?? []).filter((t) => t === 1) as monaco.languages.SymbolTag[],
    range: conv.toRange(s.range),
    selectionRange: conv.toRange(s.selectionRange),
    children: s.children?.map(toDocumentSymbol)
  }
}

function registerProviders(): void {
  const L = monaco.languages
  const completion = caps.completionProvider
  if (completion) {
    providers.push(
      L.registerCompletionItemProvider(LANGUAGE, {
        triggerCharacters: completion.triggerCharacters ?? ['.', '>', ':'],
        async provideCompletionItems(model, position, context, token) {
          const uri = docUri(model)
          if (!uri) return { suggestions: [] }
          const r = await request<{ isIncomplete?: boolean; items: LspCompletionItem[] } | LspCompletionItem[]>(
            'textDocument/completion',
            {
              textDocument: { uri },
              position: conv.toPosition(position),
              context: { triggerKind: context.triggerKind + 1, triggerCharacter: context.triggerCharacter }
            },
            token
          )
          if (!r) return { suggestions: [] }
          const items = Array.isArray(r) ? r : r.items
          const word = model.getWordUntilPosition(position)
          const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn }
          const lineBefore = model.getLineContent(position.lineNumber).slice(0, position.column - 1)
          const inInclude = /^\s*#\s*include/.test(lineBefore)
          const suggestions = items.filter((i) => keepCompletion(i, inInclude)).map((i) => completionItem(i, range))
          if (items.length === 0) suggestions.push(...(await rowMembers(model, position, lineBefore, range, token)))
          if (!inInclude && /^\s*(?:[A-Za-z_]\w*)?$/.test(lineBefore)) suggestions.push(...snippetItems(model, range))
          return { suggestions, incomplete: !Array.isArray(r) && !!r.isIncomplete }
        },
        resolveCompletionItem: completion.resolveProvider
          ? async (item, token) => {
              const original = lspItems.get(item)
              if (!original) return item
              const r = await request<LspCompletionItem>('completionItem/resolve', original, token)
              if (!r) return item
              return { ...item, detail: r.detail ?? item.detail, documentation: cleanDocumentation(conv.toDocumentation(r.documentation)) ?? item.documentation }
            }
          : undefined
      })
    )
  }
  if (caps.hoverProvider) {
    providers.push(
      L.registerHoverProvider(LANGUAGE, {
        async provideHover(model, position, token) {
          const uri = docUri(model)
          if (!uri) return null
          const r = await request<{ contents: conv.MarkupContent | conv.MarkedString | conv.MarkedString[]; range?: LspRange }>(
            'textDocument/hover',
            { textDocument: { uri }, position: conv.toPosition(position) },
            token
          )
          if (!r) return null
          const contents = conv.toMarkdown(r.contents).map((m) => ({ ...m, value: cleanDoc(prettyNames(m.value)) }))
          return { contents, range: r.range ? conv.toRange(r.range) : undefined }
        }
      })
    )
  }
  const sig = caps.signatureHelpProvider
  if (sig) {
    providers.push(
      L.registerSignatureHelpProvider(LANGUAGE, {
        signatureHelpTriggerCharacters: sig.triggerCharacters ?? ['(', ','],
        signatureHelpRetriggerCharacters: sig.retriggerCharacters ?? [')'],
        async provideSignatureHelp(model, position, token, context) {
          const uri = docUri(model)
          if (!uri) return null
          const r = await request<{
            signatures: { label: string; documentation?: string | conv.MarkupContent; parameters?: { label: string | [number, number]; documentation?: string | conv.MarkupContent }[]; activeParameter?: number }[]
            activeSignature?: number
            activeParameter?: number
          }>(
            'textDocument/signatureHelp',
            {
              textDocument: { uri },
              position: conv.toPosition(position),
              context: { triggerKind: context.triggerKind, triggerCharacter: context.triggerCharacter, isRetrigger: context.isRetrigger }
            },
            token
          )
          if (!r || !r.signatures?.length) return null
          return {
            value: {
              signatures: r.signatures.map((s) => ({
                label: s.label,
                documentation: cleanDocumentation(conv.toDocumentation(s.documentation)),
                parameters: (s.parameters ?? []).map((p) => ({ label: p.label, documentation: cleanDocumentation(conv.toDocumentation(p.documentation)) })),
                activeParameter: s.activeParameter
              })),
              activeSignature: r.activeSignature ?? 0,
              activeParameter: r.activeParameter ?? 0
            },
            dispose: () => undefined
          }
        }
      })
    )
  }
  if (caps.definitionProvider) {
    providers.push(
      L.registerDefinitionProvider(LANGUAGE, {
        provideDefinition: (model, position, token) => locations('textDocument/definition', model, position, token)
      })
    )
  }
  if (caps.declarationProvider) {
    providers.push(
      L.registerDeclarationProvider(LANGUAGE, {
        provideDeclaration: (model, position, token) => locations('textDocument/declaration', model, position, token)
      })
    )
  }
  if (caps.referencesProvider) {
    providers.push(
      L.registerReferenceProvider(LANGUAGE, {
        provideReferences: (model, position, context, token) =>
          locations('textDocument/references', model, position, token, { context: { includeDeclaration: context.includeDeclaration } })
      })
    )
  }
  if (caps.documentHighlightProvider) {
    providers.push(
      L.registerDocumentHighlightProvider(LANGUAGE, {
        async provideDocumentHighlights(model, position, token) {
          const uri = docUri(model)
          if (!uri) return []
          const r = await request<{ range: LspRange; kind?: number }[]>('textDocument/documentHighlight', { textDocument: { uri }, position: conv.toPosition(position) }, token)
          if (!Array.isArray(r)) return []
          // The engine counts kinds from 1 (text, read, write); the editor from 0.
          return r.map((h) => ({ range: conv.toRange(h.range), kind: ((h.kind ?? 1) - 1) as monaco.languages.DocumentHighlightKind }))
        }
      })
    )
  }
  if (caps.renameProvider) {
    const prepare = typeof caps.renameProvider === 'object' && caps.renameProvider.prepareProvider
    providers.push(
      L.registerRenameProvider(LANGUAGE, {
        async provideRenameEdits(model, position, newName, token) {
          const uri = docUri(model)
          if (!uri) return { edits: [], rejectReason: 'Code intelligence is not ready.' }
          const r = await request<LspWorkspaceEdit>('textDocument/rename', { textDocument: { uri }, position: conv.toPosition(position), newName }, token)
          if (!r) return { edits: [], rejectReason: 'This symbol cannot be renamed.' }
          try {
            return { edits: await applyWorkspaceEdit(r, true) }
          } catch (err) {
            return { edits: [], rejectReason: `Rename failed: ${err instanceof Error ? err.message : String(err)}` }
          }
        },
        resolveRenameLocation: prepare
          ? async (model, position, token) => {
              const uri = docUri(model)
              const word = model.getWordAtPosition(position)
              const fallback = word
                ? { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn }
                : { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: position.column, endColumn: position.column }
              if (!uri) return { range: fallback, text: '', rejectReason: 'Code intelligence is not ready.' }
              const r = await request<LspRange | { range: LspRange; placeholder: string }>(
                'textDocument/prepareRename',
                { textDocument: { uri }, position: conv.toPosition(position) },
                token
              )
              if (!r) return { range: fallback, text: '', rejectReason: 'This symbol cannot be renamed.' }
              const range = conv.toRange('range' in r ? r.range : r)
              return { range, text: 'placeholder' in r ? r.placeholder : model.getValueInRange(range) }
            }
          : undefined
      })
    )
  }
  if (caps.documentSymbolProvider) {
    providers.push(
      L.registerDocumentSymbolProvider(LANGUAGE, {
        displayName: 'clangd',
        async provideDocumentSymbols(model, token) {
          const uri = docUri(model)
          if (!uri) return []
          const r = await request<(LspDocumentSymbol | LspSymbolInformation)[]>('textDocument/documentSymbol', { textDocument: { uri } }, token)
          if (!Array.isArray(r)) return []
          return r.map((s) =>
            'location' in s
              ? {
                  name: s.name,
                  detail: s.containerName ?? '',
                  kind: conv.toSymbolKind(s.kind),
                  tags: [],
                  range: conv.toRange(s.location.range),
                  selectionRange: conv.toRange(s.location.range)
                }
              : toDocumentSymbol(s)
          )
        }
      })
    )
  }
  const formatOptions = (o: monaco.languages.FormattingOptions): { tabSize: number; insertSpaces: boolean } => ({
    tabSize: o.tabSize,
    insertSpaces: o.insertSpaces
  })
  if (caps.documentFormattingProvider) {
    providers.push(
      L.registerDocumentFormattingEditProvider(LANGUAGE, {
        displayName: 'clang-format',
        async provideDocumentFormattingEdits(model, options, token) {
          const uri = docUri(model)
          if (!uri) return []
          const r = await request<LspTextEdit[]>('textDocument/formatting', { textDocument: { uri }, options: formatOptions(options) }, token)
          return (r ?? []).map((e) => ({ range: conv.toRange(e.range), text: e.newText }))
        }
      })
    )
  }
  if (caps.documentRangeFormattingProvider) {
    providers.push(
      L.registerDocumentRangeFormattingEditProvider(LANGUAGE, {
        displayName: 'clang-format',
        async provideDocumentRangeFormattingEdits(model, range, options, token) {
          const uri = docUri(model)
          if (!uri) return []
          const r = await request<LspTextEdit[]>(
            'textDocument/rangeFormatting',
            { textDocument: { uri }, range: conv.toLspRange(range), options: formatOptions(options) },
            token
          )
          return (r ?? []).map((e) => ({ range: conv.toRange(e.range), text: e.newText }))
        }
      })
    )
  }
  if (caps.codeActionProvider) {
    providers.push(
      L.registerCodeActionProvider(
        LANGUAGE,
        {
          async provideCodeActions(model, range, context, token) {
            const uri = docUri(model)
            if (!uri) return { actions: [], dispose: () => undefined }
            // The request names the engine's own diagnostics (its ranges and words), so it finds their fixes.
            const related = (shownDiagnostics.get(uri) ?? [])
              .filter((s) => s.raw.source !== CHECKS_SOURCE)
              .filter((s) => conv.rangesOverlap(conv.toRange(s.shown.range), range) || conv.rangesOverlap(conv.toRange(s.raw.range), range))
              .map((s) => engineForm(s.raw))
            const r = await request<(LspCodeAction | LspCommand)[]>(
              'textDocument/codeAction',
              {
                textDocument: { uri },
                range: conv.toLspRange(range),
                context: { diagnostics: related, only: context.only ? [context.only] : undefined, triggerKind: context.trigger }
              },
              token
            )
            return { actions: (r ?? []).map(codeAction), dispose: () => undefined }
          }
        },
        { providedCodeActionKinds: ['quickfix', 'refactor', 'source'] }
      )
    )
  }
}

// Commands offered by the engine (in code actions) run back through it.
monaco.editor.registerCommand(COMMAND_ID, (_accessor, cmd: LspCommand) => {
  if (!cmd || typeof cmd.command !== 'string') return
  void request('workspace/executeCommand', { command: cmd.command, arguments: cmd.arguments })
})

// Go to definition and references into another file: the project view opens it in a tab.
monaco.editor.registerEditorOpener({
  openCodeEditor(_source, resource, selectionOrPosition) {
    if (resource.scheme !== 'project' && resource.scheme !== 'toolchain') return false
    emit('open-location', { uri: resource.toString(), selection: selectionOrPosition })
    return true
  }
})

// ---- session -------------------------------------------------------------

function resetClient(): void {
  client?.dispose()
  client = null
  ready = false
  caps = {}
  indexing = null
  fileStatus.clear()
  providers.forEach((p) => p.dispose())
  providers = []
  closeBackgroundDocs()
  for (const d of docs.values()) d.opened = false
  if (headerTouchTimer) clearTimeout(headerTouchTimer)
  headerTouchTimer = null
  touchedHeaders.clear()
  includedIn.clear()
  includeTargets.clear()
  ownErrors.clear()
  dependents.clear()
  mainErrors = null
  clearMarkers()
}

async function initialize(c: LspClient): Promise<void> {
  const r = await c.request<{ capabilities: ServerCaps }>('initialize', {
    processId: null,
    clientInfo: { name: 'WAX Master' },
    rootUri: 'project:///',
    capabilities: CLIENT_CAPABILITIES,
    initializationOptions: { clangdFileStatus: true }
  })
  if (c !== client) return
  caps = r?.capabilities ?? {}
  c.notify('initialized', {})
  ready = true
  for (const d of docs.values()) sendOpen(d)
  registerProviders()
  updateView()
}

function wireClient(c: LspClient): void {
  c.onNotification('textDocument/publishDiagnostics', onDiagnostics)
  c.onNotification('$/progress', (params) => {
    const p = params as { token?: unknown; value?: { kind?: string; title?: string; percentage?: number } }
    const v = p?.value
    if (!v) return
    if (v.kind === 'begin') indexing = { title: v.title ?? 'Indexing', percentage: v.percentage }
    else if (v.kind === 'report' && indexing) indexing = { ...indexing, percentage: v.percentage ?? indexing.percentage }
    else if (v.kind === 'end') indexing = null
    updateView()
  })
  c.onNotification('textDocument/clangd.fileStatus', (params) => {
    const p = params as { uri?: string; state?: string }
    if (typeof p?.uri !== 'string') return
    const k = key(p.uri)
    if (!docs.has(k)) return
    fileStatus.set(k, typeof p.state === 'string' ? p.state : 'idle')
    updateView()
  })
  c.onNotification('window/showMessage', (params) => {
    const p = params as { type?: number; message?: string }
    if (p?.message && (p.type === 1 || p.type === 2)) toast('Editor engine', String(p.message).slice(0, 500), p.type === 1 ? 'error' : 'info')
  })
  c.onNotification('window/logMessage', () => undefined)
  c.onRequest('window/workDoneProgress/create', () => null)
  c.onRequest('client/registerCapability', () => null)
  c.onRequest('client/unregisterCapability', () => null)
  c.onRequest('workspace/configuration', (params) => {
    const items = (params as { items?: unknown[] })?.items
    return Array.isArray(items) ? items.map(() => null) : []
  })
  c.onRequest('workspace/applyEdit', async (params) => {
    const p = params as { edit?: LspWorkspaceEdit }
    if (!p?.edit) return { applied: false }
    await applyWorkspaceEdit(p.edit)
    return { applied: true }
  })
}

function onStatus(s: EditorStatus): void {
  mainStatus = s
  setup = s.setup
  if (s.state === 'running') {
    if (!client || client.session !== s.session) {
      resetClient()
      const c = new LspClient(s.session)
      client = c
      wireClient(c)
      initialize(c).catch((err) => {
        if (c !== client) return
        mainStatus = { ...s, state: 'error', detail: `The editor engine did not start: ${err instanceof Error ? err.message : String(err)}` }
        updateView()
      })
    }
  } else if (s.state !== 'starting' || (client && client.session !== s.session)) {
    resetClient()
  }
  updateView()
}

/** Starts code intelligence for the open project; the returned function stops it. */
export function startEditorEngine(): () => void {
  if (users++ === 0) {
    unsubscribe = [
      window.wax.on('editor-status', onStatus),
      window.wax.on('editor-message', (session, msg) => {
        if (client && client.session === session) client.receive(msg as unknown as RpcMessage)
      })
    ]
    void window.wax.editor
      .start()
      .then(onStatus)
      .catch((err) => {
        mainStatus = { state: 'error', detail: err instanceof Error ? err.message : String(err), session: 0, setup, cdtVersion: '' }
        updateView()
      })
  }
  return () => {
    if (--users > 0) return
    unsubscribe.forEach((u) => u())
    unsubscribe = []
    resetClient()
    mainStatus = null
    mainFile = null
    disposeBackgroundModels()
    setEngineView({ state: 'off', detail: 'No project is open.' })
  }
}

/** Restarts the engine (status bar click after an error). */
export function restartEditorEngine(): void {
  if (users === 0) return
  void window.wax.editor.start().then(onStatus).catch(() => undefined)
}
