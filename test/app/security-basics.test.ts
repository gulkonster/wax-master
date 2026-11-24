import { describe, expect, it } from 'vitest'
import { redact } from '../../src/main/log'
import { relPath, chainName } from '../../src/shared/validate'
import { defaultBuildCommand, defaultConfig, normalizeConfig } from '../../src/shared/project'

describe('log redaction', () => {
  it('removes private keys in every text form', () => {
    const wif = '5KQwrPbwdL6PhXujxW37FSSQZ1JiwsST4cqQzDeyXtP79zkvFD3'
    const out = redact(`key ${wif} and PVT_K1_2bfGi9rYsXQSXXTvJbDAPhHLQUojjaNLomdm3cEJ1XTzMqUt3V`)
    expect(out).not.toContain(wif)
    expect(out).not.toContain('PVT_K1_2bfGi9')
  })
  it('removes password fields', () => {
    expect(redact('{"password":"correct horse battery"}')).not.toContain('correct horse')
  })
  it('keeps public keys', () => {
    const pub = 'EOS6MRyAjQq8ud7hVNYcfnVPJqcVpscN5So8BhtHuGYqET5GDW5CV'
    expect(redact(pub)).toBe(pub)
  })
})

describe('IPC validators', () => {
  it('accepts relative paths and normalizes slashes', () => {
    expect(relPath('src\\a.cpp', 'p')).toBe('src/a.cpp')
  })
  it('refuses paths leaving the project', () => {
    expect(() => relPath('../x', 'p')).toThrow()
    expect(() => relPath('src/../../x', 'p')).toThrow()
    expect(() => relPath('C:/Windows/win.ini', 'p')).toThrow()
    expect(() => relPath('/etc/passwd', 'p')).toThrow()
  })
  it('checks account names', () => {
    expect(chainName('eosio.token', 'n')).toBe('eosio.token')
    expect(() => chainName('Bad', 'n')).toThrow()
  })
})

describe('project defaults', () => {
  it('match the EOS Studio default command', () => {
    expect(defaultBuildCommand(defaultConfig('hello'))).toBe(
      'cdt-cpp -abigen -I ./include -R ./resource -contract hello -o hello.wasm src/hello.cpp'
    )
  })
  it('fill missing fields', () => {
    const c = normalizeConfig({ main: 'src\\x.cpp' }, 'x')
    expect(c.main).toBe('src/x.cpp')
    expect(c.deploy.target).toBe('both')
  })
})
