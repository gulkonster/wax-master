// IPC for running, simulating and inspecting transactions, and for deploying.
// Every signature goes through signer.prepare -> confirmation window -> approve.

import type { BrowserWindow } from 'electron'
import type { PermissionLevel } from '../chain-core'
import type { InspectedTransaction } from '../shared/trace-types'
import { arr, chainName, obj, oneOf, optStr, str } from '../shared/validate'
import { handle } from './ipc'
import { signer, vault } from './keys-service'
import { getSettings } from './store'
import { focusOpenConfirmation, hasOpenConfirmation, openConfirmation } from './confirm-window'
import { afterCodeWindows, codeWindowOpen } from './key-windows'
import { simulate, probeSimulation } from './simulate'
import { blockTransaction, failedSendError, fromHistory, fromKept, fromNodeAnswer, fromNodeError, signedActionCount, withBlock, withResourceState } from './trace'
import { KEPT_PER_NETWORK, sentStore, type KeptFile } from './sent-store'
import { WAX_TESTNET_CHAIN, currentNetwork, endpointOf, getNetwork } from './networks'
import { chain, history } from './rpc'
import { clearCodeActions, deployActions, planDeploy } from './deploy'
import { BUSY_MESSAGE, LOCKED_MESSAGE, type ActionRequest, type ApprovalRecord, type PrepareKind, type PrepareRequest } from './signer'
import { changeKeyActions, createAccountActions } from './accounts'
import { createTestnetAccount, randomTestnetName, requestTokens } from './faucet'
import { bool, int } from '../shared/validate'
import { withoutLockedCode } from '../shared/vault-locked'
import type { NetworkInfo } from '../shared/chain-types'
import { isUnknownAccount, plainAccountError } from './account-pick'
import { linksFromAccount, linksFromHistory, parsePermissionIntent, planPermissionChange, readPermissions, type PlanContext } from './wallet-permissions'

const ACTION_NAME = /^[a-z1-5.]{1,12}[a-j1-5]?$/
/** Same limit as contract:pack. */

export function parseActions(raw: unknown): ActionRequest[] {
  return arr(raw, 'actions', 20).map((a, i) => {
    const o = obj(a, `actions[${i}]`)
    const name = str(o.name, `actions[${i}].name`, 13)
    if (!ACTION_NAME.test(name)) throw new Error(`actions[${i}].name: not a valid action name`)
    const authorization: PermissionLevel[] = arr(o.authorization, `actions[${i}].authorization`, 10).map((x, j) => {
      const p = obj(x, `authorization[${j}]`)
      return { actor: chainName(p.actor, 'actor'), permission: chainName(p.permission, 'permission') }
    })
    if (authorization.length === 0) throw new Error('Authorization is required')
    try {
      JSON.stringify(o.data ?? null)
    } catch {
      throw new Error(`actions[${i}].data: not valid JSON data`)
    }
    return { account: chainName(o.account, `actions[${i}].account`), name, authorization, data: o.data }
  })
}

export type TxOutcome =
  | { status: 'sent'; trace: InspectedTransaction }
  | { status: 'failed'; trace: InspectedTransaction | null; error: string }
  | { status: 'cancelled' }

/**
 * Stops before any window: a locked vault (the typed `vault-locked` error; the
 * editor asks for the password in place and repeats the request) or a
 * confirmation that is already open (it comes to the front).
 */
export function preflight(_win: BrowserWindow | null): void {
  if (!vault().isUnlocked()) throw new Error(LOCKED_MESSAGE)
  if (hasOpenConfirmation() || signer().busy()) {
    focusOpenConfirmation()
    throw new Error(BUSY_MESSAGE)
  }
}

/** Account and endpoint whose resources explain a CPU / NET / RAM refusal. */
function firstAuthorizer(actions: ActionRequest[]): string {
  return actions[0]?.authorization[0]?.actor ?? ''
}

async function addResources(t: InspectedTransaction, account: string, endpoint: string): Promise<InspectedTransaction> {
  return withResourceState(t, account, (a) => chain.getAccount(endpoint, a))
}

/**
 * Keeps the node's answer of an accepted send, so Open Transaction by Id can show it again.
 * A failed write never fails the send: it is logged and gives false.
 */
