// Types shared by the main process and the window for chain features.

export type NetworkKind = 'mainnet' | 'testnet' | 'local'

export interface NetworkInfo {
  id: string
  name: string
  kind: NetworkKind
  chainId: string
  symbol: string
  precision: number
  endpoints: string[]
  history?: string
  preset: boolean
  currentEndpoint: number
}

export interface PermissionView {
  name: string
  parent: string
  threshold: number
  keys: { key: string; weight: number }[]
  accounts: { actor: string; permission: string; weight: number }[]
  waits: { waitSec: number; weight: number }[]
}

export interface ResourceView {
  used: number
  max: number
}

export interface AccountView {
  name: string
  network: string
  symbol: string
  liquid: string
  staked: string
  refund: string
  total: string
  ram: { usage: number; quota: number }
  cpu: ResourceView
  net: ResourceView
  cpuWeight: string
  netWeight: string
  permissions: PermissionView[]
  hasCode: boolean
  created: string
}

export interface AccountActionRow {
  time: string
  block: number
  trxId: string
  contract: string
  action: string
  data: string
}

export interface AccountActionsPage {
  rows: AccountActionRow[]
  /** False when the network has no history service configured. */
  historyAvailable: boolean
  more: boolean
}
