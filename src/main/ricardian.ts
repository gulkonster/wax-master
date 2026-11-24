// Ricardian files of a project: `<contract>.contracts.md` with one section per
// action of the built ABI, and `<contract>.clauses.md` when it does not exist.
// An existing file is only ever extended at its end: sections for actions that
// have none are appended, nothing already in the file is read back or written
// again, so its old bytes stay exactly as they were.

import { existsSync, promises as fsp, realpathSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { parseAbi, type AbiDef } from '../chain-core/abi'
import type { RicardianResult } from '../shared/api'
import { effectiveOutput, effectiveResource, type ProjectConfig } from '../shared/project'
import { relPath } from '../shared/validate'

/** Largest ABI and Ricardian file read here. */
const MAX_FILE = 5 * 1024 * 1024
/** Deepest chain of struct bases or type aliases followed. */
const MAX_DEPTH = 32

export interface RicardianParam {
  name: string
  type: string
}

export interface RicardianAction {
  name: string
  params: RicardianParam[]
}

/** An action name as the chain writes it; anything else gets no section. */
const ACTION_NAME = /^[a-z1-5.]{1,13}$/
/** Parameter names and types listed in a section: plain words only. */
const PARAM_NAME = /^[A-Za-z0-9_]{1,64}$/
const PARAM_TYPE = /^[A-Za-z0-9_[\]?$]{1,64}$/

/** The heading the ABI generator looks for in front of each action's text. */
const CONTRACT_HEADING = /<h1 class="contract">\s*([^<]*?)\s*<\/h1>/g

/** Actions of an ABI with their parameters (fields of the action's struct, base fields first). */
export function actionsFromAbi(abi: AbiDef | string): RicardianAction[] {
  const def = typeof abi === 'string' ? parseAbi(abi) : abi
  const aliases = new Map(def.types.map((t) => [t.new_type_name, t.type]))
  const structs = new Map(def.structs.map((s) => [s.name, s]))
  const resolveAlias = (t: string): string => {
    let cur = t
    for (let i = 0; i < MAX_DEPTH && aliases.has(cur); i++) cur = aliases.get(cur)!
    return cur
  }
  const fieldsOf = (type: string): RicardianParam[] => {
    const chain: RicardianParam[][] = []
    let name = resolveAlias(type)
    const seen = new Set<string>()
    for (let i = 0; i < MAX_DEPTH; i++) {
      const s = structs.get(name)
      if (!s || seen.has(name)) break
      seen.add(name)
      chain.unshift(s.fields.map((f) => ({ name: f.name, type: f.type })))
      if (!s.base) break
      name = resolveAlias(s.base)
    }
    return chain.flat()
  }
  const plain = (p: RicardianParam): boolean => PARAM_NAME.test(p.name) && PARAM_TYPE.test(p.type)
  return def.actions.map((a) => ({ name: a.name, params: fieldsOf(a.type).filter(plain) }))
}

function titleOf(action: string): string {
  return action.charAt(0).toUpperCase() + action.slice(1)
}

/**
 * The section written for one action: the heading, the front block
 * (spec_version, title, summary with the parameters as variables) and a body
 * with the place for the description and the parameter list with types.
 * Lines end with `eol`; the section ends with one line end.
 */
export function ricardianSection(action: RicardianAction, eol = '\n'): string {
  const vars = action.params.map((p) => `{{${p.name}}}`).join(', ')
  const summary = `TODO: one line about ${action.name}${vars ? `. Values: ${vars}` : ''}`
  const lines = [
    `<h1 class="contract">${action.name}</h1>`,
    '',
    '---',
    'spec_version: "0.2.0"',
    `title: "${titleOf(action.name)}"`,
    `summary: '${summary}'`,
    '---',
    '',
    'TODO: say in plain words what the signer agrees to.',
    ''
  ]
  if (action.params.length === 0) lines.push('Parameters: none.')
  else lines.push('Parameters:', ...action.params.map((p) => `- ${p.name} (${p.type})`))
  return lines.join(eol) + eol
}

/** The clauses file written when the project has none (one clause, so the ABI generator finds it not empty). */
export function ricardianClauses(eol = '\n'): string {
  return ['<h1 class="clause">terms</h1>', '', 'TODO: terms that apply to every action of this contract.'].join(eol) + eol
}

/** Names of the actions that already have a section in a contracts file. */
export function contractSectionNames(text: string): Set<string> {
  const out = new Set<string>()
  for (const m of text.matchAll(CONTRACT_HEADING)) out.add(m[1])
  return out
}

/** True for a name that may get a section: a chain action name. */
export function isActionName(name: string): boolean {
  return ACTION_NAME.test(name)
}

export interface ExtendResult {
  /** The new file text; it starts with the old text unchanged. */
  text: string
  /** The part appended to the old text (empty when nothing was added). */
  appended: string
  added: string[]
  kept: string[]
  /** Actions without a section because their name is not a chain action name. */
  skipped: number
  /** 1-based line of the first added section (0 when nothing was added). */
  firstAddedLine: number
}

/** Appends a section for every action without one; the existing text stays exactly as it is. */
export function extendContracts(existing: string, actions: RicardianAction[]): ExtendResult {
  const have = contractSectionNames(existing)
  const added: string[] = []
  const kept: string[] = []
  const seen = new Set<string>()
  const missing: RicardianAction[] = []
  let skipped = 0
  for (const a of actions) {
    if (!isActionName(a.name)) {
      skipped++
      continue
    }
    if (seen.has(a.name)) continue
    seen.add(a.name)
    if (have.has(a.name)) kept.push(a.name)
    else {
      added.push(a.name)
      missing.push(a)
    }
  }
  if (missing.length === 0) return { text: existing, appended: '', added, kept, skipped, firstAddedLine: 0 }
  const eol = existing.includes('\r\n') ? '\r\n' : '\n'
  let prefix = existing
  if (prefix.length > 0) {
    if (!prefix.endsWith('\n')) prefix += eol
    // One blank line between the old text and the first new section.
    if (!/\r?\n\r?\n$/.test(prefix) && prefix.trim().length > 0) prefix += eol
  }
  const firstAddedLine = prefix.length === 0 ? 1 : prefix.split('\n').length
  const text = prefix + missing.map((a) => ricardianSection(a, eol)).join(eol)
  return { text, appended: text.slice(existing.length), added, kept, skipped, firstAddedLine }
}

function inside(root: string, target: string): boolean {
  const r = relative(root, target)
  return r === '' || (!r.startsWith('..') && !isAbsolute(r))
}

/** Resolves a project-relative path and refuses anything outside the project, also through links. */
export function containedPath(root: string, rel: string): string {
  const clean = relPath(rel, 'path')
  // GIT~1 is the 8.3 short name of .git where short names are on.
  if (clean.split('/').some((seg) => seg.toLowerCase() === '.git' || /^git~\d+$/i.test(seg))) throw new Error('Files inside .git cannot be written')
  const target = resolve(root, clean)
  if (!inside(root, target)) throw new Error('Path is outside the project')
  let probe = target
  while (!existsSync(probe) && probe !== root && dirname(probe) !== probe) probe = dirname(probe)
  if (!inside(realpathSync(root), realpathSync(probe))) throw new Error('Path is outside the project')
  return target
}

async function readLimited(abs: string, what: string): Promise<string> {
  const st = await fsp.stat(abs)
  if (!st.isFile()) throw new Error(`${what} is not a file`)
  if (st.size > MAX_FILE) throw new Error(`${what} is larger than ${MAX_FILE / 1024 / 1024} MB`)
  return fsp.readFile(abs, 'utf8')
}

/** Whether a file to be written exists; a link in its place is refused, also one that points nowhere. */
async function existingTarget(abs: string, what: string): Promise<boolean> {
  let st
  try {
    st = await fsp.lstat(abs)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw e
  }
  if (st.isSymbolicLink()) throw new Error(`${what} is a link; it is not written`)
  return true
}

/** Project-relative paths the command reads and writes. */
export function ricardianPaths(config: ProjectConfig): { abi: string; contracts: string; clauses: string } {
  const resource = effectiveResource(config).replace(/\\/g, '/').replace(/\/+$/, '')
  const base = resource === '' || resource === '.' ? '' : `${resource}/`
  return {
    abi: effectiveOutput(config).replace(/\.wasm$/, '') + '.abi',
    contracts: `${base}${config.contract}.contracts.md`,
    clauses: `${base}${config.contract}.clauses.md`
  }
}

/**
 * Reads the built ABI of the project and writes or extends its Ricardian files
 * in the resource folder. All paths stay inside the project folder.
 */
export async function createRicardianFiles(root: string, config: ProjectConfig): Promise<RicardianResult> {
  const paths = ricardianPaths(config)
  const abiAbs = containedPath(root, paths.abi)
  if (!existsSync(abiAbs)) throw new Error(`${paths.abi} was not found. Build the contract first.`)
  const actions = actionsFromAbi(await readLimited(abiAbs, paths.abi))

  const contractsAbs = containedPath(root, paths.contracts)
  const clausesAbs = containedPath(root, paths.clauses)
  const existed = await existingTarget(contractsAbs, paths.contracts)
  const clausesExisted = await existingTarget(clausesAbs, paths.clauses)
  // The old text is read only to find its sections and its line ends; it is never written back.
  const old = existed ? await readLimited(contractsAbs, paths.contracts) : ''
  const r = extendContracts(old, actions)
  await fsp.mkdir(dirname(contractsAbs), { recursive: true })
  if (existed) {
    if (r.appended.length > 0) await fsp.appendFile(contractsAbs, r.appended, { encoding: 'utf8', flag: 'a' })
  } else {
    await fsp.writeFile(contractsAbs, r.text, { encoding: 'utf8', flag: 'wx' })
  }

  let clausesCreated = false
  if (!clausesExisted) {
    await fsp.writeFile(clausesAbs, ricardianClauses(), { encoding: 'utf8', flag: 'wx' })
    clausesCreated = true
  }

  const parts = [`added ${r.added.length}, kept ${r.kept.length}`]
  if (actions.length === 0) parts.push('the ABI has no actions')
  if (r.skipped > 0) parts.push(`skipped ${r.skipped}: not a valid action name`)
  if (clausesCreated) parts.push(`${paths.clauses} created`)
  return {
    contractsFile: paths.contracts,
    clausesFile: paths.clauses,
    added: r.added,
    kept: r.kept,
    clausesCreated,
    line: r.firstAddedLine || 1,
    message: `${paths.contracts}: ${parts.join('; ')}.`
  }
}