export function keepAnswer(
  networkId: string,
  record: Pick<ApprovalRecord, 'transactionId' | 'endpoint'> & { network: { name: string }; actions: { account: string; name: string }[] },
  response: unknown
): boolean {
  return sentStore().keep(
    networkId,
    record.transactionId,
    {
      network: record.network.name,
      endpoint: record.endpoint,
      first: record.actions[0] ? `${record.actions[0].account}::${record.actions[0].name}` : '',
      count: record.actions.length
    },
    response
  )
}

async function signAndSend(
  win: BrowserWindow | null,
  networkId: string,
  actions: ActionRequest[],
  kind: PrepareKind,
  sequence?: PrepareRequest['sequence'],
  build?: PrepareRequest['build']
): Promise<TxOutcome> {
  preflight(win)
  // A recovery code on screen (the unlock just converted the vault): the transaction
  // is built and confirmed only after its window is closed, so the confirmation
  // never covers the code and its time to approve starts then.
  if (codeWindowOpen()) {
    await new Promise<void>((resolve) => afterCodeWindows(resolve))
    preflight(win)
  }
  const { record, secret } = await signer().prepare({ networkId, actions, kind, sequence, build })
  const outcome = await openConfirmation(win, record, secret)
  if (outcome.approved && getSettings().lockAfterSignature) vault().lock()
  const ctx = { source: 'sent' as const, network: record.network.name, endpoint: record.endpoint }
  if (outcome.approved) {
    const kept = keepAnswer(networkId, record, outcome.result.response)
    const trace = fromNodeAnswer(outcome.result.response, ctx)
    return { status: 'sent', trace: { ...trace, hasKept: kept, hasHistory: hasHistoryService(networkId) } }
  }
  if (outcome.reason === 'error') {
    const trace = outcome.details
      ? await addResources(fromNodeError(outcome.details, ctx, record.transactionId), record.actions[0]?.authorization[0]?.actor ?? '', record.endpoint)
      : null
    return {
      status: 'failed',
      // A CPU / NET / RAM refusal is said plainly; anything else keeps the node's message.
      // Without the locked-vault code: a failed send is never repeated after an unlock.
      error: withoutLockedCode(failedSendError(trace, outcome.error)),
      trace
    }
  }
  return { status: 'cancelled' }
}

function hasHistoryService(networkId: string): boolean {
  try {
    return !!getNetwork(networkId).history
  } catch {
    return false
  }
}

/** What `tx:open` reads from; injected in tests. */
export interface OpenSources {
  network: NetworkInfo
  kept: (networkId: string, id: string) => KeptFile | null
  historyV2: (hist: string, id: string) => Promise<Record<string, unknown>>
  historyV1: (hist: string, id: string, blockNumHint: number) => Promise<Record<string, unknown>>
  block: (endpoint: string, blockNum: number) => Promise<Record<string, unknown>>
}

export const NOT_KNOWN_MESSAGE = 'The history service does not know this transaction. One sent a moment ago can take some seconds to appear.'
export function noSourceMessage(network: string): string {
  return `${network} has no history service, and this transaction was not sent from WAX Master on this computer. Add a history service in Network > Manage Networks.`
}

/**
 * The kept answer of the current network first, then the history
 * service; `from` forces one source. From history, the v1 read (RAM per trace) and
 * the block read (the signed transaction) run at once and may fail.
 */
export async function openTransaction(id: string, from: 'kept' | 'history' | undefined, src: OpenSources): Promise<InspectedTransaction> {
  const trxId = id.toLowerCase()
  const n = src.network
  let kept: KeptFile | null = null
  try {
    kept = src.kept(n.id, trxId)
  } catch {
    kept = null
  }
  const hasHistory = !!n.history
  if (from !== 'history' && kept) return { ...fromKept(kept), hasKept: true, hasHistory }
  if (from === 'kept') throw new Error(`WAX Master no longer has the node's answer of this transaction on ${n.name}. It keeps the latest ${KEPT_PER_NETWORK} it sent on each network.`)
  if (!n.history) throw new Error(from === 'history' ? `${n.name} has no history service. Add one in Network > Manage Networks.` : noSourceMessage(n.name))
  const hist = n.history
  const r = await src.historyV2(hist, trxId)
  const list = (r as { actions?: unknown }).actions
  if (!Array.isArray(list) || list.length === 0) throw new Error(NOT_KNOWN_MESSAGE)
  const blockNum = list
    .map((a) => Number((a as { block_num?: unknown } | null)?.block_num))
    .find((b) => Number.isInteger(b) && b > 0)
  let v1: unknown
  let entry: Record<string, unknown> | null = null
  if (blockNum !== undefined) {
    const [a, b] = await Promise.allSettled([src.historyV1(hist, trxId, blockNum), src.block(endpointOf(n), blockNum)])
    if (a.status === 'fulfilled') v1 = a.value
    if (b.status === 'fulfilled') entry = blockTransaction(b.value, trxId)
  }
  const t = fromHistory(r, { network: n.name, endpoint: hist }, { v1, signedActions: signedActionCount(entry) })
  return { ...withBlock(t, entry), hasKept: !!kept, hasHistory: true }
}

