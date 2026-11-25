// The documentation topic of each place that has a "?" button or a "Read more"
// link. Every place uses a name from here, so the tests can check that each
// topic exists in the shipped documentation.

export const HELP_TOPICS = {
  deploy: 'deploy',
  createAccount: 'create-account',
  testnetAccount: 'create-testnet-account',
  manageKeypairs: 'vault',
  changeKey: 'change-key-safely',
  addNetwork: 'add-remove-networks',
  manageNetworks: 'add-remove-networks',
  networkPage: 'network-page',
  projectSettings: 'project-files',
  settings: 'window-tour',
  setup: 'first-start',
  contractPage: 'run-actions',
  accountPage: 'accounts-and-names',
  /** Wallet sections of the Account page. */
  walletOverview: 'wallet-overview',
  walletTransfers: 'transfers',
  walletRam: 'resources-ram',
  walletCpuNet: 'resources-cpu-net',
  walletFaucet: 'create-testnet-account',
  walletTransactions: 'transaction-history',
  walletPermissions: 'permissions-overview',
  walletThreshold: 'multisig-threshold',
  walletNewPermission: 'custom-permissions',
  walletEosioCode: 'eosio-code',
  walletLinks: 'linked-actions',
  walletCreateAccount: 'create-account',
  walletContract: 'contract-section',
  walletVoting: 'voting-rewards',
  walletPowerup: 'powerup',
  walletNameBids: 'name-bids',
  /** Pages and dialogs of the projects, the editor and the window. */
  home: 'what-is-wax-master',
  newProject: 'project-files',
  mainFile: 'project-files',
  projectTree: 'project-files',
  unsavedChanges: 'project-files',
  fileChanged: 'project-files',
  editorSearch: 'window-tour',
  toolchains: 'toolchain-versions',
  wasmView: 'build-output-problems',
  about: 'what-is-wax-master',
  updateAvailable: 'verify-download',
  comingLater: 'what-is-wax-master',
  /** Dialogs of the vault and the keys. */
  vault: 'vault',
  keyBackup: 'key-backups',
  /** Dialogs of the chain. */
  clearCode: 'contract-section',
  editNetwork: 'endpoints',
  starredAccounts: 'starred-accounts',
  inspector: 'simulate-inspector',
  openTransaction: 'transaction-history',
  /** Groups of the Settings page. */
  settingsAppearance: 'window-tour',
  settingsEditor: 'window-tour',
  settingsVault: 'vault',
  settingsUpdates: 'what-the-app-contacts',
  settingsData: 'what-the-app-contacts',
  /** "Read more" under a CPU / NET / RAM refusal. */
  resourceRefusal: 'troubleshooting',
  /** "Read more" under the error of a refused transaction. */
  txRefusal: 'troubleshooting',
  /** "Read more" under the ABI check text. */
  abiCheck: 'abi-check',
  /** "Read more" next to a Ricardian warning in Problems. */
  ricardianWarning: 'ricardian',
  /** "Read more" under the name rule hint of a build error in Problems. */
  nameRule: 'compiler-errors'
} as const

export type HelpPlace = keyof typeof HELP_TOPICS
