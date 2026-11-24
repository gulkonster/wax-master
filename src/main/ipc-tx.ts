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
import { simulate, probeSimulation } from './simulate'
import { fromHistory, fromNodeAnswer, fromNodeError, withResourceState } from './trace'
import { WAX_TESTNET_CHAIN, currentNetwork, endpointOf, getNetwork } from './networks'
import { chain, history } from './rpc'
import { clearCodeActions, deployActions, planDeploy } from './deploy'
import { BUSY_MESSAGE, LOCKED_MESSAGE, type ActionRequest, type PrepareKind } from './signer'
import { changeKeyActions, createAccountActions } from './accounts'
import { createTestnetAccount, randomTestnetName, requestTokens } from './faucet'
import { bool, int } from '../shared/validate'
import { withoutLockedCode } from '../shared/vault-locked'
import type { NetworkInfo } from '../shared/chain-types'
import { isUnknownAccount } from './account-pick'
import { linksFromAccount, linksFromHistory, parsePermissionIntent, planPermissionChange, readPermissions, type PlanContext } from './wallet-permissions'

const ACTION_NAME = /^[a-z1-5.]{1,12}[a-j1-5]?$/
/** Same limit as contract:pack. */
export const MAX_ACTION_DATA = 1024 * 1024

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
    let size: number
    try {
      size = JSON.stringify(o.data ?? null).length
    } catch {
      throw new Error(`actions[${i}].data: not valid JSON data`)
    }
    if (size > MAX_ACTION_DATA) throw new Error(`actions[${i}].data: too large`)
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

async function signAndSend(win: BrowserWindow | null, networkId: string, actions: ActionRequest[], kind: PrepareKind): Promise<TxOutcome> {
  preflight(win)
  const { record, secret } = await signer().prepare({ networkId, actions, kind })
  const outcome = await openConfirmation(win, record, secret)
  if (outcome.approved && getSettings().lockAfterSignature) vault().lock()
  const ctx = { source: 'sent' as const, network: record.network.name, endpoint: record.endpoint }
  if (outcome.approved) return { status: 'sent', trace: fromNodeAnswer(outcome.result.response, ctx) }
  if (outcome.reason === 'error') {
    const trace = outcome.details
      ? await addResources(fromNodeError(outcome.details, ctx, record.transactionId), record.actions[0]?.authorization[0]?.actor ?? '', record.endpoint)
      : null
    return {
      status: 'failed',
      // A CPU / NET / RAM refusal is said plainly; anything else keeps the node's message.
      // Without the locked-vault code: a failed send is never repeated after an unlock.
      error: withoutLockedCode(trace?.resource ? (trace.errorMessage ?? outcome.error ?? 'Failed') : (outcome.error ?? 'Failed')),
      trace
    }
  }
  return { status: 'cancelled' }
}

/** The faucet is for WAX Testnet only: keyed on its chain id, so any entry for that chain has it. */
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
  const accountData = await chain.getAccount(ep, account)
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
  handle('tx:open', async (_e, id) => {
    const trxId = str(id, 'id', 64)
    if (!/^[0-9a-f]{64}$/i.test(trxId)) throw new Error('A transaction id is 64 hex characters')
    const n = currentNetwork()
    if (!n.history) throw new Error(`${n.name} has no history service configured (Network > Manage Networks).`)
    const r = await history.getTransaction(n.history, trxId)
    if (!Array.isArray((r as { actions?: unknown[] }).actions) || ((r as { actions: unknown[] }).actions.length === 0)) {
      throw new Error('The history service does not know this transaction.')
    }
    return fromHistory(r, { network: n.name, endpoint: n.history })
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
  handle('deploy:simulate', async (_e, planId) => {
    // Simulation uses a copy of the plan's actions; the plan stays usable for Deploy.
    const id = str(planId, 'plan', 64)
    const { networkId, actions } = deployActions(id, { keep: true })
    const t = await simulate(actions, networkId)
    return addResources(t, firstAuthorizer(actions), t.endpoint)
  })
  handle('deploy:run', (_e, planId) => {
    const id = str(planId, 'plan', 64)
    // Checked before the plan is used up, so Deploy works again after unlocking.
    preflight(getWindow())
    const { networkId, actions } = deployActions(id)
    return signAndSend(getWindow(), networkId, actions, 'deploy')
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
    const account = await chain.getAccount(endpointOf(n), input.account)
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
