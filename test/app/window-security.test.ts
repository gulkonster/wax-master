import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: true, on: () => undefined },
  dialog: {},
  protocol: {},
  session: {},
  shell: {},
  net: {}
}))

import { secureWebPreferences } from '../../src/main/security'

describe('window creation options', () => {
  const prefs = secureWebPreferences('/preload.js')
  it('keeps isolation, sandbox and web security on', () => {
    expect(prefs.contextIsolation).toBe(true)
    expect(prefs.sandbox).toBe(true)
    expect(prefs.webSecurity).toBe(true)
    expect(prefs.allowRunningInsecureContent).toBe(false)
  })
  it('keeps node integration and webviews off', () => {
    expect(prefs.nodeIntegration).toBe(false)
    expect(prefs.nodeIntegrationInWorker).toBe(false)
    expect(prefs.nodeIntegrationInSubFrames).toBe(false)
    expect(prefs.webviewTag).toBe(false)
  })
  it('turns developer tools off in a packaged build', () => {
    expect(prefs.devTools).toBe(false)
    expect(prefs.preload).toBe('/preload.js')
  })
})
