// The scripted editor check (`npm run check:editor`). It starts the editor
// engine in the toolchain distro on projects made from the shipped templates,
// makes the 52 deliberate slips of test/fixtures/editor-check/cases.ts and
// compares what the window would show with the expected place and words.
// Every engine answer goes through the window's pipeline in its order:
// keepDiagnostic, rewriteDiagnostic, replacedByCheck, replacedInHeader, placeDiagnostics,
// cleanMessage, plus contractChecks on the text.
//
// It needs WSL and the toolchain (Help > Setup), so it is not part of
// `npx vitest run`. The distro comes from WAX_DISTRO (default
// waxmaster-wax-cdt-4.1.1wax01); without it the suite is skipped with one line.

import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { engineArguments } from '../../src/main/clangd'
import { contractChecks, replacedByCheck } from '../../src/shared/contract-checks'
import { FLAG_SETUP, keepDiagnostic, rewriteDiagnostic, type LspDiagnostic } from '../../src/shared/lsp-diagnostics'
import { memberAccessBefore, keepCompletion, rowLambdaAt, rowTypeOf, SNIPPETS } from '../../src/shared/lsp-completion'
import { isPiece, namedInInclude } from '../../src/shared/lsp-fragment'
import { cleanDoc, cleanMessage } from '../../src/shared/lsp-messages'
import { placeDiagnostics } from '../../src/shared/lsp-place'
import { EXAMPLES, type TemplateId } from '../../src/shared/project'
import { CASES, CPP, CONTRACT, HPP, type Case, type Item, type Severity } from '../fixtures/editor-check/cases'
import { replacedInHeader } from '../../src/renderer/src/lib/lsp/problems'
import { sortTextFor } from '../../src/renderer/src/lib/lsp/sort'
import { distroInstalled, distroName, EngineClient, makeProject, offsetToPos, type CheckProject } from './lsp-harness'

const DISTRO = distroName()
const AVAILABLE = distroInstalled(DISTRO)
if (!AVAILABLE) console.log(`check:editor skipped: the distro "${DISTRO}" is not listed by "wsl.exe -l -q" (set WAX_DISTRO, or install the toolchain with Help > Setup).`)

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** One problem as the window shows it. */
interface Entry {
  /** The document that holds the diagnostic. */
  doc: string
  /** Where the problem is: the related place for an error inside an included project header. */
  file: string
  line: number
  col: number
  endLine: number
  endCol: number
  severity: Severity
  code: string
  message: string
  underlined: string
  source: 'engine' | 'checks'
}

const SEVERITY: Record<number, Severity> = { 1: 'error', 2: 'warning', 3: 'hint', 4: 'hint' }

function offsetOf(text: string, line: number, character: number): number {
  let off = 0
  for (let i = 0; i < line; i++) {
    const nl = text.indexOf('\n', off)
    if (nl < 0) return text.length
    off = nl + 1
  }
  return Math.min(off + character, text.length)
}

function textUnder(text: string, r: LspDiagnostic['range']): string {
  return text.slice(offsetOf(text, r.start.line, r.start.character), offsetOf(text, r.end.line, r.end.character))
}

/** The window's pipeline on the stored engine answer of one document. */
function shown(client: EngineClient, rel: string): Entry[] {
  const text = client.text(rel)
  const lines = text.split('\n')
  const docUri = client.windowUri(rel)
  const raw = client.published.get(rel)?.diagnostics ?? []
  const checks = contractChecks(text)
  const kept: LspDiagnostic[] = []
  for (const d of raw) {
    const ctx = { cdtVersion: client.cdtVersion, underlined: textUnder(text, d.range) }
    if (!keepDiagnostic(d, docUri, FLAG_SETUP, ctx)) continue
    const rewritten = rewriteDiagnostic(d, ctx)
    if (replacedByCheck(rewritten, checks)) continue
    if (replacedInHeader(rewritten, (u) => (client.projectPathOf(u) && client.text(client.projectPathOf(u)) ? contractChecks(client.text(client.projectPathOf(u))) : null))) continue
    kept.push(rewritten)
  }
  const out: Entry[] = []
  const placed = placeDiagnostics(kept, lines, docUri, client.projectPathOf)
  for (const [i, d] of placed.entries()) {
    // An error found inside an included project header sits at its related place (as in the Problems list).
    let file = rel
    let range = d.range
    if (/^in included file/i.test(kept[i].message)) {
      const here = (d.relatedInformation ?? []).find((r) => /error occurred here/i.test(r.message))
      const there = here ? client.projectPathOf(here.location.uri) : ''
      if (here && there) {
        file = there
        range = here.location.range
      }
    }
    const ownText = file === rel ? text : client.text(file)
    out.push({
      doc: rel,
      file,
      line: range.start.line + 1,
      col: range.start.character + 1,
      endLine: range.end.line + 1,
      endCol: range.end.character + 1,
      severity: SEVERITY[d.severity ?? 1] ?? 'error',
      code: typeof d.code === 'string' ? d.code : String(d.code ?? ''),
      message: cleanMessage(d.message),
      underlined: textUnder(ownText, range),
      source: 'engine'
    })
  }
  for (const c of checks) {
    out.push({
      doc: rel,
      file: rel,
      line: c.range.start.line + 1,
      col: c.range.start.character + 1,
      endLine: c.range.end.line + 1,
      endCol: c.range.end.character + 1,
      severity: c.severity === 1 ? 'error' : 'warning',
      code: c.code,
      message: c.message,
      underlined: textUnder(text, c.range),
      source: 'checks'
    })
  }
  return out
}

