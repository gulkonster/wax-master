import { useCallback, useEffect, useRef, useState } from 'react'
import type { ExternalFile, MenuCommand, OpenProject, TreeNode } from '../../../shared/api'
import { monaco, languageFor } from '../lib/monaco'
import { emit, on } from '../lib/bus'
import { errorText, toast } from '../lib/toast'
import { useApp } from '../state'
import { FileTree, type TreeMenuAction } from '../components/FileTree'
import { InputDialog } from '../components/Modal'
import { IconClose, IconGear, IconHammer, IconPlus, IconShip } from '../components/Icons'
import { ProjectSettings } from './ProjectSettings'
import { startBuild } from '../lib/build'
import { problemsStore } from '../lib/stores'
import type { Problem, WasmInfo } from '../../../shared/api'
import { WasmInfoView } from './WasmInfoView'

type Tab =
  | { id: 'settings'; kind: 'settings'; title: string }
  | { id: string; kind: 'file'; title: string; rel: string; info?: string; wasm?: WasmInfo }
  | { id: string; kind: 'external'; title: string; token: string; displayPath: string }

interface Doc {
  model: monaco.editor.ITextModel | null
  savedVersion: number
  viewState: monaco.editor.ICodeEditorViewState | null
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
      fontFamily: "'Cascadia Mono', Consolas, 'Courier New', monospace",
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      renderWhitespace: 'selection',
      tabSize: 2,
      fixedOverflowWidgets: true
    })
    editorRef.current = ed
    const sub1 = ed.onDidChangeCursorPosition((e) => actions.setCursor({ line: e.position.lineNumber, column: e.position.column }))
    const sub2 = ed.onDidChangeModelContent(() => {
      const id = activeRef.current
      if (!id) return
      const d = docs.current.get(id)
      if (!d?.model) return
      const isDirty = d.model.getAlternativeVersionId() !== d.savedVersion
      setDirty((s) => {
        if (s.has(id) === isDirty) return s
        const n = new Set(s)
        if (isDirty) n.add(id)
        else n.delete(id)
        return n
      })
    })
    return () => {
      sub1.dispose()
      sub2.dispose()
      ed.dispose()
      docs.current.forEach((d) => d.model?.dispose())
      docs.current.clear()
      actions.setCursor(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    editorRef.current?.updateOptions({ fontSize: state.settings?.fontSize ?? 14 })
  }, [state.settings?.fontSize])

  useEffect(() => {
    void refreshTree()
    const off = window.wax.on('files-changed', () => void refreshTree())
    return off
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
    if (doc?.model) {
      if (ed.getModel() !== doc.model) {
        ed.setModel(doc.model)
        if (doc.viewState) ed.restoreViewState(doc.viewState)
      }
      ed.focus()
    } else {
      ed.setModel(null)
    }
  }, [active])

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
      const f = await window.wax.files.read(rel)
      let info: string | undefined
      let model: monaco.editor.ITextModel | null = null
      if (f.binary) info = `Binary file, ${f.size.toLocaleString()} bytes.`
      else if (f.tooLarge) info = `This file is too large to edit here (${f.size.toLocaleString()} bytes).`
      else {
        const uri = monaco.Uri.parse(`project:///${rel.split('/').map(encodeURIComponent).join('/')}`)
        monaco.editor.getModel(uri)?.dispose()
        model = monaco.editor.createModel(f.content, languageFor(rel), uri)
      }
      docs.current.set(id, { model, savedVersion: model?.getAlternativeVersionId() ?? 0, viewState: null })
      setTabs((t) => [...t, { id, kind: 'file', title, rel, info }])
      switchTo(id)
      applyMarkers()
    } catch (e) {
      toast('Could not open the file', errorText(e), 'error')
    }
  }

  const openExternal = (f: ExternalFile): void => {
    const id = `ext:${f.token}`
    const model = monaco.editor.createModel(f.content, languageFor(f.name))
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

  const save = async (id: string | null): Promise<void> => {
    if (!id) return
    const tab = tabsRef.current.find((t) => t.id === id)
    const d = docs.current.get(id)
    if (!tab || !d?.model) return
    try {
      if (tab.kind === 'file') await window.wax.files.write(tab.rel, d.model.getValue())
      else if (tab.kind === 'external') await window.wax.files.writeExternal(tab.token, d.model.getValue())
      markSaved(id)
    } catch (e) {
      toast('Could not save', errorText(e), 'error')
    }
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
            for (const id of dirty) void save(id)
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
            toast('Find in Files', 'Arrives with code intelligence in a later build.')
            break
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
        void openFile(p.file).then(() => {
          const ed = editorRef.current
          if (!ed) return
          ed.setPosition({ lineNumber: p.line, column: p.column })
          ed.revealLineInCenter(p.line)
          ed.focus()
        })
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  useEffect(
    () =>
      on('save-all-then', (done) => {
        const ids = tabsRef.current.map((t) => t.id).filter((id) => dirty.has(id))
        void Promise.all(ids.map((id) => save(id))).then(() => (done as () => void)())
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dirty]
  )

  useEffect(() => {
    emit('dirty-count', dirty.size)
  }, [dirty])
  useEffect(() => () => emit('dirty-count', 0), [])

  const activeTab = tabs.find((t) => t.id === active)
  const showEditor = activeTab && activeTab.kind !== 'settings' && !(activeTab.kind === 'file' && activeTab.info)

  return (
    <div className="project-view">
      <div className="sidebar">
        <div className="sidebar-toolbar">
          <button className="icon-btn" title="New File (Ctrl+N)" onClick={() => newFile(selected ? dirname(selected) : 'src')}>
            <IconPlus />
          </button>
          <button className="icon-btn" title="Build (Ctrl+B)" onClick={() => void startBuild((t) => actions.showPanel(t))}>
            <IconHammer />
          </button>
          <button className="icon-btn" title="Deploy (arrives in a later build)" disabled>
            <IconShip />
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
              title={t.kind === 'file' ? t.rel : t.kind === 'external' ? t.displayPath : t.title}
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
          {activeTab?.kind === 'settings' && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', background: 'var(--bg)' }}>
              <ProjectSettings project={project} />
            </div>
          )}
          {activeTab?.kind === 'file' && activeTab.wasm && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', background: 'var(--bg)' }}>
              <WasmInfoView rel={activeTab.rel} info={activeTab.wasm} />
            </div>
          )}
          {activeTab?.kind === 'file' && activeTab.info && !activeTab.wasm && <div className="editor-placeholder">{activeTab.info}</div>}
          {!activeTab && <div className="editor-placeholder">Open a file from the tree on the left.</div>}
        </div>
      </div>
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

function findNode(root: TreeNode, path: string): TreeNode | null {
  if (root.path === path) return root
  for (const c of root.children ?? []) {
    const f = findNode(c, path)
    if (f) return f
  }
  return null
}
