// The fixed interface the preload script exposes to the editor window as `window.wax`.
// Types only; the implementation lives in src/preload and src/main.

import type { ProjectConfig, TemplateId } from './project'
import type { InspectedTransaction } from './trace-types'
import type { DeployPlan } from './chain-types'
import type { AccountActionsPage, AccountView, NetworkInfo, NetworkKind } from './chain-types'
import type { AuthLevel, ContractAbiView, ContractHistoryEntry, ContractHistoryKind, ContractHistoryList, PackResult, RowsQuery, RowsResult, ScopesResult } from './chain-types'

export interface AppInfo {
  name: string
  version: string
  commit: string
  stage: number
  mainnetSigning: boolean
  platform: string
}

export interface UpdateResult {
  current: string
  latest: string | null
  newer: boolean
  url: string
  error?: string
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
  /** Set once when the folder opened: project values that were replaced by their default. */
  notices?: string[]
}

/** What identifies one state of a file on disk. */
export interface FileStamp {
  mtimeMs: number
  size: number
}

export interface FileContent {
  path: string
  content: string
  size: number
  /** Modification time on disk, in milliseconds. */
  mtimeMs: number
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

/** State of the editor engine (code intelligence) for the open project. */
export interface EditorStatus {
  state: 'off' | 'starting' | 'running' | 'error'
  detail: string
  /** Changes every time the engine is (re)started; messages carry it. */
  session: number
  /** Target setup of the generated compile flags. */
  setup: 'x32' | 'i386'
}

export interface SearchMatch {
  file: string
  line: number
  column: number
  /** Length of the match in characters. */
  length: number
  /** The line's text (trimmed to a few hundred characters). */
  text: string
}

export interface SearchResult {
  matches: SearchMatch[]
  filesSearched: number
  /** True when the result list was cut at its limit. */
  truncated: boolean
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

export interface TxAction {
  account: string
  name: string
  authorization: { actor: string; permission: string }[]
  data: unknown
}

export type TxOutcome =
  | { status: 'sent'; trace: InspectedTransaction }
  | { status: 'failed'; trace: InspectedTransaction | null; error: string }
  | { status: 'cancelled' }

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
  | 'switch-header-source'
  | 'workspace-symbol'
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
  /** Sent by the main process on F10 or an Alt tap: the drawn menu bar takes the focus. */
  | 'focus-menu'

export interface WaxApi {
  app: {
    info(): Promise<AppInfo>
    openExternal(url: string): Promise<boolean>
    setDirty(count: number): Promise<void>
    checkUpdates(): Promise<UpdateResult>
    clearData(includeVault: boolean, typed: string): Promise<void>
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
    /**
     * Writes the file and returns its new modification time and size. With `expected`, the main
     * process refuses ("changed on disk") when the file on disk has another modification time or size.
     */
    write(rel: string, content: string, expected?: FileStamp): Promise<FileStamp>
    /** Modification time and size, or null when the file does not exist. */
    stat(rel: string): Promise<FileStamp | null>
    create(rel: string, dir: boolean): Promise<void>
    rename(from: string, to: string): Promise<void>
    remove(rel: string): Promise<void>
    reveal(rel: string): Promise<void>
    saveAs(content: string, suggested: string): Promise<{ rel?: string; external?: ExternalFile } | null>
    openDialog(): Promise<{ rel?: string; external?: ExternalFile } | null>
    writeExternal(token: string, content: string): Promise<void>
    wasmInfo(rel: string): Promise<WasmInfo>
    search(query: string, matchCase: boolean, wholeWord: boolean): Promise<SearchResult>
  }
  editor: {
    /** Starts the editor engine for the open project (or reports why it is off). */
    start(): Promise<EditorStatus>
    status(): Promise<EditorStatus>
    /** Sends one JSON-RPC message to the engine of the given session. */
    send(session: number, message: Record<string, unknown>): Promise<void>
    /** Reads a toolchain header (`toolchain:///usr/opt/cdt/...`) for a read-only tab. */
    readToolchainFile(uri: string): Promise<string>
  }
  toolchain: {
    status(): Promise<SetupStatus>
    enableWsl(compat: boolean): Promise<{ ok: boolean; message: string }>
    install(wslVersion: 1 | 2): Promise<SetupStatus>
    testBuild(): Promise<SetupStatus>
    restartComputer(): Promise<void>
  }
  networks: {
    list(): Promise<{ networks: NetworkInfo[]; current: string }>
    select(id: string): Promise<NetworkInfo>
    probe(url: string): Promise<{
      endpoint: string
      chainId: string
      symbol: string
      precision: number
      version: string
      /** Set when the chain is a known main network: the kind is fixed to mainnet. */
      kindNote: string | null
      /** True when the endpoint is on this computer (kind "local" possible). */
      localAllowed: boolean
    }>
    add(n: { name: string; kind: NetworkKind; endpoint: string; chainId: string; symbol: string; precision: number; history?: string }): Promise<NetworkInfo>
    update(id: string, patch: { name?: string; kind?: NetworkKind; endpoints?: string[]; history?: string | null }): Promise<NetworkInfo>
    remove(id: string): Promise<void>
    chooseEndpoint(id: string, index: number): Promise<NetworkInfo>
    stars(): Promise<string[]>
    setStar(account: string, starred: boolean): Promise<string[]>
    setStarOrder(accounts: string[]): Promise<string[]>
  }
  chain: {
    account(name: string): Promise<AccountView>
    actions(name: string, skip: number): Promise<AccountActionsPage>
  }
  contract: {
    abi(account: string, refresh?: boolean): Promise<ContractAbiView>
    pack(account: string, action: string, data: Record<string, unknown>, authorization: AuthLevel[]): Promise<PackResult>
    rows(query: RowsQuery): Promise<RowsResult>
    scopes(account: string, table: string, lower: string, limit: number): Promise<ScopesResult>
    historyList(account: string, kind: ContractHistoryKind, list: ContractHistoryList): Promise<ContractHistoryEntry[]>
    historyAdd(account: string, kind: ContractHistoryKind, list: ContractHistoryList, name: string, payload: Record<string, unknown>): Promise<ContractHistoryEntry[]>
    historyRemove(account: string, kind: ContractHistoryKind, list: ContractHistoryList, id: string): Promise<ContractHistoryEntry[]>
  }
  keys: {
    status(): Promise<{ exists: boolean; unlocked: boolean; keys: number }>
    create(password: string, again: string): Promise<{ exists: boolean; unlocked: boolean; keys: number }>
    unlock(password: string): Promise<{ exists: boolean; unlocked: boolean; keys: number }>
    lock(): Promise<{ exists: boolean; unlocked: boolean; keys: number }>
    list(): Promise<{ id: string; label: string; publicKey: string; created: number }[]>
    newPending(): Promise<string>
    savePending(label: string): Promise<{ id: string; label: string; publicKey: string; created: number }>
    discardPending(): Promise<void>
    import(privateKey: string, label: string): Promise<{ id: string; label: string; publicKey: string; created: number }>
    setLabel(id: string, label: string): Promise<void>
    remove(id: string): Promise<void>
    reveal(id: string): Promise<void>
    accounts(keys: string[]): Promise<{ account: string; permission: string; key: string }[]>
    exportVault(): Promise<boolean>
    importVault(password: string): Promise<number | null>
  }
  tx: {
    /** The confirmation's title is made by the main process from the decoded actions. */
    run(actions: TxAction[]): Promise<TxOutcome>
    simulate(actions: TxAction[]): Promise<InspectedTransaction>
    simulationSupport(): Promise<'available' | 'unsupported' | 'unknown'>
    open(id: string): Promise<InspectedTransaction>
  }
  deploy: {
    plan(input: { networkId: string; account: string; permission: string; target: 'both' | 'wasm' | 'abi' }): Promise<DeployPlan>
    simulate(planId: string): Promise<InspectedTransaction>
    run(planId: string): Promise<TxOutcome>
  }
  faucet: {
    create(name: string): Promise<{ ok: boolean; message: string; account?: string; ownerPublic?: string; activePublic?: string }>
    tokens(name: string): Promise<{ ok: boolean; message: string }>
    suggestName(): Promise<string>
  }
  accounts: {
    create(input: {
      creator: string
      creatorPermission: string
      name: string
      ownerKey: string
      activeKey: string
      ramBytes: number
      stakeCpu: string
      stakeNet: string
      transfer: boolean
    }): Promise<TxOutcome>
    /** Replaces one key; the main process reads the permission and keeps the rest of its authority. */
    changeKey(input: { account: string; permission: string; oldKey: string; newKey: string; signWith: string }): Promise<TxOutcome>
    clearCode(account: string, permission: string): Promise<TxOutcome>
  }
  toolchains: {
    list(): Promise<{ defaultId: string; defaultLabel: string; installed: (ToolchainInfo & { isDefault: boolean })[] }>
    chooseFile(): Promise<{ token: string; id: string; label: string; sha256: string; size: number; known: string | null; file: string } | null>
    add(token: string, wslVersion: 1 | 2): Promise<ToolchainInfo[]>
    remove(id: string): Promise<ToolchainInfo[]>
  }
  build: {
    run(): Promise<BuildResult>
    defaultCommand(): Promise<string>
  }
  on(event: 'menu', cb: (cmd: MenuCommand) => void): () => void
  on(event: 'output', cb: (e: OutputEvent) => void): () => void
  on(event: 'update-available', cb: (r: UpdateResult) => void): () => void
  on(event: 'vault-changed', cb: (s: { exists: boolean; unlocked: boolean; keys: number }) => void): () => void
  on(event: 'network-changed', cb: (n: NetworkInfo, note: string) => void): () => void
  on(event: 'setup-progress', cb: (line: string) => void): () => void
  on(event: 'files-changed', cb: () => void): () => void
  on(event: 'editor-status', cb: (s: EditorStatus) => void): () => void
  on(event: 'editor-message', cb: (session: number, message: Record<string, unknown>) => void): () => void
}

/** The interface of the terminal frame (app://terminal) only; the editor page does not have it. */
export interface WaxTerminalApi {
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
  on(event: 'terminal-data', cb: (id: string, data: string) => void): () => void
  on(event: 'terminal-exit', cb: (id: string, code: number, error: string) => void): () => void
}

declare global {
  interface Window {
    wax: WaxApi
    waxTerminal: WaxTerminalApi
  }
}
