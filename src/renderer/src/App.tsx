import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MenuCommand, OpenProject, Settings } from '../../shared/api'
import { AppContext, type AppActions, type AppState, type PanelTab, type View } from './state'
import { emit } from './lib/bus'
import { errorText, toast } from './lib/toast'
import { TopBar } from './components/TopBar'
import { StatusBar } from './components/StatusBar'
import { BottomPanel } from './components/BottomPanel'
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
        await window.wax.projects.close()
        patch({ project: null, view: 'home' })
      },
      openProjectPath: async (path: string) => {
        try {
          const p = await window.wax.projects.open(path)
          actions.projectOpened(p)
        } catch (e) {
          toast('Could not open the project', errorText(e), 'error')
        }
      },
      openProjectDialog: async () => {
        try {
          const p = await window.wax.projects.openDialog()
          if (p) actions.projectOpened(p)
        } catch (e) {
          toast('Could not open the project', errorText(e), 'error')
        }
      },
      newProject: () => setNewOpen(true),
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
    })()
  }, [patch])

  // Menu commands from the main process.
  useEffect(() => {
    return window.wax.on('menu', (cmd: MenuCommand) => {
      const s = stateRef.current
      switch (cmd) {
        case 'new-project':
          setNewOpen(true)
          break
        case 'open-project':
          void actions.openProjectDialog()
          break
        case 'home':
          actions.setView('home')
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
            {state.view !== 'home' && state.view !== 'project' && <ComingLater what={state.view} />}
            <BottomPanel />
          </div>
        </div>
        <StatusBar />
      </div>
      {newOpen && <NewProjectDialog onClose={() => setNewOpen(false)} />}
      {state.project?.needsMainFile && <MainFileDialog project={state.project} />}
      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
      {coming && <ComingLater what={coming} dialog onClose={() => setComing(null)} />}
      <Toasts />
    </AppContext.Provider>
  )
}

