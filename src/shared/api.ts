// The fixed interface the preload script exposes to the editor window as `window.wax`.
// Types only; the implementation lives in src/preload and src/main.

import type { ProjectConfig, TemplateId } from './project'

export interface AppInfo {
  name: string
  version: string
  commit: string
  stage: number
  mainnetSigning: boolean
  platform: string
}

export interface Settings {
  fontSize: number
  defaultProjectFolder: string
  autoLockMinutes: 5 | 15 | 60
  lockAfterSignature: boolean
  updateCheck: boolean
  terminalProfile: 'powershell' | 'cmd' | 'toolchain'
  setupDismissed: boolean
}

export interface ProjectEntry {
  path: string
  name: string
  starred: boolean
  createdHere: boolean
  lastOpened: number
}

export interface TreeNode {
  name: string
  /** Relative path from the project root with forward slashes; "" for the root. */
  path: string
  dir: boolean
  children?: TreeNode[]
}

export interface OpenProject {
  path: string
  name: string
  config: ProjectConfig
  createdHere: boolean
  /** True when the folder had no waxmaster.json and the main file must be chosen. */
  needsMainFile: boolean
  /** Candidate main files (.cpp) when needsMainFile is true. */
  candidates: string[]
}

export interface FileContent {
  path: string
  content: string
  size: number
  binary: boolean
  /** True when the file is too large to edit. */
  tooLarge: boolean
}

export interface ExternalFile {
  /** Token that identifies a file the user picked with a dialog (outside the project). */
  token: string
  name: string
  displayPath: string
  content: string
}

export type MenuCommand =
  | 'new-project'
  | 'open-project'
  | 'new-file'
  | 'open-file'
  | 'save'
  | 'save-as'
  | 'save-all'
  | 'settings'
  | 'find'
  | 'replace'
  | 'find-in-files'
  | 'format'
  | 'rename-symbol'
  | 'go-to-definition'
  | 'find-references'
  | 'command-palette'
  | 'font-increase'
  | 'font-decrease'
  | 'font-reset'
  | 'toggle-terminal'
  | 'show-output'
  | 'show-problems'
  | 'show-outline'
  | 'project-settings'
  | 'build'
  | 'deploy'
  | 'deploy-to-account'
  | 'simulate-deploy'
  | 'create-account'
  | 'create-testnet-account'
  | 'manage-keypairs'
  | 'lock-vault'
  | 'clear-code'
  | 'add-network'
  | 'manage-networks'
  | 'open-transaction'
  | 'setup'
  | 'check-updates'
  | 'about'
  | 'home'

export interface WaxApi {
  app: {
    info(): Promise<AppInfo>
    openExternal(url: string): Promise<boolean>
  }
  settings: {
    get(): Promise<Settings>
    set(patch: Partial<Settings>): Promise<Settings>
  }
  projects: {
    list(): Promise<ProjectEntry[]>
    create(template: TemplateId, name: string, parent: string): Promise<OpenProject>
    chooseParentFolder(current: string): Promise<string | null>
    openDialog(): Promise<OpenProject | null>
    open(path: string): Promise<OpenProject>
    setMainFile(main: string): Promise<OpenProject>
    saveConfig(config: ProjectConfig): Promise<OpenProject>
    star(path: string, starred: boolean): Promise<ProjectEntry[]>
    remove(path: string): Promise<ProjectEntry[]>
    close(): Promise<void>
  }
  files: {
    tree(): Promise<TreeNode>
    read(rel: string): Promise<FileContent>
    write(rel: string, content: string): Promise<void>
    create(rel: string, dir: boolean): Promise<void>
    rename(from: string, to: string): Promise<void>
    remove(rel: string): Promise<void>
    reveal(rel: string): Promise<void>
    saveAs(content: string, suggested: string): Promise<{ rel?: string; external?: ExternalFile } | null>
    openDialog(): Promise<{ rel?: string; external?: ExternalFile } | null>
    writeExternal(token: string, content: string): Promise<void>
  }
  on(event: 'menu', cb: (cmd: MenuCommand) => void): () => void
  on(event: 'files-changed', cb: () => void): () => void
}

declare global {
  interface Window {
    wax: WaxApi
  }
}
