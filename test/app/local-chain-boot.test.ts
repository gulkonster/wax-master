import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '', isPackaged: false, getAppPath: () => process.cwd() } }))

import {
  generatePrivateKey,
  hexToBytes,
  privateKeyToString,
  publicFromPrivate,
  publicKeyToString,
  recoverPublicKey,
  parseSignature,
  signingDigest,
  unpackTransaction
} from '../../src/chain-core'
import {
  LOCAL_CHAIN_SYSTEM_ACCOUNTS,
  bootstrapPlan,
  chooseFeatures,
  configIni,
  genesisJson,
  genesisTimestamp,
  type SupportedFeature
} from '../../src/shared/local-chain-config'
import { bootstrap, localChainPort, readFeatureNames, type BootDeps } from '../../src/main/local-chain-boot'

const RESOURCES = join(process.cwd(), 'resources', 'local-chain')

function newKey(): { priv: string; pub: string } {
  const k = generatePrivateKey()
  return { priv: privateKeyToString(k), pub: publicKeyToString(publicFromPrivate(k)) }
}

const digest = (n: number): string => n.toString(16).padStart(64, '0')
const feature = (name: string, n: number, deps: number[] = []): SupportedFeature => ({
  feature_digest: digest(n),
  dependencies: deps.map(digest),
  specification: [{ name: 'builtin_feature_codename', value: name }]
})

describe('genesis and config.ini', () => {
  it('builds the genesis around the system key', () => {
    const { pub } = newKey()
    const ts = genesisTimestamp(new Date('2026-11-25T17:00:00.789Z'))
    expect(ts).toBe('2026-11-25T17:00:00.000')
    const g = JSON.parse(genesisJson(pub, ts))
    expect(g.initial_key).toBe(pub)
    expect(g.initial_timestamp).toBe(ts)
    expect(g.initial_configuration.max_transaction_net_usage).toBe(524288)
    expect(() => genesisJson(pub, '2026-11-25')).toThrow()
    expect(() => genesisJson('nonsense', ts)).toThrow()
  })

  it('writes the lines of the config with the http-alias and no producer API', () => {
    const { priv, pub } = newKey()
    const text = configIni({ port: 8890, publicKey: pub, privateKey: priv, webPages: false })
    const lines = text.trim().split('\n')
    expect(lines).toEqual([
      'plugin = eosio::chain_api_plugin',
      'producer-name = eosio',
      'enable-stale-production = true',
      `signature-provider = ${pub}=KEY:${priv}`,
      'http-server-address = 127.0.0.1:8890',
      'http-alias = localhost:8890',
      'p2p-listen-endpoint =',
      'contracts-console = true',
      'enable-account-queries = true'
    ])
    expect(text).not.toContain('producer_api')
    expect(text).not.toContain('net_plugin')
    // The node loads its net plugin anyway; an empty listen endpoint keeps it from listening.
    expect(lines.filter((l) => l.startsWith('p2p-'))).toEqual(['p2p-listen-endpoint ='])
    expect(text).not.toContain('0.0.0.0')
    expect(configIni({ port: 8890, publicKey: pub, privateKey: priv, webPages: true })).toContain('access-control-allow-origin = *')
    expect(() => configIni({ port: 0, publicKey: pub, privateKey: priv, webPages: false })).toThrow()
    expect(() => configIni({ port: 8888, publicKey: priv, privateKey: pub, webPages: false })).toThrow()
  })
})

describe('feature choice', () => {
  const supported = [feature('PREACTIVATE_FEATURE', 1), feature('GET_SENDER', 2, [1]), feature('WTMSIG_BLOCK_SIGNATURES', 3, [1]), feature('NEEDS_X', 4, [9])]

  it('takes the wanted names in their order, PREACTIVATE apart, and skips what the node lacks', () => {
    const c = chooseFeatures(['PREACTIVATE_FEATURE', 'WTMSIG_BLOCK_SIGNATURES', 'UNKNOWN_ONE', 'GET_SENDER', 'NEEDS_X'], supported)
    expect(c.preactivate).toEqual({ name: 'PREACTIVATE_FEATURE', digest: digest(1) })
    expect(c.activate.map((f) => f.name)).toEqual(['WTMSIG_BLOCK_SIGNATURES', 'GET_SENDER'])
    expect(c.skipped.map((s) => s.name)).toEqual(['UNKNOWN_ONE', 'NEEDS_X'])
    expect(c.skipped[0].reason).toContain('does not know')
  })

  it('skips a feature whose dependency comes later in the list', () => {
    const c = chooseFeatures(['GET_SENDER', 'PREACTIVATE_FEATURE'], supported)
    expect(c.activate).toEqual([])
    expect(c.skipped[0].name).toBe('GET_SENDER')
  })

  it('reads features.json as a list or as { features }', () => {
    expect(readFeatureNames(['A_B'])).toEqual(['A_B'])
    expect(readFeatureNames({ features: ['A_B', { name: 'C' }] })).toEqual(['A_B', 'C'])
    expect(() => readFeatureNames({})).toThrow()
    expect(() => readFeatureNames(['bad name'])).toThrow()
  })
})