/** The faucet is for WAX Testnet only:keyed on its chain id, so any entry for that chain has it. */
function requireWaxTestnet(): void {
  const n = currentNetwork()
  if (n.chainId !== WAX_TESTNET_CHAIN) throw new Error('Switch to WAX Testnet first.')
}

/** Public keys of the vault (readable while it is locked; empty when there is none). */
function vaultKeys(): string[] {
  try {
    return vault()
      .list()
      .map((k) => k.publicKey)
  } catch {
    return []
  }
}

/**
 * What a permission change is built from: the account read from the endpoint the
 * signer will use, the vault's public keys, and lookups on the same endpoint.
 */
export async function permissionContext(n: NetworkInfo, account: string): Promise<PlanContext> {
  const ep = endpointOf(n)
  const accountData = await chain.getAccount(ep, account).catch((e) => {
    throw plainAccountError(e, account, n.name)
  })
  let historyLinks = null
  if (!linksFromAccount(accountData) && n.history) {
    try {
      historyLinks = linksFromHistory(await history.getLinks(n.history, account))
    } catch {
      historyLinks = null
    }
  }
  return {
    accountData,
    vaultKeys: vaultKeys(),
    historyLinks,
    levelExists: async (actor, permission) => {
      try {
        return readPermissions(await chain.getAccount(ep, actor)).some((p) => p.name === permission)
      } catch (e) {
        if (isUnknownAccount(e)) return false
        throw e
      }
    },
    actionExists: async (code, action) => {
      const r = await chain.getAbi(ep, code)
      const actions = (r.abi as { actions?: unknown } | undefined)?.actions
      return Array.isArray(actions) && actions.some((a) => (a as { name?: unknown } | null)?.name === action)
    }
  }
}

