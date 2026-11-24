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

import { CONFIRM_CSP, CSP, TERMINAL_CSP } from '../../src/main/security'

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
    expect(metaPolicy('confirm.html')).toBe(CONFIRM_CSP)
  })
  it('terminal.html meta tag equals the header policy without frame-ancestors (header only)', () => {
    expect(`${metaPolicy('terminal.html')}; frame-ancestors app://bundle`).toBe(TERMINAL_CSP)
  })
  for (const [name, policy] of [
    ['editor', CSP],
    ['confirmation', CONFIRM_CSP],
    ['terminal', TERMINAL_CSP]
  ] as const) {
    it(`${name} policy is strict`, () => {
      expect(policy).toContain("connect-src 'none'")
      expect(policy).toContain("font-src 'self';")
      expect(policy).toContain("script-src 'self';")
      expect(policy).not.toContain('localhost')
      expect(policy).not.toMatch(/font-src[^;]*data:/)
      expect(policy).not.toContain('unsafe-eval')
    })
  }
  it('only the editor page may embed a frame, and only app://terminal', () => {
    expect(CSP).toContain('frame-src app://terminal;')
    expect(CONFIRM_CSP).toContain("frame-src 'none';")
    expect(TERMINAL_CSP).toContain("frame-src 'none';")
  })
  it('the terminal page may be embedded only by the editor page', () => {
    expect(TERMINAL_CSP).toMatch(/frame-ancestors app:\/\/bundle$/)
    expect(CSP).not.toContain('frame-ancestors')
  })
})
