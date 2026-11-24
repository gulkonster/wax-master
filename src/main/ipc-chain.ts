// IPC handlers for networks and chain reads.

import { dialog, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { arr, bool, int, obj, oneOf, optStr, str, chainName } from '../shared/validate'
import { handle } from './ipc'
import * as networks from './networks'
import { accountActions, accountView } from './account-view'
import { ContractHistory, getContractAbi, getContractDef, KEY_TYPES, packAction, queryRows } from './contract-view'
import { dataDir } from './paths'
import { chain } from './rpc'
import { isUnknownAccount } from './account-pick'
import type { AuthLevel, ContractHistoryKind, ContractHistoryList } from '../shared/chain-types'

const KINDS = ['mainnet', 'testnet', 'local'] as const
const HIST_KINDS = ['action', 'query'] as const
const HIST_LISTS = ['favorite', 'history'] as const

let contractHistory: ContractHistory | null = null
function historyStore(): ContractHistory {
  contractHistory ??= new ContractHistory(join(dataDir(), 'contract-history.json'))
  return contractHistory
}

/** Free-text chain value (scope, bounds): short, no control characters. */
function plain(v: unknown, field: string, max: number): string {
  const s = str(v, field, max)
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(s)) throw new Error(`${field}: invalid character`)
  return s
}

function authList(v: unknown): AuthLevel[] {
  return arr(v, 'authorization', 20).map((a, i) => {
    const o = obj(a, 'authorization[' + i + ']')
    return { actor: chainName(o.actor, 'actor'), permission: chainName(o.permission, 'permission') }
  })
}

function dataObject(v: unknown): Record<string, unknown> {
  const o = obj(v, 'data')
  if (JSON.stringify(o).length > 1024 * 1024) throw new Error('data: too large')
  return o
}

