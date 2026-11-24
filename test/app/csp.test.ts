import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

vi.mock('electron', () => ({
  app: { isPackaged: true, on: () => undefined },
  dialog: {},
  protocol: {},
  session: {},
  shell: {},
  net: {}
}))

import { CSP } from '../../src/main/security'

function metaPolicy(file: string): string {
  const html = readFileSync(join(__dirname, '../../src/renderer', file), 'utf8')
  const m = /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(html)
  if (!m) throw new Error(`no policy in ${file}`)
  return m[1]
}

describe('content security policy', () => {
  it('index.html meta tag equals the header policy', () => {
    expect(metaPolicy('index.html')).toBe(CSP)
  })
  it('confirm.html meta tag equals the header policy', () => {
    expect(metaPolicy('confirm.html')).toBe(CSP)
  })
  it('is strict', () => {
    expect(CSP).toContain("connect-src 'none'")
    expect(CSP).toContain("font-src 'self';")
    expect(CSP).not.toContain('localhost')
    expect(CSP).not.toMatch(/font-src[^;]*data:/)
    expect(CSP).not.toContain('unsafe-eval')
  })
})
