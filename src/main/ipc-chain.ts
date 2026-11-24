// IPC handlers for networks and chain reads.

import type { BrowserWindow } from 'electron'
import { arr, int, obj, oneOf, optStr, str, chainName } from '../shared/validate'
import { handle } from './ipc'
import * as networks from './networks'
import { accountActions, accountView } from './account-view'

const KINDS = ['mainnet', 'testnet', 'local'] as const

export function registerChainIpc(getWindow: () => BrowserWindow | null): void {
  networks.onEndpointSwitch((n, from, to) => {
    getWindow()?.webContents.send('network-changed', n, `${n.name}: ${from} did not answer; reading from ${to}.`)
  })

  handle('networks:list', () => ({ networks: networks.listNetworks(), current: networks.currentNetwork().id }))
  handle('networks:select', (_e, id) => networks.selectNetwork(str(id, 'id', 64)))
  handle('networks:probe', (_e, url) => networks.probeEndpoint(str(url, 'url', 512)))
  handle('networks:add', (_e, raw) => {
    const o = obj(raw, 'network')
    return networks.addNetwork({
      name: str(o.name, 'name', 64),
      kind: oneOf(o.kind, 'kind', KINDS),
      endpoint: str(o.endpoint, 'endpoint', 512),
      chainId: str(o.chainId, 'chainId', 64),
      symbol: str(o.symbol, 'symbol', 7),
      precision: int(o.precision, 'precision', 0, 18),
      history: optStr(o.history, 'history', 512)
    })
  })
  handle('networks:update', (_e, id, raw) => {
    const o = obj(raw, 'patch')
    return networks.updateNetwork(str(id, 'id', 64), {
      name: o.name === undefined ? undefined : str(o.name, 'name', 64),
      kind: o.kind === undefined ? undefined : oneOf(o.kind, 'kind', KINDS),
      endpoints: o.endpoints === undefined ? undefined : arr(o.endpoints, 'endpoints', 20).map((e, i) => str(e, `endpoints[${i}]`, 512)),
      history: o.history === null ? null : o.history === undefined ? undefined : str(o.history, 'history', 512)
    })
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
  handle('chain:actions', (_e, name, skip) => accountActions(chainName(name, 'account'), int(skip, 'skip', 0, 1_000_000)))
}
