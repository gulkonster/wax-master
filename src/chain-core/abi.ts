import { SerialBuffer, utf8Encode } from './bytes'
import { ChainCoreError, withPath } from './errors'
import { BUILTIN_CODECS, type CodecOptions } from './primitives'

/** Maximum ABI size accepted, in bytes (JSON text or binary). */
/** Maximum nesting of types while encoding, decoding and resolving. */
export const MAX_DEPTH = 32
/** Arrays longer than the remaining bytes are rejected, except for this many zero-size items. */
const MAX_ZERO_SIZE_ITEMS = 1024

// ---------------------------------------------------------------- ABI definition

export interface AbiTypeDef {
  new_type_name: string
  type: string
}
export interface AbiFieldDef {
  name: string
  type: string
}
export interface AbiStructDef {
  name: string
  base: string
  fields: AbiFieldDef[]
}
export interface AbiActionDef {
  name: string
  type: string
  ricardian_contract: string
}
export interface AbiTableDef {
  name: string
  index_type: string
  key_names: string[]
  key_types: string[]
  type: string
}
export interface AbiClauseDef {
  id: string
  body: string
}
export interface AbiErrorMessageDef {
  error_code: string
  error_msg: string
}
export interface AbiExtensionDef {
  tag: number
  value: string
}
export interface AbiVariantDef {
  name: string
  types: string[]
}
export interface AbiActionResultDef {
  name: string
  result_type: string
}

/** JSON form of an ABI (`eosio::abi/1.0` to `1.2`). `variants` and `action_results` are absent when the ABI has none. */
export interface AbiDef {
  version: string
  types: AbiTypeDef[]
  structs: AbiStructDef[]
  actions: AbiActionDef[]
  tables: AbiTableDef[]
  ricardian_clauses: AbiClauseDef[]
  error_messages: AbiErrorMessageDef[]
  abi_extensions: AbiExtensionDef[]
  variants?: AbiVariantDef[]
  action_results?: AbiActionResultDef[]
}

// ---------------------------------------------------------------- parsing the JSON form

function fail(path: string, msg: string): never {
  throw new ChainCoreError(path, msg)
}

function rec(v: unknown, path: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(path, 'expected an object')
  return v as Record<string, unknown>
}

function arr(v: unknown, path: string, optional = false): unknown[] | undefined {
  if (v === undefined || v === null) {
    if (optional) return undefined
    return []
  }
  if (!Array.isArray(v)) fail(path, 'expected an array')
  return v as unknown[]
}

function str(v: unknown, path: string, dflt?: string): string {
  if (v === undefined || v === null) {
    if (dflt !== undefined) return dflt
    fail(path, 'missing string')
  }
  if (typeof v !== 'string') fail(path, 'expected a string')
  return v as string
}

function mapArr<T>(v: unknown, path: string, f: (o: Record<string, unknown>, p: string) => T): T[] {
  return (arr(v, path) as unknown[]).map((x, i) => f(rec(x, `${path}[${i}]`), `${path}[${i}]`))
}

/**
 * Validates the shape of an ABI JSON object (or text) and returns a normalized AbiDef.
 * Unknown keys such as `kv_tables` are accepted and dropped. Text is limited to 2 MB.
 */