function allShown(client: EngineClient): Entry[] {
  return [CPP, HPP].flatMap((rel) => shown(client, rel))
}

function matches(e: Entry, it: Item, byDoc = false): boolean {
  if (it.file !== undefined && (byDoc ? e.doc : e.file) !== it.file) return false
  if (it.line !== undefined && e.line !== it.line) return false
  if (it.col !== undefined && e.col !== it.col) return false
  if (it.severity !== undefined && e.severity !== it.severity) return false
  if (it.code !== undefined && e.code !== it.code) return false
  if (it.underlined !== undefined && e.underlined !== it.underlined) return false
  if (it.text !== undefined && !e.message.toLowerCase().includes(it.text.toLowerCase())) return false
  return true
}

const place = (e: Entry): string => `${e.file}:${e.line}:${e.col}`

function describeEntries(entries: Entry[]): string {
  if (!entries.length) return '  (nothing)'
  return entries
    .slice(0, 30)
    .map((e) => `  [${e.severity}] ${place(e)}-${e.endLine}:${e.endCol} (${e.code}${e.doc !== e.file ? `, held by ${e.doc}` : ''}) ${JSON.stringify(e.message.slice(0, 200))} | underlined ${JSON.stringify(e.underlined.slice(0, 60))}`)
    .join('\n')
}

function describeRaw(client: EngineClient, files: string[] = [CPP, HPP]): string {
  return files
    .map((rel) => {
      const list = client.published.get(rel)?.diagnostics ?? []
      const rows = list
        .slice(0, 12)
        .map((d) => `  [${d.severity}] ${d.range.start.line + 1}:${d.range.start.character + 1}-${d.range.end.line + 1}:${d.range.end.character + 1} (${d.code ?? ''}) ${JSON.stringify(d.message.slice(0, 200))}`)
        .join('\n')
      return `engine's raw answer for ${rel} (${list.length}):\n${rows || '  (nothing)'}`
    })
    .join('\n')
}

/** Problems of one case: an empty list means it passed. */
function judge(c: Case, client: EngineClient, entries: Entry[]): string[] {
  const faults: string[] = []
  const ex = c.expect
  for (const it of ex.items ?? []) {
    if (!entries.some((e) => matches(e, it))) faults.push(`missing: ${JSON.stringify(it)}`)
  }
  for (const it of ex.absent ?? []) {
    const hit = entries.find((e) => matches(e, it, true))
    if (hit) faults.push(`must not be shown: ${JSON.stringify(it)} but ${place(hit)} says ${JSON.stringify(hit.message.slice(0, 100))}`)
  }
  if (ex.nothing) {
    const some = entries.filter((e) => e.severity !== 'hint')
    if (some.length) faults.push(`expected no error and no warning, found ${some.length}`)
  }
  if (ex.lastError) {
    const errs = entries.filter((e) => e.severity === 'error' && e.file === c.file)
    const last = errs.reduce<Entry | null>((m, e) => (m === null || e.line > m.line || (e.line === m.line && e.col > m.col) ? e : m), null)
    if (!last || last.line !== ex.lastError.line || last.col !== ex.lastError.col) {
      faults.push(`last error of ${c.file} should be at ${ex.lastError.line}:${ex.lastError.col}, is ${last ? place(last) : 'missing'}`)
    }
  }
  // Every case: no warning for an unused include (it is a hint), and the Token header has exactly one such hint.
  const warned = entries.filter((e) => e.severity === 'warning' && e.code === 'unused-includes')
  if (warned.length) faults.push(`${warned.length} unused-includes shown as a warning`)
  const hints = entries.filter((e) => e.doc === client.project.hpp && e.severity === 'hint' && e.code === 'unused-includes')
  if (hints.length !== 1) faults.push(`the header should hold exactly one unused-includes hint, holds ${hints.length}`)
  return faults
}

