// Builds every C++ sample of the help pages (docs/help/*.md) with the installed
// default toolchain, the way the app builds a project:
//   cdt-cpp -abigen -I ./include -R ./resource -contract <name> -o ./<name>.wasm src/<name>.cpp
// run in the toolchain's WSL distro.
//
// - A block that holds a contract class is built as it is.
// - A shorter block (a fragment) is checked against its full form: a complete
//   block of the same page, or a project folder listed in FULL_FORMS below. Each
//   code line of the fragment must appear in the full form, and the full form is
//   built. A full form may be expected to fail with a given text (a page that
//   shows a compiler error).
// - Every page of the "Writing contracts" group must have a complete sample.
//
// Prints one line per sample and ends with an error when one fails.
// It needs WSL and the toolchain (Help > Setup in the app), so it is not part of
// the test suite. Usage: node scripts/check-doc-samples.mjs [--distro <name>] [--page <file.md>[,<file.md>...]]

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DOCS = join(ROOT, 'docs', 'help')
const DEFAULT_DISTRO = 'waxmaster-wax-cdt-4.1.1wax01'
const WRITING_GROUP = 'writing'
const PARALLEL = 3

/**
 * Full forms of the fragments, by page. `dirs` are project folders in the layout
 * of resources/templates (src/contract.cpp, include/contract.hpp, resource/,
 * with the markers %CONTRACT% and %CLASS%); the first one that exists is used.
 * Complete blocks of the same page count as full forms without an entry here.
 */
const FULL_FORMS = {
  'first-contract.md': [{ dirs: ['resources/templates/project/hello'], contract: 'hello' }],
  'abi-check.md': [{ dirs: ['test/fixtures/doc-samples/abi-check-other-table'], contract: 'cfgreader' }],
  'compiler-errors.md': [
    { dirs: ['test/fixtures/doc-samples/compiler-errors-mismatch'], contract: 'hello', expectError: 'does not match any declaration' }
  ],
  'example-transfer-listener.md': [{ dirs: ['resources/templates/examples/transfer-listener'], contract: 'listener' }],
  'example-staking.md': [{ dirs: ['resources/templates/examples/staking'], contract: 'staking' }],
  'example-atomicassets.md': [{ dirs: ['resources/templates/examples/atomicassets'], contract: 'minter' }],
  'example-alcor-swap.md': [{ dirs: ['resources/templates/examples/alcor-swap'], contract: 'swapper' }],
  'example-random-number.md': [{ dirs: ['resources/templates/examples/random-number'], contract: 'dice' }],
  'example-nft-staking.md': [{ dirs: ['resources/templates/examples/nft-staking'], contract: 'nftstake' }],
  'example-nft-blend.md': [{ dirs: ['resources/templates/examples/nft-blend'], contract: 'blender' }],
  'example-payments.md': [{ dirs: ['resources/templates/examples/payments'], contract: 'payments' }],
  'example-reward-log.md': [{ dirs: ['resources/templates/examples/reward-log'], contract: 'rewards' }],
  'contract-table-migration.md': [
    { dirs: ['test/fixtures/doc-samples/migration-v1'], contract: 'migrate' },
    { dirs: ['test/fixtures/doc-samples/migration-v2-plain'], contract: 'migrate' },
    { dirs: ['test/fixtures/doc-samples/migration-v2-extension'], contract: 'migrate' },
    { dirs: ['test/fixtures/doc-samples/migration-v3-newtable'], contract: 'migrate' }
  ]
}

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag)
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

/** The ```cpp blocks of a page, numbered from 1. */
function cppBlocks(text) {
  const out = []
  const re = /^```cpp\r?\n([\s\S]*?)^```/gm
  let m
  while ((m = re.exec(text))) out.push(m[1].replace(/\r\n/g, '\n'))
  return out
}

function contractName(code) {
  const m = /class\s+\[\[eosio::contract\("([a-z1-5.]{1,12})"\)\]\]/.exec(code)
  return m ? m[1] : null
}

/**
 * Code without comments, whitespace collapsed, and without the class qualifier
 * of a function name (a page may show a member inside the class that the
 * project defines outside it): for the fragment check.
 */
