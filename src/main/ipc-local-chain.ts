// IPC handlers of the app's local chain (decision B108 point 7, B110 points 1-2): the window calls the
// process module, and the network entry follows the node's port and chain id.

import { dialog, type BrowserWindow } from 'electron'
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
import { copyContract, copyRead, copyTarget, defaultContractCopyDeps, type CopySignOutcome } from './contract-copy'
import { keepAnswer, preflight } from './ipc-tx'
import { signer, vault } from './keys-service'
import { getSettings } from './store'
import { openConfirmation } from './confirm-window'
import { afterCodeWindows, codeWindowOpen } from './key-windows'
import { failedSendError, fromNodeError } from './trace'
import type { ActionRequest } from './signer'
import { log } from './log'
import { sentStore } from './sent-store'

const CHAIN_ID_FORM = /^[0-9a-f]{64}$/

/** The vault-signed send of a copy's deployment: the same steps and confirmation as Deploy. */
async function signFromVault(win: BrowserWindow | null, networkId: string, actions: ActionRequest[]): Promise<CopySignOutcome> {
  preflight(win)
  if (codeWindowOpen()) {
    await new Promise<void>((resolve) => afterCodeWindows(resolve))
    preflight(win)
  }
  const { record, secret } = await signer().prepare({ networkId, actions, kind: 'deploy' })
  const outcome = await openConfirmation(win, record, secret)
  if (outcome.approved && getSettings().lockAfterSignature) vault().lock()
  if (outcome.approved) {
    keepAnswer(networkId, record, outcome.result.response)
    return { status: 'sent', transactionId: record.transactionId }
  }
  if (outcome.reason === 'error') {
    const ctx = { source: 'sent' as const, network: record.network.name, endpoint: record.endpoint }
    const trace = outcome.details ? fromNodeError(outcome.details, ctx, record.transactionId) : null
    return { status: 'failed', error: failedSendError(trace, outcome.error) }
  }
  return { status: 'cancelled' }
}

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

/** The kept answers of the local chain go with its data (B120 point 1). */
function forgetKept(): void {
  try {
    sentStore().clear(LOCAL_CHAIN_NETWORK_ID)
  } catch (e) {
    log.warn(`Kept answers of the local chain not removed: ${e instanceof Error ? e.message : 'unknown error'}`)
  }
}

function dropNetwork(s: LocalChainStatus): LocalChainStatus {
  try {
    if (networks.listNetworks().some((n) => n.id === LOCAL_CHAIN_NETWORK_ID)) networks.removeNetwork(LOCAL_CHAIN_NETWORK_ID)
  } catch (e) {
    log.warn(`Local chain network entry not removed: ${e instanceof Error ? e.message : 'unknown error'}`)
  }
  return s
}

/** The question B108 point 7 asks in the main process before Reset and Remove. */
export const RESET_QUESTION = {
  message: 'Reset the local chain?',
  detail: 'Reset makes a new empty chain with the same chain id. The accounts, contracts and tables on it are lost, and the stars and added tokens of Local chain are cleared.'
}
export const REMOVE_QUESTION = {
  message: 'Remove the local chain?',
  detail: 'Remove deletes the chain and its private Linux from this computer and takes Local chain out of the network list. The accounts and contracts on it are lost. Set up makes a new one.'
}

export function registerLocalChainIpc(getWindow: () => BrowserWindow | null): void {
  const ask = async (q: { message: string; detail: string }, button: string): Promise<boolean> => {
    const opts: Electron.MessageBoxOptions = { type: 'warning', buttons: [button, 'Cancel'], defaultId: 1, cancelId: 1, noLink: true, title: 'Local Chain', ...q }
    const win = getWindow()
    const r = win && !win.isDestroyed() ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
    return r.response === 0
  }
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
    if (!(await ask(RESET_QUESTION, 'Reset'))) return chain.getStatus()
    const s = await chain.reset()
    networks.clearLocalChainMemory()
    forgetKept()
    return syncNetwork(s)
  })
  handle('localChain:remove', async () => {
    if (!(await ask(REMOVE_QUESTION, 'Remove'))) return chain.getStatus()
    const s = await chain.remove()
    forgetKept()
    return dropNetwork(s)
  })
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
  // B111 points 1-4: read on the source network (nothing is signed there); a missing target is made by
  // eosio; the deployment is signed from the vault with the normal confirmation.
  const copyDeps = (): ReturnType<typeof defaultContractCopyDeps> => defaultContractCopyDeps((n, a) => signFromVault(getWindow(), n, a))
  handle('localChain:copyRead', async (_e, input) => {
    const i = obj(input, 'input')
    return copyRead({ networkId: str(i.networkId, 'networkId', 64), account: chainName(i.account, 'account') }, copyDeps())
  })
  handle('localChain:copyTarget', async (_e, target) => copyTarget(chainName(target, 'target'), copyDeps()))
  handle('localChain:copyContract', async (_e, input) => {
    const i = obj(input, 'input')
    const key = i.publicKey === undefined || i.publicKey === null || i.publicKey === '' ? undefined : str(i.publicKey, 'publicKey', 200)
    return copyContract(
      {
        networkId: str(i.networkId, 'networkId', 64),
        account: chainName(i.account, 'account'),
        target: chainName(i.target, 'target'),
        publicKey: key,
        replace: i.replace === undefined ? false : bool(i.replace, 'replace')
      },
      copyDeps()
    )
  })
}
