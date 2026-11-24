// The fixed interface the preload script exposes to the editor window as `window.wax`.
// Types only; the implementation lives in src/preload and src/main.

import type { ProjectConfig, TemplateId } from './project'
import type { InspectedTransaction } from './trace-types'
import type { DeployPlan } from './chain-types'
import type { RamPrice } from './ram-market'
import type { NetworkHead, NetworkOverview } from './network-info'
import type { AccountActionsFilter, PowerupStateView, ProxyInfoView, SystemFeatures, VotingView } from './chain-types'
import type { AccountActionsPage, AccountView, AddedToken, ContractInfoView, LinkedActionsView, NetworkInfo, NetworkKind, NetworkStatus, PermissionIntent, PermissionPlanView, TokenBalance, WalletTokens } from './chain-types'
import type { AuthLevel, ContractAbiView, ContractHistoryEntry, ContractHistoryKind, ContractHistoryList, PackResult, RowsQuery, RowsResult, ScopesResult } from './chain-types'
import type { WindowErrorReport } from './window-error'

/** How a vault key can be had back without the vault: none, a text file, shown once, brought by the user, in an exported vault. */
export type KeyBackupState = 'none' | 'file' | 'shown' | 'imported' | 'vault-export'

export interface VaultKeyEntry {
  id: string
  label: string
  publicKey: string
  created: number
  backup: KeyBackupState
  backupAt: number
}

export interface VaultStatus {
  exists: boolean
  unlocked: boolean
  keys: number
  /** Keys whose only copy is the vault. */
  noBackup: number
  /** The vault has a recovery code. */
  recovery: boolean
  /** Kept older vault files in the data folder (vault.v1.bak.json, vault-old-<date>.json). */
  keptCopies: number
}

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
  /** Look of the program: follow Windows, or always dark or light. */
  theme: ThemeSetting
  /** Sizes the user gave to dialogs, by dialog name. */
  dialogSizes: Record<string, DialogSize>
}

export type ThemeSetting = 'system' | 'dark' | 'light'
export type ResolvedTheme = 'dark' | 'light'

export interface DialogSize {
  width: number
  height: number
}

/** A change of settings. In `dialogSizes` only the named dialogs change; null forgets a size. */
export type SettingsPatch = Partial<Omit<Settings, 'dialogSizes'>> & { dialogSizes?: Record<string, DialogSize | null> }

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
  source: 'build' | 'editor' | 'abi'
}

/** Stored result of a build: compiled and deployable, failed, or compiled with an ABI the chain refuses. */
export type BuildOutcome = 'ok' | 'failed' | 'abi-not-deployable'

/** One inconsistency of the compiled ABI. */
export interface AbiFinding {
  kind: 'table-type' | 'action-type' | 'field-type' | 'base-type' | 'variant-type' | 'alias-type' | 'result-type' | 'duplicate' | 'invalid'
  /** The table, action, struct, variant or alias the finding is about. */
  subject: string
  /** The type that is missing (empty when not about a type). */
  type: string
  /** The full explanation; the first line starts with "ABI check:". */
  text: string
  /** Where to look: the source place when found, otherwise the entry in the ABI file. Project-relative. */
  place: { file: string; line: number; column: number } | null
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
  /** Stored result of this build (absent when it did not run). */
  outcome?: BuildOutcome
  /** When the build finished (ms since epoch). */
  builtAt?: number
  /** ABI check findings; empty when the ABI is consistent or the compile failed. */
  abiFindings?: AbiFinding[]
}

/** Answer of "build if needed" and "rebuild". */
export interface BuildCheck {
  /** True when nothing was compiled because the stored build matches the project. */
  upToDate: boolean
  /** Time of the build the answer is about (null when no build ran, e.g. not approved). */
  builtAt: number | null
  result: BuildOutcome | null
  abiFindings: AbiFinding[]
  /** Problems of the ABI check (source "abi"), for the Problems tab. */
  abiProblems: Problem[]
  /** The build that ran now; null when the stored build was up to date. */
  build: BuildResult | null
}

