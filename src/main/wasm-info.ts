// Reads basic facts from a WebAssembly module: size, SHA-256, imports, exports.

import { createHash } from 'node:crypto'

export interface WasmImport {
  module: string
  name: string
  kind: 'function' | 'table' | 'memory' | 'global' | 'tag' | 'unknown'
}

export interface WasmInfo {
  size: number
  sha256: string
  valid: boolean
  error?: string
  imports: WasmImport[]
  exports: string[]
}

class Reader {
  pos = 0
  constructor(private b: Uint8Array) {}
  get done(): boolean {
    return this.pos >= this.b.length
  }
  byte(): number {
    if (this.pos >= this.b.length) throw new Error('unexpected end of module')
    return this.b[this.pos++]
  }
  u32(): number {
    let result = 0
    let shift = 0
    for (let i = 0; i < 5; i++) {
      const b = this.byte()
      result |= (b & 0x7f) << shift
      if ((b & 0x80) === 0) return result >>> 0
      shift += 7
    }
    throw new Error('bad LEB128 number')
  }
  name(): string {
    const len = this.u32()
    if (this.pos + len > this.b.length) throw new Error('name past end of module')
    const s = new TextDecoder().decode(this.b.subarray(this.pos, this.pos + len))
    this.pos += len
    return s
  }
  skip(n: number): void {
    this.pos += n
    if (this.pos > this.b.length) throw new Error('section past end of module')
  }
  limits(): void {
    const flags = this.byte()
    this.u32()
    if (flags & 1) this.u32()
  }
}

const KINDS: WasmImport['kind'][] = ['function', 'table', 'memory', 'global', 'tag']

export function wasmInfo(bytes: Uint8Array): WasmInfo {
  const info: WasmInfo = {
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    valid: false,
    imports: [],
    exports: []
  }
  try {
    const magic = [0x00, 0x61, 0x73, 0x6d]
    if (bytes.length < 8 || magic.some((m, i) => bytes[i] !== m)) throw new Error('not a WebAssembly module')
    const r = new Reader(bytes)
    r.pos = 8
    while (!r.done) {
      const id = r.byte()
      const size = r.u32()
      const end = r.pos + size
      if (id === 2) {
        const count = r.u32()
        for (let i = 0; i < count; i++) {
          const module = r.name()
          const name = r.name()
          const k = r.byte()
          if (k === 0) r.u32()
          else if (k === 1) {
            r.byte()
            r.limits()
          } else if (k === 2) r.limits()
          else if (k === 3) {
            r.byte()
            r.byte()
          } else if (k === 4) {
            r.byte()
            r.u32()
          }
          info.imports.push({ module, name, kind: KINDS[k] ?? 'unknown' })
        }
      } else if (id === 7) {
        const count = r.u32()
        for (let i = 0; i < count; i++) {
          info.exports.push(r.name())
          r.byte()
          r.u32()
        }
      }
      r.pos = end
    }
    info.valid = true
  } catch (e) {
    info.error = e instanceof Error ? e.message : String(e)
  }
  return info
}