describe.skipIf(!AVAILABLE)('editor engine: baseline', () => {
  const projects: [TemplateId, string][] = [
    ['hello', 'hello'],
    ['token', CONTRACT],
    ...(['staking', 'nft-staking', 'payments'] as const).map((id): [TemplateId, string] => [id, EXAMPLES.find((e) => e.id === id)?.name ?? id])
  ]
  for (const [template, contract] of projects) {
    it(`baseline ${template}: opens with no error and no warning in both files`, async () => {
      const project = makeProject(template, contract)
      const client = new EngineClient(project, DISTRO)
      try {
        await client.start()
        await client.open(project.cpp, project.files[project.cpp])
        await client.open(project.hpp, project.files[project.hpp])
        await client.settle(1500)
        const entries = [project.cpp, project.hpp].flatMap((rel) => shown(client, rel))
        const bad = entries.filter((e) => e.severity !== 'hint')
        console.log(`baseline ${template}: ${bad.length === 0 ? 'ok' : 'FAIL'} (${entries.length - bad.length} hints, ${bad.length} errors or warnings)`)
        expect(bad, `${template}\n${describeEntries(bad)}\n${describeRaw(client)}`).toEqual([])
      } finally {
        await client.stop()
        project.dispose()
      }
    }, 240000)
  }
})

// E57: a contract written with the eosio macros (ACTION, TABLE, CONTRACT, EOSIO_DISPATCH)
// shows no "Unknown attribute" warning; the compiler gives none for it either.
const MACRO_HPP = [
  '#include <eosio/eosio.hpp>',
  'using namespace eosio;',
  '',
  'CONTRACT macrotest : public contract {',
  'public:',
  '  using contract::contract;',
  '  ACTION setlistener(name listener);',
  '  ACTION tick();',
  '  TABLE state {',
  '    name listener;',
  '    uint64_t primary_key() const { return listener.value; }',
  '  };',
  '  typedef multi_index<"state"_n, state> states;',
  '};',
  ''
].join('\n')
const MACRO_CPP = [
  '#include <macrotest.hpp>',
  '',
  'ACTION macrotest::setlistener(name listener) {',
  '  require_auth(get_self());',
  '  check(is_account(listener), "no such account");',
  '}',
  '',
  'ACTION macrotest::tick() {',
  '  require_auth(get_self());',
  '}',
  '',
  'EOSIO_DISPATCH(macrotest, (setlistener)(tick))',
  ''
].join('\n')

describe.skipIf(!AVAILABLE)('editor engine: the eosio macros', () => {
  it('a contract written with ACTION, TABLE, CONTRACT and EOSIO_DISPATCH shows no error and no warning', async () => {
    const project = makeProject('hello', 'macrotest', {}, (files) => {
      for (const k of Object.keys(files)) if (/\.(c|h)pp$/.test(k)) delete files[k]
      files['src/macrotest.cpp'] = MACRO_CPP
      files['include/macrotest.hpp'] = MACRO_HPP
    })
    const client = new EngineClient(project, DISTRO)
    try {
      await client.start()
      await client.open(project.cpp, project.files[project.cpp])
      await client.open(project.hpp, project.files[project.hpp])
      await client.settle(1500)
      const entries = [project.cpp, project.hpp].flatMap((rel) => shown(client, rel))
      const bad = entries.filter((e) => e.severity !== 'hint')
      console.log(`eosio macros: ${bad.length === 0 ? 'ok' : 'FAIL'}\n${describeRaw(client, [project.cpp, project.hpp])}`)
      expect(bad, `${describeEntries(bad)}\n${describeRaw(client, [project.cpp, project.hpp])}`).toEqual([])
    } finally {
      await client.stop()
      project.dispose()
    }
  }, 240000)
})

