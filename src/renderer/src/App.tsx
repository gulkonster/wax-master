import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TemplateId } from '../../shared/project'
import type { MenuCommand, OpenProject, SettingsPatch } from '../../shared/api'
import { AppContext, type AppActions, type AppState, type PanelTab, type View } from './state'
import { emit, on } from './lib/bus'
import { startBuild } from './lib/build'
import { Setup, refreshToolchainLabel } from './pages/Setup'
import { Modal } from './components/Modal'
import { AccountPage } from './pages/AccountPage'
import { KeysDialog } from './components/KeysDialog'
import { SettingsPage } from './pages/SettingsPage'
import type { UpdateResult } from '../../shared/api'
import { InspectorDialog } from './components/Inspector'
import { DeployDialog } from './components/DeployDialog'
import { CreateAccountDialog, ChangeKeyDialog } from './components/AccountDialogs'
import { ClearCodeDialog } from './components/MoreDialogs'
import { TestnetAccountDialog } from './components/TestnetAccountDialog'
import { InputDialog } from './components/Modal'
import { askUnlock, refreshVault, vaultStore, watchVault } from './lib/vault'
import { UnlockPromptHost } from './components/UnlockPrompt'
import { appendOutput } from './lib/stores'
import type { InspectedTransaction } from '../../shared/trace-types'
import { ContractPage } from './pages/ContractPage'
import { NetworkPage } from './pages/NetworkPage'
import { AddNetworkDialog, ManageNetworksDialog, StarredManager } from './components/NetworkDialogs'
import { refreshNetworks, watchNetworkEvents } from './lib/networks'
import { errorText, toast } from './lib/toast'
import { failureText, type SaveAllResult } from './lib/save-result'
import { TopBar } from './components/TopBar'
import { TitleBar } from './components/TitleBar'
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
  const [dirtyNames, setDirtyNames] = useState<string[]>([])
  useEffect(() => on('dirty-names', (n) => setDirtyNames(n as string[])), [])
  const [dialog, setDialog] = useState<null | 'add-network' | 'manage-networks' | 'starred'>(null)
  const [keysOpen, setKeysOpen] = useState<null | { filter: string | null }>(null)
  const [inspect, setInspect] = useState<InspectedTransaction | null>(null)
  const [update, setUpdate] = useState<UpdateResult | null>(null)
  useEffect(() => window.wax.on('update-available', (r: UpdateResult) => setUpdate(r)), [])
  const [deployOpen, setDeployOpen] = useState<null | { askAccount: boolean }>(null)
  const [chainDialog, setChainDialog] = useState<null | 'create-account' | 'testnet-account' | 'clear-code' | 'open-transaction'>(null)
  const [changeKey, setChangeKey] = useState<null | Parameters<typeof ChangeKeyDialog>[0]>(null)

  const openTransaction = useCallback(async (id: string) => {
    try {
      setInspect(await window.wax.tx.open(id))
    } catch (e) {
      toast('Could not open the transaction', errorText(e), 'error')
    }
  }, [])

  useEffect(() => {
    void refreshVault()
    const offs = [
      watchVault(),
      on('show-inspector', (t) => setInspect(t as InspectedTransaction)),
      on('output-line', (t) => appendOutput(t as string)),
      on('open-keys', (a) => setKeysOpen({ filter: (a as string | null) ?? null })),
      on('open-transaction', (id) => void openTransaction(id as string)),
      on('change-key', (p) => setChangeKey(p as Parameters<typeof ChangeKeyDialog>[0])),
      on('open-account-page', (n) => {
        setState((st) => ({ ...st, view: 'account' }))
        setTimeout(() => emit('open-account', n), 0)
      }),
      // "Find an account" of an empty starred list: the Account page with its search focused,
      // and a way back to the dialog once an account is starred.
      on('find-account', (back) => {
        setState((st) => ({ ...st, view: 'account' }))
        setTimeout(() => emit('account-search', back), 0)
      })
    ]
    return () => offs.forEach((o) => o())
  }, [openTransaction])

  useEffect(() => on('menu-command', (c) => (c === 'create-account' ? setChainDialog('create-account') : setComing(c as string))), [])
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
    if (answer === 'save') {
      const r = await new Promise<SaveAllResult>((resolve) => emit('save-all-then', resolve))
      if (r.failed.length) {
        toast('Not saved, so the project stays open', failureText(r.failed), 'error')
        return false
      }
    }
    return true
  }, [])

  /**
   * File > Exit of the drawn menu. A page-initiated window.close() would skip the
   * close guard, so unsaved items are asked about here with the same three
   * choices, and the app then quits through the existing quit call.
   */
  const exitApp = useCallback(async (): Promise<void> => {
    if (dirtyRef.current > 0) {
      const answer = await new Promise<'save' | 'discard' | 'cancel'>((resolve) => setUnsaved(() => resolve))
      setUnsaved(null)
      if (answer === 'cancel') return
      if (answer === 'save') {
        emit('save-all-then', (r: SaveAllResult) => {
          if (r.failed.length) toast('Not saved, so WAX Master stays open', failureText(r.failed), 'error')
          else void window.wax.app.quitNow()
        })
        return
      }
    }
    void window.wax.app.quitNow()
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
        if (p.notices && p.notices.length > 0) toast('Project settings replaced', p.notices.join(' '), 'info')
        void window.wax.projects.list().then((projects) => patch({ projects }))
      },
      projectUpdated: (p: OpenProject) => patch({ project: p }),
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
      updateSettings: async (p: SettingsPatch) => {
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

  // Menu commands: the same function for the drawn menu bar and for the
  // menu event from the main process (accelerators and the close guard).
  const runMenuCommand = useCallback(
    (cmd: MenuCommand) => {
      const s = stateRef.current
      switch (cmd) {
        case 'focus-menu':
          emit('focus-menu')
          break
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
          emit('save-all-then', (r: SaveAllResult) => {
            if (r.failed.length) toast('Not saved, so WAX Master stays open', failureText(r.failed), 'error')
            else void window.wax.app.quitNow()
          })
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
        case 'settings':
          actions.setView('settings')
          break
        case 'check-updates':
          void window.wax.app.checkUpdates().then((r) => {
            if (r.newer) setUpdate(r)
            else if (r.error) toast('Could not check for updates', r.error, 'error')
            else toast('Up to date', r.latest ? `WAX Master ${r.current} is the latest version.` : `No release is published yet (this is ${r.current}).`, 'success')
          })
          break
        case 'manage-keypairs':
          setKeysOpen({ filter: null })
          break
        case 'vault': {
          // One item by state: Create Vault, Unlock Vault (both in place) or Lock Vault.
          const v = vaultStore.get()
          if (v.unlocked) void window.wax.keys.lock().then(() => toast('Vault locked'))
          else void askUnlock()
          break
        }
        case 'deploy':
        case 'simulate-deploy':
        case 'deploy-to-account':
          if (!s.project) toast('Open a project first', 'Deploy works on the current project.')
          else setDeployOpen({ askAccount: cmd === 'deploy-to-account' })
          break
        case 'create-account':
          setChainDialog('create-account')
          break
        case 'create-testnet-account':
          setChainDialog('testnet-account')
          break
        case 'clear-code':
          setChainDialog('clear-code')
          break
        case 'open-transaction':
          setChainDialog('open-transaction')
          break
        case 'network-page':
          actions.setView('network')
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
        case 'switch-header-source':
        case 'workspace-symbol':
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
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [actions]
  )

  useEffect(() => window.wax.on('menu', runMenuCommand), [runMenuCommand])
  // Buttons that run a menu command (the sidebar Deploy button).
  useEffect(() => on('menu-run', (c) => runMenuCommand(c as MenuCommand)), [runMenuCommand])

  return (
    <AppContext.Provider value={{ state, actions }}>
      <div className="app">
        <TitleBar run={runMenuCommand} exit={() => void exitApp()} />
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
            {state.view === 'settings' && <SettingsPage />}
            {state.view === 'network' && <NetworkPage />}
            <div style={{ display: state.view === 'account' ? 'flex' : 'none', flex: 1, minHeight: 0 }}>
              <AccountPage />
            </div>
            <div style={{ display: state.view === 'contract' ? 'flex' : 'none', flex: 1, minHeight: 0 }}>
              <ContractPage />
            </div>
            {state.view !== 'home' && state.view !== 'project' && state.view !== 'setup' && state.view !== 'settings' && state.view !== 'account' && state.view !== 'contract' && state.view !== 'network' && <ComingLater what={state.view} />}
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
          size="s"
          name="unsaved-changes"
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
              <button className="btn primary" onClick={() => unsaved('save')}>
                Save All
              </button>
            </>
          }
        >
          {dirtyNames.length} item(s) of the current project have unsaved changes: {dirtyNames.join(', ')}. Save them first?
        </Modal>
      )}
      {dialog === 'add-network' && <AddNetworkDialog onClose={() => setDialog(null)} />}
      {dialog === 'manage-networks' && <ManageNetworksDialog onClose={() => setDialog(null)} />}
      {dialog === 'starred' && <StarredManager onClose={() => setDialog(null)} />}
      {keysOpen && <KeysDialog filterAccount={keysOpen.filter} onClose={() => setKeysOpen(null)} />}
      {inspect && <InspectorDialog t={inspect} onClose={() => setInspect(null)} />}
      {deployOpen && state.project && (
        <DeployDialog project={state.project} askAccount={deployOpen.askAccount} showPanel={(t) => actions.showPanel(t)} onClose={() => setDeployOpen(null)} />
      )}
      {chainDialog === 'create-account' && <CreateAccountDialog onClose={() => setChainDialog(null)} />}
      {chainDialog === 'testnet-account' && <TestnetAccountDialog onClose={() => setChainDialog(null)} />}
      {chainDialog === 'clear-code' && <ClearCodeDialog onClose={() => setChainDialog(null)} />}
      {chainDialog === 'open-transaction' && (
        <InputDialog
          title="Open Transaction by Id"
          label="Transaction id (64 hex characters)"
          initial=""
          okLabel="Open"
          onOk={async (v) => {
            setInspect(await window.wax.tx.open(v.trim()))
          }}
          onClose={() => setChainDialog(null)}
        />
      )}
      {changeKey && <ChangeKeyDialog {...changeKey} onClose={() => setChangeKey(null)} />}
      {update && (
        <Modal
          size="s"
          name="update-available"
          title="A new version is available"
          onClose={() => setUpdate(null)}
          footer={
            <>
              <button className="btn" onClick={() => setUpdate(null)}>
                Later
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  void window.wax.app.openExternal(update.url)
                  setUpdate(null)
                }}
              >
                Open the release page
              </button>
            </>
          }
        >
          WAX Master {update.latest} is available (you have {update.current}). Download it from the release page and verify it as the README describes.
        </Modal>
      )}
      <UnlockPromptHost />
      <Toasts />
    </AppContext.Provider>
  )
}

