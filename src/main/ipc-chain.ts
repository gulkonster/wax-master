// IPC handlers for networks and chain reads.

import { dialog, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { arr, bool, int, obj, oneOf, optStr, str, chainName } from '../shared/validate'
import { handle } from './ipc'
import * as networks from './networks'
import { accountActions, accountView } from './account-view'
import { ContractHistory, getContractAbi, getContractDef, KEY_TYPES, packAction, queryRows } from './contract-view'
import { dataDir } from './paths'
import { chain, history, request } from './rpc'
import { vault } from './keys-service'
import { linksFromAccount, linksFromHistory } from './wallet-permissions'
import { chainAbiHashOf } from './deploy'
import { nameAuctions, nameBidLookup, powerupState, powerupStateRow, proxyInfo, systemFeatures, votingView } from './wallet-system'
import { bidNameProblem } from '../shared/name-bids'
import { checkActionsFilter } from '../shared/history-filter'
import type { AbiDef } from '../chain-core'
import { addedTokens, MAX_HISTORY_TOKENS, NETWORK_ID_FORM, precisionFromStats, TOKEN_SYMBOL, tokenBalance, walletTokens } from './wallet-tokens'

/** Public keys of the vault (empty when there is none or it cannot be read). */
function vaultPublicKeys(): string[] {
  try {
    return vault()
      .list()
      .map((k) => k.publicKey)
      .slice(0, 200)
  } catch {
    return []
  }
}
import { NetworkStatusPoller, networkStatus } from './network-status'
import { log } from './log'
import { sentStore } from './sent-store'
import { isUnknownAccount, plainAccountError } from './account-pick'
import { ramPriceError, readRamPrice } from './ram-price'
import { RAM_MAX_BUY } from '../shared/ram-market'
import type { AuthLevel, ContractHistoryKind, ContractHistoryList, ContractInfoView, LinkedActionsView } from '../shared/chain-types'

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
  return obj(v, 'data')
}

