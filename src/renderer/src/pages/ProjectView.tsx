import { useCallback, useEffect, useRef, useState } from 'react'
import type { ExternalFile, MenuCommand, OpenProject, TreeNode } from '../../../shared/api'
import { monaco, languageFor } from '../lib/monaco'
import { emit, on } from '../lib/bus'
import { errorText, toast } from '../lib/toast'
import { useApp } from '../state'
import { FileTree, type TreeMenuAction } from '../components/FileTree'
import { InputDialog } from '../components/Modal'
import { IconClose, IconDeploy, IconGear, IconHammer, IconPlus } from '../components/Icons'
import { ProjectSettings, type SettingsSaver } from './ProjectSettings'
import { Modal } from '../components/Modal'
import { failureText, type SaveAllResult, type SaveFailure } from '../lib/save-result'
import { startBuild } from '../lib/build'
import { problemsStore } from '../lib/stores'
import type { Problem, WasmInfo } from '../../../shared/api'
import { WasmInfoView } from './WasmInfoView'
import { documentSaved, openDocument, startEditorEngine, switchHeaderSource } from '../lib/lsp/engine'
import { adoptModel, ensureModel, projectUri, relOf } from '../lib/lsp/models'
import { FindInFilesDialog } from '../components/FindInFilesDialog'
import { SymbolSearchDialog } from '../components/SymbolSearchDialog'

type Tab =
  | { id: 'settings'; kind: 'settings'; title: string }
  | { id: string; kind: 'file'; title: string; rel: string; info?: string; wasm?: WasmInfo }
  | { id: string; kind: 'external'; title: string; token: string; displayPath: string }
  | { id: string; kind: 'header'; title: string; uri: string }

interface Doc {
  model: monaco.editor.ITextModel | null
  savedVersion: number
  viewState: monaco.editor.ICodeEditorViewState | null
  /** Modification time and size of the file as last read or written by this tab. */
  mtimeMs?: number
  size?: number
  /** True while the text is replaced by the disk content (not a user edit). */
  reloading?: boolean
  /** True while the file is compared with the disk. */
  syncing?: boolean
}

type ConflictChoice = 'overwrite' | 'reload' | 'cancel'

const isDirtyDoc = (d: Doc): boolean => !!d.model && d.model.getAlternativeVersionId() !== d.savedVersion

/** Replaces the text of a model by a minimal edit, so cursor and scroll stay where they are. */
function replaceText(model: monaco.editor.ITextModel, text: string): void {
  const crlf = (text.match(/\r\n/g) ?? []).length
  const lf = (text.match(/\n/g) ?? []).length - crlf
  const eol = crlf > lf ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF
  if (model.getEndOfLineSequence() !== eol) model.setEOL(eol)
  const old = model.getValue()
  const next = eol === monaco.editor.EndOfLineSequence.CRLF ? text.replace(/\r?\n/g, '\r\n') : text.replace(/\r\n/g, '\n')
  if (old === next) return
  let a = 0
  const max = Math.min(old.length, next.length)
  while (a < max && old.charCodeAt(a) === next.charCodeAt(a)) a++
  let b = 0
  while (b < max - a && old.charCodeAt(old.length - 1 - b) === next.charCodeAt(next.length - 1 - b)) b++
  const start = model.getPositionAt(a)
  const end = model.getPositionAt(old.length - b)
  model.applyEdits([{ range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column), text: next.slice(a, next.length - b) }])
}

function dirname(rel: string): string {
  const i = rel.lastIndexOf('/')
  return i < 0 ? '' : rel.slice(0, i)
}

