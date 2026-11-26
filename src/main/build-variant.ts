// Testnet and mainnet builds of one contract source (E64).
//
// A project's code marks its network parts with two macros that WAX Master defines when it
// compiles: WAXMASTER_TESTNET in the testnet build (WAX Testnet, other test networks and the
// local chain) and WAXMASTER_MAINNET in the mainnet build. Code inside `#ifdef WAXMASTER_TESTNET`
// is not compiled into the mainnet build at all, so it is in neither its WASM nor its ABI.
// Values that differ per network are set in one place with the same macros (for example a
// header with `#ifdef WAXMASTER_MAINNET ... #else ... #endif`). A project whose sources use
// neither macro has one build that fits every network.

import type { BuildVariant, Problem } from '../shared/api'
import type { NetworkKind } from '../shared/chain-types'

export type BuildFor = 'testnet' | 'mainnet'

export const VARIANT_MACRO: Record<BuildFor, string> = { testnet: 'WAXMASTER_TESTNET', mainnet: 'WAXMASTER_MAINNET' }

/** The build a network takes: mainnet for a mainnet, testnet for a test network and the local chain. */
export function buildForKind(kind: NetworkKind): BuildFor {
  return kind === 'mainnet' ? 'mainnet' : 'testnet'
}

/** True when any source line names one of the two macros (so the two builds differ). */
export function usesNetworkMacros(sources: { lines: string[] }[]): boolean {
  return sources.some((s) => s.lines.some((l) => l.includes(VARIANT_MACRO.testnet) || l.includes(VARIANT_MACRO.mainnet)))
}

/** The variant a build is: the network's when the sources use the macros, otherwise one for all. */
export function variantOf(uses: boolean, buildFor: BuildFor): BuildVariant {
  return uses ? buildFor : 'any'
}

/** The compiler flag of a variant; none for a build that fits every network. */
export function variantFlags(variant: BuildVariant): string[] {
  return variant === 'any' ? [] : [`-D${VARIANT_MACRO[variant]}`]
}

/** For a custom build command: what it is told about the build, as environment variables (it may pass the flag itself). */
export function variantEnv(buildFor: BuildFor): Record<string, string> {
  return { WAXMASTER_NETWORK: buildFor, WAXMASTER_BUILD_FLAG: `-D${VARIANT_MACRO[buildFor]}` }
}

/** A build may be deployed to a network when it fits every network or is that network's build. */
export function variantFits(variant: BuildVariant, buildFor: BuildFor): boolean {
  return variant === 'any' || variant === buildFor
}

export function variantLabel(variant: BuildVariant): string {
  return variant === 'any' ? 'one build for every network' : variant === 'mainnet' ? 'mainnet build' : 'testnet build'
}

// E68: a project that uses the macros must stop with an error when another compiler builds it
// without either flag; otherwise that compiler silently makes a testnet build (an `#else`
// branch), and code written as `#ifndef WAXMASTER_MAINNET` lands in every build that is not a
// WAX Master mainnet build. WAX Master warns (it never blocks) when the guard is missing or such
// a line is used.

const M = VARIANT_MACRO.mainnet
const T = VARIANT_MACRO.testnet

export const GUARD_LINES = [
  `#if !defined(${M}) && !defined(${T})`,
  `#error "Build with WAX Master, or add -D${M} or -D${T}"`,
  '#endif'
]

export interface MacroFinding {
  kind: 'no-guard' | 'ifndef'
  file: string
  line: number
  column: number
  /** One line, for Problems. */
  message: string
  /** The full explanation with the fix, for Output. */
  detail: string
}

/** The lines of a file with comments removed (line numbers kept). */
function codeLines(lines: string[]): string[] {
  let inBlock = false
  return lines.map((raw) => {
    let out = ''
    let quote: string | null = null
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i]
      const next = raw[i + 1]
      if (inBlock) {
        if (c === '*' && next === '/') {
          inBlock = false
          i++
        }
        continue
      }
      if (quote) {
        out += c
        if (c === '\\' && next !== undefined) {
          out += next
          i++
        } else if (c === quote) quote = null
        continue
      }
      if (c === '/' && next === '/') break
      if (c === '/' && next === '*') {
        inBlock = true
        out += ' '
        i++
        continue
      }
      if (c === '"' || c === "'") quote = c
      out += c
    }
    return out
  })
}

interface Directive {
  name: string
  /** The first word after the directive name (the macro of #ifdef / #ifndef). */
  word: string
  rest: string
  line: number
  column: number
}

/** The preprocessor directives of a file, without comments, continuation lines joined. */
function directives(lines: string[]): Directive[] {
  const code = codeLines(lines)
  const out: Directive[] = []
  for (let i = 0; i < code.length; i++) {
    const m = /^(\s*)#\s*([A-Za-z_]+)(.*)$/.exec(code[i])
    if (!m) continue
    const at = i
    let rest = m[3]
    while (rest.endsWith('\\') && i + 1 < code.length) rest = rest.slice(0, -1) + ' ' + code[++i]
    rest = rest.trim()
    out.push({ name: m[2], word: rest.split(/\s+/)[0] ?? '', rest, line: at + 1, column: m[1].length + 1 })
  }
  return out
}

