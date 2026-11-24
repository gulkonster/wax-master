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
  /** Present when settings were taken from an EOS Studio .eosproj file. */
  eosproj?: { buildScript: string }
}

export interface FileContent {
  path: string
  content: string
  size: number
  binary: boolean
  /** True when the file is too large to edit. */
  tooLarge: boolean
}

export interface WasmInfo {
  size: number
  sha256: string
  valid: boolean
  error?: string
  imports: { module: string; name: string; kind: string }[]
  exports: string[]
}

export interface ExternalFile {
  /** Token that identifies a file the user picked with a dialog (outside the project). */
  token: string
  name: string
  displayPath: string
  content: string
}

export interface Problem {
  file: string
  line: number
  column: number
  severity: 'error' | 'warning' | 'info'
  message: string
  source: 'build' | 'editor'
}

export interface BuildResult {
  ok: boolean
  problems: Problem[]
  durationMs: number
  /** Output files that exist after the build (project-relative). */
  outputs: string[]
  /** Set when a custom build command must be approved first. */
  needsApproval?: boolean
  command?: string
}

export interface ToolchainInfo {
  id: string
  label: string
  distro: string
  wslVersion: 1 | 2
  cdtVersion: string
  clangdVersion: string
  testBuildOk: boolean
}

export interface SetupStatus {
  windows: { ok: boolean; detail: string }
  wsl: { ok: boolean; detail: string }
  toolchain: { ok: boolean; detail: string; state: ToolchainInfo | null }
  testBuild: { ok: boolean; detail: string }
  partsAvailable: boolean
}

export interface OutputEvent {
  source: 'build' | 'setup' | 'deploy' | 'transaction'
  text: string
}

export type TerminalProfile = 'powershell' | 'cmd' | 'toolchain'

export interface TerminalProfileInfo {
  id: TerminalProfile
  label: string
  available: boolean
  note?: string
}

export type MenuCommand =
  | 'new-project'
  | 'template-empty'
  | 'template-hello'
  | 'template-token'
  | 'save-all-and-quit'
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
    setDirty(count: number): Promise<void>
    quitNow(): Promise<void>
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
    wasmInfo(rel: string): Promise<WasmInfo>
  }
  toolchain: {
    status(): Promise<SetupStatus>
    enableWsl(compat: boolean): Promise<{ ok: boolean; message: string }>
    install(wslVersion: 1 | 2): Promise<SetupStatus>
    testBuild(): Promise<SetupStatus>
    restartComputer(): Promise<void>
  }
  clipboard: {
    writeText(text: string): Promise<void>
    readText(): Promise<string>
  }
  terminal: {
    profiles(): Promise<{ profiles: TerminalProfileInfo[]; gitHint: string | null }>
    create(profile: TerminalProfile, rel: string | null, cols: number, rows: number): Promise<string>
    write(id: string, data: string): Promise<void>
    resize(id: string, cols: number, rows: number): Promise<void>
    kill(id: string): Promise<void>
  }
  build: {
    run(): Promise<BuildResult>
    defaultCommand(): Promise<string>
  }
  on(event: 'menu', cb: (cmd: MenuCommand) => void): () => void
  on(event: 'output', cb: (e: OutputEvent) => void): () => void
  on(event: 'setup-progress', cb: (line: string) => void): () => void
  on(event: 'files-changed', cb: () => void): () => void
  on(event: 'terminal-data', cb: (id: string, data: string) => void): () => void
  on(event: 'terminal-exit', cb: (id: string, code: number, error: string) => void): () => void
}

declare global {
  interface Window {
    wax: WaxApi
  }
}
