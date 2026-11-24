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
  return `cdt-cpp -abigen -I ./${inc} -R ./${res} -contract ${c.contract} -o ./${out} ./${c.main}`
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
    for (const [id, v] of Object.entries(nr as Record<string, unknown>)) {
      if (typeof v === 'object' && v !== null) {
        const a = (v as Record<string, unknown>).account
        const p = (v as Record<string, unknown>).permission
        networks[id] = {
          account: typeof a === 'string' ? a : '',
          permission: typeof p === 'string' && p ? p : 'active'
        }
      }
    }
  }
  return {
    ...base,
    cdt: /^[a-z0-9.-]{0,64}$/.test(s('cdt')) ? s('cdt') : '',
    include: safeProjectPath(s('include')),
    resource: safeProjectPath(s('resource')),
    output: ((o) => (o.endsWith('.wasm') ? o : ''))(safeProjectPath(s('output'))),
    buildCommand: s('buildCommand'),
    deploy: { target, networks }
  }
}

export type TemplateId = 'empty' | 'hello' | 'token'

export const TEMPLATES: { id: TemplateId; label: string; description: string }[] = [
  { id: 'empty', label: 'Empty', description: 'A contract with one empty action.' },
  { id: 'hello', label: 'Hello World', description: 'The classic "hi" action that prints a greeting.' },
  { id: 'token', label: 'Token', description: 'A standard token contract (create, issue, transfer, retire).' }
]