describe('bootstrap plan', () => {
  it('follows the bootstrap order with setpriv after the system contract', () => {
    const c = chooseFeatures(['PREACTIVATE_FEATURE', 'GET_SENDER'], [feature('PREACTIVATE_FEATURE', 1), feature('GET_SENDER', 2, [1])])
    const plan = bootstrapPlan(c)
    expect(plan.map((s) => (s.kind === 'deploy' ? `deploy ${s.contract}` : s.kind))).toEqual([
      'preactivate',
      'deploy eosio.boot',
      'activate',
      'actions',
      'deploy eosio.token',
      'actions',
      'deploy eosio.msig',
      'deploy eosio.system',
      'actions'
    ])
    const acts = plan.flatMap((s) => (s.kind === 'deploy' || s.kind === 'preactivate' ? [] : s.actions))
    const created = acts.filter((a) => a.name === 'newaccount').map((a) => a.data.name)
    expect(created).toEqual([...LOCAL_CHAIN_SYSTEM_ACCOUNTS])
    for (const n of ['eosio.bpay', 'eosio.msig', 'eosio.names', 'eosio.ram', 'eosio.ramfee', 'eosio.saving', 'eosio.stake', 'eosio.token', 'eosio.vpay', 'eosio.rex']) {
      expect(created).toContain(n)
    }
    expect(acts.find((a) => a.name === 'create')?.data).toEqual({ issuer: 'eosio', maximum_supply: '10000000000.00000000 WAX' })
    expect(acts.find((a) => a.name === 'issue')?.data).toMatchObject({ to: 'eosio', quantity: '1000000000.00000000 WAX' })
    expect(acts.find((a) => a.name === 'init')?.data).toEqual({ version: 0, core: '8,WAX' })
    expect(acts.find((a) => a.name === 'setpriv')?.data).toEqual({ account: 'eosio.msig', is_priv: 1 })
    expect(() => bootstrapPlan({ preactivate: null, activate: [], skipped: [] })).toThrow()
  })
})

describe('guard', () => {
  it('takes only http://127.0.0.1 on a local chain port', () => {
    expect(localChainPort('http://127.0.0.1:8888')).toBe(8888)
    expect(localChainPort('http://127.0.0.1:8899/', { port: 8899, networkId: 'local-chain' })).toBe(8899)
    for (const bad of ['http://localhost:8888', 'https://127.0.0.1:8888', 'http://127.0.0.1:9000', 'http://127.0.0.1', 'http://10.0.0.1:8888', 'http://127.0.0.1:8888/v1']) {
      expect(() => localChainPort(bad), bad).toThrow()
    }
    expect(() => localChainPort('http://127.0.0.1:8888', { port: 8889 })).toThrow()
    expect(() => localChainPort('http://127.0.0.1:8888', { networkId: 'wax-testnet' })).toThrow()
  })
})

// ---------------------------------------------------------------- a fake node

const FEATURES = [
  feature('PREACTIVATE_FEATURE', 1),
  feature('ONLY_LINK_TO_EXISTING_PERMISSION', 2, [1]),
  feature('WTMSIG_BLOCK_SIGNATURES', 3, [1]),
  feature('SAVANNA', 4, [1])
]

function fakeNode(systemPub: string, opts: { chainId?: string; activeAtStart?: string[] } = {}) {
  const chainId = opts.chainId ?? 'ab'.repeat(32)
  const active: string[] = [...(opts.activeAtStart ?? [])]
  const pending: string[] = []
  const sent: string[][] = []
  const signers: string[] = []
  let head = 10
  const tick = (): void => {
    head++
    active.push(...pending.splice(0))
  }
  const request = async <T>(_ep: string, path: string, body: unknown): Promise<T> => {
    const b = body as Record<string, unknown>
    let r: unknown
    switch (path) {
      case '/v1/chain/get_info':
        tick()
        r = { chain_id: chainId, head_block_num: head, head_block_id: head.toString(16).padStart(8, '0') + '11'.repeat(28), head_block_time: '2026-11-25T17:00:00.000', last_irreversible_block_num: head, last_irreversible_block_id: '' }
        break
      case '/v1/chain/get_account':
        r = { permissions: [{ perm_name: 'owner', required_auth: { keys: [{ key: systemPub }] } }] }
        break
      case '/v1/chain/get_activated_protocol_features':
        tick()
        r = { activated_protocol_features: active.map((d) => ({ feature_digest: d, specification: FEATURES.find((f) => f.feature_digest === d)?.specification })) }
        break
      case '/v1/producer/get_supported_protocol_features':
        r = FEATURES
        break
      case '/v1/producer/schedule_protocol_feature_activations':
        pending.push(...(b.protocol_features_to_activate as string[]))
        r = { result: 'ok' }
        break
      case '/v1/chain/send_transaction': {
        const packed = hexToBytes(b.packed_trx as string)
        const trx = unpackTransaction(packed)
        const sig = parseSignature((b.signatures as string[])[0])
        signers.push(publicKeyToString(recoverPublicKey(signingDigest(chainId, packed), sig)))
        sent.push(trx.actions.map((a) => `${a.account}::${a.name}@${a.authorization[0].actor}`))
        for (const a of trx.actions) if (a.name === 'activate') pending.push(a.data)
        r = { transaction_id: 'x' }
        break
      }
      case '/v1/chain/get_currency_stats':
        r = { WAX: { supply: '1000000000.00000000 WAX', max_supply: '10000000000.00000000 WAX', issuer: 'eosio' } }
        break
      case '/v1/chain/get_table_rows':
        r = b.table === 'rammarket' ? { rows: [{ base: { balance: '68719476736 RAM' }, quote: { balance: '1000000.00000000 WAX' } }] } : { rows: [{ max_ram_size: '68719476736' }] }
        break
      default:
        throw new Error(`unexpected ${path}`)
    }
    return r as T
  }
  return { request, sent, signers, chainId }
}