/** Answer of Contract > Create Ricardian Files. Paths are project-relative. */
export interface RicardianResult {
  contractsFile: string
  clausesFile: string
  /** Actions that got a new section. */
  added: string[]
  /** Actions that already had one (left as they were). */
  kept: string[]
  clausesCreated: boolean
  /** Line of the contracts file to show: the first added section, or 1. */
  line: number
  /** One line for the user, e.g. "resource/x.contracts.md: added 3, kept 5." */
  message: string
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

/** One account offered by the account picker. */
export interface AccountPickEntry {
  account: string
  starred: boolean
  /** Found for a public key of the vault. */
  fromVault: boolean
  /** Permissions the vault's keys can sign for (empty: view only). */
  signable: string[]
}

export interface AccountPickList {
  networkId: string
  entries: AccountPickEntry[]
  /** False when the endpoint could not look up the vault's keys (starred accounts are still listed). */
  vaultChecked: boolean
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
  /** Writes or extends the Ricardian files from the built ABI. */
  | 'create-ricardian'
  | 'create-account'
  | 'create-testnet-account'
  | 'manage-keypairs'
  /** Accounts menu vault item: Create Vault, Unlock Vault or Lock Vault, by the vault's state. */
  | 'vault'
  | 'clear-code'
  | 'add-network'
  | 'manage-networks'
  /** Opens the Network page of the current network. */
  | 'network-page'
  | 'open-transaction'
  | 'setup'
  | 'check-updates'
  | 'about'
  | 'home'
  /** Opens the Documentation page. */
  | 'docs'
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
    /** Sends an error of the page to the main log (one way, checked there). */
    reportError(report: WindowErrorReport): void
  }
  settings: {
    get(): Promise<Settings>
    set(patch: SettingsPatch): Promise<Settings>
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
      /** Name of a chain the app knows (WAX Mainnet, WAX Testnet, EOS, Telos), or null. */
      knownName: string | null
    }>
    add(n: { name: string; kind: NetworkKind; endpoint: string; chainId: string; symbol: string; precision: number; history?: string }): Promise<NetworkInfo>
    update(id: string, patch: { name?: string; kind?: NetworkKind; endpoints?: string[]; history?: string | null }): Promise<NetworkInfo>
    /** Removes a network (at least one stays); returns the current network afterwards. */
    remove(id: string): Promise<NetworkInfo>
    /** Default networks that were removed. */
    removedDefaults(): Promise<{ id: string; name: string }[]>
    /** Brings back the removed default networks; returns the list. */
    restoreDefaults(): Promise<NetworkInfo[]>
    chooseEndpoint(id: string, index: number): Promise<NetworkInfo>
    /** Starred accounts of the current network, or of the given one. */
    stars(networkId?: string): Promise<string[]>
    setStar(account: string, starred: boolean): Promise<string[]>
    setStarOrder(accounts: string[]): Promise<string[]>
  }
  /** Status mark of the selected network. */
  network: {
    status(): Promise<NetworkStatus>
    /** True while the Network page is open: checks every 2 seconds instead of 10. */
    watchFast(on: boolean): Promise<void>
  }
  chain: {
    account(name: string): Promise<AccountView>
    /** False when the node says the account does not exist; a failed request rejects. */
    accountExists(name: string): Promise<boolean>
    /** One page of the account's actions from the history service, newest first, with the optional filter. */
    actions(name: string, skip: number, filter?: AccountActionsFilter): Promise<AccountActionsPage>
    /** RAM price of the current network for `bytes` (0: the market only), from the system RAM market. */
    ramPrice(bytes: number): Promise<RamPrice>
  }
  wallet: {
    /** Core token, the history service's tokens of the account, and the tokens added for this network, with balances. */
    tokens(account: string): Promise<WalletTokens>
    /** The tokens added for the current network, or for the network with this id. */
    addedTokens(networkId?: string): Promise<AddedToken[]>
    /** One token's balance and precision read from the chain (zero at the token's precision when the account has no row). */
    balance(account: string, contract: string, symbol: string): Promise<TokenBalance>
    /** Checked on the chain (the contract must have the token); returns the added tokens of this network. */
    addToken(contract: string, symbol: string): Promise<AddedToken[]>
    removeToken(contract: string, symbol: string): Promise<AddedToken[]>
    /** Builds a permission change from the chain's current state; nothing is signed. A refusal rejects with its reason. */
    permPreview(intent: PermissionIntent, signWith: string): Promise<PermissionPlanView>
    /** Builds the change again from the chain (refused when the permissions differ from basis) and sends it through the confirmation. */
    permSend(intent: PermissionIntent, signWith: string, basis: string): Promise<TxOutcome>
    /** Linked actions of the account (node first, history service second). */
    links(account: string): Promise<LinkedActionsView>
    /** Code hash, ABI hash and last code update of the account. */
    contractInfo(account: string): Promise<ContractInfoView>
    /** What the system contract of the current network offers (voting, PowerUp), from its ABI. */
    system(): Promise<SystemFeatures>
    /** Active producers, the account's current vote, and the reward claims the system ABI offers. */
    voting(account: string): Promise<VotingView>
    /** Whether the account is registered as a proxy, from its row of the voters table. */
    proxyInfo(account: string): Promise<ProxyInfoView>
    /** The PowerUp market of the current network, checked; null when the chain has none. */
    powerup(): Promise<PowerupStateView | null>
  }
  networkInfo: {
    /** Chain state of a saved network for the Network page: get_info, RAM, RAM price, core token. */
    overview(networkId: string): Promise<NetworkOverview>
    /** get_info and the head block; null while the window is minimized. */
    head(networkId: string): Promise<NetworkHead | null>
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
    status(): Promise<VaultStatus>
    create(password: string, again: string): Promise<VaultStatus>
    unlock(password: string): Promise<VaultStatus>
    lock(): Promise<VaultStatus>
    list(): Promise<VaultKeyEntry[]>
    newPending(): Promise<string>
    savePending(label: string): Promise<VaultKeyEntry>
    discardPending(): Promise<void>
    import(privateKey: string, label: string): Promise<VaultKeyEntry>
    setLabel(id: string, label: string): Promise<void>
    remove(id: string): Promise<void>
    reveal(id: string): Promise<void>
    accounts(keys: string[]): Promise<{ account: string; permission: string; key: string }[]>
    exportVault(): Promise<boolean>
    /** The secret is the imported file's password or recovery code. */
    importVault(secret: string): Promise<number | null>
    /** Opens the separate backup window for one key; tells only whether a file was saved. */
    backup(id: string): Promise<'saved' | 'cancelled'>
    /** Opens the separate forgotten-password window. */
    forgot(): Promise<void>
    changePassword(current: string, next: string, again: string): Promise<VaultStatus>
    /** The new code is shown once in a separate window, never here. */
    newRecoveryCode(password: string): Promise<VaultStatus>
    removeRecoveryCode(password: string): Promise<VaultStatus>
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
    /** Starred accounts and accounts of the vault's keys on a network (default: the current one). */
    pickList(networkId?: string): Promise<AccountPickList>
  }
  toolchains: {
    list(): Promise<{ defaultId: string; defaultLabel: string; installed: (ToolchainInfo & { isDefault: boolean })[] }>
    chooseFile(): Promise<{ token: string; id: string; label: string; sha256: string; size: number; known: string | null; file: string } | null>
    add(token: string, wslVersion: 1 | 2): Promise<ToolchainInfo[]>
    remove(id: string): Promise<ToolchainInfo[]>
  }
  build: {
    /** Always compiles (Contract > Build, Ctrl+B). */
    run(): Promise<BuildResult>
    /** Compiles only when the project changed since the stored build or its outputs are missing. */
    ensure(): Promise<BuildCheck>
    /** Always compiles; answers in the same form as ensure(). */
    rebuild(): Promise<BuildCheck>
    defaultCommand(): Promise<string>
  }
  ricardian: {
    /** Writes or extends the open project's Ricardian files from its built ABI. */
    create(): Promise<RicardianResult>
  }
  docs: {
    /** Text of one file of the shipped documentation: `index.json` or `<topic id>.md`. */
    read(name: string): Promise<string>
  }
  on(event: 'menu', cb: (cmd: MenuCommand) => void): () => void
  on(event: 'output', cb: (e: OutputEvent) => void): () => void
  on(event: 'update-available', cb: (r: UpdateResult) => void): () => void
  on(event: 'vault-changed', cb: (s: VaultStatus) => void): () => void
  on(event: 'network-changed', cb: (n: NetworkInfo, note: string) => void): () => void
  on(event: 'network-status', cb: (s: NetworkStatus) => void): () => void
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
