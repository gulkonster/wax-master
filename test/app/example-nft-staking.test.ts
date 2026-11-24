import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EXAMPLES } from '../../src/shared/project'
import { templateFiles } from '../../src/main/templates'

/** C++ without comments (block and line). */
function cppCode(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

function actionsOf(hpp: string): string[] {
  return [...cppCode(hpp).matchAll(/\[\[eosio::action\]\]\s*void\s+(\w+)\s*\(/g)].map((m) => m[1])
}

/** The fields of the atomicassets `assets` row (its ABI on WAX Testnet), in order, with their C++ types. */
const ASSET_ROW = [
  'uint64_t             asset_id;',
  'name                 collection_name;',
  'name                 schema_name;',
  'int32_t              template_id;',
  'name                 ram_payer;',
  'std::vector<asset>   backed_tokens;',
  'std::vector<uint8_t> immutable_serialized_data;',
  'std::vector<uint8_t> mutable_serialized_data;'
]

describe('NFT staking example', () => {
  const f = templateFiles('nft-staking', 'nftstake')
  const hppText = f['include/nftstake.hpp']
  const hpp = cppCode(hppText)
  const cpp = cppCode(f['src/nftstake.cpp'])
  const readme = f['README.md']
  const page = readFileSync(join(__dirname, '../../docs/help/example-nft-staking.md'), 'utf8')

  it('is listed in New Project as nftstake with its page', () => {
    const e = EXAMPLES.find((x) => x.id === 'nft-staking')
    expect(e?.name).toBe('nftstake')
    expect(e?.topic).toBe('example-nft-staking')
  })

  it('has setconfig and unstake as actions and a handler on atomicassets::transfer', () => {
    expect(actionsOf(hppText)).toEqual(['setconfig', 'unstake'])
    expect(hpp).toContain('void setconfig(name collection);')
    expect(hpp).toContain('[[eosio::on_notify("atomicassets::transfer")]]')
    expect(hpp).toContain('void on_transfer(name from, name to, std::vector<uint64_t> asset_ids, std::string memo);')
    expect(hpp).toContain('void unstake(name owner, std::vector<uint64_t> asset_ids);')
    expect(hpp).not.toContain('"atomicassets::logtransfer"')
    expect(hpp).toContain('static constexpr uint32_t MAX_ASSETS = 10;')
  })

  it('keeps one row per asset with its owner and time, and a second index by owner', () => {
    const row = hpp.slice(hpp.indexOf('struct [[eosio::table]] stake_row'))
    expect(row).toMatch(/uint64_t\s+asset_id;\s*name\s+owner;\s*time_point_sec\s+staked_at;/)
    expect(row).toContain('uint64_t primary_key() const { return asset_id; }')
    expect(row).toContain('uint64_t by_owner() const { return owner.value; }')
    expect(row.replace(/\s+/g, ' ')).toContain(
      'typedef multi_index<"stakes"_n, stake_row, indexed_by<"byowner"_n, const_mem_fun<stake_row, uint64_t, &stake_row::by_owner>>> stakes_table;'
    )
  })

  it('reads the atomicassets assets row with the fields of its ABI, outside the contract class', () => {
    const ns = hpp.slice(hpp.indexOf('namespace atomic {'), hpp.indexOf('class [[eosio::contract('))
    expect(ns.length).toBeGreaterThan(0)
    let at = 0
    for (const field of ASSET_ROW) {
      const i = ns.indexOf(field, at)
      expect(i, field).toBeGreaterThan(at)
      at = i
    }
    expect(ns).toContain('uint64_t primary_key() const { return asset_id; }')
    expect(ns).toContain('typedef multi_index<"assets"_n, asset_row> assets_table;')
  })

  it('setconfig: signed by the contract account, refuses an empty name', () => {
    const s = cpp.slice(cpp.indexOf('::setconfig('), cpp.indexOf('::on_transfer('))
    expect(s).toContain('require_auth(get_self());')
    expect(s).toContain('check(collection != name(), "collection must not be empty");')
  })

  it('handler: skips outgoing and forwarded transfers, checks memo, count and collection, pays its rows', () => {
    const h = cpp.slice(cpp.indexOf('::on_transfer('), cpp.indexOf('::unstake('))
    expect(h).toContain('if (from == get_self() || to != get_self()) return;')
    expect(h).toContain('check(memo == "stake", "send with the memo stake");')
    expect(h).toContain('check(asset_ids.size() <= MAX_ASSETS, "stake at most 10 assets in one transfer");')
    expect(h).toContain('check(cfg.exists(), "staking is not set up yet: run setconfig");')
    expect(h).toContain('atomic::assets_table assets(ATOMICASSETS, get_self().value);')
    expect(h).toContain('assets.get(id, "the contract does not hold this asset");')
    expect(h).toContain('check(a.collection_name == collection, "only assets of the configured collection can be staked");')
    expect(h).toContain('check(stakes.find(id) == stakes.end(), "this asset is already staked");')
    expect(h).toContain('stakes.emplace(get_self(),')
    expect(h).toContain('row.owner = from;')
    expect(h).not.toMatch(/inline|\.send\(\)/)
    expect(cpp).toContain('static constexpr name ATOMICASSETS = "atomicassets"_n;')
  })

  it('unstake: signed by the owner, 1 to 10 assets, each row must be his, one inline transfer back', () => {
    const u = cpp.slice(cpp.indexOf('::unstake('))
    expect(u).toContain('require_auth(owner);')
    expect(u).toContain('check(!asset_ids.empty(), "name at least one asset");')
    expect(u).toContain('check(asset_ids.size() <= MAX_ASSETS, "unstake at most 10 assets at a time");')
    expect(u).toContain('stakes.get(id, "this asset is not staked");')
    expect(u).toContain('check(row.owner == owner, "this asset was staked by another account");')
    expect(u).toContain('stakes.erase(row);')
    expect(u.indexOf('stakes.erase(row);')).toBeLessThan(u.indexOf('.send()'))
    expect(u).toMatch(
      /action\(permission_level\{get_self\(\), "active"_n\}, ATOMICASSETS, "transfer"_n,\s*std::make_tuple\(get_self\(\), owner, asset_ids, std::string\("unstake"\)\)\)\s*\.send\(\);/
    )
    expect(u.match(/\.send\(\)/g)?.length).toBe(1)
  })

  it('README and page: the same steps, the failure cases of the run, and why the table matters', () => {
    const steps = (text: string, from: string, to: string): string[] =>
      text
        .slice(text.indexOf(from), text.indexOf(to, text.indexOf(from)))
        .split('\n')
        .filter((l) => /^\d+\. /.test(l))
    const readmeSteps = steps(readme, '## Steps in WAX Master', '## What goes wrong')
    const pageSteps = steps(page, '## How to do it here', '## What is needed')
    expect(readmeSteps.length).toBe(19)
    expect(pageSteps.length).toBe(readmeSteps.length)
    for (const text of [readme, page]) {
      expect(text).toContain('not audited; do not hold real value with it unchanged')
      for (const s of [
        'send with the memo stake',
        'only assets of the configured collection can be staked',
        'this asset was staked by another account',
        'Allow this account\'s contract to send actions (eosio.code)',
        '`immutable_data` = `[{"key":"name","value":["string","Example item"]}]`',
        '`schema_format` = `[{"name":"name","type":"string"}]`',
        '`tokens_to_back` = `[]`',
        'when fewer than 2,048 bytes are free, buy 2048 bytes'
      ])
        expect(text, s).toContain(s)
      expect(text).toMatch(/knows only|only record/)
      expect(text).not.toMatch(/faucet[^.]*\b\d+ (WAX|accounts?)\b/)
    }
    expect(page).toContain('keep the name `nftstake`')
    expect(page).toContain('## Before you build on it')
    expect(readme).toContain('Before you build on it:')
    expect(readme).not.toContain('doc:')
  })
})