export function registerChainIpc(getWindow: () => BrowserWindow | null): void {
  networks.onEndpointSwitch((n, from, to) => {
    const text = networks.endpointSwitchText(n.name, from, to, networks.endpointOf(n))
    log.info(text)
    getWindow()?.webContents.send('network-changed', n, text)
  })

  // Status mark of the selected network; the checks start with the main window (index.ts).
  const status = networkStatus(
    () =>
      new NetworkStatusPoller({
        target: () => {
          const n = networks.currentNetwork()
          return { networkId: n.id, name: n.name, chainId: n.chainId, endpoint: networks.endpointOf(n) }
        },
        getInfo: (ep, timeoutMs) => request(ep, '/v1/chain/get_info', { body: {}, timeoutMs, retryStale: false }),
        now: () => Date.now(),
        setTimer: (fn, ms) => setTimeout(fn, ms),
        clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
        emit: (s) => {
          const win = getWindow()
          if (win && !win.isDestroyed()) win.webContents.send('network-status', s)
        },
        log: (line) => log.info(line)
      })
  )
  handle('network:status', () => status?.current())
  handle('network:watchFast', (_e, on) => {
    status?.setFast(bool(on, 'on'))
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
  handle('networks:remove', (_e, id) => {
    const netId = str(id, 'id', 64)
    const removed = networks.removeNetwork(netId)
    try {
      sentStore().clear(netId)
    } catch (e) {
      log.warn(`Network removed; its kept answers could not be deleted: ${e instanceof Error ? e.message : 'unknown error'}`)
    }
    return removed
  })
  handle('networks:removedDefaults', () => networks.removedDefaults())
  handle('networks:restoreDefaults', () => networks.restoreDefaults())
  handle('networks:chooseEndpoint', (_e, id, index) => networks.chooseEndpoint(str(id, 'id', 64), int(index, 'index', 0, 19)))
  // Starred accounts of the current network, or of the given one (the removal question names them).
  handle('networks:stars', (_e, id) => networks.stars(id === undefined ? networks.currentNetwork().id : networks.getNetwork(str(id, 'id', 64)).id))
  handle('networks:setStar', (_e, account, starred) =>
    networks.setStar(networks.currentNetwork().id, chainName(account, 'account'), starred === true)
  )
  handle('networks:setStarOrder', (_e, list) =>
    networks.setStarOrder(
      networks.currentNetwork().id,
      arr(list, 'accounts', 500).map((a, i) => chainName(a, `accounts[${i}]`))
    )
  )

  // The control badge: the vault's public keys (readable while it is locked) against the account's permissions.
  handle('chain:account', (_e, name) => accountView(chainName(name, 'account'), vaultPublicKeys()))

  // Wallet token list: core token, the history service's tokens, the tokens added for this network.
  handle('wallet:tokens', (_e, name) => {
    const acc = chainName(name, 'account')
    if (!acc) throw new Error('account: enter an account name')
    const n = networks.currentNetwork()
    return walletTokens(n, {
      coreBalance: () => networks.readCall((ep) => chain.getCurrencyBalance(ep, 'eosio.token', acc, n.symbol), n),
      balance: (contract, symbol) => networks.readCall((ep) => chain.getCurrencyBalance(ep, contract, acc, symbol), n),
      historyTokens: n.history ? () => history.getTokens(n.history!, acc, MAX_HISTORY_TOKENS) : undefined,
      added: addedTokens().list(n.id)
    })
  })
  // "Add token": the contract must have the token (its precision is read from the chain).
  handle('wallet:addToken', async (_e, contract, symbol) => {
    const code = chainName(contract, 'contract')
    if (!code) throw new Error('contract: enter the token contract')
    const sym = str(symbol, 'symbol', 7)
    if (!TOKEN_SYMBOL.test(sym)) throw new Error('symbol: 1 to 7 capital letters')
    const n = networks.currentNetwork()
    let stats: unknown
    try {
      stats = await networks.readCall((ep) => chain.getCurrencyStats(ep, code, sym), n)
    } catch (e) {
      throw new Error(`${code} has no token ${sym} on ${n.name}: ${e instanceof Error ? e.message.slice(0, 200) : 'no answer'}`)
    }
    const precision = precisionFromStats(stats, sym)
    if (precision === null) throw new Error(`${code} has no token ${sym} on ${n.name}.`)
    return addedTokens().add(n.id, { contract: code, symbol: sym, precision })
  })
  // The balance and precision of one token for a form that sends, read from the chain (never from the history service).
  handle('wallet:balance', (_e, account, contract, symbol) => {
    const acc = chainName(account, 'account')
    if (!acc) throw new Error('account: enter an account name')
    const code = chainName(contract, 'contract')
    if (!code) throw new Error('contract: enter the token contract')
    const sym = str(symbol, 'symbol', 7)
    if (!TOKEN_SYMBOL.test(sym)) throw new Error('symbol: 1 to 7 capital letters')
    const n = networks.currentNetwork()
    return tokenBalance(
      {
        balance: () => networks.readCall((ep) => chain.getCurrencyBalance(ep, code, acc, sym), n),
        stats: () => networks.readCall((ep) => chain.getCurrencyStats(ep, code, sym), n)
      },
      code,
      sym
    )
  })
  handle('wallet:removeToken', (_e, contract, symbol) => {
    const sym = str(symbol, 'symbol', 7)
    if (!TOKEN_SYMBOL.test(sym)) throw new Error('symbol: 1 to 7 capital letters')
    return addedTokens().remove(networks.currentNetwork().id, chainName(contract, 'contract'), sym)
  })
  // Linked actions: the node's get_account first, the history service when the node does not report them.
  handle('wallet:links', async (_e, name): Promise<LinkedActionsView> => {
    const acc = chainName(name, 'account')
    if (!acc) throw new Error('account: enter an account name')
    const n = networks.currentNetwork()
    const account = await networks.readCall((ep) => chain.getAccount(ep, acc), n).catch((e) => {
      throw plainAccountError(e, acc, n.name)
    })
    const fromNode = linksFromAccount(account)
    if (fromNode) return { rows: fromNode, source: 'node' }
    if (!n.history) return { rows: [], source: 'none' }
    return { rows: linksFromHistory(await history.getLinks(n.history, acc)), source: 'history' }
  })
  // Contract section: code hash, ABI hash and the last code update.
  handle('wallet:contractInfo', async (_e, name): Promise<ContractInfoView> => {
    const acc = chainName(name, 'account')
    if (!acc) throw new Error('account: enter an account name')
    const n = networks.currentNetwork()
    const a = await networks.readCall((ep) => chain.getAccount(ep, acc), n).catch((e) => {
      throw plainAccountError(e, acc, n.name)
    })
    const raw = await networks.readCall((ep) => chain.getRawAbi(ep, acc), n)
    const hash = (v: unknown): string => (typeof v === 'string' && /^[0-9a-f]{64}$/.test(v) && !/^0+$/.test(v) ? v : '')
    const codeHash = hash(raw.code_hash)
    const last = typeof a.last_code_update === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]+$/.test(a.last_code_update) ? a.last_code_update : ''
    return { hasCode: codeHash !== '', codeHash, abiHash: hash(chainAbiHashOf({ abi_hash: typeof raw.abi_hash === 'string' ? raw.abi_hash : undefined, abi: typeof raw.abi === 'string' ? raw.abi : undefined })), lastCodeUpdate: codeHash && !last.startsWith('1970-') ? last : '' }
  })
  // The tokens added for the current network, or for a named one (the question before a network is removed).
  handle('wallet:addedTokens', (_e, networkId) => {
    const id = optStr(networkId, 'network', 64)
    if (id !== undefined && !NETWORK_ID_FORM.test(id)) throw new Error('network: not a network id')
    return addedTokens().list(id ?? networks.currentNetwork().id)
  })
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
  handle('chain:actions', (_e, name, skip, filter) => {
    const acc = chainName(name, 'account')
    if (!acc) throw new Error('account: enter an account name')
    return accountActions(acc, int(skip, 'skip', 0, 1_000_000), checkActionsFilter(filter))
  })
  // System contract features of the current network (voting, PowerUp), read from the eosio ABI.
  handle('wallet:system', async () => {
    const n = networks.currentNetwork()
    let def: AbiDef | null
    try {
      def = await getContractDef(n, 'eosio', networks.readCall)
    } catch {
      def = null
    }
    return systemFeatures(def, () => powerupStateRow(n, networks.readCall))
  })
  // Voting and rewards of an account: active producers, its current vote, the claims the ABI offers.
  handle('wallet:voting', async (_e, name) => {
    const acc = chainName(name, 'account')
    if (!acc) throw new Error('account: enter an account name')
    const n = networks.currentNetwork()
    const def = await getContractDef(n, 'eosio', networks.readCall)
    if (!def.actions.some((x) => x.name === 'voteproducer')) throw new Error(`The system contract of ${n.name} offers no voting.`)
    return votingView(n, def, acc, networks.readCall)
  })
  // Whether an account is registered as a proxy (read-only: its row of the voters table).
  handle('wallet:proxyInfo', (_e, name) => {
    const acc = chainName(name, 'account')
    if (!acc) throw new Error('account: enter an account name')
    return proxyInfo(networks.currentNetwork(), acc, networks.readCall)
  })
  // Name bids: one name for one account (the account of that name, its auction row, the account's refund row).
  handle('wallet:nameBid', (_e, name, account) => {
    const nm = chainName(name, 'name')
    const problem = bidNameProblem(nm)
    if (problem) throw new Error(`name: ${problem}`)
    const acc = chainName(account, 'account')
    if (!acc) throw new Error('account: enter an account name')
    return nameBidLookup(networks.currentNetwork(), nm, acc, networks.readCall)
  })
  // Name bids: the open auctions, highest bid first, and the chain's last close. Read on request only.
  handle('wallet:nameAuctions', () => nameAuctions(networks.currentNetwork(), networks.readCall))
  // The PowerUp market (powup.state) of the current network; null when the chain has none.
  handle('wallet:powerup', () => powerupState(networks.currentNetwork(), networks.readCall))
  // RAM price of the current network for `bytes` (0: the market only); buyrambytes takes a uint32.
  handle('chain:ramPrice', (_e, bytes) => {
    const b = int(bytes, 'bytes', 0, RAM_MAX_BUY)
    return networks.readCall((ep) => readRamPrice(b, (body) => chain.getTableRows(ep, body))).catch((e) => {
      throw ramPriceError(e)
    })
  })

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
