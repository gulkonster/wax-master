// The README pictures: every path names a file of the picture rule, every
// picture has a dark source and a light image, the alt text equals the caption
// line under it and the caption of the same name in a help page, and the last
// line stays as it is.

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const readme = readFileSync(join(root, 'README.md'), 'utf8').replace(/\r\n/g, '\n')
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/

const blocks = [
  ...readme.matchAll(
    /<picture>\n\s*<source media="\(prefers-color-scheme: dark\)" srcset="docs\/help\/img\/([^"]+)-dark\.png">\n\s*<img src="docs\/help\/img\/([^"]+)-light\.png" alt="([^"]*)">\n<\/picture>\n\n([^\n]*)\n/g
  )
].map((m) => ({ dark: m[1], light: m[2], alt: m[3], line: m[4] }))

function helpCaptions(): Map<string, string> {
  const dir = join(root, 'docs', 'help')
  const out = new Map<string, string>()
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const text = readFileSync(join(dir, f), 'utf8')
    for (const m of text.matchAll(/^!\[([^\]]*)\]\(img:([a-z0-9-]+)\)$/gm)) out.set(m[2], m[1])
  }
  return out
}

describe('README pictures', () => {
  it('holds the nine pictures', () => {
    expect(blocks.map((b) => b.dark)).toEqual([
      'window',
      'editor-completion',
      'local-chain',
      'deploy',
      'contract-actions',
      'confirm',
      'transaction-view',
      'account-page',
      'setup'
    ])
  })

  it('every docs/help/img path follows the name rule and names an existing file', () => {
    const paths = [...readme.matchAll(/docs\/help\/img\/([^"\s)]+)/g)].map((m) => m[1])
    expect(paths.length).toBe(blocks.length * 2)
    for (const p of paths) {
      const m = /^(.+)-(dark|light)\.png$/.exec(p)
      expect(m, p).not.toBeNull()
      expect(m![1].length).toBeLessThanOrEqual(40)
      expect(NAME.test(m![1]), p).toBe(true)
      expect(existsSync(join(root, 'docs', 'help', 'img', p)), p).toBe(true)
    }
  })

  it('every picture has a dark source and a light image of the same name', () => {
    expect(readme.match(/<picture>/g)?.length).toBe(blocks.length)
    for (const b of blocks) expect(b.dark).toBe(b.light)
  })

  it('the alt text equals the caption line and the caption of the help page', () => {
    const help = helpCaptions()
    for (const b of blocks) {
      expect(b.alt).toBe(b.line)
      expect(help.get(b.dark), b.dark).toBe(b.alt)
    }
  })

  it('ends with its last line as it is', () => {
    const lines = readme.trimEnd().split('\n')
    // The last line of the README is unchanged.
    expect(createHash('sha256').update(lines[lines.length - 1]).digest('hex')).toBe(
      'b3a0fe0041a11ae9182863cc70d828ea9d8686331197d796dadd114cfaddfae1'
    )
  })
})
