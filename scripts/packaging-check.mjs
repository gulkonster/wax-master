// Checks that no test-only package ships in the app.
//   node scripts/packaging-check.mjs --before-build   checks package.json
//   node scripts/packaging-check.mjs dist/win-unpacked checks the built app
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const TEST_ONLY = ['eosjs', 'vitest', 'elliptic']
const ALLOWED_RUNTIME = ['@noble/curves', '@noble/hashes', '@xterm/addon-fit', '@xterm/xterm', 'monaco-editor', 'node-pty', 'react', 'react-dom']

const arg = process.argv[2]
let problems = []
if (arg === '--before-build') {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  for (const name of Object.keys(pkg.dependencies ?? {})) {
    if (!ALLOWED_RUNTIME.includes(name)) problems.push(`runtime dependency not on the allow-list: ${name}`)
  }
} else {
  const require = createRequire(import.meta.url)
  const asar = require('@electron/asar')
  const archive = join(arg, 'resources', 'app.asar')
  if (!existsSync(archive)) problems.push(`missing ${archive}`)
  else {
    const list = asar.listPackage(archive, { isPack: false }).map((p) => p.replace(/\\/g, '/'))
    for (const t of TEST_ONLY) if (list.some((p) => p.includes(`/node_modules/${t}/`))) problems.push(`test-only package inside the app: ${t}`)
    if (list.some((p) => p.startsWith('/test/'))) problems.push('test files inside the app')
  }
  const unpacked = join(arg, 'resources', 'app.asar.unpacked', 'node_modules')
  if (existsSync(unpacked)) {
    for (const d of readdirSync(unpacked)) if (TEST_ONLY.includes(d)) problems.push(`test-only package unpacked: ${d}`)
  }
}
if (problems.length) {
  console.error(problems.join('\n'))
  process.exit(1)
}
console.log('Packaging check passed')
