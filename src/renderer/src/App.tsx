import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TemplateId } from '../../shared/project'
import type { MenuCommand, OpenProject, Settings } from '../../shared/api'
import { AppContext, type AppActions, type AppState, type PanelTab, type View } from './state'
import { emit, on } from './lib/bus'
import { startBuild } from './lib/build'
import { Setup, refreshToolchainLabel } from './pages/Setup'
import { Modal } from './components/Modal'
import { AccountPage } from './pages/AccountPage'
import { AddNetworkDialog, ManageNetworksDialog, StarredManager } from './components/NetworkDialogs'
import { refreshNetworks, watchNetworkEvents } from './lib/networks'
import { errorText, toast } from './lib/toast'
import { TopBar } from './components/TopBar'
import { StatusBar } from './components/StatusBar'
import { BottomPanel } from './components/BottomPanel'
import { TerminalPanel } from './components/TerminalPanel'
import { Toasts } from './components/Toasts'
import { NewProjectDialog } from './components/NewProjectDialog'
import { MainFileDialog } from './components/MainFileDialog'
import { AboutDialog } from './components/AboutDialog'
import { Home } from './pages/Home'
import { ProjectView } from './pages/ProjectView'
import { ComingLater } from './pages/ComingLater'

export function App(): React.JSX.Element {
  const [state, setState] = useState<AppState>({
    info: null,
    settings: null,
    projects: [],
    project: null,
    view: 'home',
    panelOpen: false,
    panelTab: 'output',
    cursor: null
  })
  const [newOpen, setNewOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [coming, setComing] = useState<string | null>(null)
  const [newTemplate, setNewTemplate] = useState<TemplateId | undefined>(undefined)
  const [unsaved, setUnsaved] = useState<null | ((r: 'save' | 'discard' | 'cancel') => void)>(null)
  const dirtyRef = useRef(0)
  const [dialog, setDialog] = useState<null | 'add-network' | 'manage-networks' | 'starred'>(null)

  useEffect(() => on('menu-command', (c) => setComing(c as string)), [])
  useEffect(() => on('dialog', (d) => setDialog(d as 'add-network' | 'manage-networks' | 'starred')), [])
  useEffect(() => {
    void refreshNetworks()
    return watchNetworkEvents()
  }, [])

  useEffect(
    () =>
      on('dirty-count', (n) => {
        dirtyRef.current = n as number
        void window.wax.app.setDirty(n as number)
      }),
    []
  )

  /** Resolves true when it is fine to leave the current project (saved or discarded). */
  const confirmLeave = useCallback(async (): Promise<boolean> => {
    if (dirtyRef.current === 0) return true
    const answer = await new Promise<'save' | 'discard' | 'cancel'>((resolve) => setUnsaved(() => resolve))
    setUnsaved(null)
    if (answer === 'cancel') return false
    if (answer === 'save') await new Promise((resolve) => emit('save-all-then', resolve))
    return true
  }, [])

  // Latest state for the menu handler.
  const stateRef = useRef(state)
  stateRef.current = state

  const patch = useCallback((p: Partial<AppState>) => setState((s) => ({ ...s, ...p })), [])

  const actions: AppActions = useMemo(
    () => ({
      setView: (view: View) => patch({ view }),
      refreshProjects: async () => {
        patch({ projects: await window.wax.projects.list() })
      },
      projectOpened: (p: OpenProject) => {
        patch({ project: p, view: 'project' })
        void window.wax.projects.list().then((projects) => patch({ projects }))
      },
      closeProject: async () => {
        if (!(await confirmLeave())) return
        await window.wax.projects.close()
        patch({ project: null, view: 'home' })
      },
      openProjectPath: async (path: string) => {
        if (stateRef.current.project?.path === path) {
          patch({ view: 'project' })
          return
        }
        if (!(await confirmLeave())) return
        try {
          const p = await window.wax.projects.open(path)
          actions.projectOpened(p)
        } catch (e) {
          toast('Could not open the project', errorText(e), 'error')
        }
      },
      openProjectDialog: async () => {
        if (!(await confirmLeave())) return
        try {
          const p = await window.wax.projects.openDialog()
          if (p) actions.projectOpened(p)
        } catch (e) {
          toast('Could not open the project', errorText(e), 'error')
        }
      },
      newProject: () => {
        void confirmLeave().then((ok) => ok && (setNewTemplate(undefined), setNewOpen(true)))
      },
      updateSettings: async (p: Partial<Settings>) => {
        const settings = await window.wax.settings.set(p)
        patch({ settings })
      },
      showPanel: (tab: PanelTab | null) => {
        if (tab) patch({ panelOpen: true, panelTab: tab })
        else patch({ panelOpen: false })
      },
      togglePanel: () => setState((s) => ({ ...s, panelOpen: !s.panelOpen })),
      setCursor: (cursor) => patch({ cursor })
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  useEffect(() => {
    void (async () => {
      const [info, settings, projects] = await Promise.all([
        window.wax.app.info(),
        window.wax.settings.get(),
        window.wax.projects.list()
      ])
      patch({ info, settings, projects })
      const st = await window.wax.toolchain.status()
      refreshToolchainLabel(st)
      const ready = st.toolchain.ok && st.testBuild.ok
      if (!ready && !settings.setupDismissed) patch({ view: 'setup' })
    })()
  }, [patch])

  // Menu commands from the main process.
  useEffect(() => {
    return window.wax.on('menu', (cmd: MenuCommand) => {
      const s = stateRef.current
      switch (cmd) {
        case 'new-project':
          actions.newProject()
          break
        case 'template-empty':
        case 'template-hello':
        case 'template-token':
          void confirmLeave().then((ok) => {
            if (!ok) return
            setNewTemplate(cmd.slice(9) as TemplateId)
            setNewOpen(true)
          })
          break
        case 'save-all-and-quit':
          emit('save-all-then', () => void window.wax.app.quitNow())
          break
        case 'open-project':
          void actions.openProjectDialog()
          break
        case 'home':
          actions.setView('home')
          break
        case 'build':
          if (s.project) void startBuild((t) => actions.showPanel(t))
          else toast('Open a project first', 'Build works on the current project.')
          break
        case 'setup':
          actions.setView('setup')
          break
        case 'add-network':
        case 'manage-networks':
          setDialog(cmd)
          break
        case 'about':
          setAboutOpen(true)
          break
        case 'toggle-terminal':
          setState((st) => ({ ...st, panelOpen: !(st.panelOpen && st.panelTab === 'terminal'), panelTab: 'terminal' }))
          break
        case 'show-output':
          actions.showPanel('output')
          break
        case 'show-problems':
          actions.showPanel('problems')
          break
        case 'font-increase':
          if (s.settings) void actions.updateSettings({ fontSize: Math.min(40, s.settings.fontSize + 1) })
          break
        case 'font-decrease':
          if (s.settings) void actions.updateSettings({ fontSize: Math.max(8, s.settings.fontSize - 1) })
          break
        case 'font-reset':
          void actions.updateSettings({ fontSize: 14 })
          break
        case 'new-file':
        case 'open-file':
        case 'save':
        case 'save-as':
        case 'save-all':
        case 'find':
        case 'replace':
        case 'find-in-files':
        case 'format':
        case 'rename-symbol':
        case 'go-to-definition':
        case 'find-references':
        case 'command-palette':
        case 'show-outline':
        case 'project-settings':
          if (s.project) {
            if (s.view !== 'project') actions.setView('project')
            emit('editor-command', cmd)
          } else if (cmd === 'open-file') {
            toast('Open a project first', 'Files are opened inside a project.')
          }
          break
        default:
          setComing(cmd)
      }
    })
  }, [actions])

  return (
    <AppContext.Provider value={{ state, actions }}>
      <div className="app">
        <TopBar />
        <div className="main">
          <div className="column">
            {state.view === 'home' && <Home />}
            {state.project && (
              <div style={{ display: state.view === 'project' ? 'flex' : 'none', flex: 1, minHeight: 0 }}>
                <ProjectView key={state.project.path} project={state.project} />
              </div>
            )}
            {state.view === 'setup' && <Setup />}
            <div style={{ display: state.view === 'account' ? 'flex' : 'none', flex: 1, minHeight: 0 }}>
              <AccountPage />
            </div>
            {state.view !== 'home' && state.view !== 'project' && state.view !== 'setup' && state.view !== 'account' && <ComingLater what={state.view} />}
            <BottomPanel terminal={<TerminalPanel visible={state.panelOpen && state.panelTab === 'terminal'} />} />
          </div>
        </div>
        <StatusBar />
      </div>
      {newOpen && <NewProjectDialog initialTemplate={newTemplate} onClose={() => setNewOpen(false)} />}
      {state.project?.needsMainFile && <MainFileDialog project={state.project} />}
      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
      {coming && <ComingLater what={coming} dialog onClose={() => setComing(null)} />}
      {unsaved && (
        <Modal
          title="Unsaved changes"
          onClose={() => unsaved('cancel')}
          footer={
            <>
              <button className="btn" onClick={() => unsaved('cancel')}>
                Cancel
              </button>
              <button className="btn" onClick={() => unsaved('discard')}>
                Don&apos;t Save
              </button>
              <button className="btn purple" onClick={() => unsaved('save')}>
                Save All
              </button>
            </>
          }
        >
          Some files of the current project have unsaved changes. Save them first?
        </Modal>
      )}
      {dialog === 'add-network' && <AddNetworkDialog onClose={() => setDialog(null)} />}
      {dialog === 'manage-networks' && <ManageNetworksDialog onClose={() => setDialog(null)} />}
      {dialog === 'starred' && <StarredManager onClose={() => setDialog(null)} />}
      <Toasts />
    </AppContext.Provider>
  )
}

