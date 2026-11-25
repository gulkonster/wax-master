// IPC handlers of the app's local chain (decision B108 point 7, B110 points 1-2): the window calls the
// process module, and the network entry follows the node's port and chain id.

import type { BrowserWindow } from 'electron'
import { bool, chainName, int, obj, str } from '../shared/validate'
import {
  LOCAL_CHAIN_NETWORK_ID,
  LOCAL_CHAIN_PORT_MAX,
  LOCAL_CHAIN_PORT_MIN,
  LOCAL_CHAIN_PROGRESS_EVENT,
  LOCAL_CHAIN_STATUS_EVENT,
  type LocalChainStatus
} from '../shared/local-chain'
import { handle } from './ipc'
import * as chain from './local-chain'
import * as networks from './networks'
import { createLocalAccount, giveLocalTokens, localAccountExists } from './local-chain-accounts'
import { log } from './log'

const CHAIN_ID_FORM = /^[0-9a-f]{64}$/

/** Keeps the network entry at the node's port and chain id once the chain is set up. */
function syncNetwork(s: LocalChainStatus): LocalChainStatus {
  if (s.phase !== 'not-set-up' && s.phase !== 'unavailable' && s.phase !== 'setting-up' && CHAIN_ID_FORM.test(s.chainId)) {
    try {
      networks.ensureLocalChainNetwork({ port: s.port, chainId: s.chainId })
    } catch (e) {
      log.warn(`Local chain network entry not updated: ${e instanceof Error ? e.message : 'unknown error'}`)
    }
  }
  return s
}

function dropNetwork(s: LocalChainStatus): LocalChainStatus {
  try {
    if (networks.listNetworks().some((n) => n.id === LOCAL_CHAIN_NETWORK_ID)) networks.removeNetwork(LOCAL_CHAIN_NETWORK_ID)
  } catch (e) {
    log.warn(`Local chain network entry not removed: ${e instanceof Error ? e.message : 'unknown error'}`)
  }
  return s
}

export function registerLocalChainIpc(getWindow: () => BrowserWindow | null): void {
  const send = (channel: string, payload: unknown): void => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }
  chain.onStatus((s) => send(LOCAL_CHAIN_STATUS_EVENT, s))
  chain.onProgress((line) => send(LOCAL_CHAIN_PROGRESS_EVENT, line))

  handle('localChain:status', async () => chain.getStatus())
  handle('localChain:setUp', async () => syncNetwork(await chain.setUp()))
  handle('localChain:start', async () => syncNetwork(await chain.start()))
  handle('localChain:stop', async () => chain.stop())
  handle('localChain:reset', async () => {
    const s = await chain.reset()
    networks.clearLocalChainMemory()
    return syncNetwork(s)
  })
  handle('localChain:remove', async () => dropNetwork(await chain.remove()))
  handle('localChain:usePort', async (_e, port) => syncNetwork(await chain.usePort(int(port, 'port', LOCAL_CHAIN_PORT_MIN, LOCAL_CHAIN_PORT_MAX))))
  handle('localChain:setOptions', async (_e, options) => {
    const o = obj(options, 'options')
    return chain.setOptions({ webPages: bool(o.webPages, 'webPages'), startWithApp: bool(o.startWithApp, 'startWithApp') })
  })
  handle('localChain:openLog', async () => chain.openLog())
  // B109 points 4-5: sent by eosio and signed in the main process after the local chain guard.
  handle('localChain:accountExists', async (_e, name) => localAccountExists(chainName(name, 'account')))
  handle('localChain:createAccount', async (_e, input) => {
    const i = obj(input, 'input')
    return createLocalAccount({ name: chainName(i.name, 'name'), publicKey: str(i.publicKey, 'publicKey', 200) })
  })
  handle('localChain:giveTokens', async (_e, input) => {
    const i = obj(input, 'input')
    if (typeof i.amount !== 'number') throw new Error('amount: must be a number')
    return giveLocalTokens({ account: chainName(i.account, 'account'), amount: i.amount })
  })
}
