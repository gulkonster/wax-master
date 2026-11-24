#!/usr/bin/env node
// Downloads every part listed in toolchain/parts.json into toolchain-parts/.
// Files that are already present with the right size and SHA-256 are skipped.
// Any mismatch is fatal. No dependencies; needs Node 18+.
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'
import https from 'node:https'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = join(root, 'toolchain', 'parts.json')
const outDir = join(root, 'toolchain-parts')
const MAX_REDIRECTS = 10

function sha256File(path) {
  return new Promise((res, rej) => {
    const h = createHash('sha256')
    createReadStream(path).on('data', (d) => h.update(d)).on('error', rej).on('end', () => res(h.digest('hex')))
  })
}

function download(url, dest, redirects = 0) {
  return new Promise((res, rej) => {
    if (redirects > MAX_REDIRECTS) return rej(new Error('too many redirects: ' + url))
    const mod = url.startsWith('https:') ? https : http
    const req = mod.get(url, { headers: { 'User-Agent': 'wax-master-fetch' } }, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        r.resume()
        return res(download(new URL(r.headers.location, url).toString(), dest, redirects + 1))
      }
      if (r.statusCode !== 200) {
        r.resume()
        return rej(new Error('HTTP ' + r.statusCode + ' for ' + url))
      }
      const out = createWriteStream(dest)
      r.pipe(out)
      out.on('finish', () => out.close(res))
      out.on('error', rej)
      r.on('error', rej)
    })
    req.on('error', rej)
    req.setTimeout(60000, () => req.destroy(new Error('timeout: ' + url)))
  })
}

async function verify(path, part) {
  const size = statSync(path).size
  if (size !== part.size) return `size ${size} != expected ${part.size}`
  const sum = await sha256File(path)
  if (sum !== part.sha256) return `sha256 ${sum} != expected ${part.sha256}`
  return null
}

async function main() {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  mkdirSync(outDir, { recursive: true })
  let failed = 0
  for (const part of manifest.parts) {
    const dest = join(outDir, part.file)
    if (existsSync(dest) && (await verify(dest, part)) === null) {
      console.log(`ok       ${part.id} (present)`)
      continue
    }
    const tmp = dest + '.part'
    try {
      console.log(`fetch    ${part.id} <- ${part.url}`)
      await download(part.url, tmp)
      const err = await verify(tmp, part)
      if (err) throw new Error(err)
      renameSync(tmp, dest)
      console.log(`ok       ${part.id}`)
    } catch (e) {
      rmSync(tmp, { force: true })
      failed++
      console.error(`FAILED   ${part.id}: ${e.message}`)
    }
  }
  if (failed) {
    console.error(`${failed} part(s) failed`)
    process.exit(1)
  }
  console.log(`all ${manifest.parts.length} parts verified in ${outDir}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