describe.skipIf(!AVAILABLE)('editor engine: the 52 slips on the Token template', () => {
  let project: CheckProject
  let client: EngineClient
  const original: Record<string, string> = {}

  beforeAll(async () => {
    project = makeProject('token', CONTRACT)
    client = new EngineClient(project, DISTRO)
    await client.start()
    original[CPP] = project.files[CPP]
    original[HPP] = project.files[HPP]
    await client.open(CPP, original[CPP])
    await client.open(HPP, original[HPP])
    await sleep(1500)
    await client.settle(1500)
  }, 240000)

  afterAll(async () => {
    await client?.stop()
    project?.dispose()
  })

  for (const c of CASES) {
    it(`${c.id}: ${c.what}`, async () => {
      const text = c.edit(original[c.file])
      const t0 = Date.now()
      let faults: string[] = []
      let entries: Entry[] = []
      let raw = ''
      try {
        await client.change(c.file, text)
        // A header is saved: the open source file is checked against it (the engine reads the header from disk).
        if (c.file === HPP) await client.save(HPP, text, CPP)
        await client.settle(900)
        entries = allShown(client)
        faults = judge(c, client, entries)
        if (faults.length) raw = describeRaw(client)
      } finally {
        await client.change(c.file, original[c.file])
        if (c.file === HPP) await client.save(HPP, original[HPP], CPP)
        await client.settle(900)
      }
      const first = (c.expect.items ?? [])[0]
      const summary = first ? `${first.file}:${first.line ?? '?'}:${first.col ?? '?'}` : c.expect.hole ? 'engine says nothing (known hole)' : 'nothing shown'
      console.log(`${c.id}: ${faults.length ? 'FAIL' : 'ok'} (${summary}, ${Date.now() - t0} ms)`)
      if (faults.length) {
        throw new Error(`${c.id} (${c.what})\n${faults.join('\n')}\nshown:\n${describeEntries(entries)}\n${raw}`)
      }
    }, 120000)
  }
})

// ---- headers, completion, signatures, hover, definitions, snippets ----------------------------------

const FRAG = (name: string): string => readFileSync(new URL(`../fixtures/editor-check/frag/${name}`, import.meta.url), 'utf8')

const rep = (t: string, a: string, b: string): string => {
  if (!t.includes(a)) throw new Error(`not found: ${a}`)
  return t.replace(a, b)
}

/** The line after which test code is put into `create()` of the Token template. */
const ANCHOR = '  check(maximum_supply.is_valid(), "invalid supply");'

interface CompletionItem {
  label: string
  filterText?: string
  insertText?: string
  sortText?: string
  textEdit?: { newText: string }
}

interface Location {
  uri?: string
  targetUri?: string
}

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