export function registerTxIpc(getWindow: () => BrowserWindow | null): void {
  // The confirmation's title is made by the signer from the decoded actions; the editor sends only the actions.
  handle('tx:run', (_e, actions) => signAndSend(getWindow(), currentNetwork().id, parseActions(actions), 'run'))
  handle('tx:simulate', async (_e, actions) => {
    const acts = parseActions(actions)
    const t = await simulate(acts)
    return addResources(t, firstAuthorizer(acts), t.endpoint)
  })
  handle('tx:simulationSupport', () => probeSimulation(endpointOf(currentNetwork())))
  handle('tx:open', async (_e, id, from) => {
    const trxId = str(id, 'id', 64)
    if (!/^[0-9a-f]{64}$/i.test(trxId)) throw new Error('A transaction id is 64 hex characters')
    const source = from === undefined || from === null ? undefined : oneOf(from, 'from', ['kept', 'history'] as const)
    return openTransaction(trxId, source, {
      network: currentNetwork(),
      kept: (networkId, tx) => sentStore().read(networkId, tx),
      historyV2: history.getTransaction,
      historyV1: history.getTransactionV1,
      block: (ep, num) => chain.getBlock(ep, num)
    })
  })
  handle('tx:kept', () => {
    try {
      return sentStore().list(currentNetwork().id, 20)
    } catch {
      return []
    }
  })

  handle('deploy:plan', (_e, input) => {
    const o = obj(input, 'deploy')
    return planDeploy({
      networkId: optStr(o.networkId, 'networkId', 64),
      account: chainName(o.account, 'account'),
      permission: chainName(o.permission, 'permission'),
      target: oneOf(o.target, 'target', ['both', 'wasm', 'abi'] as const)
    })
  })
  handle('deploy:simulate', async (_e, planId, part) => {
    // Simulation uses a copy of the plan's actions; the plan stays usable for Deploy.
    const id = str(planId, 'plan', 64)
    const p = part === undefined || part === null ? undefined : oneOf(part, 'part', ['code', 'abi'] as const)
    const { networkId, actions } = deployActions(id, { keep: true, part: p })
    const t = await simulate(actions, networkId)
    return addResources(t, firstAuthorizer(actions), t.endpoint)
  })
  handle('deploy:run', (_e, planId, part) => {
    const id = str(planId, 'plan', 64)
    const p = part === undefined || part === null ? undefined : oneOf(part, 'part', ['code', 'abi'] as const)
    // Checked before the plan is used up, so Deploy works again after unlocking.
    preflight(getWindow())
    const { networkId, actions, sequence, build } = deployActions(id, { part: p })
    return signAndSend(getWindow(), networkId, actions, 'deploy', sequence, build ?? undefined)
  })
  handle('accounts:clearCode', (_e, account, permission) => {
    const acc = chainName(account, 'account')
    const n = getNetwork(currentNetwork().id)
    return signAndSend(getWindow(), n.id, clearCodeActions(acc, chainName(permission, 'permission')), 'clearCode')
  })
  handle('accounts:create', (_e, raw) => {
    const o = obj(raw, 'account')
    const input = {
      creator: chainName(o.creator, 'creator'),
      creatorPermission: chainName(o.creatorPermission, 'permission'),
      name: chainName(o.name, 'name'),
      ownerKey: str(o.ownerKey, 'ownerKey', 120),
      activeKey: str(o.activeKey, 'activeKey', 120),
      ramBytes: int(o.ramBytes, 'ramBytes', 0, 100 * 1024 * 1024),
      stakeCpu: str(o.stakeCpu, 'stakeCpu', 40),
      stakeNet: str(o.stakeNet, 'stakeNet', 40),
      transfer: bool(o.transfer, 'transfer')
    }
    return signAndSend(getWindow(), currentNetwork().id, createAccountActions(input), 'createAccount')
  })
  handle('accounts:changeKey', async (_e, raw) => {
    const o = obj(raw, 'change')
    const input = {
      account: chainName(o.account, 'account'),
      permission: chainName(o.permission, 'permission'),
      oldKey: str(o.oldKey, 'oldKey', 120),
      newKey: str(o.newKey, 'newKey', 120),
      signWith: chainName(o.signWith, 'signWith')
    }
    preflight(getWindow())
    // The permission is read here, from the endpoint the signer will use; only one key changes.
    const n = currentNetwork()
    const account = await chain.getAccount(endpointOf(n), input.account).catch((e) => {
      throw plainAccountError(e, input.account, n.name)
    })
    return signAndSend(getWindow(), n.id, changeKeyActions(input, account), 'changeKey')
  })

  // Permission changes: the editor sends an intent; the authority is built here from the chain.
  handle('wallet:permPreview', async (_e, rawIntent, signWith) => {
    const intent = parsePermissionIntent(rawIntent)
    const sign = chainName(signWith, 'signWith')
    return planPermissionChange(intent, sign, await permissionContext(currentNetwork(), intent.account))
  })
  handle('wallet:permSend', async (_e, rawIntent, signWith, basis) => {
    const intent = parsePermissionIntent(rawIntent)
    const sign = chainName(signWith, 'signWith')
    const shown = str(basis, 'basis', 64)
    preflight(getWindow())
    const n = currentNetwork()
    const plan = await planPermissionChange(intent, sign, await permissionContext(n, intent.account))
    if (plan.basis !== shown) throw new Error('The permissions of this account changed since the change was shown. Review it again; nothing was prepared.')
    return signAndSend(getWindow(), n.id, [plan.action], 'run')
  })

  // WAX Testnet faucet (only on the WAX Testnet chain; keys go into the vault in this process).
  handle('faucet:create', async (_e, name) => {
    requireWaxTestnet()
    const n = str(name, 'name', 12)
    // The keys go into the vault: a locked vault is asked for before the faucet is called.
    if (!vault().isUnlocked()) throw new Error(LOCKED_MESSAGE)
    return createTestnetAccount(n, vault())
  })
  handle('faucet:tokens', async (_e, name) => {
    requireWaxTestnet()
    return requestTokens(chainName(name, 'name'))
  })
  handle('faucet:suggestName', () => randomTestnetName())
}