export function parseAbi(input: unknown): AbiDef {
  let raw: unknown = input
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input)
    } catch {
      fail('abi', 'ABI is not valid JSON')
    }
  }
  const o = rec(raw, 'abi')
  const version = str(o.version, 'abi.version')
  if (!/^eosio::abi\/1\.\d+$/.test(version)) fail('abi.version', `unsupported ABI version "${version}"`)
  const def: AbiDef = {
    version,
    types: mapArr(o.types, 'abi.types', (t, p) => ({
      new_type_name: str(t.new_type_name, p + '.new_type_name'),
      type: str(t.type, p + '.type')
    })),
    structs: mapArr(o.structs, 'abi.structs', (s, p) => ({
      name: str(s.name, p + '.name'),
      base: str(s.base, p + '.base', ''),
      fields: mapArr(s.fields, p + '.fields', (f, fp) => ({
        name: str(f.name, fp + '.name'),
        type: str(f.type, fp + '.type')
      }))
    })),
    actions: mapArr(o.actions, 'abi.actions', (a, p) => ({
      name: str(a.name, p + '.name'),
      type: str(a.type, p + '.type'),
      ricardian_contract: str(a.ricardian_contract, p + '.ricardian_contract', '')
    })),
    tables: mapArr(o.tables, 'abi.tables', (t, p) => ({
      name: str(t.name, p + '.name'),
      index_type: str(t.index_type, p + '.index_type', 'i64'),
      key_names: ((arr(t.key_names, p + '.key_names') as unknown[]) ?? []).map((k, i) => str(k, `${p}.key_names[${i}]`)),
      key_types: ((arr(t.key_types, p + '.key_types') as unknown[]) ?? []).map((k, i) => str(k, `${p}.key_types[${i}]`)),
      type: str(t.type, p + '.type')
    })),
    ricardian_clauses: mapArr(o.ricardian_clauses, 'abi.ricardian_clauses', (c, p) => ({
      id: str(c.id, p + '.id'),
      body: str(c.body, p + '.body')
    })),
    error_messages: mapArr(o.error_messages, 'abi.error_messages', (e, p) => ({
      error_code: String(e.error_code ?? '0'),
      error_msg: str(e.error_msg, p + '.error_msg')
    })),
    abi_extensions: mapArr(o.abi_extensions, 'abi.abi_extensions', (e, p) => ({
      tag: Number(e.tag ?? 0),
      value: str(e.value, p + '.value', '')
    }))
  }
  if (o.variants !== undefined && o.variants !== null) {
    def.variants = mapArr(o.variants, 'abi.variants', (v, p) => ({
      name: str(v.name, p + '.name'),
      types: ((arr(v.types, p + '.types') as unknown[]) ?? []).map((t, i) => str(t, `${p}.types[${i}]`))
    }))
  }
  if (o.action_results !== undefined && o.action_results !== null) {
    def.action_results = mapArr(o.action_results, 'abi.action_results', (r, p) => ({
      name: str(r.name, p + '.name'),
      result_type: str(r.result_type, p + '.result_type')
    }))
  }
  return def
}

// ---------------------------------------------------------------- compiled form

interface FlatField {
  name: string
  type: string
  ext: boolean
}

export interface CompiledAbi {
  def: AbiDef
  aliases: Map<string, string>
  structs: Map<string, AbiStructDef>
  variants: Map<string, AbiVariantDef>
  actions: Map<string, string>
  tables: Map<string, string>
  results: Map<string, string>
  flat: Map<string, FlatField[]>
}

/** Anything the codec functions accept as an ABI. */
export type AbiLike = AbiDef | CompiledAbi

const EXTENDED_ASSET: AbiStructDef = {
  name: 'extended_asset',
  base: '',
  fields: [
    { name: 'quantity', type: 'asset' },
    { name: 'contract', type: 'name' }
  ]
}

const compiledCache = new WeakMap<AbiDef, CompiledAbi>()

function isCompiled(a: AbiLike): a is CompiledAbi {
  return (a as CompiledAbi).flat instanceof Map
}

/** Splits trailing `[]`, `?` and `$` markers: returns the inner type and the marker. */
function splitSuffix(t: string): { inner: string; kind: 'array' | 'optional' | 'none' } {
  if (t.endsWith('[]')) return { inner: t.slice(0, -2), kind: 'array' }
  if (t.endsWith('?')) return { inner: t.slice(0, -1), kind: 'optional' }
  return { inner: t, kind: 'none' }
}

