// The NFT blend example: fixed points of the source, the README and its page.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { allTopics, parseDocsIndex } from '../../src/shared/docs'
import { EXAMPLES } from '../../src/shared/project'
import { templateFiles } from '../../src/main/templates'

/** C++ without comments (block and line). */
function cppCode(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

function actionsOf(hpp: string): string[] {
  return [...cppCode(hpp).matchAll(/\[\[eosio::action\]\]\s*void\s+(\w+)\s*\(/g)].map((m) => m[1])
}

/** The texts of every check() of the source. */
function checkMessages(cpp: string): string[] {
  return [...cppCode(cpp).matchAll(/check\([^;]*?,\s*"([^"]+)"\s*\);/g)].map((m) => m[1])
}

const f = templateFiles('nft-blend', 'blender')
const hpp = cppCode(f['include/blender.hpp'])
const cpp = cppCode(f['src/blender.cpp'])
const readme = f['README.md']
const page = readFileSync(join(__dirname, '../../docs/help/example-nft-blend.md'), 'utf8')

describe('NFT blend example', () => {
  it('is listed in New Project with the project name blender and its page', () => {
    const e = EXAMPLES.find((x) => x.id === 'nft-blend')
    expect(e).toBeDefined()
    expect(e!.name).toBe('blender')
    expect(e!.topic).toBe('example-nft-blend')
    expect(Object.keys(f).sort()).toEqual(['README.md', 'include/blender.hpp', 'resource/blender.clauses.md', 'resource/blender.contracts.md', 'src/blender.cpp'])
    expect((f['src/blender.cpp'] + f['include/blender.hpp']).split('\n').length).toBeLessThan(150)
  })

  it('has setrecipe and delrecipe, both signed by the contract account', () => {
    expect(actionsOf(f['include/blender.hpp'])).toEqual(['setrecipe', 'delrecipe'])
    expect(hpp).toContain(
      'void setrecipe(uint64_t id, name collection, std::vector<int32_t> ingredients, name result_schema,\n                 int32_t result_template);'
    )
    expect(hpp).toContain('void delrecipe(uint64_t id);')
    const setrecipe = cpp.slice(cpp.indexOf('::setrecipe('), cpp.indexOf('::delrecipe('))
    const delrecipe = cpp.slice(cpp.indexOf('::delrecipe('), cpp.indexOf('::on_transfer('))
    expect(setrecipe).toContain('require_auth(get_self());')
    expect(delrecipe).toContain('require_auth(get_self());')
    expect(setrecipe).toContain('recipes.emplace(get_self(),')
  })

  it('checks every recipe field: id, 1 to 10 ingredients, no negative template ids, burnable ingredients, the result template', () => {
    expect(hpp).toContain('static constexpr size_t MAX_INGREDIENTS = 10;')
    const setrecipe = cpp.slice(cpp.indexOf('::setrecipe('), cpp.indexOf('::delrecipe('))
    expect(setrecipe).toContain('check(id > 0, "the recipe id must be 1 or more");')
    expect(setrecipe).toContain('check(!ingredients.empty() && ingredients.size() <= MAX_INGREDIENTS, "a recipe has 1 to 10 ingredients");')
    expect(setrecipe).toContain('check(recipes.find(id) == recipes.end(), "a recipe with this id exists; run delrecipe first");')
    // A negative id is refused before it is turned into an unsigned table key.
    expect(setrecipe.indexOf('check(t > 0,')).toBeLessThan(setrecipe.indexOf('templates.find(uint64_t(t))'))
    expect(setrecipe.indexOf('check(result_template > 0,')).toBeLessThan(setrecipe.indexOf('templates.find(uint64_t(result_template))'))
    expect(setrecipe).toContain('atomicassets::templates_table templates(ATOMICASSETS, collection.value);')
    expect(setrecipe).toContain('check(tpl->burnable, "an ingredient template is not burnable");')
    expect(setrecipe).toContain('res->schema_name == result_schema')
    expect(setrecipe).toContain('std::sort(ingredients.begin(), ingredients.end());')
  })

  it('blends in a handler on atomicassets::transfer that refuses anything but the exact recipe', () => {
    expect(hpp).toContain('[[eosio::on_notify("atomicassets::transfer")]]')
    expect(hpp).toContain('void on_transfer(name from, name to, std::vector<uint64_t> asset_ids, std::string memo);')
    expect(hpp).not.toContain('logtransfer")]]')
    const handler = cpp.slice(cpp.indexOf('::on_transfer('))
    expect(handler.indexOf('if (from == get_self() || to != get_self()) return;')).toBeGreaterThan(0)
    expect(handler).toContain('check(id != 0, "send the assets with the memo blend:<recipe id>");')
    expect(handler).toContain('recipes.get(id, "no recipe with this id")')
    expect(handler).toContain('check(asset_ids.size() == r.ingredients.size(),')
    expect(handler).toContain('atomicassets::assets_table assets(ATOMICASSETS, get_self().value);')
    expect(handler).toContain('check(a.collection_name == r.collection,')
    expect(handler).toContain('std::sort(sent.begin(), sent.end());')
    expect(handler).toContain('check(sent == r.ingredients, "the assets sent are not the ingredients of this recipe");')
    // Every check comes before the first inline action.
    const firstAction = handler.indexOf('action(')
    expect(handler.lastIndexOf('check(')).toBeLessThan(firstAction)
    expect(handler).toMatch(/action\(permission_level\{get_self\(\), "active"_n\}, ATOMICASSETS, "burnasset"_n, std::make_tuple\(get_self\(\), asset_id\)\)\.send\(\);/)
    expect(handler).toMatch(
      /action\(permission_level\{get_self\(\), "active"_n\}, ATOMICASSETS, "mintasset"_n,\s*std::make_tuple\(get_self\(\), r\.collection, r\.result_schema, r\.result_template, from,/
    )
  })

  it('reads a memo id of digits only, at most 18 of them', () => {
    const parse = cpp.slice(cpp.indexOf('recipe_id_of('), cpp.indexOf('::setrecipe('))
    expect(parse).toContain('memo.compare(0, start, "blend:") != 0')
    expect(parse).toContain('memo.size() > start + 18')
    expect(parse).toContain("if (memo[i] < '0' || memo[i] > '9') return 0;")
  })

  it('declares the atomicassets rows outside the contract class, with the fields of its ABI in order', () => {
    const ns = hpp.slice(hpp.indexOf('namespace atomicassets {'), hpp.indexOf('class [[eosio::contract('))
    expect(ns.length).toBeGreaterThan(0)
    expect(ns).not.toContain('[[eosio::table]]')
    const fields = (struct: string): string[] => {
      const body = ns.slice(ns.indexOf(`struct ${struct} {`), ns.indexOf('};', ns.indexOf(`struct ${struct} {`)))
      return [...body.matchAll(/^\s+([\w:<>]+)\s+([\w, ]+);/gm)].flatMap((m) => m[2].split(',').map((n) => `${n.trim()}:${m[1]}`))
    }
    expect(fields('asset_row')).toEqual([
      'asset_id:uint64_t',
      'collection_name:name',
      'schema_name:name',
      'template_id:int32_t',
      'ram_payer:name',
      'backed_tokens:std::vector<asset>',
      'immutable_serialized_data:std::vector<uint8_t>',
      'mutable_serialized_data:std::vector<uint8_t>'
    ])
    expect(fields('template_row')).toEqual([
      'template_id:int32_t',
      'schema_name:name',
      'transferable:bool',
      'burnable:bool',
      'max_supply:uint32_t',
      'issued_supply:uint32_t',
      'immutable_serialized_data:std::vector<uint8_t>'
    ])
    expect(ns).toContain('typedef multi_index<"assets"_n, asset_row> assets_table;')
    expect(ns).toContain('typedef multi_index<"templates"_n, template_row> templates_table;')
  })

  it('README and page name the refusals of the source and run the same steps', () => {
    // An asset that the transfer did not move to the contract cannot be read there, so that check never fires in the steps.
    const shown = checkMessages(f['src/blender.cpp']).filter((m) => m !== 'an asset sent is not held by the contract')
    expect(shown.length).toBeGreaterThan(8)
    for (const m of shown) {
      expect(readme, m).toContain(m)
      expect(page, m).toContain(m)
    }
    expect(readme).toContain('not audited; do not hold real value with it unchanged')
    expect(readme).toContain('Before you build on it')
    expect(page).toContain('## Before you build on it')
    expect(page).toContain('`blenderizerx`')
    expect(page).toContain('`blend.nefty`')
    const steps = readme.slice(readme.indexOf('## Steps in WAX Master'), readme.indexOf('## What goes wrong')).split('\n').filter((l) => /^\d+\. /.test(l))
    expect(steps.length).toBe(17)
    for (const s of steps) expect(page, s).toContain(s.replace(/\*\*(contract|user) account\*\*/g, '$1 account'))
    expect(steps[12]).toContain('`memo` = `blend:1`')
    expect(steps[13]).toContain('`memo` = `blend:7`')
  })

  it('links only pages that exist', () => {
    const topics = new Set(allTopics(parseDocsIndex(readFileSync(join(__dirname, '../../docs/help/index.json'), 'utf8'))).map((t) => t.id))
    const links = [...page.matchAll(/\]\(doc:([a-z0-9-]+)\)/g)].map((m) => m[1])
    expect(links.length).toBeGreaterThan(5)
    for (const l of links) expect(topics.has(l), l).toBe(true)
  })
})