/** The name a completion item stands for. */
function nameOfItem(i: CompletionItem): string {
  return (i.filterText ?? i.label)
    .replace(/^[\s•]+/, '')
    .trim()
    .replace(/\(.*$/s, '')
}

function errorsOf(client: EngineClient, rel: string): Entry[] {
  return shown(client, rel).filter((e) => e.severity === 'error')
}

describe.skipIf(!AVAILABLE)('editor engine: a header that is being edited', () => {
  it('passes --use-dirty-headers to the engine', () => {
    expect(engineArguments('/x')).toContain('--use-dirty-headers')
  })

  it('an unsaved header edit reaches the open source file after one empty didChange', async () => {
    const project = makeProject('token', CONTRACT)
    const client = new EngineClient(project, DISTRO)
    try {
      await client.start()
      await client.open(CPP, project.files[CPP])
      await client.open(HPP, project.files[HPP])
      await client.settle(1500)
      expect(errorsOf(client, CPP), describeRaw(client)).toEqual([])
      const broken = rep(project.files[HPP], 'name issuer;\n    uint64_t primary_key() const { return supply', 'name isuer;\n    uint64_t primary_key() const { return supply')
      await client.change(HPP, broken)
      const ms = await client.touch(CPP, 3000).then(
        (n) => n,
        () => -1
      )
      const found = errorsOf(client, CPP).find((e) => matches(e, { line: 31, col: 18, text: "No member named 'issuer' in 'mytoken::currency_stats'; did you mean 'isuer'?" }))
      console.log(`dirty header, broken: ${found && ms >= 0 ? 'ok' : 'FAIL'} (${ms < 0 ? 'no publication in 3 s' : `${ms} ms`})`)
      expect(ms, 'the source file is checked again within 3 s').toBeGreaterThanOrEqual(0)
      expect(found, `${describeEntries(errorsOf(client, CPP))}\n${describeRaw(client)}`).toBeTruthy()
      await client.change(HPP, project.files[HPP])
      const back = await client.touch(CPP, 10000)
      await client.settle(600)
      console.log(`dirty header, put right: ${errorsOf(client, CPP).length === 0 ? 'ok' : 'FAIL'} (${back} ms)`)
      expect(errorsOf(client, CPP), describeRaw(client)).toEqual([])
    } finally {
      await client.stop()
      project.dispose()
    }
  }, 240000)
})

describe.skipIf(!AVAILABLE)('editor engine: a header that is a piece of another file', () => {
  const make = (): CheckProject =>
    makeProject('token', CONTRACT, { 'include/helpers.hpp': FRAG('helpers.hpp'), 'include/tables.inc.hpp': FRAG('tables.inc.hpp') }, (files) => {
      files[CPP] = rep(files[CPP], `#include <${CONTRACT}.hpp>\n`, `#include <${CONTRACT}.hpp>\n#include <helpers.hpp>\n`)
      files[HPP] = rep(files[HPP], '  using contract::contract;\n', '  using contract::contract;\n\n#include "tables.inc.hpp"\n')
    })

  const searchLines = (project: CheckProject): { file: string; text: string }[] =>
    Object.entries(project.files).flatMap(([file, text]) =>
      text
        .split('\n')
        .filter((l) => /^\s*#\s*include/.test(l))
        .map((l) => ({ file, text: l }))
    )

  it('the two pieces show errors of their own, the main file none, and isPiece follows the main file', async () => {
    const project = make()
    const client = new EngineClient(project, DISTRO)
    try {
      await client.start()
      const pieces = ['include/helpers.hpp', 'include/tables.inc.hpp']
      for (const rel of [CPP, HPP, ...pieces]) await client.open(rel, project.files[rel])
      await client.settle(1500)
      const counts = Object.fromEntries([CPP, HPP, ...pieces].map((rel) => [rel, errorsOf(client, rel).length]))
      console.log(`pieces: ${JSON.stringify(counts)}`)
      const detail = [...pieces, CPP, HPP].map((rel) => `${rel}\n${describeEntries(errorsOf(client, rel))}`).join('\n')
      expect(counts['include/helpers.hpp'], detail).toBe(7)
      expect(counts['include/tables.inc.hpp'], detail).toBe(5)
      expect(counts[CPP], detail).toBe(0)
      const lines = searchLines(project)
      for (const rel of pieces) {
        expect(isPiece({ headerErrors: counts[rel], mainFileErrors: counts[CPP], included: namedInInclude(lines, rel) }), rel).toBe(true)
      }
      // A slip in the main file: the pieces are not excused any more.
      await client.change(CPP, rep(project.files[CPP], 'require_auth(get_self());\n\n  auto sym', 'require_auth(get_self())\n\n  auto sym'))
      await client.settle(900)
      const broken = errorsOf(client, CPP).length
      console.log(`pieces, main file with a missing ';': ${broken} errors in the main file`)
      expect(broken).toBeGreaterThan(0)
      for (const rel of pieces) {
        expect(isPiece({ headerErrors: counts[rel], mainFileErrors: broken, included: namedInInclude(lines, rel) }), rel).toBe(false)
      }
    } finally {
      await client.stop()
      project.dispose()
    }
  }, 240000)
})

describe.skipIf(!AVAILABLE)('editor engine: completion, signatures, hover, definitions, snippets', () => {
  let project: CheckProject
  let client: EngineClient
  let cpp = ''
  let hpp = ''

  beforeAll(async () => {
    project = makeProject('token', CONTRACT)
    client = new EngineClient(project, DISTRO)
    await client.start()
    cpp = project.files[CPP]
    hpp = project.files[HPP]
    await client.open(CPP, cpp)
    await client.open(HPP, hpp)
    await client.settle(1500)
  }, 240000)

  afterAll(async () => {
    await client?.stop()
    project?.dispose()
  })

  /** Sets the text of an open document unless it already is that text (the engine does not answer an unchanged one). */
  const put = async (rel: string, text: string): Promise<void> => {
    if (client.text(rel) !== text) await client.change(rel, text)
  }

  /** The Token source with `insert` on a new line after the anchor; the offset is the end of `upTo` (default: all of it), the cursor. */
  const withInsert = (insert: string, upTo = insert): { text: string; offset: number } => {
    const text = rep(cpp, ANCHOR, `${ANCHOR}\n  ${insert}`)
    return { text, offset: text.indexOf(ANCHOR) + ANCHOR.length + 3 + upTo.length }
  }

  async function complete(text: string, offset: number, trigger?: string): Promise<{ raw: CompletionItem[]; shown: CompletionItem[]; names: string[]; ms: number }> {
    await put(CPP, text)
    const pos = offsetToPos(text, offset)
    const lineBefore = text.slice(text.lastIndexOf('\n', offset - 1) + 1, offset)
    const inInclude = /^\s*#\s*include/.test(lineBefore)
    const t0 = Date.now()
    const r = (await client.ask('textDocument/completion', {
      textDocument: { uri: client.serverUri(CPP) },
      position: pos,
      context: trigger ? { triggerKind: 2, triggerCharacter: trigger } : { triggerKind: 1 }
    })) as { items?: CompletionItem[] } | CompletionItem[] | null
    const ms = Date.now() - t0
    const raw = Array.isArray(r) ? r : (r?.items ?? [])
    const kept = raw.filter((i) => keepCompletion(i, inInclude))
    kept.sort((a, b) => {
      const x = sortTextFor(a) ?? ''
      const y = sortTextFor(b) ?? ''
      return x < y ? -1 : x > y ? 1 : 0
    })
    return { raw, shown: kept, names: kept.map(nameOfItem), ms }
  }

  async function completeAfter(insert: string): Promise<{ names: string[]; shown: CompletionItem[]; raw: CompletionItem[]; ms: number }> {
    const { text, offset } = withInsert(insert)
    return complete(text, offset)
  }

  const expectNames = (label: string, names: string[], wanted: string[]): void => {
    const missing = wanted.filter((w) => !names.includes(w))
    console.log(`completion ${label}: ${missing.length ? 'FAIL' : 'ok'} (${names.length} shown${missing.length ? `, missing ${missing.join(', ')}` : ''})`)
    expect(missing, `${label}: ${names.slice(0, 30).join(' ')}`).toEqual([])
  }

  const CASES_COMPLETION: [string, string, string[]][] = [
    ['issuer.', 'issuer.', ['value', 'to_string', 'length', 'suffix', 'prefix']],
    ['maximum_supply.', 'maximum_supply.', ['amount', 'symbol', 'is_valid']],
    ['sym.', 'sym.', ['code', 'precision', 'raw']],
    ['a stats object', 'stats t(get_self(), 0); t.', ['find', 'emplace', 'modify', 'erase', 'get', 'require_find', 'begin', 'end', 'get_index', 'available_primary_key']],
    ['it->', 'stats t(get_self(), 0); auto it = t.find(1); it->', ['supply', 'max_supply', 'issuer']],
    ['get_self().', 'get_self().', ['value']],
    ['eosio::', 'eosio::', ['name', 'asset', 'symbol', 'check', 'require_auth', 'contract', 'permission_level']]
  ]
  for (const [label, insert, wanted] of CASES_COMPLETION) {
    it(`completion: ${label}`, async () => {
      const r = await completeAfter(insert)
      expectNames(label, r.names, wanted)
      if (label === 'issuer.') {
        const bad = r.names.filter((n) => n.startsWith('_bluegrass_'))
        expect(bad, 'no name starting with _bluegrass_').toEqual([])
      }
    })
  }

  it('completion: require_ has require_auth first and no internal_use_do_not_use', async () => {
    const r = await completeAfter('require_')
    console.log(`completion require_: first ${r.names[0]}`)
    expect(r.names[0]).toBe('require_auth')
    const internal = r.shown.filter((i) => `${i.label}${i.filterText ?? ''}${i.insertText ?? ''}`.includes('internal_use_do_not_use'))
    expect(internal.map((i) => i.label)).toEqual([])
  })

  // The engine's list for `eosio::` alone does not hold `action` (49 items, none of that name); it comes with the first typed letters.
  it('completion: eosio::ac has action', async () => {
    const r = await completeAfter('eosio::ac')
    expectNames('eosio::ac', r.names, ['action'])
  })

  it('completion: eosio::mu has multi_index first', async () => {
    const r = await completeAfter('eosio::mu')
    console.log(`completion eosio::mu: first ${r.names[0]}`)
    expect(r.names[0]).toBe('multi_index')
  })

  it('completion: #include <eosio/ lists the headers', async () => {
    const r = await complete('#include <eosio/\n' + cpp, '#include <eosio/'.length, '/')
    const labels = r.shown.map((i) => i.label.trim())
    const has = (h: string): boolean => labels.includes(h) || r.names.includes(h)
    const missing = ['asset.hpp>', 'eosio.hpp>', 'multi_index.hpp>', 'singleton.hpp>'].filter((h) => !has(h))
    console.log(`completion #include <eosio/: ${missing.length ? 'FAIL' : 'ok'} (${labels.length} shown)`)
    expect(missing, labels.join(' ')).toEqual([])
  })

  it('completion: #include < has no entry starting with _', async () => {
    const r = await complete('#include <\n' + cpp, '#include <'.length, '<')
    const under = r.shown.filter((i) => i.label.trim().replace(/^[•\s]+/, '').startsWith('_')).map((i) => i.label)
    console.log(`completion #include <: ${under.length ? 'FAIL' : 'ok'} (${r.shown.length} shown of ${r.raw.length})`)
    expect(under).toEqual([])
    expect(r.shown.length).toBeGreaterThan(0)
  })

  it('row lambda: the engine gives nothing, the row type and workspace symbols give the members', async () => {
    const { text, offset } = withInsert('stats t(get_self(), 0); t.emplace(get_self(), [&](auto& s) { s. });', 'stats t(get_self(), 0); t.emplace(get_self(), [&](auto& s) { s.')
    const r = await complete(text, offset)
    expect(r.raw.length, 'the engine gives no item inside the row lambda').toBe(0)
    const lambda = rowLambdaAt(text, offset)
    expect(lambda, 'rowLambdaAt finds the lambda').not.toBeNull()
    expect(lambda?.param).toBe('s')
    expect(memberAccessBefore(text.slice(text.lastIndexOf('\n', offset - 1) + 1, offset))?.id).toBe('s')
    const hover = (await client.ask('textDocument/hover', { textDocument: { uri: client.serverUri(CPP) }, position: offsetToPos(text, (lambda?.tableExprEnd ?? 1) - 1) })) as { contents?: { value?: string } | string } | null
    const hoverText = typeof hover?.contents === 'string' ? hover.contents : (hover?.contents?.value ?? '')
    const row = rowTypeOf(hoverText)
    expect(row, `row type from hover ${JSON.stringify(hoverText.slice(0, 300))}`).toBeTruthy()
    const symbols = (await client.ask('workspace/symbol', { query: `${row}::` })) as { name: string; containerName?: string }[] | null
    const names = (symbols ?? []).map((x) => x.name)
    console.log(`row lambda: row type ${row}, members ${names.join(' ')}`)
    const missing = ['supply', 'max_supply', 'issuer', 'primary_key'].filter((n) => !names.includes(n))
    expect(missing, names.join(' ')).toEqual([])
  })

  async function signatures(insert: string): Promise<string[]> {
    const { text, offset } = withInsert(insert)
    await put(CPP, text)
    const r = (await client.ask('textDocument/signatureHelp', { textDocument: { uri: client.serverUri(CPP) }, position: offsetToPos(text, offset) })) as { signatures?: { label: string }[] } | null
    return (r?.signatures ?? []).map((s) => s.label)
  }

  it('signature help: require_auth( has 2 signatures', async () => {
    const s = await signatures('require_auth(')
    expect(s, s.join(' | ')).toHaveLength(2)
  })

  it('signature help: check( has 7 signatures', async () => {
    const s = await signatures('check(')
    expect(s, s.join(' | ')).toHaveLength(7)
  })

  it('signature help: emplace( has 1 signature with `name payer`', async () => {
    const s = await signatures('stats t(get_self(), 0); t.emplace(')
    expect(s, s.join(' | ')).toHaveLength(1)
    expect(s[0]).toContain('name payer')
  })

  it('signature help: asset a( has asset(int64_t a, class symbol s)', async () => {
    const s = await signatures('asset a(')
    expect(
      s.some((l) => l.includes('asset(int64_t a, class symbol s)')),
      s.join(' | ')
    ).toBe(true)
  })

  const hoverCases: [string, string, number][] = [
    ['require_auth', 'require_auth(get_self())', 1],
    ['get_self', 'get_self()', 1],
    ['check', 'check(sym.is_valid()', 1],
    ['same_payer', 'same_payer', 1],
    ['amount', 'amount > 0', 1]
  ]
  for (const [label, needle, delta] of hoverCases) {
    it(`hover: ${label} has text without @`, async () => {
      await put(CPP, cpp)
      const at = cpp.indexOf(needle)
      expect(at, `${needle} is in the template`).toBeGreaterThanOrEqual(0)
      const r = (await client.ask('textDocument/hover', { textDocument: { uri: client.serverUri(CPP) }, position: offsetToPos(cpp, at + delta) })) as { contents?: { value?: string } | string } | null
      const value = typeof r?.contents === 'string' ? r.contents : (r?.contents?.value ?? '')
      console.log(`hover ${label}: ${value ? 'ok' : 'FAIL'} (${value.length} characters)`)
      expect(value.length).toBeGreaterThan(0)
      expect(cleanDoc(value), value.slice(0, 300)).not.toContain('@')
    })
  }

  async function definition(rel: string, text: string, needle: string, delta = 1): Promise<string[]> {
    const at = text.indexOf(needle)
    expect(at, `${needle} is in ${rel}`).toBeGreaterThanOrEqual(0)
    const pos = offsetToPos(text, at + delta)
    for (let attempt = 0; ; attempt++) {
      const r = (await client.ask('textDocument/definition', { textDocument: { uri: client.serverUri(rel) }, position: pos })) as Location | Location[] | null
      const uris = (Array.isArray(r) ? r : r ? [r] : []).map((l) => l.uri ?? l.targetUri ?? '')
      if (uris.length || attempt >= 10) return uris
      await sleep(1000)
    }
  }

  const defCases: [string, string, string, string][] = [
    ['check', 'check(sym.is_valid()', CPP, 'eosio/check.hpp'],
    ['require_auth', 'require_auth(get_self())', CPP, 'eosio/action.hpp'],
    ['name', 'name& issuer', CPP, 'eosio/name.hpp'],
    ['asset', 'asset& maximum_supply', CPP, 'eosio/asset.hpp'],
    ['multi_index', 'multi_index<"accounts"_n', HPP, 'eosio/multi_index.hpp'],
    ['the action definition goes to its declaration', 'create(const name& issuer', CPP, `include/${CONTRACT}.hpp`],
    ['the action declaration goes back to its definition', 'create(const name& issuer, const asset& maximum_supply);', HPP, `src/${CONTRACT}.cpp`]
  ]
  for (const [label, needle, rel, target] of defCases) {
    it(`definition: ${label}`, async () => {
      await put(CPP, cpp)
      const uris = await definition(rel, rel === CPP ? cpp : hpp, needle)
      console.log(`definition ${label}: ${uris.some((u) => u.endsWith(target)) ? 'ok' : 'FAIL'} (${uris.map((u) => u.split('/').slice(-2).join('/')).join(', ') || 'nothing'})`)
      expect(uris.some((u) => u.endsWith(target)), uris.join(' | ')).toBe(true)
    })
  }

  /** A snippet body with each placeholder replaced by its default text. */
  const filled = (body: string): string => body.replace(/\$\{\d+:([^}]*)\}/g, '$1').replace(/\$\d+/g, '')

  for (const sn of SNIPPETS) {
    it(`snippet ${sn.label}: filled with its defaults it gives no error`, async () => {
      const code = filled(sn.body)
      const indented = code
        .split('\n')
        .map((l) => `  ${l}`)
        .join('\n')
      let cppText = cpp
      let hppText = hpp
      if (sn.where === 'member') {
        if (sn.label === 'singleton') hppText = rep(hppText, '#include <eosio/eosio.hpp>\n', '#include <eosio/eosio.hpp>\n#include <eosio/singleton.hpp>\n')
        hppText = rep(hppText, '\nprivate:\n', `\n${indented}\n\nprivate:\n`)
      } else {
        // `retire` has statstable, st, quantity and memo; the snippet goes before its last statement.
        cppText = rep(cppText, '  sub_balance(st.issuer, quantity);\n}', `${indented}\n\n  sub_balance(st.issuer, quantity);\n}`)
      }
      try {
        await put(HPP, hppText)
        await put(CPP, cppText)
        await client.save(HPP, hppText, CPP)
        await client.settle(900)
        const bad = allShown(client).filter((e) => e.severity !== 'hint')
        console.log(`snippet ${sn.label}: ${bad.length ? 'FAIL' : 'ok'}`)
        expect(bad, `${code}\n${describeEntries(bad)}\n${describeRaw(client)}`).toEqual([])
      } finally {
        await put(HPP, hpp)
        await put(CPP, cpp)
        await client.save(HPP, hpp, CPP)
        await client.settle(900)
      }
    }, 120000)
  }

  it('latency: diagnostics after a one-character change under 1.5 s, completion under 0.5 s', async () => {
    await put(CPP, cpp)
    await client.settle(900)
    const diagnostics: number[] = []
    for (let n = 0; n < 4; n++) {
      const t0 = Date.now()
      await client.change(CPP, n % 2 === 0 ? `${cpp} ` : cpp)
      diagnostics.push(Date.now() - t0)
      await client.settle(300)
    }
    const completions: number[] = []
    for (let n = 0; n < 4; n++) completions.push((await completeAfter('eosio::')).ms)
    // The first measurement of each kind is a warm-up.
    const d = median(diagnostics.slice(1))
    const c = median(completions.slice(1))
    console.log(`latency: diagnostics ${diagnostics.join(', ')} ms (median ${d}), completion ${completions.join(', ')} ms (median ${c})`)
    expect(d, 'diagnostics after a one-character change').toBeLessThan(1500)
    expect(c, 'completion').toBeLessThan(500)
    await put(CPP, cpp)
  })
})
