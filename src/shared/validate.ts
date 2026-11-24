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

/** A plain relative path inside a project: no drive, no leading slash, no "..". */
export function relPath(v: unknown, field: string): string {
  const s = str(v, field, 1024).replace(/\\/g, '/')
  if (s.startsWith('/') || /^[a-zA-Z]:/.test(s)) throw new ValidationError(`${field}: must be relative`)
  if (s.split('/').some((p) => p === '..')) throw new ValidationError(`${field}: must stay inside the project`)
  if (s.includes('\0')) throw new ValidationError(`${field}: invalid character`)
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
