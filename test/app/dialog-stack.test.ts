import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isTopLayer, popLayer, pushLayer, takeEscape } from '../../src/renderer/src/lib/dialog-stack'

describe('dialog stack', () => {
  it('a dialog opened from the help window goes over the dialog the help was opened from', () => {
    const create = pushLayer() // Create Account
    const help = pushLayer() // its help window
    // An app: button of the topic: the help closes and Manage Keypairs opens in the same update
    // (React removes the help before the new dialog takes its layer).
    popLayer(help)
    const keys = pushLayer()
    expect(keys).toBeGreaterThan(create)
    expect(isTopLayer(keys)).toBe(true)
    expect(isTopLayer(create)).toBe(false)

    // Escape closes the upper one only, once per press, whatever the order of the listeners.
    const press = new Event('keydown')
    expect(takeEscape(press, create)).toBe(false)
    expect(takeEscape(press, keys)).toBe(true)
    popLayer(keys)
    expect(takeEscape(press, create)).toBe(false)
    // The next press closes the dialog below.
    expect(takeEscape(new Event('keydown'), create)).toBe(true)
    popLayer(create)
    const next = pushLayer()
    expect(next).toBe(1)
    popLayer(next)
  })

  it('every dialog takes a layer and Escape through the stack', () => {
    const src = readFileSync(join(__dirname, '../../src/renderer/src/components/Modal.tsx'), 'utf8')
    expect(src).toContain('const l = pushLayer()')
    expect(src).toContain('return () => popLayer(l)')
    expect(src).toContain('if (!takeEscape(e, layerRef.current)) return')
    expect(src).toContain('zIndex: DIALOG_Z + layer')
    const css = readFileSync(join(__dirname, '../../src/renderer/src/styles.css'), 'utf8')
    expect(css).toMatch(/\.modal-backdrop \{[^}]*z-index: 100;/)
  })
})
