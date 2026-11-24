/** Error raised by the chain core. `path` names the field being processed, when known. */
export class ChainCoreError extends Error {
  readonly path: string
  readonly detail: string

  constructor(path: string, detail: string) {
    super(path ? `${path}: ${detail}` : detail)
    this.name = 'ChainCoreError'
    this.path = path
    this.detail = detail
  }
}

/** Re-throws any error with the given field path attached (keeps an existing path). */
export function withPath(path: string, e: unknown): never {
  if (e instanceof ChainCoreError) {
    if (e.path) throw e
    throw new ChainCoreError(path, e.detail)
  }
  throw new ChainCoreError(path, e instanceof Error ? e.message : String(e))
}