/** The condition without spaces and parentheses, so `defined X` and `defined(X)` read alike. */
function squash(expr: string): string {
  return expr.replace(/[\s()]/g, '')
}

/** True when the condition is "neither macro is defined", in one of the usual spellings. */
function isNeitherCondition(expr: string): boolean {
  return [
    `!defined${M}&&!defined${T}`,
    `!defined${T}&&!defined${M}`,
    `!defined${M}||defined${T}`, // !(defined(M) || defined(T)) once the parentheses are gone
    `!defined${T}||defined${M}`
  ].includes(squash(expr))
}

/** The macro that `#ifndef X`, `#if !defined(X)` or `#elif !defined(X)` names alone, or null. */
function notDefinedMacro(d: Directive | undefined): string | null {
  if (!d) return null
  if (d.name === 'ifndef') return d.word === M || d.word === T ? d.word : null
  if (d.name !== 'if' && d.name !== 'elif') return null
  const s = squash(d.rest)
  return s === `!defined${M}` ? M : s === `!defined${T}` ? T : null
}

/** Whether the block a directive opens stops the build at once: its next directive is #error. */
function stopsWithError(ds: Directive[], i: number): boolean {
  return ds[i + 1]?.name === 'error'
}

/** The first place a source names either macro (outside comments). */
function firstUse(sources: { rel: string; lines: string[] }[]): { file: string; line: number; column: number } | null {
  for (const src of sources) {
    const code = codeLines(src.lines)
    for (let i = 0; i < code.length; i++) {
      const at = [code[i].indexOf(T), code[i].indexOf(M)].filter((x) => x >= 0)
      if (at.length) return { file: src.rel, line: i + 1, column: Math.min(...at) + 1 }
    }
  }
  return null
}

/**
 * The network-build warnings of a project's sources (E68): the guard is missing although the
 * macros are used, or `#ifndef WAXMASTER_MAINNET` / `#ifndef WAXMASTER_TESTNET` (also written as
 * `#if !defined(...)`) is used. Empty for a project that names neither macro outside comments.
 */
export function checkNetworkMacros(sources: { rel: string; lines: string[] }[]): MacroFinding[] {
  const use = firstUse(sources)
  if (!use) return []
  const findings: MacroFinding[] = []
  let guard = false
  for (const src of sources) {
    const ds = directives(src.lines)
    for (let i = 0; i < ds.length; i++) {
      const d = ds[i]
      if (d.name === 'if' && isNeitherCondition(d.rest) && stopsWithError(ds, i)) {
        guard = true
        continue
      }
      const macro = notDefinedMacro(d)
      if (!macro) continue
      // `#ifndef X` followed at once by #error only stops the build: not risky.
      if (stopsWithError(ds, i)) continue
      // A guard written as two nested lines, `#ifndef M` / `#ifndef T` / `#error`.
      const other = macro === M ? T : M
      if (notDefinedMacro(ds[i + 1]) === other && stopsWithError(ds, i + 1)) {
        guard = true
        i++
        continue
      }
      const written = d.name === 'ifndef' ? `#ifndef ${macro}` : `#${d.name} !defined(${macro})`
      const fix = macro === M ? `#ifdef ${T}` : `#ifdef ${M}`
      const meaning =
        macro === M
          ? 'it is true in every build that is not a WAX Master mainnet build, also when another compiler builds this code without either flag, so this code can end up in a mainnet contract'
          : 'it is true in every build that is not a WAX Master testnet build, also when another compiler builds this code without either flag'
      findings.push({
        kind: 'ifndef',
        file: src.rel,
        line: d.line,
        column: d.column,
        message: `${written}: ${meaning}. Write ${fix} instead.`,
        detail:
          `Warning: ${src.rel}:${d.line}: ${written} is risky: ${meaning}.\n` +
          `  Fix: write ${fix} for code that belongs only in the ${macro === M ? 'testnet' : 'mainnet'} build. Help > Testnet and mainnet builds explains it.`
      })
    }
  }
  if (!guard) {
    findings.unshift({
      kind: 'no-guard',
      file: use.file,
      line: use.line,
      column: use.column,
      message: `The sources use ${T} / ${M} but have no guard, so another compiler (for example EOS Studio) builds them without an error, as a testnet build. Add the guard from Help > Testnet and mainnet builds to a header every source includes.`,
      detail:
        `Warning: the sources use ${T} / ${M}, but no guard stops a build that defines neither.\n` +
        '  Another compiler (for example EOS Studio) would build this code without an error, and every #else branch would give the testnet values.\n' +
        '  Fix: add these lines to a header that every source includes (for example include/network.hpp):\n' +
        GUARD_LINES.map((l) => `    ${l}\n`).join('') +
        `  Another compiler can still build the code when it adds -D${M} or -D${T}. Help > Testnet and mainnet builds explains it.`
    })
  }
  return findings
}

/** The warnings as Problems (they never fail the build). */
export function macroProblems(findings: MacroFinding[]): Problem[] {
  return findings.map((f) => ({ file: f.file, line: f.line, column: f.column, severity: 'warning' as const, message: f.message, source: 'build' as const }))
}
