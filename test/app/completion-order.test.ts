import { describe, expect, it } from 'vitest'
import { sortTextFor } from '../../src/renderer/src/lib/lsp/sort'

describe('completion order', () => {
  const items = [
    { label: ' _bluegrass_meta_refl_a', sortText: '3f_bluegrass_meta_refl_a' },
    { label: ' get_name', sortText: '40get_name' },
    { label: ' _bluegrass_meta_refl_b', sortText: '30_bluegrass_meta_refl_b' },
    { label: ' value', sortText: '50value' },
    { label: '•_hidden', filterText: '_hidden', sortText: '10_hidden' }
  ]
  it('members starting with an underscore come after the others', () => {
    const sorted = [...items].sort((a, b) => (sortTextFor(a) as string).localeCompare(sortTextFor(b) as string))
    expect(sorted.map((i) => i.label.trim())).toEqual(['get_name', 'value', '•_hidden', '_bluegrass_meta_refl_b', '_bluegrass_meta_refl_a'])
  })
  it('leaves other items alone', () => {
    expect(sortTextFor({ label: 'foo', sortText: '40foo' })).toBe('40foo')
    expect(sortTextFor({ label: 'foo' })).toBeUndefined()
  })
})
