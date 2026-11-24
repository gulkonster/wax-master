// compile_commands.json for the editor engine. The flags make a stock clang
// front end see contract code the way the CDT compiler does: CDT's own libc++,
// libc and contract headers only, the C++ standard and defines CDT passes, and
// a 32-bit target whose type sizes match wasm32.
//
// Target choice (checked with `clangd --check` on the sample and a real
// multi-file contract): x86_64-unknown-linux-gnux32 has 32-bit pointers and
// size_t like wasm32 and also has __int128 and a 16-byte long double, so CDT's
// headers parse without the `type_unsupported` errors that the older
// i386-unknown-none-elf setup produces. The x86 and Linux macros the target
// defines are removed because CDT's libc++ branches on some of them.

import { FLAG_SETUP, type FlagSetup } from '../shared/lsp-diagnostics'

export { FLAG_SETUP }

export interface CompileCommand {
  directory: string
  file: string
  arguments: string[]
}

const TARGET_FLAGS: Record<FlagSetup, string[]> = {
  x32: [
    '--target=x86_64-unknown-linux-gnux32',
    '-nostdinc',
    '-D__wasm__',
    '-D__wasm32__',
    '-D__wasm',
    '-U__x86_64__',
    '-U__x86_64',
    '-U__amd64__',
    '-U__amd64',
    '-U__SSE__',
    '-U__SSE2__',
    '-U__SSE_MATH__',
    '-U__SSE2_MATH__',
    '-U__MMX__',
    '-U__FXSR__',
    '-U__linux__',
    '-U__linux',
    '-U__gnu_linux__',
    '-U__unix__',
    '-U__unix',
    '-Ulinux',
    '-Uunix'
  ],
  i386: ['--target=i386-unknown-none-elf', '-D__wasm__', '-D__wasm32__', '-D__wasm', '-nostdinc']
}

/** "4.1.1wax01" -> the defines CDT's driver passes. */
function versionDefines(version: string): string[] {
  const m = /^(\d+)\.(\d+)\.(.+)$/.exec(version)
  const [major, minor, patch] = m ? [m[1], m[2], m[3]] : ['0', '0', '0']
  return [`-D__eosio_cdt_major__=${major}`, `-D__eosio_cdt_minor__=${minor}`, `-D__eosio_cdt_patchlevel__=${patch}`]
}

/** The CDT header folders, in the order the CDT compiler searches them. */
export function toolchainIncludeDirs(cdtRoot: string): string[] {
  return [
    `${cdtRoot}/include/libcxx`,
    `${cdtRoot}/include/libc`,
    `${cdtRoot}/include`,
    `${cdtRoot}/include/eosiolib/core`,
    `${cdtRoot}/include/eosiolib/contracts`
  ]
}

export function compileFlags(setup: FlagSetup, cdtRoot: string, cdtVersion: string, includeDirs: string[]): string[] {
  return [
    ...TARGET_FLAGS[setup],
    '-std=gnu++2a',
    '-ffreestanding',
    '-nostdlib',
    '-fno-builtin',
    '-fno-threadsafe-statics',
    '-fno-exceptions',
    '-fno-rtti',
    '-D__eosio_cdt__',
    ...versionDefines(cdtVersion),
    '-D_GNU_SOURCE=1',
    '-DBOOST_DISABLE_ASSERTS',
    '-DBOOST_EXCEPTION_DISABLE',
    '-U__APPLE__',
    ...includeDirs.map((d) => `-I${d}`),
    ...toolchainIncludeDirs(cdtRoot).flatMap((d) => ['-isystem', d])
  ]
}

export interface CompileCommandsInput {
  /** Project folder inside the distro, e.g. /mnt/c/Users/me/proj. */
  rootWsl: string
  /** Project-relative .cpp files with forward slashes. */
  files: string[]
  /** Project-relative include folder (the build's `-I`). */
  include: string
  cdtRoot: string
  cdtVersion: string
  setup?: FlagSetup
}

export function compileCommands(input: CompileCommandsInput): CompileCommand[] {
  const root = input.rootWsl.replace(/\/+$/, '')
  const inc = input.include.replace(/^\.\//, '').replace(/\/+$/, '')
  const flags = compileFlags(input.setup ?? FLAG_SETUP, input.cdtRoot, input.cdtVersion, [inc ? `${root}/${inc}` : root])
  const seen = new Set<string>()
  const out: CompileCommand[] = []
  for (const rel of input.files) {
    const r = rel.replace(/^\.\//, '')
    if (seen.has(r)) continue
    seen.add(r)
    const file = `${root}/${r}`
    out.push({ directory: root, file, arguments: ['clang++', ...flags, '-c', file] })
  }
  return out
}