export function registerChainIpc(getWindow: () => BrowserWindow | null): void {
  networks.onEndpointSwitch((n, from, to) => {
    getWindow()?.webContents.send('network-changed', n, `${n.name}: ${from} did not answer; reading from ${to}.`)
  })

  handle('networks:list', () => ({ networks: networks.listNetworks(), current: networks.currentNetwork().id }))
  handle('networks:select', (_e, id) => networks.selectNetwork(str(id, 'id', 64)))
  handle('networks:probe', (_e, url) => networks.probeEndpoint(str(url, 'url', 512)))
  // Marking a chain outside the known lists as a test network is asked here, in the main process.
  const confirmTestnet: networks.ConfirmTestnet = async (n) => {
    const opts: Electron.MessageBoxOptions = {
      type: 'warning',
      buttons: ['Treat as a test network', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      title: 'Test network',
      message: 'Treat this network as a test network? Signing there skips the mainnet steps.',
      detail: `Name: ${n.name}\nChain id: ${n.chainId}\nEndpoint: ${n.endpoint}\n\nThe mainnet steps are the red confirmation and typing the account name before deploys and permission changes.`
    }
    const win = getWindow()
    const r = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
    return r.response === 0
  }
  handle('networks:add', (_e, raw) => {
    const o = obj(raw, 'network')
    return networks.addNetwork(
      {
        name: str(o.name, 'name', 64),
        kind: oneOf(o.kind, 'kind', KINDS),
        endpoint: str(o.endpoint, 'endpoint', 512),
        chainId: str(o.chainId, 'chainId', 64),
        symbol: str(o.symbol, 'symbol', 7),
        precision: int(o.precision, 'precision', 0, 18),
        history: optStr(o.history, 'history', 512)
      },
      confirmTestnet
    )
  })
  handle('networks:update', (_e, id, raw) => {
    const o = obj(raw, 'patch')
    return networks.updateNetwork(
      str(id, 'id', 64),
      {
        name: o.name === undefined ? undefined : str(o.name, 'name', 64),
        kind: o.kind === undefined ? undefined : oneOf(o.kind, 'kind', KINDS),
        endpoints: o.endpoints === undefined ? undefined : arr(o.endpoints, 'endpoints', 20).map((e, i) => str(e, `endpoints[${i}]`, 512)),
        history: o.history === null ? null : o.history === undefined ? undefined : str(o.history, 'history', 512)
      },
      confirmTestnet
    )
  })
  handle('networks:remove', (_e, id) => networks.removeNetwork(str(id, 'id', 64)))
  handle('networks:chooseEndpoint', (_e, id, index) => networks.chooseEndpoint(str(id, 'id', 64), int(index, 'index', 0, 19)))
  handle('networks:stars', () => networks.stars(networks.currentNetwork().id))
  handle('networks:setStar', (_e, account, starred) =>
    networks.setStar(networks.currentNetwork().id, chainName(account, 'account'), starred === true)
  )
  handle('networks:setStarOrder', (_e, list) =>
    networks.setStarOrder(
      networks.currentNetwork().id,
      arr(list, 'accounts', 500).map((a, i) => chainName(a, `accounts[${i}]`))
    )
  )

  handle('chain:account', (_e, name) => accountView(chainName(name, 'account')))
  // Existence of an account (recipient check, "name is free"); a failed request is an error, not "missing".
  handle('chain:accountExists', async (_e, name) => {
    const acc = chainName(name, 'account')
    try {
      await networks.readCall((ep) => chain.getAccount(ep, acc))
      return true
    } catch (e) {
      if (isUnknownAccount(e)) return false
      throw e
    }
  })
  handle('chain:actions', (_e, name, skip) => accountActions(chainName(name, 'account'), int(skip, 'skip', 0, 1_000_000)))

  handle('contract:abi', (_e, account, refresh) =>
    getContractAbi(networks.currentNetwork(), chainName(account, 'account'), networks.readCall, refresh === true)
  )
  handle('contract:pack', async (_e, account, action, data, authorization) => {
    const n = networks.currentNetwork()
    const acct = chainName(account, 'account')
    const def = await getContractDef(n, acct, networks.readCall)
    return packAction(def, networks.endpointOf(n), acct, chainName(action, 'action'), dataObject(data), authList(authorization))
  })
  handle('contract:rows', (_e, raw) => {
    const o = obj(raw, 'query')
    const index = plain(o.index ?? '', 'index', 16)
    if (index && !/^[a-z0-9]+$/.test(index)) throw new Error('index: use 1 to 10 or a name such as secondary')
    const keyType = o.keyType === '' || o.keyType === undefined ? '' : oneOf(o.keyType, 'keyType', KEY_TYPES)
    return queryRows(
      networks.currentNetwork(),
      {
        account: chainName(o.account, 'account'),
        table: chainName(o.table, 'table'),
        scope: plain(o.scope ?? '', 'scope', 64),
        lower: plain(o.lower ?? '', 'lower', 256),
        upper: plain(o.upper ?? '', 'upper', 256),
        limit: int(o.limit ?? 10, 'limit', 1, 1000),
        index,
        keyType,
        reverse: bool(o.reverse ?? false, 'reverse')
      },
      networks.readCall
    )
  })
  handle('contract:scopes', (_e, account, table, lower, limit) =>
    networks.readCall((ep) =>
      chain.getTableByScope(ep, {
        code: chainName(account, 'account'),
        table: chainName(table, 'table'),
        lower_bound: plain(lower ?? '', 'lower', 64),
        limit: int(limit ?? 10, 'limit', 1, 1000)
      })
    )
  )
  handle('contract:historyList', (_e, account, kind, list) =>
    historyStore().list(
      networks.currentNetwork().id,
      chainName(account, 'account'),
      oneOf(kind, 'kind', HIST_KINDS) as ContractHistoryKind,
      oneOf(list, 'list', HIST_LISTS) as ContractHistoryList
    )
  )
  handle('contract:historyAdd', (_e, account, kind, list, name, payload) => {
    const p = obj(payload, 'payload')
    if (JSON.stringify(p).length > 256 * 1024) throw new Error('payload: too large')
    return historyStore().add(
      networks.currentNetwork().id,
      chainName(account, 'account'),
      oneOf(kind, 'kind', HIST_KINDS) as ContractHistoryKind,
      oneOf(list, 'list', HIST_LISTS) as ContractHistoryList,
      chainName(name, 'name'),
      p
    )
  })
  handle('contract:historyRemove', (_e, account, kind, list, id) =>
    historyStore().remove(
      networks.currentNetwork().id,
      chainName(account, 'account'),
      oneOf(kind, 'kind', HIST_KINDS) as ContractHistoryKind,
      oneOf(list, 'list', HIST_LISTS) as ContractHistoryList,
      str(id, 'id', 64)
    )
  )
}
