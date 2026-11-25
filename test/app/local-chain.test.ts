import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => process.cwd(), on: () => undefined },
  shell: { openPath: async () => '' },
  utilityProcess: { fork: () => ({ on: () => undefined, postMessage: () => undefined }) }
}))

import {
  DAMAGED_TEXT,
  DIRTY_TEXT,
  endedText,
  ENDED_TEXT,
  UNAVAILABLE_TEXT,
  exitOutcome,
  firstFreePort,
  hideKeys,
  localChainPartIds,
  logTail,
  nodeArgs,
  portTakenText,
  scriptArgs,
  silentText,
  waitIrreversible
} from '../../src/main/local-chain'
import { generatePrivateKey, privateKeyToString } from '../../src/chain-core'
import { LOCAL_CHAIN_DISTRO } from '../../src/shared/local-chain'
import manifest from '../../toolchain/parts.json'

const SCRIPT = readFileSync(join(__dirname, '../../resources/local-chain/setup-distro.sh'), 'utf8')

describe('local chain parts', () => {
  it('lists the base first and the node package last, each a known part', () => {
    const ids = localChainPartIds()
    expect(ids[0]).toBe(manifest.localChain.base)
    expect(ids[ids.length - 1]).toMatch(/^wax-spring-ce-/)
    for (const id of ids) expect(manifest.parts.some((p) => p.id === id)).toBe(true)
  })
})

describe('node command lines (B108 point 1)', () => {
  it('runs nodeos as wax in the chain distro with config and data folders', () => {
    const a = nodeArgs()
    expect(a.slice(0, 5)).toEqual(['-d', LOCAL_CHAIN_DISTRO, '-u', 'wax', '--exec'])
    expect(a).toContain('nodeos')
    expect(a.join(' ')).toContain('--config-dir /home/wax/chain/config --data-dir /home/wax/chain/data')
    expect(a).not.toContain('--genesis-json')
    expect(a).not.toContain('eosio::producer_api_plugin')
  })
  it('adds the genesis and the producer API only for the first start, and replay on request', () => {
    const a = nodeArgs({ genesis: true, producerApi: true })
    expect(a.join(' ')).toContain('--genesis-json /home/wax/chain/config/genesis.json')
    expect(a.join(' ')).toContain('--plugin eosio::producer_api_plugin')
    expect(nodeArgs({ replay: true })).toContain('--replay-blockchain')
  })
  it('runs the setup script as root with the command after the script name; no key is an argument', () => {
    const a = scriptArgs('write', ['config.ini'])
    expect(a.slice(0, 7)).toEqual(['-d', LOCAL_CHAIN_DISTRO, '-u', 'root', '--exec', 'bash', '-c'])
    expect(a.slice(8)).toEqual(['setup-distro', 'write', 'config.ini'])
    expect(a[7]).not.toContain('\r')
    expect(a.join(' ')).not.toMatch(/PVT_|KEY:5/)
  })
})

describe('the setup script', () => {
  it('installs with dpkg only and never apt or a download', () => {
    expect(SCRIPT).toContain('dpkg -i')
    const commands = SCRIPT.split('\n')
      .filter((l) => !l.trim().startsWith('#'))
      .join('\n')
    expect(commands).not.toMatch(/\bapt(-get)?\b|curl |wget /)
  })
  it('writes config files with mode 600 for wax and prints nothing of them', () => {
    const write = SCRIPT.slice(SCRIPT.indexOf('  write)'), SCRIPT.indexOf('  set-port)'))
    expect(write).toContain('umask 077')
    expect(write).toContain('chmod 600')
    expect(write).not.toMatch(/\bcat "\$CONFIG\/\$NAME"|tee /)
  })
  it('stops the node with SIGINT', () => {
    expect(SCRIPT).toContain('pkill -INT -x nodeos')
  })
})

