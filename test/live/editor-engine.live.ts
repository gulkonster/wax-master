// The scripted editor check (`npm run check:editor`). It starts the editor
// engine in the toolchain distro on projects made from the shipped templates,
// makes the 52 deliberate slips of test/fixtures/editor-check/cases.ts and
// compares what the window would show with the expected place and words.
// Every engine answer goes through the window's pipeline in its order:
// keepDiagnostic, rewriteDiagnostic, replacedByCheck, placeDiagnostics,
// cleanMessage, plus contractChecks on the text.
//
// It needs WSL and the toolchain (Help > Setup), so it is not part of
// `npx vitest run`. The distro comes from WAX_DISTRO (default
// waxmaster-wax-cdt-4.1.1wax01); without it the suite is skipped with one line.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { contractChecks, replacedByCheck } from '../../src/shared/contract-checks'
import { FLAG_SETUP, keepDiagnostic, rewriteDiagnostic, type LspDiagnostic } from '../../src/shared/lsp-diagnostics'
import { cleanMessage } from '../../src/shared/lsp-messages'
import { placeDiagnostics } from '../../src/shared/lsp-place'
import { EXAMPLES, type TemplateId } from '../../src/shared/project'
import { CASES, CPP, CONTRACT, HPP, type Case, type Item, type Severity } from '../fixtures/editor-check/cases'
import { distroInstalled, distroName, EngineClient, makeProject, type CheckProject } from './lsp-harness'

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

function describeRaw(client: EngineClient): string {
  return [CPP, HPP]
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
