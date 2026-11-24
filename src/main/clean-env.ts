// Environment for every child process (terminals, compiler, editor engine).
// Starts from the user's own environment as it was when the app started and
// removes everything Electron, Node, npm or the app itself added. The app never
// puts a secret into an environment variable.

const REMOVED_PREFIXES = ['ELECTRON_', 'NODE_', 'NPM_', 'CHROME_', 'ORIGINAL_XDG_', 'WAXMASTER_', 'VSCODE_']
const REMOVED_NAMES = new Set(['NODE', 'INIT_CWD', 'GOOGLE_API_KEY', 'GOOGLE_DEFAULT_CLIENT_ID', 'GOOGLE_DEFAULT_CLIENT_SECRET'])

export function isRemovedVariable(name: string): boolean {
  const upper = name.toUpperCase()
  if (REMOVED_NAMES.has(upper)) return true
  return REMOVED_PREFIXES.some((p) => upper.startsWith(p))
}

export function cleanEnvironment(source: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(source)) {
    if (v === undefined || isRemovedVariable(k)) continue
    out[k] = v
  }
  return out
}

/** Snapshot taken once, at start-up, before anything could change process.env. */
const startupEnv = cleanEnvironment(process.env)

export function childEnvironment(extra: Record<string, string> = {}): Record<string, string> {
  return { ...startupEnv, ...extra }
}
