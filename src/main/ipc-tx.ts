// IPC for running, simulating and inspecting transactions, and for deploying.
// Every signature goes through signer.prepare -> confirmation window -> approve.

import type { BrowserWindow } from 'electron'
import type { PermissionLevel } from '../chain-core'
import type { InspectedTransaction } from '../shared/trace-types'
import { arr, chainName, obj, oneOf, optStr, str } from '../shared/validate'
import { handle } from './ipc'
import { signer, vault } from './keys-service'
import { getSettings } from './store'
import { openConfirmation } from './confirm-window'
import { simulate, probeSimulation } from './simulate'
import { fromHistory, fromNodeAnswer, fromNodeError } from './trace'
import { currentNetwork, endpointOf, getNetwork } from './networks'
import { history } from './rpc'
import { clearCodeActions, deployActions, planDeploy } from './deploy'
import type { ActionRequest, DeployArtifacts } from './signer'
import { changeKeyActions, createAccountActions } from './accounts'
import { arr as list, bool, int } from '../shared/validate'

const ACTION_NAME = /^[a-z1-5.]{1,12}[a-j1-5]?$/

function parseActions(raw: unknown): ActionRequest[] {
  return arr(raw, 'actions', 20).map((a, i) => {
    const o = obj(a, `actions[${i}]`)
    const name = str(o.name, `actions[${i}].name`, 13)
    if (!ACTION_NAME.test(name)) throw new Error(`actions[${i}].name: not a valid action name`)
    const authorization: PermissionLevel[] = arr(o.authorization, `actions[${i}].authorization`, 10).map((x, j) => {
      const p = obj(x, `authorization[${j}]`)
      return { actor: chainName(p.actor, 'actor'), permission: chainName(p.permission, 'permission') }
    })
    if (authorization.length === 0) throw new Error('Authorization is required')
    return { account: chainName(o.account, `actions[${i}].account`), name, authorization, data: o.data }
  })
}

export type TxOutcome =
  | { status: 'sent'; trace: InspectedTransaction }
  | { status: 'failed'; trace: InspectedTransaction | null; error: string }
  | { status: 'cancelled' }

async function signAndSend(
  win: BrowserWindow | null,
  networkId: string,
  actions: ActionRequest[],
  purpose: string,
  artifacts?: DeployArtifacts
): Promise<TxOutcome> {
  const { record, secret } = await signer().prepare({ networkId, actions, purpose, artifacts })
  const outcome = await openConfirmation(win, record, secret)
  if (outcome.approved && getSettings().lockAfterSignature) vault().lock()
  const ctx = { source: 'sent' as const, network: record.network.name, endpoint: record.endpoint }
  if (outcome.approved) return { status: 'sent', trace: fromNodeAnswer(outcome.result.response, ctx) }
  if (outcome.reason === 'error') {
    return {
      status: 'failed',
      error: outcome.error ?? 'Failed',
      trace: outcome.details ? fromNodeError(outcome.details, ctx, record.transactionId) : null
    }
  }
  return { status: 'cancelled' }
}

export function registerTxIpc(getWindow: () => BrowserWindow | null): void {
  handle('tx:run', (_e, actions, purpose) =>
    signAndSend(getWindow(), currentNetwork().id, parseActions(actions), str(purpose, 'purpose', 120))
  )
  handle('tx:simulate', (_e, actions) => simulate(parseActions(actions)))
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
    return simulate(actions, networkId)
  })
  handle('deploy:run', (_e, planId) => {
    const { networkId, actions, artifacts } = deployActions(str(planId, 'plan', 64))
    return signAndSend(getWindow(), networkId, actions, `Deploy to ${actions[0]?.authorization[0]?.actor ?? ''}`, artifacts)
  })
  handle('accounts:clearCode', (_e, account, permission) => {
    const acc = chainName(account, 'account')
    const n = getNetwork(currentNetwork().id)
    return signAndSend(getWindow(), n.id, clearCodeActions(acc, chainName(permission, 'permission')), `Clear contract code of ${acc}`)
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
    return signAndSend(getWindow(), currentNetwork().id, createAccountActions(input), `Create account ${input.name}`)
  })
  handle('accounts:changeKey', (_e, raw) => {
    const o = obj(raw, 'change')
    const input = {
      account: chainName(o.account, 'account'),
      permission: chainName(o.permission, 'permission'),
      parent: o.parent === '' ? '' : chainName(o.parent, 'parent'),
      signWith: chainName(o.signWith, 'signWith'),
      newKey: str(o.newKey, 'newKey', 120),
      keepAccounts: list(o.keepAccounts, 'keepAccounts', 20).map((x, i) => {
        const a = obj(x, `keepAccounts[${i}]`)
        const perm = obj(a.permission, 'permission')
        return { permission: { actor: chainName(perm.actor, 'actor'), permission: chainName(perm.permission, 'permission') }, weight: int(a.weight, 'weight', 0, 65535) }
      }),
      keepWaits: list(o.keepWaits, 'keepWaits', 20).map((x, i) => {
        const w = obj(x, `keepWaits[${i}]`)
        return { wait_sec: int(w.wait_sec, 'wait_sec', 0, 2 ** 31), weight: int(w.weight, 'weight', 0, 65535) }
      })
    }
    return signAndSend(getWindow(), currentNetwork().id, changeKeyActions(input), `Change key of ${input.account}@${input.permission}`)
  })
}
