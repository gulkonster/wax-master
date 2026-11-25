// The permission picker marks as "(vault)" and picks by default what the vault can
// sign: the key lookup's list and what the account view says the vault controls.

import { describe, expect, it } from 'vitest'

// The component is a .tsx file; the test settings have no JSX, so it is loaded by path.
const PICKER = '../../src/renderer/src/components/AccountPicker'
const load = async (): Promise<{
  signableOf(fromList: readonly string[] | undefined, control: readonly string[]): string[]
  defaultPermission(signable: readonly string[], names: string[]): string
}> => (await import(/* @vite-ignore */ PICKER)) as never

describe('permission picker: what the vault can sign', () => {
  it('an account the key lookup does not know yet counts with the permissions the account view says the vault controls', async () => {
    const { signableOf, defaultPermission } = await load()
    // Created in this session, not starred: no entry in the pick list yet.
    expect(signableOf(undefined, ['active', 'owner'])).toEqual(['active', 'owner'])
    expect(defaultPermission(signableOf(undefined, ['active', 'owner']), ['owner', 'active'])).toBe('active')
    // Only a custom permission is controlled: it becomes the default.
    expect(defaultPermission(signableOf(undefined, ['deploy']), ['owner', 'active', 'deploy'])).toBe('deploy')
    // Both sources together, each permission once.
    expect(signableOf(['active'], ['active', 'deploy'])).toEqual(['active', 'deploy'])
    // Nothing known: view only, the default stays active.
    expect(signableOf(undefined, [])).toEqual([])
    expect(defaultPermission([], ['owner', 'active'])).toBe('active')
  })
})
