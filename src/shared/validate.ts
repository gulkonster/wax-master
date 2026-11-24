// Small argument validators for IPC handlers. Every handler validates its input
// with these before doing anything; unexpected shapes throw.

export class ValidationError extends Error {}

export function str(v: unknown, field: string, max = 4096): string {
  if (typeof v !== 'string') throw new ValidationError(`${field}: expected text`)
  if (v.length > max) throw new ValidationError(`${field}: too long`)
  return v
}

export function optStr(v: unknown, field: string, max = 4096): string | undefined {
  if (v === undefined || v === null) return undefined
  return str(v, field, max)
}

export function bool(v: unknown, field: string): boolean {
  if (typeof v !== 'boolean') throw new ValidationError(`${field}: expected true or false`)
  return v
}

export function int(v: unknown, field: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw new ValidationError(`${field}: expected a whole number from ${min} to ${max}`)
  }
  return v
}

export function oneOf<T extends string>(v: unknown, field: string, options: readonly T[]): T {
  if (typeof v !== 'string' || !options.includes(v as T)) {
    throw new ValidationError(`${field}: unexpected value`)
  }
  return v as T
}

export function obj(v: unknown, field: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new ValidationError(`${field}: expected an object`)
  }
  return v as Record<string, unknown>
}

export function arr(v: unknown, field: string, maxLen = 1000): unknown[] {
  if (!Array.isArray(v)) throw new ValidationError(`${field}: expected a list`)
  if (v.length > maxLen) throw new ValidationError(`${field}: too many items`)
  return v
}

const DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** A plain relative path inside a project: no drive, no leading slash, no "..". */
export function relPath(v: unknown, field: string): string {
  const s = str(v, field, 1024).replace(/\\/g, '/')
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(s)) throw new ValidationError(`${field}: invalid character`)
  if (s.includes(':')) throw new ValidationError(`${field}: invalid character`)
  if (s.startsWith('/')) throw new ValidationError(`${field}: must be relative`)
  if (s === '') return s
  const segments = s.split('/')
  if (segments[segments.length - 1] === '') segments.pop() // one trailing slash is fine
  for (const seg of segments) {
    if (seg === '') throw new ValidationError(`${field}: empty folder name`)
    if (seg === '..') throw new ValidationError(`${field}: must stay inside the project`)
    if (seg === '.') continue
    if (/[. ]$/.test(seg)) throw new ValidationError(`${field}: name must not end in a dot or space`)
    if (DEVICE_NAME.test(seg.split('.')[0].trimEnd())) throw new ValidationError(`${field}: reserved name`)
  }
  return s
}

/** An absolute local drive path such as C:\Users\me\wax. UNC, device paths and ".." are refused. */
export function localAbsPath(v: unknown, field: string, max = 1024): string {
  const s = str(v, field, max)
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(s)) throw new ValidationError(`${field}: invalid character`)
  if (s.startsWith('\\\\') || s.startsWith('//')) throw new ValidationError(`${field}: network and device paths are not allowed`)
  if (!/^[A-Za-z]:[\\/]/.test(s)) throw new ValidationError(`${field}: must be a full path on a local drive`)
  const rest = s.slice(2)
  if (rest.includes(':')) throw new ValidationError(`${field}: invalid character`)
  if (rest.split(/[\\/]/).some((p) => p === '..')) throw new ValidationError(`${field}: must not contain ".."`)
  return s
}

const ANTELOPE_NAME = /^[a-z1-5.]{0,12}[a-j1-5]?$/
export function chainName(v: unknown, field: string): string {
  const s = str(v, field, 13)
  if (!ANTELOPE_NAME.test(s)) {
    throw new ValidationError(`${field}: not a valid account name`)
  }
  return s
}
