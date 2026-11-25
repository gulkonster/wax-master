// Builds the system contracts of the app's local chain from pinned source and writes
// resources/local-chain/contracts/*.wasm|*.abi and resources/local-chain/contracts.json.
//
// Source: wax-system-contracts, tag wax-3.4.1 (MIT). The tarball is downloaded into a temp folder outside
// the repository, its SHA-256 is checked, and the four contracts are built with cdt-cpp inside the
// toolchain distro (building only; nothing is installed). The temp folders are removed at the end.
//
// Usage: node scripts/build-local-chain-contracts.mjs [--distro <name>] [--check]
//   --check  builds and compares with the files in the repository, writes nothing.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'resources', 'local-chain', 'contracts')
const MANIFEST = join(ROOT, 'resources', 'local-chain', 'contracts.json')

const SOURCE = {
  repository: 'https://github.com/worldwide-asset-exchange/wax-system-contracts',
  tag: 'wax-3.4.1',
  commit: 'a8c19f8b480f9101aff31b6e2a749c960f30c81a',
  url: 'https://github.com/worldwide-asset-exchange/wax-system-contracts/archive/refs/tags/wax-3.4.1.tar.gz',
  sha256: '7c74db85e2f01ab96b32c8d1144d1d53713d32bc1bd158024c8650be92c85c8f',
  license: 'MIT'
}
const CONTRACTS = ['eosio.boot', 'eosio.system', 'eosio.token', 'eosio.msig']
const DEFAULT_DISTRO = 'waxmaster-wax-cdt-4.1.1wax01'

