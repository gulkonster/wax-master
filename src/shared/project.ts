// Project format (waxmaster.json) and the default build command.

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
  return `cdt-cpp -abigen -I ./${inc} -R ./${res} -contract ${c.contract} -o ${out} ${c.main}`
}

/** Fills missing fields of a parsed config with defaults; ignores unknown fields. */
export function normalizeConfig(raw: unknown, fallbackContract: string): ProjectConfig {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const s = (k: string, d = ''): string => (typeof r[k] === 'string' ? (r[k] as string) : d)
  const contract = s('contract') || fallbackContract
  const base = defaultConfig(contract, s('main') ? s('main').replace(/\\/g, '/') : undefined)
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
    cdt: s('cdt'),
    include: s('include'),
    resource: s('resource'),
    output: s('output'),
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