/** Validates an ABI and builds the lookup tables used by the codec. Results are cached per AbiDef object. */
export function compileAbi(def: AbiDef): CompiledAbi {
  const hit = compiledCache.get(def)
  if (hit) return hit
  const aliases = new Map<string, string>()
  const structs = new Map<string, AbiStructDef>()
  const variants = new Map<string, AbiVariantDef>()
  const declared = new Set<string>()
  const declare = (name: string, path: string): void => {
    if (declared.has(name)) fail(path, `duplicate type name "${name}"`)
    declared.add(name)
  }
  def.types.forEach((t, i) => {
    declare(t.new_type_name, `types[${i}]`)
    aliases.set(t.new_type_name, t.type)
  })
  def.structs.forEach((s, i) => {
    declare(s.name, `structs[${i}]`)
    structs.set(s.name, s)
  })
  ;(def.variants ?? []).forEach((v, i) => {
    declare(v.name, `variants[${i}]`)
    variants.set(v.name, v)
  })
  if (!structs.has('extended_asset') && !aliases.has('extended_asset') && !variants.has('extended_asset')) {
    structs.set('extended_asset', EXTENDED_ASSET)
  }
  const compiled: CompiledAbi = {
    def,
    aliases,
    structs,
    variants,
    actions: new Map(def.actions.map((a) => [a.name, a.type])),
    tables: new Map(def.tables.map((t) => [t.name, t.type])),
    results: new Map((def.action_results ?? []).map((r) => [r.name, r.result_type])),
    flat: new Map()
  }

  const known = (name: string): boolean => aliases.has(name) || structs.has(name) || variants.has(name) || name in BUILTIN_CODECS
  const checkRef = (t: string, path: string): void => {
    let cur = t
    if (cur.endsWith('$')) cur = cur.slice(0, -1)
    for (let i = 0; i <= MAX_DEPTH; i++) {
      const s = splitSuffix(cur)
      if (s.kind === 'none') break
      cur = s.inner
    }
    if (!known(cur)) fail(path, `unknown type "${t}"`)
  }
  // alias chains must end in a non-alias within the depth limit
  for (const [name] of aliases) {
    let cur = name
    let hops = 0
    while (aliases.has(cur)) {
      cur = splitSuffix(aliases.get(cur) as string).inner
      if (++hops > MAX_DEPTH) fail(`types.${name}`, 'type alias is circular or nested too deeply')
    }
  }
  def.types.forEach((t, i) => checkRef(t.type, `types[${i}].type`))
  def.structs.forEach((s, i) => {
    if (s.base) {
      checkRef(s.base, `structs[${i}].base`)
    }
    s.fields.forEach((f, j) => checkRef(f.type, `structs[${i}].fields[${j}].type`))
  })
  ;(def.variants ?? []).forEach((v, i) => v.types.forEach((t, j) => checkRef(t, `variants[${i}].types[${j}]`)))
  def.actions.forEach((a, i) => checkRef(a.type, `actions[${i}].type`))
  def.tables.forEach((t, i) => checkRef(t.type, `tables[${i}].type`))
  ;(def.action_results ?? []).forEach((r, i) => checkRef(r.result_type, `action_results[${i}].result_type`))
  // flatten every struct (also validates base chains and extension ordering)
  for (const name of structs.keys()) flatFields(compiled, name, 0)
  compiledCache.set(def, compiled)
  return compiled
}

function resolveAlias(abi: CompiledAbi, type: string): string {
  let cur = type
  for (let i = 0; i <= MAX_DEPTH; i++) {
    const next = abi.aliases.get(cur)
    if (next === undefined) return cur
    cur = next
  }
  return fail('', `type alias "${type}" is circular or nested too deeply`)
}