function argValue(name, fallback) {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

function wslExe() {
  return join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe')
}

/** Runs wsl.exe; returns { code, out: Buffer, err: string }. `input` goes to stdin. */
function wsl(args, input) {
  return new Promise((res) => {
    const p = spawn(wslExe(), args, { env: { ...process.env, WSL_UTF8: '1' }, windowsHide: true })
    const out = []
    let err = ''
    p.stdout.on('data', (d) => out.push(d))
    p.stderr.on('data', (d) => (err += d.toString()))
    p.on('error', (e) => res({ code: -1, out: Buffer.alloc(0), err: String(e) }))
    p.on('close', (code) => res({ code: code ?? -1, out: Buffer.concat(out), err: err.replace(/\0/g, '').replace(/\r/g, '') }))
    p.stdin.on('error', () => {})
    p.stdin.end(input ?? '')
  })
}

function toWslPath(p) {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(p)
  return m ? `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}` : p
}

async function download(dest) {
  let lastError = ''
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(SOURCE.url, { redirect: 'follow' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const buf = Buffer.from(await r.arrayBuffer())
      const got = sha256(buf)
      if (got !== SOURCE.sha256) throw new Error(`SHA-256 mismatch: expected ${SOURCE.sha256}, got ${got}`)
      writeFileSync(dest, buf)
      return buf.length
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
      const network = /fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|HTTP 5/.test(lastError + String(e?.cause ?? ''))
      console.error(`Download attempt ${attempt} of 3 failed (${network ? 'network' : 'not the network'}): ${lastError}`)
    }
  }
  throw new Error(`Download failed after 3 attempts: ${lastError}`)
}

// Runs inside the distro. $1 = tarball path (WSL form). The result goes to /tmp/<work>/out; the work folder name is printed.
const BUILD_SCRIPT = String.raw`
set -e
WORK=$(mktemp -d /tmp/wsc-build-XXXXXX)
echo "WORK=$WORK"
tar xzf "$1" -C "$WORK" --strip-components=1
cd "$WORK/contracts"
# Ricardian .md.in files: fill the @NAME@ values from contracts/CMakeLists.txt, write .md beside them.
SEDX=""
while IFS= read -r line; do
  name=$(printf '%s' "$line" | sed -n 's/^set(\([A-Z_]*\) "\(.*\)")$/\1/p')
  val=$(printf '%s' "$line" | sed -n 's/^set(\([A-Z_]*\) "\(.*\)")$/\2/p')
  [ -n "$name" ] && SEDX="$SEDX -e s|@$name@|$val|g"
done < <(grep -E '^set\((ICON_BASE_URL|[A-Z]+_ICON_URI) ' CMakeLists.txt)
for f in */ricardian/*.md.in; do sed $SEDX "$f" > "\${f%.in}"; done
if grep -l '@[A-Z_]*@' */ricardian/*.md >/dev/null 2>&1; then echo "UNREPLACED"; exit 3; fi
mkdir -p out gen
cdt-cpp -abigen -contract eosio.token -o out/eosio.token.wasm -I eosio.token/include -R eosio.token/ricardian -R gen eosio.token/src/eosio.token.cpp
cdt-cpp -abigen -contract eosio.msig -o out/eosio.msig.wasm -I eosio.msig/include -R eosio.msig/ricardian -R gen eosio.msig/src/eosio.msig.cpp
cdt-cpp -abigen -contract eosio.boot -o out/eosio.boot.wasm -I eosio.boot/include -R eosio.boot/ricardian -R gen eosio.boot/src/eosio.boot.cpp
cdt-cpp -abigen -contract eosio.system -o out/eosio.system.wasm -DSYSTEM_CONFIGURABLE_WASM_LIMITS -DSYSTEM_BLOCKCHAIN_PARAMETERS -I eosio.system/include -I eosio.token/include -R eosio.system/ricardian -R gen eosio.system/src/{eosio.system,delegate_bandwidth,exchange_state,name_bidding,native,producer_pay,voting,standby,limit_auth_changes,block_info,wps,powerup}.cpp
echo "BUILD_OK"
`.replace(/\\\$\{f%\.in\}/g, '${f%.in}')

async function main() {
  if (process.platform !== 'win32') {
    console.error('This script runs on Windows (it uses wsl.exe).')
    process.exit(1)
  }
  const distro = argValue('--distro', DEFAULT_DISTRO)
  const checkOnly = process.argv.includes('--check')
  const started = Date.now()
  const temp = mkdtempSync(join(tmpdir(), 'wax-master-wsc-'))
  let work = ''
  try {
    const tar = join(temp, 'wax-system-contracts.tar.gz')
    const size = await download(tar)
    console.log(`Downloaded ${size} bytes, SHA-256 ok`)
    const version = await wsl(['-d', distro, '--exec', 'cdt-cpp', '--version'])
    if (version.code !== 0) throw new Error(`The toolchain distro "${distro}" does not answer: ${version.err.trim()}`)
    const cdt = version.out.toString().trim().split('\n')[0]
    console.log(`Toolchain: ${distro}, ${cdt}`)

    const r = await wsl(['-d', distro, '--exec', 'bash', '-s', '--', toWslPath(tar)], BUILD_SCRIPT)
    const text = r.out.toString() + r.err
    work = /WORK=(\S+)/.exec(text)?.[1] ?? ''
    if (r.code !== 0 || !text.includes('BUILD_OK')) {
      const lines = text.split('\n').filter((l) => /error|UNREPLACED/i.test(l)).slice(0, 20)
      throw new Error(`Build failed (exit ${r.code}).\n${lines.join('\n')}`)
    }
    const warnings = (text.match(/does not have a ricardian contract/g) ?? []).length
    console.log(`Built ${CONTRACTS.length} contracts (${warnings} abigen warnings about missing ricardian text)`)

    const files = []
    for (const name of CONTRACTS) {
      for (const ext of ['wasm', 'abi']) {
        const f = `${name}.${ext}`
        const c = await wsl(['-d', distro, '--exec', 'cat', `${work}/contracts/out/${f}`])
        if (c.code !== 0 || c.out.length === 0) throw new Error(`Cannot read ${f} from the build`)
        files.push({ name: f, contract: name, bytes: c.out.length, sha256: sha256(c.out), data: c.out })
      }
    }

    if (checkOnly) {
      let same = true
      for (const f of files) {
        const p = join(OUT_DIR, f.name)
        const ok = existsSync(p) && sha256(readFileSync(p)) === f.sha256
        if (!ok) same = false
        console.log(`${ok ? 'same   ' : 'DIFFERS'} ${f.name} ${f.bytes} ${f.sha256}`)
      }
      process.exitCode = same ? 0 : 1
    } else {
      mkdirSync(OUT_DIR, { recursive: true })
      for (const f of files) writeFileSync(join(OUT_DIR, f.name), f.data)
      const manifest = {
        source: { ...SOURCE, kind: 'built from source with cdt-cpp', cdt },
        build: {
          commands: 'cdt-cpp -abigen per contract; eosio.system with -DSYSTEM_CONFIGURABLE_WASM_LIMITS -DSYSTEM_BLOCKCHAIN_PARAMETERS',
          ricardian: 'contracts.md.in files filled from contracts/CMakeLists.txt'
        },
        contracts: CONTRACTS.map((name) => ({
          name,
          files: files
            .filter((f) => f.contract === name)
            .map((f) => ({ file: f.name, bytes: f.bytes, sha256: f.sha256 }))
        }))
      }
      writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n')
      for (const f of files) console.log(`${f.name} ${f.bytes} ${f.sha256}`)
      console.log('Wrote resources/local-chain/contracts and contracts.json')
    }
  } finally {
    if (work) await wsl(['-d', distro, '--exec', 'rm', '-rf', work])
    rmSync(temp, { recursive: true, force: true })
    console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)} s`)
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
