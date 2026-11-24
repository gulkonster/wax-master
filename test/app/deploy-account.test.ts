import { describe, expect, it } from 'vitest'
import { lastDeployPick, preselectAccount, rememberDeployPick } from '../../src/renderer/src/lib/deploy-account'

describe('Deploy dialog preselection', () => {
  const stars = ['alice', 'bob', 'carol']
  it('takes the saved deploy account first, then the top-bar account, then the last pick', () => {
    expect(preselectAccount('alice', 'bob', 'carol', stars)).toBe('alice')
    expect(preselectAccount(undefined, 'bob', 'carol', stars)).toBe('bob')
    expect(preselectAccount(undefined, null, 'carol', stars)).toBe('carol')
  })
  it('never picks an account that is not starred', () => {
    expect(preselectAccount('dave', 'erin', 'frank', stars)).toBe('')
    expect(preselectAccount('dave', 'bob', undefined, stars)).toBe('bob')
    expect(preselectAccount('dave', 'erin', 'carol', stars)).toBe('carol')
    expect(preselectAccount('alice', 'bob', 'carol', [])).toBe('')
  })
  it('remembers the last pick per project and network', () => {
    rememberDeployPick('C:/p1', 'testnet', 'alice')
    rememberDeployPick('C:/p2', 'testnet', 'bob')
    expect(lastDeployPick('C:/p1', 'testnet')).toBe('alice')
    expect(lastDeployPick('C:/p2', 'testnet')).toBe('bob')
    expect(lastDeployPick('C:/p1', 'mainnet')).toBeUndefined()
  })
})
