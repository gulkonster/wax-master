// Project format (waxmaster.json) and the default build command.

import { relPath } from './validate'

export type DeployTarget = 'both' | 'wasm' | 'abi'

export interface DeployAccount {
  account: string
  permission: string
}

export interface ProjectConfig {
  /** Main source file, relative to the project root, forward slashes. */
  main: string
  /** Contract name passed to `-contract`. */
  contract: string
  /** Toolchain id used for builds, e.g. "wax-cdt-4.1.1wax01". Empty: the default toolchain. */
  cdt: string
  /** Include folder (`-I`). Empty: "include". */
  include: string
  /** Resource folder (`-R`). Empty: "resource". */
  resource: string
  /** Output file (`-o`). Empty: "<contract>.wasm". */
  output: string
  /** Custom build command. Empty: the default command. */
  buildCommand: string
  deploy: {
    target: DeployTarget
    /** Deploy account per saved network id. */
    networks: Record<string, DeployAccount>
  }
}

export const PROJECT_FILE = 'waxmaster.json'

const CONTRACT_NAME = /^[a-z1-5.]{1,12}$/
/** A toolchain id stored in a project file (never starts with "-"). */
export const TOOLCHAIN_ID = /^([a-z0-9][a-z0-9.-]{0,63})?$/
const ACCOUNT = /^[a-z1-5.]{1,12}[a-j1-5]?$/

export function isValidContract(name: string): boolean {
  return CONTRACT_NAME.test(name) && !name.startsWith('.') && !name.endsWith('.')
}

/**
 * A safe project-relative path from a project file: relative, inside the
 * project, no segment starting with "-" (it would read as a compiler option).
 * Returns '' when the value is not safe.
 */
