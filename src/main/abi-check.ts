// ABI check after every successful compile. The compiler's ABI is read with the
// chain core's reader and every inconsistency is collected (not only the first):
// a table, action, struct field, base, variant, alias or action result naming a
// type the ABI does not define, and duplicate names. Each finding gets one
// explanation (what, why, fix) and, when a search of the project's sources finds
// it, the place in the code. The ABI file itself is never changed.

import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import { BUILTIN_CODECS, compileAbi, parseAbi, type AbiDef } from '../chain-core'
import type { AbiFinding, Problem } from '../shared/api'
import { ABI_CHECK_PREFIX } from '../shared/output-lines'

type Kind = AbiFinding['kind']

/** A finding before the source search: what is wrong and where it is in the ABI. */
export interface RawAbiFinding {
  kind: Kind
  subject: string
  type: string
  /** For a field or base: the struct it belongs to. For a duplicate: what was duplicated ("action", "table", "type"). */
  owner?: string
  /** Text of the reader's error for kind "invalid". */
  detail?: string
}

const REFUSED = 'The chain refuses such an ABI, so Deploy is stopped.'

/** Strips `[]`, `?` and the binary-extension `$` from a type reference. */
function baseType(t: string): string {
  let cur = t.endsWith('$') ? t.slice(0, -1) : t
  for (let i = 0; i < 64; i++) {
    if (cur.endsWith('[]')) cur = cur.slice(0, -2)
    else if (cur.endsWith('?')) cur = cur.slice(0, -1)
    else break
  }
  return cur
}