describe('exit handling (B108 point 4)', () => {
  const dirty = 'error ... database dirty flag set (likely due to unclean shutdown): replay required'
  it('replays once on a dirty database, then offers Reset', () => {
    expect(exitOutcome(2, dirty, false, 8888)).toEqual({ kind: 'replay' })
    expect(exitOutcome(2, dirty, true, 8888)).toEqual({ kind: 'failed', reason: DIRTY_TEXT, repair: { kind: 'reset' } })
  })
  it('names a port taken inside WSL', () => {
    const o = exitOutcome(1, 'listen failed: Address already in use', false, 8890)
    expect(o).toMatchObject({ kind: 'failed', reason: 'Port 8890 is used by another program.', portTaken: true })
  })
  it('any other end points to the log', () => {
    expect(exitOutcome(1, 'something else', false, 8888)).toMatchObject({ kind: 'failed', repair: { kind: 'none' } })
  })
  it('keeps the fixed texts of B106 and B108 word for word', () => {
    expect(UNAVAILABLE_TEXT).toBe('The local chain needs WSL 2 (virtualization on). The compiler works without it; the local chain does not.')
    expect(DIRTY_TEXT).toBe(
      "The chain's data was not closed cleanly and could not be repaired. Reset makes a new empty chain; the accounts and contracts on it are lost."
    )
    expect(portTakenText(8888)).toBe('Port 8888 is used by another program.')
    expect(silentText(8889)).toBe(
      "The node runs but does not answer at 127.0.0.1:8889. WSL's localhost forwarding may be switched off (localhostForwarding in .wslconfig)."
    )
  })
})

describe('repair and start with the app (B108 points 3, 4, 9)', () => {
  const blockLog = '3190000 block_log_exception: Block log exception'
  it('offers Reset when the replay itself ends, whatever the node says', () => {
    expect(exitOutcome(254, blockLog, true, 8888)).toEqual({ kind: 'failed', reason: DIRTY_TEXT, repair: { kind: 'reset' } })
    expect(exitOutcome(1, 'listen failed: Address already in use', true, 8888)).toMatchObject({ repair: { kind: 'reset' } })
  })
  it('does not replay for an end that is not a dirty database', () => {
    expect(exitOutcome(254, blockLog, false, 8888)).not.toEqual({ kind: 'replay' })
  })
  it('names a damaged block log or database and offers Reset', () => {
    expect(exitOutcome(254, blockLog, false, 8888)).toEqual({ kind: 'failed', reason: DAMAGED_TEXT, repair: { kind: 'reset' } })
    expect(exitOutcome(1, 'x fork_database_exception y', false, 8888)).toMatchObject({ reason: DAMAGED_TEXT })
    expect(exitOutcome(1, 'bad database version', false, 8888)).toMatchObject({ reason: DAMAGED_TEXT })
  })
  it('keeps the generic text in genesis mode and for other ends', () => {
    expect(exitOutcome(254, blockLog, false, 8888, true)).toEqual({ kind: 'failed', reason: endedText(254), repair: { kind: 'none' } })
    expect(endedText(3)).toBe('The node ended at start (exit 3). Open the log to see why. If Start fails again, Reset makes a new empty chain.')
    expect(DAMAGED_TEXT).toBe(
      "The chain's data is damaged and the node cannot start with it. Reset makes a new empty chain; the accounts and contracts on it are lost. The log has the node's own words."
    )
  })
  it('says what happened when the node ends while it runs', () => {
    expect(ENDED_TEXT).toBe('The node ended unexpectedly. Start checks its data and repairs it if needed.')
  })
  it('holds the quit for a running chain and starts it with the app only on request', () => {
    const index = readFileSync(join(__dirname, '../../src/main/index.ts'), 'utf8')
    const quit = index.slice(index.indexOf("'before-quit'"))
    expect(quit.indexOf('localChainRunning()')).toBeGreaterThan(0)
    expect(quit.indexOf('e.preventDefault()')).toBeGreaterThan(quit.indexOf('localChainRunning()'))
    expect(quit.indexOf('stopForQuit()')).toBeGreaterThan(quit.indexOf('e.preventDefault()'))
    expect(index).toContain('void startIfAsked()')
    const chain = readFileSync(join(__dirname, '../../src/main/local-chain.ts'), 'utf8')
    expect(chain).toContain('if (!state?.options.startWithApp) return null')
  })
})