function deps(node: ReturnType<typeof fakeNode>): Partial<BootDeps> {
  let t = 0
  return {
    request: node.request,
    readResource: async (rel) =>
      rel === 'features.json'
        ? Buffer.from(JSON.stringify({ features: ['PREACTIVATE_FEATURE', 'ONLY_LINK_TO_EXISTING_PERMISSION', 'WTMSIG_BLOCK_SIGNATURES', 'NOT_ON_THIS_NODE'] }))
        : readFile(join(RESOURCES, ...rel.split('/'))),
    sleep: async () => {},
    now: () => (t += 10)
  }
}

describe('bootstrap against a fake node', () => {
  it('sends the plan signed by the system key and reports the state', async () => {
    const { priv, pub } = newKey()
    const node = fakeNode(pub)
    const lines: string[] = []
    const r = await bootstrap('http://127.0.0.1:8888', priv, (l) => lines.push(l), { expect: { port: 8888, chainId: node.chainId }, deps: deps(node) })
    expect(r.precision).toBe(8)
    expect(r.ramMarket.quote).toBe('1000000.00000000 WAX')
    expect(r.features).toEqual(['PREACTIVATE_FEATURE', 'ONLY_LINK_TO_EXISTING_PERMISSION', 'WTMSIG_BLOCK_SIGNATURES'])
    expect(r.skipped.map((s) => s.name)).toEqual(['NOT_ON_THIS_NODE'])
    expect(node.sent.map((t) => t.join(' '))).toEqual([
      'eosio::setcode@eosio',
      'eosio::setabi@eosio',
      'eosio::activate@eosio eosio::activate@eosio',
      LOCAL_CHAIN_SYSTEM_ACCOUNTS.map(() => 'eosio::newaccount@eosio').join(' '),
      'eosio::setcode@eosio.token',
      'eosio::setabi@eosio.token',
      'eosio.token::create@eosio.token eosio.token::issue@eosio',
      'eosio::setcode@eosio.msig',
      'eosio::setabi@eosio.msig',
      'eosio::setcode@eosio',
      'eosio::setabi@eosio',
      'eosio::setpriv@eosio eosio::init@eosio'
    ])
    expect(new Set(node.signers)).toEqual(new Set([pub]))
    expect(lines.some((l) => l.includes('NOT_ON_THIS_NODE'))).toBe(true)
    for (const l of lines) expect(l).not.toContain(priv)
  })

  it('refuses another chain, another key, a used chain and a foreign address, sending nothing', async () => {
    const { priv, pub } = newKey()
    const other = newKey()
    const cases: [string, ReturnType<typeof fakeNode>, string, { chainId?: string }][] = [
      ['http://127.0.0.1:8888', fakeNode(pub), priv, { chainId: 'cd'.repeat(32) }],
      ['http://127.0.0.1:8888', fakeNode(other.pub), priv, {}],
      ['http://127.0.0.1:8888', fakeNode(pub, { activeAtStart: [digest(1)] }), priv, {}],
      ['http://192.168.1.2:8888', fakeNode(pub), priv, {}]
    ]
    for (const [ep, node, key, expect_] of cases) {
      let message = ''
      await bootstrap(ep, key, () => {}, { expect: expect_, deps: deps(node) }).catch((e: Error) => (message = e.message))
      expect(message).not.toBe('')
      expect(message).not.toContain(priv)
      expect(node.sent).toEqual([])
    }
    await expect(bootstrap('http://127.0.0.1:8888', 'not a key', () => {}, { deps: deps(fakeNode(pub)) })).rejects.toThrow('cannot be read')
  })
})