export function ProjectView({ project }: { project: OpenProject }): React.JSX.Element {
  const { state, actions } = useApp()
  const [tree, setTree] = useState<TreeNode | null>(null)
  const [tabs, setTabs] = useState<Tab[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [dirty, setDirty] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<string | null>(null)
  const [input, setInput] = useState<null | { title: string; label: string; initial: string; ok: (v: string) => Promise<void> }>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [symbolsOpen, setSymbolsOpen] = useState(false)
  const [conflict, setConflict] = useState<null | { title: string; resolve: (c: ConflictChoice) => void }>(null)
  const settingsSaver = useRef<SettingsSaver | null>(null)
  const onSettingsDirty = useCallback((d: boolean) => {
    setDirty((s) => {
      if (s.has('settings') === d) return s
      const n = new Set(s)
      if (d) n.add('settings')
      else n.delete('settings')
      return n
    })
  }, [])
  /** Where to put the cursor once a tab's model is shown. */
  const pendingReveal = useRef<{ id: string; range: monaco.IRange } | null>(null)

  const mountRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const docs = useRef(new Map<string, Doc>())
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const activeRef = useRef(active)
  activeRef.current = active

  const refreshTree = useCallback(async () => {
    try {
      setTree(await window.wax.files.tree())
    } catch (e) {
      toast('Could not read the project folder', errorText(e), 'error')
    }
  }, [])

  // Create the editor once.
  useEffect(() => {
    if (!mountRef.current) return
    const ed = monaco.editor.create(mountRef.current, {
      model: null,
      theme: 'wax-dark',
      automaticLayout: true,
      fontSize: state.settings?.fontSize ?? 14,
      fontFamily: "'Cascadia Mono', 'Cascadia Code', Consolas, 'Courier New', monospace",
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      renderWhitespace: 'selection',
      tabSize: 2,
      fixedOverflowWidgets: true
    })
    editorRef.current = ed
    // Also offered in the editor's command palette; the keys live on the Edit menu.
    const paletteCommands: [string, string, MenuCommand][] = [
      ['wax.findInFiles', 'Find in Files', 'find-in-files'],
      ['wax.workspaceSymbol', 'Go to Symbol in Workspace', 'workspace-symbol'],
      ['wax.switchHeaderSource', 'Switch Header/Source', 'switch-header-source']
    ]
    for (const [id, label, cmd] of paletteCommands) ed.addAction({ id, label, run: () => emit('editor-command', cmd) })
    const sub1 = ed.onDidChangeCursorPosition((e) => actions.setCursor({ line: e.position.lineNumber, column: e.position.column }))
    const stopEngine = startEditorEngine()
    return () => {
      sub1.dispose()
      ed.dispose()
      docs.current.forEach((d) => d.model?.dispose())
      docs.current.clear()
      stopEngine()
      actions.setCursor(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    editorRef.current?.updateOptions({ fontSize: state.settings?.fontSize ?? 14 })
  }, [state.settings?.fontSize])

  useEffect(() => {
    void refreshTree()
    const off = window.wax.on('files-changed', () => {
      void refreshTree()
      void syncRef.current()
    })
    const onFocus = (): void => void syncRef.current()
    window.addEventListener('focus', onFocus)
    return () => {
      off()
      window.removeEventListener('focus', onFocus)
    }
  }, [refreshTree])

  // Open the main file when the project opens.
  useEffect(() => {
    if (!project.needsMainFile && project.config.main) void openFile(project.config.main)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.needsMainFile])

  // Show the active tab's model.
  useEffect(() => {
    const ed = editorRef.current
    if (!ed) return
    const doc = active ? docs.current.get(active) : undefined
    const tab = tabsRef.current.find((t) => t.id === active)
    ed.updateOptions({ readOnly: tab?.kind === 'header' })
    if (doc?.model) {
      if (ed.getModel() !== doc.model) {
        ed.setModel(doc.model)
        if (doc.viewState) ed.restoreViewState(doc.viewState)
      }
      const pending = pendingReveal.current
      if (pending && pending.id === active) {
        pendingReveal.current = null
        applyReveal(ed, pending.range)
      }
      ed.focus()
    } else {
      ed.setModel(null)
    }
  }, [active])

  /** Tracks unsaved changes of a tab's model (also when it is not the one shown). */
  const track = (id: string, model: monaco.editor.ITextModel): void => {
    model.onDidChangeContent(() => {
      const d = docs.current.get(id)
      if (!d?.model || d.model !== model || d.reloading) return
      const isDirty = model.getAlternativeVersionId() !== d.savedVersion
      setDirty((s) => {
        if (s.has(id) === isDirty) return s
        const n = new Set(s)
        if (isDirty) n.add(id)
        else n.delete(id)
        return n
      })
    })
  }

  /** Moves the cursor in a tab now if its model is shown, or as soon as it is. */
  const revealIn = (id: string, range: monaco.IRange): void => {
    const ed = editorRef.current
    const d = docs.current.get(id)
    if (ed && d?.model && ed.getModel() === d.model) applyReveal(ed, range)
    else pendingReveal.current = { id, range }
  }

  const switchTo = (id: string): void => {
    const ed = editorRef.current
    const prev = activeRef.current
    if (ed && prev) {
      const d = docs.current.get(prev)
      if (d && d.model && ed.getModel() === d.model) d.viewState = ed.saveViewState()
    }
    setActive(id)
  }

  const openSettings = (): void => {
    if (!tabsRef.current.some((t) => t.id === 'settings')) {
      setTabs((t) => [{ id: 'settings', kind: 'settings', title: 'Project Settings' }, ...t])
    }
    switchTo('settings')
  }

  const openFile = async (rel: string): Promise<void> => {
    const id = `file:${rel}`
    setSelected(rel)
    if (tabsRef.current.some((t) => t.id === id)) {
      switchTo(id)
      return
    }
    try {
      const title = rel.split('/').pop() ?? rel
      if (rel.toLowerCase().endsWith('.wasm')) {
        const wasm = await window.wax.files.wasmInfo(rel)
        docs.current.set(id, { model: null, savedVersion: 0, viewState: null })
        setTabs((t) => [...t, { id, kind: 'file', title, rel, info: 'wasm', wasm }])
        switchTo(id)
        return
      }
      const uri = projectUri(rel)
      // A model loaded earlier for a preview (references, peek) is taken over as is.
      const adopted = adoptModel(uri)
      let info: string | undefined
      let model: monaco.editor.ITextModel | null = null
      let savedVersion = 0
      let stamp: { mtimeMs: number; size: number } | undefined
      if (adopted) {
        model = adopted.model
        savedVersion = adopted.savedVersion
      } else {
        const f = await window.wax.files.read(rel)
        if (f.binary) info = `Binary file, ${f.size.toLocaleString()} bytes.`
        else if (f.tooLarge) info = `This file is too large to edit here (${f.size.toLocaleString()} bytes).`
        else {
          monaco.editor.getModel(uri)?.dispose()
          model = monaco.editor.createModel(f.content, languageFor(rel), uri)
          savedVersion = model.getAlternativeVersionId()
          stamp = { mtimeMs: f.mtimeMs, size: f.size }
        }
      }
      docs.current.set(id, { model, savedVersion, viewState: null, ...stamp })
      if (model) {
        track(id, model)
        openDocument(model)
      }
      setTabs((t) => [...t, { id, kind: 'file', title, rel, info }])
      if (model && model.getAlternativeVersionId() !== savedVersion) setDirty((s) => new Set(s).add(id))
      switchTo(id)
      applyMarkers()
      // A model taken over from a preview has no disk stamp yet.
      if (adopted) void syncFile(id)
    } catch (e) {
      toast('Could not open the file', errorText(e), 'error')
    }
  }

  /** Opens a toolchain header (toolchain:///usr/opt/cdt/...) in a read-only tab. */
  const openHeader = async (address: string): Promise<string | null> => {
    const uri = monaco.Uri.parse(address).toString()
    const id = `tc:${uri}`
    if (tabsRef.current.some((t) => t.id === id)) {
      switchTo(id)
      return id
    }
    const model = await ensureModel(monaco.Uri.parse(uri))
    if (!model) {
      toast('Could not open the header', monaco.Uri.parse(uri).path, 'error')
      return null
    }
    adoptModel(model.uri)
    docs.current.set(id, { model, savedVersion: model.getAlternativeVersionId(), viewState: null })
    openDocument(model)
    const title = model.uri.path.slice(model.uri.path.lastIndexOf('/') + 1)
    setTabs((t) => (t.some((x) => x.id === id) ? t : [...t, { id, kind: 'header', title, uri }]))
    switchTo(id)
    return id
  }

  /** Opens a project file or toolchain header named by an editor address and selects a range in it. */
  const openLocation = async (uri: string, selection?: monaco.IRange | monaco.IPosition): Promise<void> => {
    const u = monaco.Uri.parse(uri)
    let id: string | null = null
    if (u.scheme === 'project') {
      const rel = relOf(u)
      await openFile(rel)
      id = `file:${rel}`
      if (!docs.current.get(id)?.model) return
    } else if (u.scheme === 'toolchain') {
      id = await openHeader(uri)
    } else {
      toast('Outside the project', u.path)
      return
    }
    if (!id || !selection) return
    const range =
      'startLineNumber' in selection
        ? selection
        : { startLineNumber: selection.lineNumber, startColumn: selection.column, endLineNumber: selection.lineNumber, endColumn: selection.column }
    revealIn(id, range)
  }

  const openExternal = (f: ExternalFile): void => {
    const id = `ext:${f.token}`
    const model = monaco.editor.createModel(f.content, languageFor(f.name))
    track(id, model)
    docs.current.set(id, { model, savedVersion: model.getAlternativeVersionId(), viewState: null })
    setTabs((t) => [...t, { id, kind: 'external', title: f.name, token: f.token, displayPath: f.displayPath }])
    switchTo(id)
  }

  const markSaved = (id: string): void => {
    const d = docs.current.get(id)
    if (d?.model) d.savedVersion = d.model.getAlternativeVersionId()
    setDirty((s) => {
      const n = new Set(s)
      n.delete(id)
      return n
    })
  }

  /** Compares one open file with the disk; a tab without unsaved edits follows the disk. */
  const syncFile = async (id: string): Promise<void> => {
    const d = docs.current.get(id)
    if (!d?.model || !id.startsWith('file:') || d.syncing) return
    const rel = id.slice(5)
    d.syncing = true
    try {
      const st = await window.wax.files.stat(rel)
      if (!st || (d.mtimeMs === st.mtimeMs && d.size === st.size)) return
      if (isDirtyDoc(d)) {
        // Edited here: the question comes when saving. Without a stamp, take the current one.
        if (d.mtimeMs === undefined) {
          d.mtimeMs = st.mtimeMs
          d.size = st.size
        }
        return
      }
      const f = await window.wax.files.read(rel)
      if (f.binary || f.tooLarge || !d.model || isDirtyDoc(d)) return
      applyDisk(id, d, f.content)
      d.mtimeMs = f.mtimeMs
      d.size = f.size
    } catch {
      // The file may be gone or locked right now; the next check tries again.
    } finally {
      d.syncing = false
    }
  }

  /** Puts the disk text into a tab's model as the saved state (not a user edit). */
  const applyDisk = (id: string, d: Doc, content: string): void => {
    if (!d.model) return
    d.reloading = true
    try {
      replaceText(d.model, content)
    } finally {
      d.reloading = false
    }
    d.savedVersion = d.model.getAlternativeVersionId()
    setDirty((s) => {
      if (!s.has(id)) return s
      const n = new Set(s)
      n.delete(id)
      return n
    })
    documentSaved(d.model)
  }

  const syncWasm = async (): Promise<void> => {
    for (const t of tabsRef.current) {
      if (t.kind !== 'file' || !t.wasm) continue
      try {
        const info = await window.wax.files.wasmInfo(t.rel)
        if (info.sha256 !== t.wasm.sha256 || info.size !== t.wasm.size)
          setTabs((list) => list.map((x) => (x.id === t.id && x.kind === 'file' ? { ...x, wasm: info } : x)))
      } catch {
        // Removed or unreadable: the tab keeps what it shows.
      }
    }
  }

  const syncAll = async (): Promise<void> => {
    await Promise.all([...docs.current.keys()].map((id) => syncFile(id)))
    await syncWasm()
  }
  const syncRef = useRef(syncAll)
  syncRef.current = syncAll

  const askConflict = (title: string): Promise<ConflictChoice> => new Promise((resolve) => setConflict({ title, resolve }))

  /** Saves one tab. Resolves to null when it is saved (or there is nothing to save), else the reason it was not. */
  const saveTab = async (id: string): Promise<string | null> => {
    const tab = tabsRef.current.find((t) => t.id === id)
    if (!tab) return null
    if (tab.kind === 'settings') {
      if (!settingsSaver.current) return 'The settings page is not available'
      return settingsSaver.current()
    }
    const d = docs.current.get(id)
    if (!d?.model) return null
    try {
      if (tab.kind === 'file') {
        if (d.mtimeMs !== undefined) {
          const st = await window.wax.files.stat(tab.rel)
          if (st && (st.mtimeMs !== d.mtimeMs || st.size !== d.size)) {
            const choice = await askConflict(tab.title)
            if (choice === 'cancel') return 'not saved, the file on disk is newer'
            if (choice === 'reload') {
              const f = await window.wax.files.read(tab.rel)
              if (f.binary || f.tooLarge) return 'the file on disk cannot be shown as text'
              applyDisk(id, d, f.content)
              d.mtimeMs = f.mtimeMs
              d.size = f.size
              return null
            }
          }
        }
        const stamp = await window.wax.files.write(tab.rel, d.model.getValue())
        d.mtimeMs = stamp.mtimeMs
        d.size = stamp.size
      } else if (tab.kind === 'external') await window.wax.files.writeExternal(tab.token, d.model.getValue())
      else return null
      markSaved(id)
      if (tab.kind === 'file') documentSaved(d.model)
      return null
    } catch (e) {
      return errorText(e)
    }
  }

  /** Saves the given tabs one after the other and lists the ones that failed. */
  const saveMany = async (ids: string[]): Promise<SaveFailure[]> => {
    const failed: SaveFailure[] = []
    for (const id of ids) {
      const error = await saveTab(id)
      if (error !== null) failed.push({ title: tabsRef.current.find((t) => t.id === id)?.title ?? id, error })
    }
    return failed
  }

  const save = async (id: string | null): Promise<void> => {
    if (!id) return
    const failed = await saveMany([id])
    if (failed.length) toast('Could not save', failureText(failed), 'error')
  }

  const saveAs = async (): Promise<void> => {
    const id = activeRef.current
    const tab = tabsRef.current.find((t) => t.id === id)
    const d = id ? docs.current.get(id) : undefined
    if (!tab || !d?.model || tab.kind === 'settings') return
    try {
      const suggested = tab.kind === 'file' ? tab.rel : tab.title
      const r = await window.wax.files.saveAs(d.model.getValue(), suggested)
      if (!r) return
      if (r.rel) await openFile(r.rel)
      else if (r.external) openExternal(r.external)
    } catch (e) {
      toast('Could not save', errorText(e), 'error')
    }
  }

  const close = (id: string): void => {
    if (dirty.has(id)) {
      const t = tabsRef.current.find((x) => x.id === id)
      if (!window.confirm(`"${t?.title}" has unsaved changes. Close it and discard the changes?`)) return
    }
    const d = docs.current.get(id)
    d?.model?.dispose()
    docs.current.delete(id)
    setDirty((s) => {
      const n = new Set(s)
      n.delete(id)
      return n
    })
    const list = tabsRef.current
    const idx = list.findIndex((t) => t.id === id)
    const next = list.filter((t) => t.id !== id)
    setTabs(next)
    if (activeRef.current === id) setActive(next[Math.max(0, idx - 1)]?.id ?? null)
  }

  const newFile = (dir: string): void => {
    setInput({
      title: 'New File',
      label: 'File path inside the project',
      initial: dir ? `${dir}/` : 'src/',
      ok: async (v) => {
        await window.wax.files.create(v, false)
        await refreshTree()
        await openFile(v.replace(/\\/g, '/'))
      }
    })
  }

  const menuFor = (node: TreeNode): TreeMenuAction[] => {
    const dir = node.dir ? node.path : dirname(node.path)
    const items: TreeMenuAction[] = [
      { label: 'New File...', run: () => newFile(dir) },
      {
        label: 'New Folder...',
        run: () =>
          setInput({
            title: 'New Folder',
            label: 'Folder path inside the project',
            initial: dir ? `${dir}/` : '',
            ok: async (v) => {
              await window.wax.files.create(v, true)
            }
          })
      }
    ]
    if (node.path !== '') {
      items.push(
        {
          label: 'Rename...',
          separatorBefore: true,
          run: () =>
            setInput({
              title: 'Rename',
              label: 'New path inside the project',
              initial: node.path,
              ok: async (v) => {
                await window.wax.files.rename(node.path, v)
                const id = `file:${node.path}`
                if (tabsRef.current.some((t) => t.id === id) && !dirty.has(id)) {
                  close(id)
                  if (!node.dir) await openFile(v)
                }
              }
            })
        },
        {
          label: 'Delete',
          run: () =>
            void window.wax.files.remove(node.path).catch((e) => toast('Could not delete', errorText(e), 'error'))
        }
      )
    }
    items.push({
      label: 'Reveal in File Explorer',
      separatorBefore: true,
      run: () => void window.wax.files.reveal(node.path)
    })
    items.push({
      label: 'Open Terminal Here',
      run: () => {
        actions.showPanel('terminal')
        emit('terminal-open-here', node.dir ? node.path : dirname(node.path))
      }
    })
    return items
  }

  // Editor and file commands from the menu.
  useEffect(
    () =>
      on('editor-command', (p) => {
        const cmd = p as MenuCommand
        const ed = editorRef.current
        const run = (action: string): void => {
          if (!ed || !ed.getModel()) return
          ed.focus()
          void ed.getAction(action)?.run()
        }
        switch (cmd) {
          case 'new-file':
            newFile(selected ? (tree && findNode(tree, selected)?.dir ? selected : dirname(selected)) : 'src')
            break
          case 'open-file':
            void window.wax.files.openDialog().then((r) => {
              if (r?.rel) void openFile(r.rel)
              else if (r?.external) openExternal(r.external)
            })
            break
          case 'save':
            void save(activeRef.current)
            break
          case 'save-as':
            void saveAs()
            break
          case 'save-all':
            void saveMany(tabsRef.current.map((t) => t.id).filter((id) => dirty.has(id))).then((failed) => {
              if (failed.length) toast('Could not save these files', failureText(failed), 'error')
            })
            break
          case 'project-settings':
            openSettings()
            break
          case 'find':
            run('actions.find')
            break
          case 'replace':
            run('editor.action.startFindReplaceAction')
            break
          case 'command-palette':
            run('editor.action.quickCommand')
            break
          case 'format':
            run('editor.action.formatDocument')
            break
          case 'rename-symbol':
            run('editor.action.rename')
            break
          case 'go-to-definition':
            run('editor.action.revealDefinition')
            break
          case 'find-references':
            run('editor.action.goToReferences')
            break
          case 'show-outline':
            run('editor.action.quickOutline')
            break
          case 'find-in-files':
            setFindOpen(true)
            break
          case 'workspace-symbol':
            setSymbolsOpen(true)
            break
          case 'switch-header-source': {
            const model = ed?.getModel()
            if (!model) break
            void switchHeaderSource(model).then((other) => {
              if (other) void openLocation(other)
              else toast('No matching file', 'No header or source file with this name was found.')
            })
            break
          }
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dirty, selected, tree]
  )

  // Build problems as editor markers.
  const applyMarkers = useCallback(() => {
    const problems = problemsStore.get()
    for (const [id, d] of docs.current) {
      if (!d.model || !id.startsWith('file:')) continue
      const rel = id.slice(5)
      const ms = problems
        .filter((p: Problem) => p.file === rel)
        .map((p: Problem) => ({
          startLineNumber: p.line,
          startColumn: p.column,
          endLineNumber: p.line,
          endColumn: d.model!.getLineMaxColumn(Math.min(p.line, d.model!.getLineCount())),
          message: p.message,
          severity:
            p.severity === 'error'
              ? monaco.MarkerSeverity.Error
              : p.severity === 'warning'
                ? monaco.MarkerSeverity.Warning
                : monaco.MarkerSeverity.Info,
          source: 'build'
        }))
      monaco.editor.setModelMarkers(d.model, 'build', ms)
    }
  }, [])

  useEffect(() => on('problems-updated', applyMarkers), [applyMarkers])

  useEffect(
    () =>
      on('reveal', (payload) => {
        const p = payload as { file: string; line: number; column: number }
        if (/^[A-Za-z]:|^\//.test(p.file)) {
          toast('Outside the project', p.file)
          return
        }
        void openFile(p.file).then(() =>
          revealIn(`file:${p.file}`, { startLineNumber: p.line, startColumn: p.column, endLineNumber: p.line, endColumn: p.column })
        )
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  useEffect(
    () =>
      on('open-location', (payload) => {
        const p = payload as { uri: string; selection?: monaco.IRange | monaco.IPosition }
        void openLocation(p.uri, p.selection)
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  useEffect(
    () =>
      on('save-all-then', (done) => {
        const ids = tabsRef.current.map((t) => t.id).filter((id) => dirty.has(id))
        void saveMany(ids).then((failed) => (done as (r: SaveAllResult) => void)({ failed }))
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dirty]
  )

  useEffect(() => {
    emit('dirty-count', dirty.size)
    emit('dirty-names', tabs.filter((t) => dirty.has(t.id)).map((t) => t.title))
  }, [dirty, tabs])
  useEffect(
    () => () => {
      emit('dirty-count', 0)
      emit('dirty-names', [])
    },
    []
  )

  const activeTab = tabs.find((t) => t.id === active)
  const showEditor = activeTab && activeTab.kind !== 'settings' && !(activeTab.kind === 'file' && activeTab.info)

  return (
    <div className="project-view">
      <div className="sidebar">
        <div className="sidebar-toolbar">
          <button className="icon-btn" title="New File (Ctrl+N)" onClick={() => newFile(selected ? dirname(selected) : 'src')}>
            <IconPlus />
          </button>
          <button className="btn subtle" title="Build (Ctrl+B)" onClick={() => void startBuild((t) => actions.showPanel(t))}>
            <IconHammer /> Build
          </button>
          <button className="btn subtle" title="Deploy" onClick={() => emit('menu-run', 'deploy')}>
            <IconDeploy /> Deploy
          </button>
          <div className="spacer" />
          <button className="icon-btn" title="Project Settings (Ctrl+,)" onClick={openSettings}>
            <IconGear />
          </button>
        </div>
        <FileTree root={tree} selected={selected} onOpen={(n) => void openFile(n.path)} menuFor={menuFor} />
      </div>
      <div className="editor-area">
        <div className="editor-tabs">
          {tabs.map((t) => (
            <div
              key={t.id}
              className={`editor-tab${t.id === active ? ' active' : ''}${dirty.has(t.id) ? ' dirty' : ''}`}
              onClick={() => switchTo(t.id)}
              onMouseDown={(e) => e.button === 1 && (e.preventDefault(), close(t.id))}
              title={t.kind === 'file' ? t.rel : t.kind === 'external' ? t.displayPath : t.kind === 'header' ? `${monaco.Uri.parse(t.uri).path} (read-only)` : t.title}
            >
              {t.title}
              <span
                className="close"
                onClick={(e) => {
                  e.stopPropagation()
                  close(t.id)
                }}
              >
                {dirty.has(t.id) ? <span className="dot" /> : <IconClose size={12} />}
              </span>
            </div>
          ))}
        </div>
        <div className="editor-host">
          <div className="monaco-mount" ref={mountRef} style={{ visibility: showEditor ? 'visible' : 'hidden' }} />
          {tabs.some((t) => t.kind === 'settings') && (
            <div className="editor-overlay" style={{ display: activeTab?.kind === 'settings' ? 'flex' : 'none' }}>
              <ProjectSettings project={project} onDirty={onSettingsDirty} saverRef={settingsSaver} />
            </div>
          )}
          {activeTab?.kind === 'file' && activeTab.wasm && (
            <div className="editor-overlay">
              <WasmInfoView rel={activeTab.rel} info={activeTab.wasm} />
            </div>
          )}
          {activeTab?.kind === 'file' && activeTab.info && !activeTab.wasm && <div className="editor-placeholder">{activeTab.info}</div>}
          {!activeTab && <div className="editor-placeholder">Open a file from the tree on the left.</div>}
        </div>
      </div>
      {findOpen && <FindInFilesDialog onClose={() => setFindOpen(false)} />}
      {symbolsOpen && (
        <SymbolSearchDialog
          onClose={() => setSymbolsOpen(false)}
          onPick={(uri, range) => {
            setSymbolsOpen(false)
            void openLocation(uri, range)
          }}
        />
      )}
      {conflict && (
        <Modal
          title="File changed on disk"
          onClose={() => {
            conflict.resolve('cancel')
            setConflict(null)
          }}
          footer={
            <>
              {(['cancel', 'reload', 'overwrite'] as const).map((c) => (
                <button
                  key={c}
                  className={c === 'overwrite' ? 'btn primary' : 'btn'}
                  onClick={() => {
                    conflict.resolve(c)
                    setConflict(null)
                  }}
                >
                  {c === 'cancel' ? 'Cancel' : c === 'reload' ? 'Reload from disk' : 'Overwrite'}
                </button>
              ))}
            </>
          }
        >
          &quot;{conflict.title}&quot; was changed on disk after you opened it. Overwrite the file with your version, reload it from disk (your edits are lost), or cancel?
        </Modal>
      )}
      {input && (
        <InputDialog
          title={input.title}
          label={input.label}
          initial={input.initial}
          onOk={input.ok}
          onClose={() => setInput(null)}
        />
      )}
    </div>
  )
}

function applyReveal(ed: monaco.editor.IStandaloneCodeEditor, range: monaco.IRange): void {
  ed.setSelection(range)
  ed.revealRangeInCenterIfOutsideViewport(range)
  ed.focus()
}

function findNode(root: TreeNode, path: string): TreeNode | null {
  if (root.path === path) return root
  for (const c of root.children ?? []) {
    const f = findNode(c, path)
    if (f) return f
  }
  return null
}