function normal(code) {
  return code
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\{\s*\.\.\.\s*\}/g, '')
    .replace(/\b\w+::(?=~?\w+\s*\()/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Fragment lines missing from the full form. */
function missingLines(fragment, full) {
  const whole = normal(full)
  return fragment
    .split('\n')
    .map(normal)
    .filter((l) => l && l !== '...')
    .filter((l) => !whole.includes(l))
}

function fill(text, contract) {
  return text.replace(/\r\n/g, '\n').replace(/%CONTRACT%/g, contract).replace(/%CLASS%/g, contract.replace(/[^a-z0-9_]/g, '_'))
}

/** A project folder in the app's layout from a single source file. */
function projectFromBlock(dir, contract, code) {
  for (const d of ['src', 'include', 'resource']) mkdirSync(join(dir, d), { recursive: true })
  writeFileSync(join(dir, 'src', `${contract}.cpp`), code)
}

/** A project folder in the app's layout from a template-style folder. */
function projectFromDir(dir, contract, source) {
  for (const d of ['src', 'include', 'resource']) mkdirSync(join(dir, d), { recursive: true })
  for (const d of ['src', 'include', 'resource']) {
    const from = join(source, d)
    if (!existsSync(from)) continue
    for (const f of readdirSync(from)) {
      if (!statSync(join(from, f)).isFile()) continue
      const to = f.startsWith('contract.') ? `${contract}.${f.slice('contract.'.length)}` : f
      writeFileSync(join(dir, d, to), fill(readFileSync(join(from, f), 'utf8'), contract))
    }
  }
}

/** The full text of a template-style folder (for the fragment check). */
function dirText(source, contract) {
  let text = ''
  for (const d of ['include', 'src']) {
    const from = join(source, d)
    if (!existsSync(from)) continue
    for (const f of readdirSync(from)) if (/\.(c|h)pp$/.test(f)) text += fill(readFileSync(join(from, f), 'utf8'), contract) + '\n'
  }
  return text
}

function wslExe() {
  return join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe')
}

function run(args, cwd) {
  return new Promise((resolve) => {
    const p = spawn(wslExe(), args, { cwd, env: { ...process.env, WSL_UTF8: '1' }, windowsHide: true })
    let out = ''
    p.stdout.on('data', (d) => (out += d.toString()))
    p.stderr.on('data', (d) => (out += d.toString()))
    p.on('error', (e) => resolve({ code: -1, output: String(e) }))
    p.on('close', (code) => resolve({ code: code ?? -1, output: out.replace(/\0/g, '').replace(/\r/g, '') }))
  })
}

async function build(distro, dir, contract) {
  const args = ['-d', distro, '--cd', dir, '--exec', 'cdt-cpp', '-abigen', '-I', './include', '-R', './resource', '-contract', contract, '-o', `./${contract}.wasm`, `src/${contract}.cpp`]
  const started = Date.now()
  const r = await run(args, dir)
  const built = r.code === 0 && existsSync(join(dir, `${contract}.wasm`)) && existsSync(join(dir, `${contract}.abi`))
  return { built, output: r.output, seconds: ((Date.now() - started) / 1000).toFixed(1) }
}

async function main() {
  if (process.platform !== 'win32') {
    console.error('This script runs on Windows with WSL.')
    process.exit(2)
  }
  const distro = argValue('--distro', DEFAULT_DISTRO)
  const version = await run(['-d', distro, '--exec', 'cdt-cpp', '--version'])
  if (version.code !== 0) {
    console.error(`The toolchain distro "${distro}" does not answer. Set up the toolchain in the app (Help > Setup).\n${version.output.trim()}`)
    process.exit(2)
  }
  console.log(`Toolchain: ${distro}, ${version.output.trim().split('\n')[0]}`)

  const index = JSON.parse(readFileSync(join(DOCS, 'index.json'), 'utf8'))
  const writing = index.groups.find((g) => g.id === WRITING_GROUP)?.topics.map((t) => `${t.id}.md`) ?? []

  const work = mkdtempSync(join(tmpdir(), 'doc-samples-'))
  /** Builds to run: key -> { dir, contract, expectError, prepare } */
  const builds = new Map()
  /** Lines of the table: { page, block, kind, sample, buildKey, problem } */
  const rows = []
  const only = argValue('--page', '').split(',').map((s) => s.trim()).filter(Boolean)
  const pages = readdirSync(DOCS).filter((f) => f.endsWith('.md') && (only.length === 0 || only.includes(f))).sort()
  const complete = new Set()

  for (const page of pages) {
    const blocks = cppBlocks(readFileSync(join(DOCS, page), 'utf8'))
    const fulls = []
    blocks.forEach((code, i) => {
      const name = contractName(code)
      if (!name) return
      const key = `${page}#${i + 1}`
      const dir = join(work, key.replace(/[^a-z0-9-]/gi, '_'))
      builds.set(key, { dir, contract: name, prepare: () => projectFromBlock(dir, name, code) })
      fulls.push({ label: `block ${i + 1}`, text: code, buildKey: key })
      rows.push({ page, block: i + 1, kind: 'contract', sample: name, buildKey: key })
      complete.add(page)
    })
    for (const f of FULL_FORMS[page] ?? []) {
      const source = f.dirs.find((d) => existsSync(join(ROOT, d, 'src', 'contract.cpp')))
      if (!source) {
        fulls.push({ label: f.dirs.join(' or '), text: null, missing: true })
        continue
      }
      const key = `${source}:${f.contract}`
      const dir = join(work, key.replace(/[^a-z0-9-]/gi, '_'))
      if (!builds.has(key)) builds.set(key, { dir, contract: f.contract, expectError: f.expectError, prepare: () => projectFromDir(dir, f.contract, join(ROOT, source)) })
      fulls.push({ label: source, text: dirText(join(ROOT, source), f.contract), buildKey: key })
    }
    blocks.forEach((code, i) => {
      if (contractName(code)) return
      const candidates = fulls.filter((f) => f.text !== null)
      const hit = candidates.find((f) => missingLines(code, f.text).length === 0)
      if (hit) {
        rows.push({ page, block: i + 1, kind: 'fragment', sample: `in ${hit.label}`, buildKey: hit.buildKey })
      } else if (candidates.length === 0) {
        const want = fulls.map((f) => f.label).join(', ')
        rows.push({ page, block: i + 1, kind: 'fragment', sample: '-', problem: want ? `full form missing: ${want}` : 'no full form listed' })
      } else {
        const first = missingLines(code, candidates[0].text)[0]
        rows.push({ page, block: i + 1, kind: 'fragment', sample: '-', problem: `not in its full form: "${first}"` })
      }
    })
  }

  // Build, a few at a time.
  const results = new Map()
  const queue = [...builds.entries()]
  async function worker() {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const [key, b] = next
      b.prepare()
      results.set(key, { ...(await build(distro, b.dir, b.contract)), expectError: b.expectError })
      process.stdout.write('.')
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, worker))
  process.stdout.write('\n')

  let failed = 0
  const lines = []
  for (const r of rows) {
    let result
    if (r.problem) {
      result = `FAILED: ${r.problem}`
    } else {
      const b = results.get(r.buildKey)
      if (b.expectError) {
        result = !b.built && b.output.includes(b.expectError) ? `fails as the page shows (${b.seconds} s)` : `FAILED: expected the error "${b.expectError}"`
      } else {
        result = b.built ? `built (${b.seconds} s)` : 'FAILED: the build failed'
      }
      if (result.startsWith('FAILED') && !b.reported) {
        b.reported = true
        result += '\n' + b.output.trim().split('\n').slice(-15).map((l) => `      ${l}`).join('\n')
      }
    }
    if (result.startsWith('FAILED')) failed++
    lines.push({ cells: [r.page, String(r.block), r.kind, r.sample], result })
  }
  for (const page of writing.filter((p) => only.length === 0 || only.includes(p))) {
    if (!complete.has(page)) {
      failed++
      lines.push({ cells: [page, '-', '-', '-'], result: 'FAILED: a "Writing contracts" page without a complete sample' })
    }
  }

  const widths = [0, 1, 2, 3].map((c) => Math.max(...lines.map((l) => l.cells[c].length), ['Page', 'Block', 'Kind', 'Sample'][c].length))
  const fmt = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join('  ')
  console.log(fmt(['Page', 'Block', 'Kind', 'Sample']) + '  Result')
  for (const l of lines) console.log(fmt(l.cells) + '  ' + l.result)
  const builtCount = [...results.values()].filter((b) => (b.expectError ? !b.built : b.built)).length
  console.log(`\n${rows.length} blocks, ${builds.size} builds, ${builtCount} as expected, ${failed} failed.`)

  try {
    rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  } catch (e) {
    // A build process may still hold a file on Windows; the folder is in the temp folder.
    console.log(`Could not remove ${work}: ${e.code ?? e}`)
  }
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
