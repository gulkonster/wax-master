// Code intelligence for C++ files: a language-server client on Monaco's
// provider API. The engine (clangd) runs in the toolchain distro; this module
// keeps open documents in sync, shows its diagnostics as markers (owner
// "clangd") and answers Monaco's completion, hover, navigation, rename,
// outline, formatting and quick-fix requests.

import { monaco } from '../monaco'
import { emit } from '../bus'
import { toast } from '../toast'
import type { EditorStatus } from '../../../../shared/api'
import { FLAG_SETUP, filterDiagnostics, type FlagSetup, type LspDiagnostic, type LspRange } from '../../../../shared/lsp-diagnostics'
import { applyTextEdits, type LspTextEdit } from '../../../../shared/lsp-text'
import { LspClient, isCancelled, type RpcMessage } from './client'
import * as conv from './convert'
import { sortTextFor } from './sort'
import { disposeBackgroundModels, ensureModels, markBackgroundSaved, relOf } from './models'
import { setEngineView } from './status'

const LANGUAGE = 'cpp'
const OWNER = 'clangd'
const COMMAND_ID = 'wax.engine.command'

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
const diagnostics = new Map<string, LspDiagnostic[]>()

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
    publishDiagnostics: { relatedInformation: true, tagSupport: { valueSet: [1, 2] }, codeDescriptionSupport: true }
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

function sendOpen(d: SyncedDoc): void {
  const c = activeClient()
  if (!c || d.opened || d.model.isDisposed()) return
  d.opened = true
  c.notify('textDocument/didOpen', {
    textDocument: { uri: d.model.uri.toString(), languageId: 'cpp', version: d.model.getVersionId(), text: d.model.getValue() }
  })
  applyStoredMarkers(d.model)
}

/** A file shown in a tab: the engine follows its content. Only C++ files. */
export function openDocument(model: monaco.editor.ITextModel): void {
  if (model.getLanguageId() !== LANGUAGE) return
  if (model.uri.scheme !== 'project' && model.uri.scheme !== 'toolchain') return
  const k = model.uri.toString()
  if (docs.has(k)) return
  const d: SyncedDoc = {
    model,
    opened: false,
    sub: model.onDidChangeContent((e) => {
      const c = activeClient()
      if (!c || !d.opened) return
      const changes =
        syncKind() === 2 && !e.isFlush
          ? e.changes.map((ch) => ({ range: conv.toLspRange(ch.range), rangeLength: ch.rangeLength, text: ch.text }))
          : [{ text: model.getValue() }]
      c.notify('textDocument/didChange', { textDocument: { uri: k, version: model.getVersionId() }, contentChanges: changes })
    })
  }
  docs.set(k, d)
  sendOpen(d)
}

export function closeDocument(model: monaco.editor.ITextModel): void {
  const k = model.uri.toString()
  const d = docs.get(k)
  if (!d) return
  d.sub.dispose()
  docs.delete(k)
  fileStatus.delete(k)
  if (d.opened) activeClient()?.notify('textDocument/didClose', { textDocument: { uri: k } })
  updateView()
}

export function documentSaved(model: monaco.editor.ITextModel): void {
  const k = model.uri.toString()
  if (docs.get(k)?.opened) activeClient()?.notify('textDocument/didSave', { textDocument: { uri: k } })
}

monaco.editor.onWillDisposeModel((m) => closeDocument(m))

// ---- diagnostics ---------------------------------------------------------

function applyStoredMarkers(model: monaco.editor.ITextModel): void {
  const list = diagnostics.get(model.uri.toString()) ?? []
  monaco.editor.setModelMarkers(model, OWNER, list.map(conv.toMarker))
}

function onDiagnostics(params: unknown): void {
  const p = params as { uri: string; diagnostics: LspDiagnostic[] }
  if (!p || typeof p.uri !== 'string' || !Array.isArray(p.diagnostics)) return
  const k = key(p.uri)
  const kept = filterDiagnostics(p.diagnostics, k, setup)
  diagnostics.set(k, kept)
  const model = monaco.editor.getModel(monaco.Uri.parse(k))
  if (model) applyStoredMarkers(model)
}

function clearMarkers(): void {
  diagnostics.clear()
  for (const m of monaco.editor.getModels()) monaco.editor.setModelMarkers(m, OWNER, [])
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
    documentation: conv.toDocumentation(item.documentation),
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
          return { suggestions: items.map((i) => completionItem(i, range)), incomplete: !Array.isArray(r) && !!r.isIncomplete }
        },
        resolveCompletionItem: completion.resolveProvider
          ? async (item, token) => {
              const original = lspItems.get(item)
              if (!original) return item
              const r = await request<LspCompletionItem>('completionItem/resolve', original, token)
              if (!r) return item
              return { ...item, detail: r.detail ?? item.detail, documentation: conv.toDocumentation(r.documentation) ?? item.documentation }
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
          return { contents: conv.toMarkdown(r.contents), range: r.range ? conv.toRange(r.range) : undefined }
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
                documentation: conv.toDocumentation(s.documentation),
                parameters: (s.parameters ?? []).map((p) => ({ label: p.label, documentation: conv.toDocumentation(p.documentation) })),
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
            const related = (diagnostics.get(uri) ?? []).filter((d) => conv.rangesOverlap(conv.toRange(d.range), range))
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
  for (const d of docs.values()) d.opened = false
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
        mainStatus = { state: 'error', detail: err instanceof Error ? err.message : String(err), session: 0, setup }
        updateView()
      })
  }
  return () => {
    if (--users > 0) return
    unsubscribe.forEach((u) => u())
    unsubscribe = []
    resetClient()
    mainStatus = null
    disposeBackgroundModels()
    setEngineView({ state: 'off', detail: 'No project is open.' })
  }
}

/** Restarts the engine (status bar click after an error). */
export function restartEditorEngine(): void {
  if (users === 0) return
  void window.wax.editor.start().then(onStatus).catch(() => undefined)
}
