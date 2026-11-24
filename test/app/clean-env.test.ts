import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cleanEnvironment, isRemovedVariable } from '../../src/main/clean-env'

describe('terminal environment', () => {
  it('drops variables added by Electron, Node, npm and the app', () => {
    const env = cleanEnvironment({
      PATH: 'C:\\Windows',
      USERPROFILE: 'C:\\Users\\me',
      ELECTRON_RUN_AS_NODE: '1',
      NODE_OPTIONS: '--inspect',
      npm_config_cache: 'x',
      CHROME_CRASHPAD_PIPE_NAME: 'x',
      ORIGINAL_XDG_CURRENT_DESKTOP: 'x',
      WAXMASTER_SECRET: 'x'
    })
    expect(Object.keys(env).sort()).toEqual(['PATH', 'USERPROFILE'])
  })

  it('a real shell started with it sees none of the removed variables', () => {
    const source = { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--no-warnings', npm_lifecycle_event: 'test' }
    const env = cleanEnvironment(source)
    const cmd = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe')
    const r = spawnSync(cmd, ['/d', '/c', 'set'], { env, encoding: 'utf8', windowsHide: true })
    expect(r.status).toBe(0)
    const names = r.stdout
      .split(/\r?\n/)
      .map((l) => l.split('=')[0])
      .filter(Boolean)
    const leaked = names.filter((n) => isRemovedVariable(n))
    expect(leaked).toEqual([])
    expect(names.map((n) => n.toUpperCase())).toContain('PATH')
  })
})
