import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseDocsIndex } from '../../src/shared/docs'
import { EXAMPLES } from '../../src/shared/project'
import { templateFiles } from '../../src/main/templates'

/** C++ without comments (block and line). */
function cppCode(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

function actionsOf(hpp: string): string[] {
  return [...cppCode(hpp).matchAll(/\[\[eosio::action\]\]\s*void\s+(\w+)\s*\(/g)].map((m) => m[1])
}

/** The text of one member function, from its definition to the next one. */
function body(cpp: string, fn: string): string {
  const start = cpp.indexOf(`::${fn}(`)
  const next = cpp.indexOf('\nvoid ', start + 1)
  return cpp.slice(start, next < 0 ? undefined : next)
}

const DOCS = join(__dirname, '../../docs/help')
const docs = (page: string): string => readFileSync(join(DOCS, page), 'utf8')

const CHECK_TEXTS = [
  'player account does not exist',
  'points must be more than zero',
  'points must be at most 1000000',
  'memo has more than 256 bytes',
  'listener account does not exist',
  'the contract does not notify itself',
  'already a listener',
  'at most 5 listeners',
  'not a listener',
  'source account does not exist'
]

describe('reward log example', () => {
  const f = templateFiles('reward-log', 'rewards')
  const hpp = cppCode(f['include/rewards.hpp'])
  const cpp = cppCode(f['src/rewards.cpp'])
  const page = docs('example-reward-log.md')

  it('is listed in New Project with its page', () => {
    const e = EXAMPLES.find((x) => x.id === 'reward-log')
    expect(e?.label).toBe('Reward log (log action)')
    expect(e?.description).toBe(
      "Announces each reward with a log action that reaches the player's history and notifies other contracts; shows how a web page reads it from the trace."
    )
    expect(e?.name).toBe('rewards')
    expect(e?.topic).toBe('example-reward-log')
    const index = parseDocsIndex(docs('index.json'))
    const topic = index.groups.find((g) => g.id === 'examples')?.topics.find((t) => t.id === 'example-reward-log')
    expect(topic?.title).toBe('Example: Reward log (log actions and notifications)')
    for (const k of ['log action', 'logreward', 'logmint', 'notify', 'notification', 'require_recipient', 'inline action', 'trace', 'event', 'history', 'explorer', 'on_notify'])
      expect(topic?.keywords, k).toContain(k)
    expect(docs('examples.md')).toContain('(doc:example-reward-log)')
  })

  it('has the five actions and a handler on the logreward of every contract', () => {
    expect(actionsOf(f['include/rewards.hpp'])).toEqual(['reward', 'logreward', 'addlistener', 'rmlistener', 'setsource'])
    expect(hpp).toContain('void reward(name player, uint64_t points, std::string memo);')
    expect(hpp).toContain('void logreward(uint64_t reward_id, name player, uint64_t points, uint64_t total_points, std::string memo);')
    expect(hpp).toContain('void addlistener(name account);')
    expect(hpp).toContain('void rmlistener(name account);')
    expect(hpp).toContain('void setsource(name source);')
    expect(hpp).toContain('[[eosio::on_notify("*::logreward")]]')
    expect(hpp).toContain('void onlogreward(uint64_t reward_id, name player, uint64_t points, uint64_t total_points, std::string memo);')
    for (const t of ['players', 'listeners', 'heard']) expect(hpp).toMatch(new RegExp(`typedef multi_index<"${t}"_n, \\w+> ${t}_table;`))
    expect(hpp).toContain('typedef singleton<"settings"_n, settings_info> settings_table;')
    expect(hpp).toContain('uint64_t next_reward_id = 1;')
  })

  it('lets only the contract account give rewards, announce them and change its lists', () => {
    for (const fn of ['reward', 'logreward', 'addlistener', 'rmlistener', 'setsource']) expect(body(cpp, fn), fn).toContain('require_auth(get_self());')
  })

  it('announces with an inline logreward that carries the id and the new total, and notifies player and listeners', () => {
    const r = body(cpp, 'reward')
    expect(r).toContain('print("reward ", reward_id, ": ", points, " points to ", player);')
    expect(r).toContain('players.emplace(get_self(),')
    expect(r.replace(/\s+/g, ' ')).toContain(
      'action(permission_level{get_self(), "active"_n}, get_self(), "logreward"_n, std::make_tuple(reward_id, player, points, it->points, memo)) .send();'
    )
    const log = body(cpp, 'logreward')
    expect(log).toContain('require_recipient(player);')
    expect(log.replace(/\s+/g, ' ')).toContain('for (const auto& l : listeners) require_recipient(l.account);')
    // It writes nothing: its data lives in the trace.
    expect(log).not.toMatch(/emplace|modify|erase|\.set\(/)
  })

  it('the handler counts only its source, never fails and pays with its own account', () => {
    const h = body(cpp, 'onlogreward')
    expect(h).toContain('if (!settings.exists() || get_first_receiver() != settings.get().source) return;')
    expect(h).not.toMatch(/check\(|require_auth|require_find/)
    expect(h).toContain('heard.emplace(get_self(),')
    // The source check comes before anything that writes.
    expect(h.indexOf('emplace')).toBeGreaterThan(h.indexOf('get_first_receiver()'))
  })

  it('has every check text of the decision in the source, README and page', () => {
    for (const t of CHECK_TEXTS) {
      expect(cpp, t).toContain(`"${t}"`)
      expect(f['README.md'], t).toContain(`"${t}"`)
      expect(page, t).toContain(`"${t}"`)
    }
  })

  it('has comments before each require_auth, require_recipient and the get_first_receiver() check', () => {
    const src = f['src/rewards.cpp'].split('\n')
    const commented = (re: RegExp): void => {
      src.forEach((line, i) => {
        if (re.test(line) && !line.trim().startsWith('//')) expect(src[i - 1].trim().startsWith('//'), `${i + 1}: ${line.trim()}`).toBe(true)
      })
    }
    commented(/require_auth\(/)
    commented(/require_recipient\(player\)/)
    commented(/get_first_receiver\(\)/)
    const hppLines = f['include/rewards.hpp'].split('\n')
    hppLines.forEach((line, i) => {
      if (/\[\[eosio::(action|on_notify)/.test(line)) expect(hppLines[i - 1].trim().startsWith('//'), line).toBe(true)
    })
  })

  it('the page has the three JavaScript reads, the tree as text and its links', () => {
    const js = [...page.matchAll(/^```js\n([\s\S]*?)^```/gm)].map((m) => m[1])
    expect(js.length).toBe(3)
    for (const b of js) {
      expect(b).toContain('fetch(')
      expect(b).toMatch(/^async function \w+\(/m)
      expect(b).not.toMatch(/require\(|import /)
    }
    expect(js[0]).toContain('/v1/chain/send_transaction')
    expect(js[0]).toContain("answer.processed.action_traces.find((t) => t.act.name === 'logreward' && t.receiver === contract)")
    expect(js[1]).toContain('/v2/history/get_transaction?id=${id}')
    expect(js[2]).toContain('/v2/history/get_actions?account=${player}&filter=${contract}:logreward&sort=desc&limit=20')
    expect(page).toMatch(/^reward\s+game/m)
    expect(page).toMatch(/^ {2}logreward \(inline\)/m)
    expect(page.match(/^ {4}logreward \(notified\)/gm)?.length).toBe(2)
    for (const id of ['eosio-code', 'nft-notifications', 'example-payments', 'token-contract', 'contract-notifications', 'local-chain'])
      expect(page, id).toContain(`(doc:${id})`)
    expect(page).toContain('keep the name `rewards`')
    expect(page).toContain('not audited')
  })

  it('README says what it leaves out, with the RAM step as a check', () => {
    const readme = f['README.md']
    expect(readme).toContain('## What this example leaves out')
    expect(readme).toContain('Before you build on it')
    expect(readme).toContain('when fewer than 2,048 bytes are free, buy 2048 bytes')
    expect(readme).toContain('keep the name `rewards`')
    expect(readme).toContain('New account')
  })
})
