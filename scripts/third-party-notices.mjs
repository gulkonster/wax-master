// Writes THIRD_PARTY_NOTICES.md: license texts of the npm packages shipped in
// the app and the list of unmodified toolchain parts with their licenses.
// Run after `npm ci`: node scripts/third-party-notices.mjs
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SHIPPED = ['electron', 'react', 'react-dom', 'scheduler', 'monaco-editor', '@xterm/xterm', '@xterm/addon-fit', 'node-pty', '@noble/curves', '@noble/hashes']

function licenseText(dir) {
  const f = readdirSync(dir).find((n) => /^(licen[cs]e|copying)(\.md|\.txt)?$/i.test(n))
  return f ? readFileSync(join(dir, f), 'utf8').trim() : null
}

const out = ['# Third-party notices', '', 'WAX Master is MIT licensed. It includes the following software.', '', '## Packages shipped with the app', '']
for (const name of SHIPPED) {
  const dir = join('node_modules', name)
  if (!existsSync(dir)) continue
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  out.push(`### ${name} ${pkg.version}`, '', `License: ${pkg.license ?? 'see below'}`, '')
  const text = licenseText(dir)
  if (text) out.push('```', text, '```', '')
}
out.push(
  '## Toolchain parts (shipped unmodified in the installer)',
  '',
  'The installer contains the following files exactly as published (SHA-256 in `toolchain/parts.json`). Each Debian package carries its full copyright file, installed at `/usr/share/doc/<package>/copyright` inside the toolchain environment. Ubuntu is a trademark of Canonical Ltd.; the Ubuntu Base image is redistributed without modification.',
  '',
  '| Part | File | License | Source |',
  '|---|---|---|---|'
)
const manifest = JSON.parse(readFileSync(join('toolchain', 'parts.json'), 'utf8'))
for (const p of manifest.parts) out.push(`| ${p.id} | ${p.file} | ${p.license} | ${p.source ?? p.urls?.[0] ?? ''} |`)
out.push('')
writeFileSync('THIRD_PARTY_NOTICES.md', out.join('\n'))
console.log('THIRD_PARTY_NOTICES.md written')