function flatFields(abi: CompiledAbi, structName: string, depth: number): FlatField[] {
  const cached = abi.flat.get(structName)
  if (cached) return cached
  if (depth > MAX_DEPTH) fail(`structs.${structName}`, 'struct base chain is circular or nested too deeply')
  const s = abi.structs.get(structName) as AbiStructDef
  let out: FlatField[] = []
  if (s.base) {
    const baseName = resolveAlias(abi, s.base)
    if (!abi.structs.has(baseName)) fail(`structs.${structName}`, `base "${s.base}" is not a struct`)
    out = flatFields(abi, baseName, depth + 1).slice()
  }
  for (const f of s.fields) {
    const ext = f.type.endsWith('$')
    out.push({ name: f.name, type: ext ? f.type.slice(0, -1) : f.type, ext })
  }
  let seenExt = false
  for (const f of out) {
    if (f.ext) seenExt = true
    else if (seenExt) fail(`structs.${structName}`, `field "${f.name}" follows a binary extension field`)
  }
  abi.flat.set(structName, out)
  return out
}

function toCompiled(abi: AbiLike): CompiledAbi {
  return isCompiled(abi) ? abi : compileAbi(abi)
}

// ---------------------------------------------------------------- encoding

function setKey(o: Record<string, unknown>, k: string, v: unknown): void {
  if (k === '__proto__') Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true })
  else o[k] = v
}

function encodeValue(abi: CompiledAbi, type: string, value: unknown, buf: SerialBuffer, path: string, depth: number): void {
  if (depth > MAX_DEPTH) fail(path, 'type nesting is too deep')
  const { inner, kind } = splitSuffix(type)
  if (kind === 'array') {
    if (!Array.isArray(value)) fail(path, 'expected an array')
    const list = value as unknown[]
    buf.pushVaruint32(list.length)
    for (let i = 0; i < list.length; i++) encodeValue(abi, inner, list[i], buf, `${path}[${i}]`, depth + 1)
    return
  }
  if (kind === 'optional') {
    if (value === null || value === undefined) buf.push(0)
    else {
      buf.push(1)
      encodeValue(abi, inner, value, buf, path, depth + 1)
    }
    return
  }
  const alias = abi.aliases.get(type)
  if (alias !== undefined) return encodeValue(abi, alias, value, buf, path, depth + 1)
  if (abi.structs.has(type)) return encodeStruct(abi, type, value, buf, path, depth)
  const variant = abi.variants.get(type)
  if (variant) {
    if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'string') {
      fail(path, 'expected a variant as ["type", value]')
    }
    const idx = variant.types.indexOf(value[0] as string)
    if (idx < 0) fail(path, `"${value[0]}" is not a case of variant ${type}`)
    buf.pushVaruint32(idx)
    return encodeValue(abi, variant.types[idx], value[1], buf, path, depth + 1)
  }
  const codec = BUILTIN_CODECS[type]
  if (!codec) fail(path, `unknown type "${type}"`)
  try {
    codec.encode(buf, value)
  } catch (e) {
    withPath(path, e)
  }
}

function encodeStruct(abi: CompiledAbi, name: string, value: unknown, buf: SerialBuffer, path: string, depth: number): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path, `expected an object for ${name}`)
  const obj = value as Record<string, unknown>
  let missingExt = false
  for (const f of flatFields(abi, name, 0)) {
    const v = obj[f.name]
    const fp = path ? `${path}.${f.name}` : f.name
    if (v === undefined && !f.type.endsWith('?')) {
      if (f.ext) {
        missingExt = true
        continue
      }
      fail(fp, 'missing required field')
    }
    if (missingExt) fail(fp, 'field is set after a missing binary extension field')
    encodeValue(abi, f.type, v, buf, fp, depth + 1)
  }
}

// ---------------------------------------------------------------- decoding

export interface DecodeOptions extends CodecOptions {
  /** Do not fail when bytes are left over after decoding. */
  allowTrailing?: boolean
  /** Root path used in error messages. */
  path?: string
}