/** Collects every inconsistency of an ABI text. An empty list means the chain core accepts it. */
export function checkAbi(text: string): RawAbiFinding[] {
  let def: AbiDef
  try {
    def = parseAbi(text)
  } catch (e) {
    return [{ kind: 'invalid', subject: '', type: '', detail: e instanceof Error ? e.message : String(e) }]
  }
  const out: RawAbiFinding[] = []
  const typeNames = new Map<string, number>()
  for (const t of def.types) typeNames.set(t.new_type_name, (typeNames.get(t.new_type_name) ?? 0) + 1)
  for (const s of def.structs) typeNames.set(s.name, (typeNames.get(s.name) ?? 0) + 1)
  for (const v of def.variants ?? []) typeNames.set(v.name, (typeNames.get(v.name) ?? 0) + 1)
  const known = (t: string): boolean => {
    const b = baseType(t)
    return typeNames.has(b) || b in BUILTIN_CODECS || b === 'extended_asset'
  }
  const seen = new Set<string>()
  const add = (f: RawAbiFinding): void => {
    const key = `${f.kind}|${f.subject}|${f.type}|${f.owner ?? ''}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(f)
  }

  for (const t of def.tables) if (!known(t.type)) add({ kind: 'table-type', subject: t.name, type: t.type })
  for (const a of def.actions) if (!known(a.type)) add({ kind: 'action-type', subject: a.name, type: a.type })
  for (const s of def.structs) {
    if (s.base && !known(s.base)) add({ kind: 'base-type', subject: s.name, type: s.base })
    for (const f of s.fields) if (!known(f.type)) add({ kind: 'field-type', subject: f.name, type: f.type, owner: s.name })
  }
  for (const v of def.variants ?? []) for (const t of v.types) if (!known(t)) add({ kind: 'variant-type', subject: v.name, type: t })
  for (const t of def.types) if (!known(t.type)) add({ kind: 'alias-type', subject: t.new_type_name, type: t.type })
  for (const r of def.action_results ?? []) if (!known(r.result_type)) add({ kind: 'result-type', subject: r.name, type: r.result_type })

  const dup = (names: string[], what: string): void => {
    const count = new Map<string, number>()
    for (const n of names) count.set(n, (count.get(n) ?? 0) + 1)
    for (const [n, c] of count) if (c > 1) add({ kind: 'duplicate', subject: n, type: '', owner: what })
  }
  dup([...def.types.map((t) => t.new_type_name), ...def.structs.map((s) => s.name), ...(def.variants ?? []).map((v) => v.name)], 'type')
  dup(def.actions.map((a) => a.name), 'action')
  dup(def.tables.map((t) => t.name), 'table')

  // Anything else the reader refuses (a base that is not a struct, a circular alias, ...).
  if (out.length === 0) {
    try {
      compileAbi(def)
    } catch (e) {
      out.push({ kind: 'invalid', subject: '', type: '', detail: e instanceof Error ? e.message : String(e) })
    }
  }
  return out
}

// ---------------------------------------------------------------- source search

export interface SourceFile {
  /** Project-relative path with forward slashes. */
  rel: string
  lines: string[]
}

const SOURCE_EXT = /\.(hpp|cpp|h|hh|hxx|cc|cxx)$/i
const MAX_SOURCE_FILES = 5000
const MAX_SOURCE_BYTES = 4 * 1024 * 1024

/** Reads the project's C++ sources (skips dot folders and node_modules). */
export async function readSources(root: string): Promise<SourceFile[]> {
  const out: SourceFile[] = []
  const walk = async (dir: string, rel: string): Promise<void> => {
    if (out.length >= MAX_SOURCE_FILES) return
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const e of entries) {
      if (out.length >= MAX_SOURCE_FILES) return
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue
        await walk(join(dir, e.name), r)
      } else if (e.isFile() && SOURCE_EXT.test(e.name)) {
        try {
          const st = await fsp.stat(join(dir, e.name))
          if (st.size > MAX_SOURCE_BYTES) continue
          const text = await fsp.readFile(join(dir, e.name), 'utf8')
          out.push({ rel: r, lines: text.split(/\r?\n/) })
        } catch {
          // unreadable file: skipped
        }
      }
    }
  }
  await walk(root, '')
  // Headers first: declarations live there more often than in the .cpp files.
  out.sort((a, b) => Number(/\.cpp$|\.cc$|\.cxx$/i.test(a.rel)) - Number(/\.cpp$|\.cc$|\.cxx$/i.test(b.rel)))
  return out
}

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export interface Place {
  file: string
  line: number
  column: number
  text: string
}

/** First line matching any of the patterns, in pattern order. */
function search(sources: SourceFile[], patterns: RegExp[]): Place | null {
  for (const re of patterns) {
    for (const f of sources) {
      for (let i = 0; i < f.lines.length; i++) {
        const m = re.exec(f.lines[i])
        if (m) return { file: f.rel, line: i + 1, column: m.index + 1, text: f.lines[i] }
      }
    }
  }
  return null
}

function typeDefinition(name: string): RegExp[] {
  const n = esc(name)
  return [
    new RegExp(`\\b(struct|class)\\s+(\\[\\[[^\\]]*\\]\\]\\s*)?${n}\\b`),
    new RegExp(`\\b(typedef\\b.*\\b${n}\\s*;|using\\s+${n}\\s*=)`),
    new RegExp(`\\b${n}\\b`)
  ]
}

/** The source place of a finding, or null. */
export function findPlace(f: RawAbiFinding, sources: SourceFile[]): Place | null {
  switch (f.kind) {
    case 'table-type': {
      const t = esc(f.subject)
      const ty = esc(baseType(f.type))
      return search(sources, [new RegExp(`"${t}"_n.*\\b${ty}\\b`), new RegExp(`"${t}"_n`), ...typeDefinition(baseType(f.type))])
    }
    case 'action-type':
    case 'result-type':
      return search(sources, [new RegExp(`\\beosio::action\\b.*\\b${esc(f.subject)}\\s*\\(`), new RegExp(`\\b${esc(f.subject)}\\s*\\(`)])
    case 'field-type':
      return search(sources, [...typeDefinition(f.owner ?? '').slice(0, 1), ...typeDefinition(baseType(f.type))])
    case 'base-type':
    case 'variant-type':
    case 'alias-type':
      return search(sources, typeDefinition(f.subject).slice(0, 2).concat(typeDefinition(baseType(f.type))))
    case 'duplicate':
      return search(sources, f.owner === 'table' ? [new RegExp(`"${esc(f.subject)}"_n`)] : typeDefinition(f.subject))
    default:
      return null
  }
}

/**
 * The account of the other contract a foreign table is read from, when the code
 * shows it: `land_coinconf_t t(LANDS_CONTRACT, ...)` and `LANDS_CONTRACT = "chickandland"_n`.
 */
export function otherContractOf(f: RawAbiFinding, sources: SourceFile[]): string | null {
  const t = esc(f.subject)
  const ty = esc(baseType(f.type))
  let alias: string | null = null
  for (const s of sources) {
    for (const line of s.lines) {
      const m =
        new RegExp(`typedef\\s+[\\w:]*(?:singleton|multi_index)\\s*<\\s*"${t}"_n\\s*,\\s*${ty}\\b.*>\\s*(\\w+)\\s*;`).exec(line) ??
        new RegExp(`using\\s+(\\w+)\\s*=\\s*[\\w:]*(?:singleton|multi_index)\\s*<\\s*"${t}"_n\\s*,\\s*${ty}\\b`).exec(line)
      if (m) {
        alias = m[1]
        break
      }
    }
    if (alias) break
  }
  if (!alias) return null
  let code: string | null = null
  const use = new RegExp(`\\b${esc(alias)}\\s+\\w+\\s*[({]\\s*(?:"([a-z1-5.]{1,13})"_n|name\\s*\\(\\s*"([a-z1-5.]{1,13})"\\s*\\)|([A-Za-z_][\\w:]*))`)
  for (const s of sources) {
    for (const line of s.lines) {
      const m = use.exec(line)
      if (!m) continue
      if (m[1] || m[2]) return m[1] || m[2]
      code = m[3]
      break
    }
    if (code) break
  }
  if (!code || code === 'get_self' || code === '_self') return null
  const id = esc(code.split('::').pop() ?? code)
  const def = new RegExp(`\\b${id}\\s*(?:=|\\{|\\()\\s*(?:name\\s*\\(\\s*)?"([a-z1-5.]{1,13})"(?:_n)?`)
  for (const s of sources) for (const line of s.lines) {
    const m = def.exec(line)
    if (m) return m[1]
  }
  return null
}

// ---------------------------------------------------------------- explanation

function placeText(p: Place | null): string {
  return p ? ` (${p.file}:${p.line})` : ''
}

/** The explanation of one finding: first line "ABI check: ...", then Why and Fix. */
export function explain(f: RawAbiFinding, place: Place | null, other: string | null = null): string {
  const ty = f.type
  switch (f.kind) {
    case 'table-type': {
      const tn = baseType(ty)
      const ns = other ? other.replace(/[^A-Za-z0-9_]/g, '_') : '<other contract>'
      return [
        `${ABI_CHECK_PREFIX} table \`${f.subject}\` uses the type \`${ty}\`, but the ABI does not define it. ${REFUSED}`,
        `Why: the code declares a table type for \`${f.subject}\`${placeText(place)}, and the struct \`${tn}\` is not marked as a table. Older compilers (CDT 1.8) left such a table out of the ABI; this one writes the table entry without the struct.`,
        'Fix, one of:',
        `(a) The table belongs to another contract and is only read here: move the struct \`${tn}\` and its typedef out of the contract class, for example into \`namespace ${ns} { ... }\` above the class. The compiler then leaves the table out of this ABI.`,
        `(b) The table belongs to this contract: mark the struct, \`struct [[eosio::table("${f.subject}")]] ${tn}\`. The table and the struct are then both in the ABI.`
      ].join('\n')
    }
    case 'action-type':
      return [
        `${ABI_CHECK_PREFIX} action \`${f.subject}\` uses the type \`${ty}\`, but the ABI does not define it. ${REFUSED}`,
        `Why: the ABI lists the action${placeText(place)} without the struct that describes its parameters.`,
        `Fix: declare the action as a member function of the contract class marked \`[[eosio::action]]\`, so the compiler writes its parameter struct, and build again.`
      ].join('\n')
    case 'result-type':
      return [
        `${ABI_CHECK_PREFIX} action \`${f.subject}\` returns the type \`${ty}\`, but the ABI does not define it. ${REFUSED}`,
        `Why: the action's return type${placeText(place)} is not a type the compiler wrote into the ABI.`,
        `Fix: return a built-in type or a struct the ABI describes (a plain struct with fields, or one with \`EOSLIB_SERIALIZE\`).`
      ].join('\n')
    case 'field-type':
      return [
        `${ABI_CHECK_PREFIX} field \`${f.subject}\` of struct \`${f.owner}\` uses the type \`${ty}\`, but the ABI does not define it. ${REFUSED}`,
        `Why: the struct${placeText(place)} refers to a type the compiler did not write into the ABI.`,
        `Fix: give the field a built-in type or a struct the ABI describes, or declare \`${baseType(ty)}\` as a plain struct the contract uses.`
      ].join('\n')
    case 'base-type':
      return [
        `${ABI_CHECK_PREFIX} struct \`${f.subject}\` has the base \`${ty}\`, but the ABI does not define it. ${REFUSED}`,
        `Why: the struct${placeText(place)} derives from a type the compiler did not write into the ABI.`,
        `Fix: make \`${baseType(ty)}\` a plain struct the ABI can describe, or copy its fields into \`${f.subject}\`.`
      ].join('\n')
    case 'variant-type':
      return [
        `${ABI_CHECK_PREFIX} variant \`${f.subject}\` lists the type \`${ty}\`, but the ABI does not define it. ${REFUSED}`,
        `Why: one alternative of the variant${placeText(place)} is a type the compiler did not write into the ABI.`,
        `Fix: use only built-in types or structs the ABI describes in the variant.`
      ].join('\n')
    case 'alias-type':
      return [
        `${ABI_CHECK_PREFIX} type \`${f.subject}\` stands for \`${ty}\`, but the ABI does not define \`${baseType(ty)}\`. ${REFUSED}`,
        `Why: the typedef${placeText(place)} names a type the compiler did not write into the ABI.`,
        `Fix: let the typedef name a built-in type or a struct the ABI describes.`
      ].join('\n')
    case 'duplicate':
      return [
        `${ABI_CHECK_PREFIX} the ${f.owner} name \`${f.subject}\` appears more than once in the ABI. ${REFUSED}`,
        `Why: two declarations${placeText(place)} produce the same ${f.owner} name.`,
        `Fix: rename one of them, or remove the second declaration.`
      ].join('\n')
    default:
      return [
        `${ABI_CHECK_PREFIX} the ABI is not valid: ${f.detail ?? 'unknown reason'}. ${REFUSED}`,
        'Why: the compiler wrote an ABI that the chain core reader refuses.',
        'Fix: correct the declaration named above in the source and build again.'
      ].join('\n')
  }
}

/** Line of the ABI JSON that names the subject (a fallback place when the source search finds nothing). */
function abiLineOf(abiText: string, f: RawAbiFinding): number {
  const lines = abiText.split(/\r?\n/)
  const want = f.subject ? `"${f.subject}"` : f.type ? `"${f.type}"` : ''
  if (!want) return 1
  const i = lines.findIndex((l) => l.includes(want))
  return i >= 0 ? i + 1 : 1
}

/** Checks an ABI text and explains every finding with its source place. */
export function describeAbi(abiText: string, abiRel: string, sources: SourceFile[]): AbiFinding[] {
  return checkAbi(abiText).map((f) => {
    const place = findPlace(f, sources)
    const other = f.kind === 'table-type' ? otherContractOf(f, sources) : null
    return {
      kind: f.kind,
      subject: f.subject,
      type: f.type,
      text: explain(f, place, other),
      place: place ? { file: place.file, line: place.line, column: place.column } : { file: abiRel, line: abiLineOf(abiText, f), column: 1 }
    }
  })
}

/** Reads the project's ABI and sources and returns the findings (empty: deployable). */
export async function checkProjectAbi(root: string, abiRel: string): Promise<AbiFinding[]> {
  const text = await fsp.readFile(join(root, abiRel), 'utf8')
  if (checkAbi(text).length === 0) return []
  return describeAbi(text, abiRel, await readSources(root))
}

/** Problems entries (source "abi") for the findings. */
export function abiProblems(findings: AbiFinding[]): Problem[] {
  return findings.map((f) => ({
    file: f.place?.file ?? '',
    line: f.place?.line ?? 1,
    column: f.place?.column ?? 1,
    severity: 'error' as const,
    message: f.text.replace(new RegExp(`^${esc(ABI_CHECK_PREFIX)}\\s*`), ''),
    source: 'abi' as const
  }))
}
