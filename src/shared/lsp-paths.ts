// Document addresses between the editor window and the editor engine.
//
// The window only knows `project:///<relative path>` for project files and
// `toolchain:///usr/opt/cdt/...` for the toolchain's read-only headers. The
// engine runs inside the toolchain distro and uses `file:///mnt/c/...` and
// `file:///usr/...`. The main process converts every address in both
// directions and refuses any other address coming from the window.

import { relPath } from './validate'

export interface PathMap {
  /** Project folder as seen inside the distro, e.g. /mnt/c/Users/me/proj (no trailing slash). */
  rootWsl: string
  /** Toolchain header folders, e.g. /usr/opt/cdt/4.1.1wax01/include (no trailing slash). */
  toolchainRoots: string[]
}

export const PROJECT_SCHEME = 'project'
export const TOOLCHAIN_SCHEME = 'toolchain'
export const OUTSIDE_SCHEME = 'outside'

function encodePath(p: string): string {
  return p.split('/').map(encodeURIComponent).join('/')
}

function decodePath(p: string): string {
  return p
    .split('/')
    .map((s) => decodeURIComponent(s))
    .join('/')
}

/** file:///a/b%20c -> /a/b c (null for anything that is not a local file address). */
export function fileUriToPath(uri: string): string | null {
  if (!uri.startsWith('file://')) return null
  let rest = uri.slice('file://'.length)
  if (rest.startsWith('localhost/')) rest = rest.slice('localhost'.length)
  if (!rest.startsWith('/')) return null
  try {
    return decodePath(rest)
  } catch {
    return null
  }
}

export function pathToFileUri(p: string): string {
  return `file://${encodePath(p)}`
}

function hasDotSegments(p: string): boolean {
  return p.split('/').some((s) => s === '..' || s === '.')
}

/** True for an absolute distro path inside one of the toolchain header folders. */
export function isToolchainPath(p: string, roots: string[]): boolean {
  // eslint-disable-next-line no-control-regex
  if (!p.startsWith('/') || hasDotSegments(p) || /[\u0000-\u001f\u007f\\]/.test(p) || p.includes('//')) return false
  return roots.some((r) => p.startsWith(r + '/'))
}

function underRoot(p: string, root: string): string | null {
  if (p.length === root.length && p.toLowerCase() === root.toLowerCase()) return ''
  // /mnt/<drive> is case-insensitive like the Windows folder behind it.
  if (p.length > root.length && p[root.length] === '/' && p.slice(0, root.length).toLowerCase() === root.toLowerCase()) {
    return p.slice(root.length + 1)
  }
  return null
}

/** Engine address -> window address. */
export function serverToClientUri(uri: string, map: PathMap): string {
  const p = fileUriToPath(uri)
  if (p === null) return `${OUTSIDE_SCHEME}:///${encodeURIComponent(uri)}`
  const rel = underRoot(p, map.rootWsl)
  if (rel !== null) return `${PROJECT_SCHEME}:///${encodePath(rel)}`
  if (isToolchainPath(p, map.toolchainRoots)) return `${TOOLCHAIN_SCHEME}://${encodePath(p)}`
  return `${OUTSIDE_SCHEME}://${encodePath(p)}`
}

/** Window address -> engine address. Throws for anything outside the project and the toolchain headers. */
export function clientToServerUri(uri: string, map: PathMap): string {
  if (uri.startsWith(`${PROJECT_SCHEME}:///`) || uri === `${PROJECT_SCHEME}://`) {
    let rel: string
    try {
      rel = decodePath(uri.slice(`${PROJECT_SCHEME}:///`.length))
    } catch {
      throw new Error('Invalid document address')
    }
    rel = relPath(rel, 'uri').replace(/\/$/, '')
    if (hasDotSegments(rel)) throw new Error('Invalid document address')
    return pathToFileUri(rel ? `${map.rootWsl}/${rel}` : map.rootWsl)
  }
  if (uri.startsWith(`${TOOLCHAIN_SCHEME}:///`)) {
    let p: string
    try {
      p = decodePath(uri.slice(`${TOOLCHAIN_SCHEME}://`.length))
    } catch {
      throw new Error('Invalid document address')
    }
    if (!isToolchainPath(p, map.toolchainRoots)) throw new Error('Not a toolchain header')
    return pathToFileUri(p)
  }
  throw new Error('Unsupported document address')
}

/** Window address of a toolchain header -> its distro path (validated). */
export function toolchainUriToPath(uri: string, roots: string[]): string {
  if (!uri.startsWith(`${TOOLCHAIN_SCHEME}:///`)) throw new Error('Not a toolchain header')
  let p: string
  try {
    p = decodePath(uri.slice(`${TOOLCHAIN_SCHEME}://`.length))
  } catch {
    throw new Error('Invalid document address')
  }
  if (!isToolchainPath(p, roots)) throw new Error('Not a toolchain header')
  return p
}

const URI_KEYS = new Set(['uri', 'targetUri', 'rootUri', 'newUri', 'oldUri'])

/**
 * Rewrites every document address in a message in place: values of the keys
 * above and the keys of a WorkspaceEdit `changes` map. Document text is never
 * touched. `convert` may throw to refuse the message.
 */
export function rewriteUris(value: unknown, convert: (uri: string) => string, depth = 0): void {
  if (depth > 64) throw new Error('Message nested too deeply')
  if (Array.isArray(value)) {
    for (const v of value) rewriteUris(v, convert, depth + 1)
    return
  }
  if (typeof value !== 'object' || value === null) return
  const o = value as Record<string, unknown>
  for (const key of Object.keys(o)) {
    const v = o[key]
    if (URI_KEYS.has(key) && typeof v === 'string') {
      o[key] = convert(v)
    } else if (key === 'changes' && typeof v === 'object' && v !== null && !Array.isArray(v)) {
      const next: Record<string, unknown> = {}
      for (const [k, edits] of Object.entries(v as Record<string, unknown>)) {
        rewriteUris(edits, convert, depth + 1)
        next[convert(k)] = edits
      }
      o[key] = next
    } else if (typeof v === 'object' && v !== null) {
      rewriteUris(v, convert, depth + 1)
    }
  }
}

/** Converts an engine message for the window (in place) and returns it. */
export function messageToClient(msg: Record<string, unknown>, map: PathMap): Record<string, unknown> {
  rewriteUris(msg, (u) => serverToClientUri(u, map))
  // textDocument/switchSourceHeader answers with a bare address.
  if (typeof msg.result === 'string' && msg.result.startsWith('file://')) msg.result = serverToClientUri(msg.result, map)
  return msg
}

/** Converts a window message for the engine (in place); throws when it names anything else. */
export function messageToServer(msg: Record<string, unknown>, map: PathMap): Record<string, unknown> {
  const params = msg.params as Record<string, unknown> | undefined
  if (params && typeof params === 'object') delete params.rootPath
  rewriteUris(msg, (u) => clientToServerUri(u, map))
  return msg
}
