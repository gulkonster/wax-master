// The documentation topic of each place that has a "?" button or a "Read more"
// link. Every place uses a name from here, so the tests can check that each
// topic exists in the shipped documentation.

export const HELP_TOPICS = {
  deploy: 'deploy',
  createAccount: 'create-account',
  testnetAccount: 'create-testnet-account',
  manageKeypairs: 'vault',
  changeKey: 'accounts-and-names',
  addNetwork: 'add-remove-networks',
  manageNetworks: 'add-remove-networks',
  networkPage: 'network-page',
  projectSettings: 'project-files',
  settings: 'window-tour',
  setup: 'first-start',
  contractPage: 'run-actions',
  accountPage: 'accounts-and-names',
  /** "Read more" under a CPU / NET / RAM refusal. */
  resourceRefusal: 'simulate-inspector',
  /** "Read more" under the ABI check text. */
  abiCheck: 'abi-check'
} as const

export type HelpPlace = keyof typeof HELP_TOPICS