export function safeProjectPath(v: string): string {
  try {
    const p = relPath(v, 'path')
    if (p === '' || p.split('/').some((seg) => seg.startsWith('-'))) return ''
    return p.replace(/^\.\//, '')
  } catch {
    return ''
  }
}

export function defaultConfig(contract: string, main?: string): ProjectConfig {
  return {
    main: main ?? `src/${contract}.cpp`,
    contract,
    cdt: '',
    include: '',
    resource: '',
    output: '',
    buildCommand: '',
    deploy: { target: 'both', networks: {} }
  }
}

export function effectiveInclude(c: ProjectConfig): string {
  return c.include.trim() || 'include'
}
export function effectiveResource(c: ProjectConfig): string {
  return c.resource.trim() || 'resource'
}
export function effectiveOutput(c: ProjectConfig): string {
  return c.output.trim() || `${c.contract}.wasm`
}

/** The default build command, as shown in Project Settings. Paths use forward slashes. */
export function defaultBuildCommand(c: ProjectConfig): string {
  const inc = effectiveInclude(c)
  const res = effectiveResource(c)
  const out = effectiveOutput(c)
  return `cdt-cpp -abigen -I ./${inc} -R ./${res} -contract ${c.contract} -o ./${out} ${c.main}`
}

/** Fills missing fields of a parsed config with defaults; ignores unknown fields. */
export function normalizeConfig(raw: unknown, fallbackContract: string): ProjectConfig {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const s = (k: string, d = ''): string => (typeof r[k] === 'string' ? (r[k] as string) : d)
  // Values in a project file are untrusted: anything unsafe falls back to the default.
  const contract = isValidContract(s('contract')) ? s('contract') : fallbackContract
  const mainPath = safeProjectPath(s('main'))
  const base = defaultConfig(contract, mainPath && mainPath.endsWith('.cpp') ? mainPath : undefined)
  const deployRaw = (typeof r.deploy === 'object' && r.deploy !== null ? r.deploy : {}) as Record<string, unknown>
  const target = deployRaw.target === 'wasm' || deployRaw.target === 'abi' ? deployRaw.target : 'both'
  const networks: Record<string, DeployAccount> = {}
  const nr = deployRaw.networks
  if (typeof nr === 'object' && nr !== null) {
    for (const [id, v] of Object.entries(nr as Record<string, unknown>).slice(0, 50)) {
      if (!/^[a-z0-9-]{1,64}$/.test(id)) continue
      if (typeof v === 'object' && v !== null) {
        const a = (v as Record<string, unknown>).account
        const p = (v as Record<string, unknown>).permission
        networks[id] = {
          account: typeof a === 'string' && ACCOUNT.test(a) ? a : '',
          permission: typeof p === 'string' && ACCOUNT.test(p) ? p : 'active'
        }
      }
    }
  }
  return {
    ...base,
    cdt: TOOLCHAIN_ID.test(s('cdt')) ? s('cdt') : '',
    include: safeProjectPath(s('include')),
    resource: safeProjectPath(s('resource')),
    output: ((o) => (o.endsWith('.wasm') ? o : ''))(safeProjectPath(s('output'))),
    buildCommand: s('buildCommand'),
    deploy: { target, networks }
  }
}

export type ProjectTemplateId = 'empty' | 'hello' | 'token'
/** Example projects: folders in resources/templates/examples/<id>/. */
export type ExampleId = 'transfer-listener' | 'staking' | 'atomicassets' | 'alcor-swap'
export type TemplateId = ProjectTemplateId | ExampleId

export const TEMPLATES: { id: ProjectTemplateId; label: string; description: string }[] = [
  { id: 'empty', label: 'Empty', description: 'A contract with one empty action.' },
  { id: 'hello', label: 'Hello World', description: 'The classic "hi" action that prints a greeting.' },
  { id: 'token', label: 'Token', description: 'A token contract (create, issue, transfer, retire); balance rows are removed at zero.' }
]

/** The Examples group of New Project: `name` is the project name offered first, `topic` its documentation page. */
export const EXAMPLES: { id: ExampleId; label: string; description: string; name: string; topic: string }[] = [
  {
    id: 'transfer-listener',
    label: 'Transfer listener',
    description: 'Records WAX sent to the contract per account (on_notify); withdraw sends it back with an inline transfer.',
    name: 'listener',
    topic: 'example-transfer-listener'
  },
  {
    id: 'staking',
    label: 'Staking',
    description: 'Stake WAX with the memo "stake"; unstake starts a 5-minute wait; claim pays out after it.',
    name: 'staking',
    topic: 'example-staking'
  },
  {
    id: 'atomicassets',
    label: 'AtomicAssets',
    description: 'Mints one NFT of your template per account (inline mintasset); counts assets of the collection that arrive (logtransfer).',
    name: 'minter',
    topic: 'example-atomicassets'
  },
  {
    id: 'alcor-swap',
    label: 'Alcor swap',
    description: "Swaps the contract's own tokens on a swap.alcor pool with a transfer and the swap memo, with a minimum out.",
    name: 'swapper',
    topic: 'example-alcor-swap'
  }
]

/** Every id New Project accepts: the templates, then the examples. */
export const TEMPLATE_IDS: readonly TemplateId[] = [...TEMPLATES.map((t) => t.id), ...EXAMPLES.map((e) => e.id)]

function given(r: Record<string, unknown>, k: string): boolean {
  return r[k] !== undefined && r[k] !== null && r[k] !== ''
}

/**
 * Names of the waxmaster.json values that `normalizeConfig` replaced by a default
 * because they were not valid or not safe (empty or missing values are not reported).
 */
export function replacedConfigValues(raw: unknown): string[] {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const str = (k: string): string => (typeof r[k] === 'string' ? (r[k] as string) : '')
  const out: string[] = []
  const bad = (k: string, ok: boolean): void => {
    if (given(r, k) && !ok) out.push(k)
  }
  bad('contract', isValidContract(str('contract')))
  bad('main', ((p) => p !== '' && p.endsWith('.cpp'))(safeProjectPath(str('main'))))
  bad('cdt', TOOLCHAIN_ID.test(str('cdt')))
  bad('include', safeProjectPath(str('include')) !== '')
  bad('resource', safeProjectPath(str('resource')) !== '')
  bad('output', ((p) => p !== '' && p.endsWith('.wasm'))(safeProjectPath(str('output'))))
  bad('buildCommand', typeof r.buildCommand === 'string')
  const d = r.deploy
  if (given(r, 'deploy') && (typeof d !== 'object' || d === null)) out.push('deploy')
  else if (typeof d === 'object' && d !== null) {
    const t = (d as Record<string, unknown>).target
    if (given(d as Record<string, unknown>, 'target') && t !== 'both' && t !== 'wasm' && t !== 'abi') out.push('deploy.target')
  }
  return out
}

/** Names of the .eosproj values that are not valid or not safe and were left out. */
export function replacedEosprojValues(raw: unknown): string[] {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const out: string[] = []
  const safe = (k: string, ext?: string): void => {
    if (!given(r, k)) return
    const p = typeof r[k] === 'string' ? safeProjectPath(r[k] as string) : ''
    if (p === '' || (ext !== undefined && !p.endsWith(ext))) out.push(k)
  }
  safe('main', '.cpp')
  safe('include')
  safe('resource')
  safe('output')
  if (given(r, 'contract') && !(typeof r.contract === 'string' && isValidContract(r.contract))) out.push('contract')
  return out
}
