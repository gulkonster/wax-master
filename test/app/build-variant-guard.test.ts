import { describe, expect, it } from 'vitest'
import { checkNetworkMacros, GUARD_LINES, macroProblems } from '../../src/main/build-variant'

const src = (rel: string, text: string): { rel: string; lines: string[] } => ({ rel, lines: text.split('\n') })

const GUARD = GUARD_LINES.join('\n')

describe('network build guard warnings (E68)', () => {
  it('a project that names neither macro gets no warning', () => {
    expect(checkNetworkMacros([src('src/a.cpp', 'void hi();')])).toEqual([])
    expect(checkNetworkMacros([src('src/a.cpp', '// WAXMASTER_TESTNET is only named in a comment')])).toEqual([])
  })

  it('macros without the guard: one warning at the first use, with the lines to add', () => {
    const f = checkNetworkMacros([src('src/a.cpp', 'int x;\n#ifdef WAXMASTER_MAINNET\n#define A 1\n#else\n#define A 2\n#endif')])
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ kind: 'no-guard', file: 'src/a.cpp', line: 2, column: 8 })
    expect(f[0].detail).toContain(GUARD_LINES[0])
    expect(f[0].detail).toContain('EOS Studio')
  })

  it('the guard in any source (for example a header) counts', () => {
    const f = checkNetworkMacros([src('include/network.hpp', GUARD), src('src/a.cpp', '#ifdef WAXMASTER_TESTNET\nACTION x();\n#endif')])
    expect(f).toEqual([])
  })

  it('other spellings of the guard count', () => {
    for (const g of [
      '#if !defined WAXMASTER_TESTNET && !defined WAXMASTER_MAINNET\n#error "no"\n#endif',
      '#if !(defined(WAXMASTER_MAINNET) || defined(WAXMASTER_TESTNET))\n  #  error "no"\n#endif',
      '#ifndef WAXMASTER_MAINNET\n#ifndef WAXMASTER_TESTNET\n#error "no"\n#endif\n#endif'
    ]) {
      expect(checkNetworkMacros([src('a.hpp', g + '\n#ifdef WAXMASTER_TESTNET\n#endif')])).toEqual([])
    }
  })

  it('a guard without #error, or inside a comment, does not count', () => {
    expect(checkNetworkMacros([src('a.hpp', '#if !defined(WAXMASTER_MAINNET) && !defined(WAXMASTER_TESTNET)\n#define X 1\n#endif')])[0].kind).toBe('no-guard')
    expect(checkNetworkMacros([src('a.hpp', '/*\n' + GUARD + '\n*/\n#ifdef WAXMASTER_TESTNET\n#endif')])[0].kind).toBe('no-guard')
  })

  it('#ifndef WAXMASTER_MAINNET and #if !defined(WAXMASTER_TESTNET) are named with their fix', () => {
    const f = checkNetworkMacros([src('include/n.hpp', GUARD), src('src/a.cpp', 'x\n  #ifndef WAXMASTER_MAINNET\nACTION cleanup();\n#endif\n#if !defined(WAXMASTER_TESTNET)\n#endif')])
    expect(f.map((x) => [x.kind, x.line, x.column])).toEqual([
      ['ifndef', 2, 3],
      ['ifndef', 5, 1]
    ])
    expect(f[0].message).toContain('Write #ifdef WAXMASTER_TESTNET instead')
    expect(f[1].message).toContain('Write #ifdef WAXMASTER_MAINNET instead')
  })

  it('both warnings together; they become Problems with severity warning', () => {
    const f = checkNetworkMacros([src('src/a.cpp', '#ifndef WAXMASTER_MAINNET\nACTION cleanup();\n#endif')])
    expect(f.map((x) => x.kind)).toEqual(['no-guard', 'ifndef'])
    const p = macroProblems(f)
    expect(p.every((x) => x.severity === 'warning' && x.source === 'build' && x.file === 'src/a.cpp')).toBe(true)
  })

  it('the help page example passes the check', async () => {
    const { readFileSync } = await import('node:fs')
    const page = readFileSync('docs/help/network-builds.md', 'utf8')
    const blocks = [...page.matchAll(/```cpp\n([\s\S]*?)```/g)].map((m) => m[1])
    const example = blocks.find((b) => b.includes('eosio::contract'))!
    expect(checkNetworkMacros([src('src/game.cpp', example)])).toEqual([])
  })
})
