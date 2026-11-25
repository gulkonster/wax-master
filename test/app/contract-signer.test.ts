// Contract page: who signs in a new tab, and switching to Raw JSON is not an edit.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultContractSigner, lastContractSigner, rememberContractSigner } from '../../src/renderer/src/lib/contract-signer'

const src = (rel: string): string => readFileSync(join(__dirname, '../../src/renderer/src', rel), 'utf8')

describe('default signer of a new Contract page tab', () => {
  const stars = ['mycontract11', 'alice']
  const last = [{ actor: 'bob', permission: 'owner' }]

  it('keeps the opened account when it is starred on this network', () => {
    expect(defaultContractSigner('mycontract11', stars, last, 'alice')).toEqual([{ actor: 'mycontract11', permission: 'active' }])
  })
  it('then the signer last used on the Contract page', () => {
    expect(defaultContractSigner('atomicassets', stars, last, 'alice')).toEqual([{ actor: 'bob', permission: 'owner' }])
  })
  it('then the top bar account with active', () => {
    expect(defaultContractSigner('atomicassets', stars, undefined, 'alice')).toEqual([{ actor: 'alice', permission: 'active' }])
    expect(defaultContractSigner('atomicassets', stars, [], 'alice')).toEqual([{ actor: 'alice', permission: 'active' }])
  })
  it('then the first starred account of this network with active (after a restart: no last signer, no top bar account)', () => {
    expect(defaultContractSigner('atomicassets', stars, undefined, null)).toEqual([{ actor: 'mycontract11', permission: 'active' }])
    expect(defaultContractSigner('atomicassets', ['alice'], [], '')).toEqual([{ actor: 'alice', permission: 'active' }])
  })
  it('else the opened account', () => {
    expect(defaultContractSigner('atomicassets', [], undefined, null)).toEqual([{ actor: 'atomicassets', permission: 'active' }])
    expect(defaultContractSigner('atomicassets', [], undefined, '')).toEqual([{ actor: 'atomicassets', permission: 'active' }])
  })
  it('remembers the last signer per network, for the session only', () => {
    expect(lastContractSigner('net-a')).toBeUndefined()
    rememberContractSigner('net-a', [{ actor: 'alice', permission: 'active' }, { actor: 'bob', permission: 'active' }])
    rememberContractSigner('net-b', [{ actor: 'carol', permission: 'active' }])
    expect(lastContractSigner('net-a')).toEqual([{ actor: 'alice', permission: 'active' }, { actor: 'bob', permission: 'active' }])
    expect(lastContractSigner('net-b')).toEqual([{ actor: 'carol', permission: 'active' }])
    // An empty list does not replace the last signer.
    rememberContractSigner('net-b', [])
    expect(lastContractSigner('net-b')).toEqual([{ actor: 'carol', permission: 'active' }])
    // The returned list is a copy.
    lastContractSigner('net-b')![0].actor = 'mallory'
    expect(lastContractSigner('net-b')).toEqual([{ actor: 'carol', permission: 'active' }])
  })
  it('the Contract page form starts with this signer and records it on Run and Simulate', () => {
    const form = src('components/ActionForm.tsx')
    expect(form).toContain('defaultContractSigner(account, networkStore.get().stars, lastContractSigner(network.id), lastOpened.get().account)')
    const tx = form.slice(form.indexOf('const txActions = '), form.indexOf('const run = async'))
    expect(tx).toContain('rememberContractSigner(network.id, auth.levels)')
  })
})

describe('Raw JSON switch', () => {
  it('does not mark the form as edited', () => {
    const form = src('components/ActionForm.tsx')
    const start = form.indexOf('const toggleRaw = ')
    const body = form.slice(start, form.indexOf('const copy = async', start))
    expect(start).toBeGreaterThan(0)
    expect(body).not.toContain('setTouched')
    // The text written for the fields stays what the form holds (an empty number is not turned into 0).
    expect(body).toContain('setRawText(JSON.stringify(cur, null, 2))')
  })
})