describe('ports', () => {
  it('takes the first free port of 8888-8899, skipping one', async () => {
    const taken = new Set([8888, 8889])
    expect(await firstFreePort(async (p) => !taken.has(p))).toBe(8890)
    expect(await firstFreePort(async (p) => !taken.has(p), 8888, 8890)).toBe(8891)
    expect(await firstFreePort(async () => false)).toBeNull()
  })
})

describe('log and key hiding', () => {
  it('hides private keys of both forms', () => {
    const k = generatePrivateKey()
    const text = `a ${privateKeyToString(k)} b ${privateKeyToString(k, 'wif')} c`
    const out = hideKeys(text)
    expect(out).toBe('a [hidden] b [hidden] c')
  })
  it('keeps the last part of a long log from a line start', () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `line ${i}`).join('\n') + '\n'
    const tail = logTail(lines, 100)
    expect(Buffer.byteLength(tail)).toBeLessThanOrEqual(100)
    expect(tail.startsWith('line ')).toBe(true)
    expect(tail.endsWith('line 999\n')).toBe(true)
    expect(logTail('short', 100)).toBe('short')
  })
})

describe('stop keeps the last transactions (stage 37 fix)', () => {
  it('waits until the irreversible block passes the head read at the call', async () => {
    const answers = [
      { head: 10, irreversible: 9 },
      { head: 11, irreversible: 10 },
      { head: 12, irreversible: 11 }
    ]
    const seen: number[] = []
    const out = await waitIrreversible(async () => {
      const a = answers.shift() ?? null
      if (a) seen.push(a.irreversible)
      return a
    }, 5000, 1)
    expect(out).toBe('irreversible')
    // Block 10 irreversible is not enough: the head was 10 and the pending block 11 holds the last transactions.
    expect(seen).toEqual([9, 10, 11])
  })
  it('does not wait for a node that does not answer, and keeps trying through a missed answer', async () => {
    expect(await waitIrreversible(async () => null, 5000, 1)).toBe('no-answer')
    const answers = [{ head: 5, irreversible: 4 }, null, { head: 7, irreversible: 6 }]
    expect(await waitIrreversible(async () => answers.shift() ?? null, 5000, 1)).toBe('irreversible')
  })
  it('gives up at the time limit', async () => {
    let t = 0
    const out = await waitIrreversible(
      async () => {
        t += 1000
        return { head: 20, irreversible: 3 }
      },
      10_000,
      1,
      () => t
    )
    expect(out).toBe('timeout')
    expect(t).toBeLessThanOrEqual(12_000)
  })
  it('settles the blocks before every SIGINT and before Set up marks the chain bootstrapped', () => {
    const src = readFileSync(join(__dirname, '../../src/main/local-chain.ts'), 'utf8')
    const stopFn = src.slice(src.indexOf('async function stopProcess'), src.indexOf('async function stopLeftover'))
    expect(stopFn.indexOf('settleBlocks(')).toBeGreaterThan(0)
    expect(stopFn.indexOf("script('stop-node'")).toBeGreaterThan(stopFn.indexOf('settleBlocks('))
    const leftover = src.slice(src.indexOf('async function stopLeftover'), src.indexOf('async function portFailure'))
    expect(leftover.indexOf("script('stop-node'")).toBeGreaterThan(leftover.indexOf('settleBlocks('))
    const fresh = src.slice(src.indexOf('async function freshChain'), src.indexOf('async function startChain'))
    expect(fresh.indexOf('bootstrapped: true')).toBeGreaterThan(fresh.indexOf('settleBlocks('))
    expect(src).toContain('const IRREVERSIBLE_WAIT_MS = 10_000')
  })
})