function decodeValue(abi: CompiledAbi, type: string, buf: SerialBuffer, path: string, depth: number, opts: CodecOptions): unknown {
  if (depth > MAX_DEPTH) fail(path, 'type nesting is too deep')
  const { inner, kind } = splitSuffix(type)
  if (kind === 'array') {
    let n: number
    try {
      n = buf.getVaruint32()
    } catch (e) {
      withPath(path, e)
    }
    if (n > buf.remaining && n > MAX_ZERO_SIZE_ITEMS) fail(path, `array length ${n} exceeds the remaining data`)
    const out: unknown[] = []
    for (let i = 0; i < n; i++) out.push(decodeValue(abi, inner, buf, `${path}[${i}]`, depth + 1, opts))
    return out
  }
  if (kind === 'optional') {
    let flag: number
    try {
      flag = buf.get()
    } catch (e) {
      withPath(path, e)
    }
    if (flag > 1) fail(path, 'invalid optional flag')
    return flag === 0 ? null : decodeValue(abi, inner, buf, path, depth + 1, opts)
  }
  const alias = abi.aliases.get(type)
  if (alias !== undefined) return decodeValue(abi, alias, buf, path, depth + 1, opts)
  if (abi.structs.has(type)) {
    const out: Record<string, unknown> = {}
    for (const f of flatFields(abi, type, 0)) {
      if (f.ext && !buf.haveReadData()) break
      const fp = path ? `${path}.${f.name}` : f.name
      setKey(out, f.name, decodeValue(abi, f.type, buf, fp, depth + 1, opts))
    }
    return out
  }
  const variant = abi.variants.get(type)
  if (variant) {
    let idx: number
    try {
      idx = buf.getVaruint32()
    } catch (e) {
      withPath(path, e)
    }
    if (idx >= variant.types.length) fail(path, `variant index ${idx} is out of range for ${type}`)
    return [variant.types[idx], decodeValue(abi, variant.types[idx], buf, path, depth + 1, opts)]
  }
  const codec = BUILTIN_CODECS[type]
  if (!codec) fail(path, `unknown type "${type}"`)
  try {
    return codec.decode(buf, opts)
  } catch (e) {
    withPath(path, e)
  }
}

// ---------------------------------------------------------------- public API

/** Encodes a JSON value as the given ABI type. `path` is the root name used in error messages. */
export function encodeType(abi: AbiLike, type: string, value: unknown, path = type): Uint8Array {
  const c = toCompiled(abi)
  const buf = new SerialBuffer()
  encodeValue(c, type, value, buf, path, 0)
  return buf.asUint8Array()
}

/** Decodes bytes as the given ABI type. Trailing bytes are an error unless `allowTrailing` is set. */
export function decodeType(abi: AbiLike, type: string, bytes: Uint8Array, opts: DecodeOptions = {}): unknown {
  const c = toCompiled(abi)
  const buf = new SerialBuffer(bytes)
  const path = opts.path ?? type
  const out = decodeValue(c, type, buf, path, 0, opts)
  if (!opts.allowTrailing && buf.remaining > 0) fail(path, `${buf.remaining} unexpected trailing byte(s)`)
  return out
}

/** Encodes the JSON arguments of an action with the struct the ABI declares for it. */
export function encodeAction(abi: AbiLike, actionName: string, json: unknown): Uint8Array {
  const c = toCompiled(abi)
  const type = c.actions.get(actionName)
  if (type === undefined) fail(actionName, 'action is not defined in the ABI')
  return encodeType(c, type as string, json, actionName)
}

export function decodeAction(abi: AbiLike, actionName: string, bytes: Uint8Array, opts: DecodeOptions = {}): unknown {
  const c = toCompiled(abi)
  const type = c.actions.get(actionName)
  if (type === undefined) fail(actionName, 'action is not defined in the ABI')
  return decodeType(c, type as string, bytes, { ...opts, path: opts.path ?? actionName })
}

/** Decodes one row of a contract table using the struct the ABI declares for the table. */
export function decodeTableRow(abi: AbiLike, tableName: string, bytes: Uint8Array, opts: DecodeOptions = {}): unknown {
  const c = toCompiled(abi)
  const type = c.tables.get(tableName)
  if (type === undefined) fail(tableName, 'table is not defined in the ABI')
  return decodeType(c, type as string, bytes, { ...opts, path: opts.path ?? tableName })
}

