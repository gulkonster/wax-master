// Application state shared by the main window's components.

import { createContext, useContext } from 'react'
import type { AppInfo, OpenProject, ProjectEntry, Settings, SettingsPatch } from '../../shared/api'

export type View = 'home' | 'project' | 'contract' | 'account' | 'network' | 'keys' | 'settings' | 'setup'
export type PanelTab = 'terminal' | 'output' | 'problems'

export interface Cursor {
  line: number
  column: number
}

export interface AppState {
  info: AppInfo | null
  settings: Settings | null
  projects: ProjectEntry[]
  project: OpenProject | null
  view: View
  panelOpen: boolean
  panelTab: PanelTab
  cursor: Cursor | null
}

export interface AppActions {
  setView(v: View): void
  refreshProjects(): Promise<void>
  openProjectPath(path: string): Promise<void>
  openProjectDialog(): Promise<void>
  projectOpened(p: OpenProject): void
  /** The open project's settings were saved: the new state, without changing the view. */
  projectUpdated(p: OpenProject): void
  closeProject(): Promise<void>
  newProject(): void
  updateSettings(patch: SettingsPatch): Promise<void>
  showPanel(tab: PanelTab | null): void
  togglePanel(): void
  setCursor(c: Cursor | null): void
}

export const AppContext = createContext<{ state: AppState; actions: AppActions } | null>(null)

export function useApp(): { state: AppState; actions: AppActions } {
  const v = useContext(AppContext)
  if (!v) throw new Error('AppContext missing')
  return v
}