/** Decodes the return value of an action (ABI 1.2 `action_results`). */
export function decodeActionResult(abi: AbiLike, actionName: string, bytes: Uint8Array, opts: DecodeOptions = {}): unknown {
  const c = toCompiled(abi)
  const type = c.results.get(actionName)
  if (type === undefined) fail(actionName, 'action has no declared result in the ABI')
  return decodeType(c, type as string, bytes, { ...opts, path: opts.path ?? actionName })
}

// ---------------------------------------------------------------- the abi_def binary format

const s = (name: string, type: string): AbiFieldDef => ({ name, type })

/** The ABI describing `abi_def` itself, used to (de)serialize ABIs for `setabi` and `get_raw_abi`. */
export const ABI_DEF_ABI: AbiDef = {
  version: 'eosio::abi/1.1',
  types: [],
  structs: [
    { name: 'extensions_entry', base: '', fields: [s('tag', 'uint16'), s('value', 'bytes')] },
    { name: 'type_def', base: '', fields: [s('new_type_name', 'string'), s('type', 'string')] },
    { name: 'field_def', base: '', fields: [s('name', 'string'), s('type', 'string')] },
    { name: 'struct_def', base: '', fields: [s('name', 'string'), s('base', 'string'), s('fields', 'field_def[]')] },
    { name: 'action_def', base: '', fields: [s('name', 'name'), s('type', 'string'), s('ricardian_contract', 'string')] },
    {
      name: 'table_def',
      base: '',
      fields: [s('name', 'name'), s('index_type', 'string'), s('key_names', 'string[]'), s('key_types', 'string[]'), s('type', 'string')]
    },
    { name: 'clause_pair', base: '', fields: [s('id', 'string'), s('body', 'string')] },
    { name: 'error_message', base: '', fields: [s('error_code', 'uint64'), s('error_msg', 'string')] },
    { name: 'variant_def', base: '', fields: [s('name', 'string'), s('types', 'string[]')] },
    { name: 'action_result_def', base: '', fields: [s('name', 'name'), s('result_type', 'string')] },
    {
      name: 'abi_def',
      base: '',
      fields: [
        s('version', 'string'),
        s('types', 'type_def[]'),
        s('structs', 'struct_def[]'),
        s('actions', 'action_def[]'),
        s('tables', 'table_def[]'),
        s('ricardian_clauses', 'clause_pair[]'),
        s('error_messages', 'error_message[]'),
        s('abi_extensions', 'extensions_entry[]'),
        s('variants', 'variant_def[]$'),
        s('action_results', 'action_result_def[]$')
      ]
    }
  ],
  actions: [],
  tables: [],
  ricardian_clauses: [],
  error_messages: [],
  abi_extensions: []
}

/** Serializes an ABI as the binary `abi_def` used by `setabi` and returned by `get_raw_abi`. */
export function abiToBinary(abi: AbiDef | string): Uint8Array {
  const def = parseAbi(abi)
  compileAbi(def)
  // variants$ is written when the ABI has a variants list (even an empty one, so that raw ABIs round trip) or
  // when action_results$ follows it; an empty action_results$ is never written because nodeos reports
  // an empty list for ABIs that do not have one.
  const { variants, action_results, ...rest } = def
  const withExt: Record<string, unknown> = { ...rest }
  if (action_results && action_results.length > 0) {
    withExt.variants = variants ?? []
    withExt.action_results = action_results
  } else if (variants !== undefined) {
    withExt.variants = variants
  }
  const out = encodeType(ABI_DEF_ABI, 'abi_def', withExt, 'abi')
  return out
}

/** Parses the binary `abi_def` (for example the result of `get_raw_abi`) into its JSON form. */
export function abiFromBinary(bytes: Uint8Array): AbiDef {
  const json = decodeType(ABI_DEF_ABI, 'abi_def', bytes, { path: 'abi' })
  const def = parseAbi(json)
  compileAbi(def)
  return def
}
