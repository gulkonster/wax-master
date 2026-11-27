import { describe, expect, it } from 'vitest'
import { menuPosition, onShellExit, pasteText, shellEndedMessage } from '../../src/renderer/src/terminal/terminal-actions'

// The terminal page's paste path, what a tab does when its shell ends, and
// where the right-click menu is drawn.

function target(): { pasted: string[]; paste(t: string): void } {
  const pasted: string[] = []
  return { pasted, paste: (t) => void pasted.push(t) }
}

describe('the terminal paste path', () => {
  it('pastes text of several lines at once, without a question', () => {
    // No window here: a question (window.confirm) would throw.
    const t = target()
    pasteText(t, 'echo one\r\necho two\necho three\r')
    expect(t.pasted).toEqual(['echo one\r\necho two\necho three\r'])
  })
  it('pastes one line as it is and ignores an empty clipboard', () => {
    const t = target()
    pasteText(t, 'dir')
    pasteText(t, '')
    expect(t.pasted).toEqual(['dir'])
  })
})

describe('a shell that ends', () => {
  it('a shell that ends on its own closes the tab as its close button would, with any exit code', () => {
    expect(onShellExit(0, '')).toBe('close')
    expect(onShellExit(1, '')).toBe('close')
    expect(onShellExit(-1073741510, '')).toBe('close')
  })
  it('only a start failure or the helper ending keeps the tab with a message', () => {
    expect(onShellExit(-1, 'File not found')).toBe('keep')
    expect(onShellExit(-1, 'Helper process ended')).toBe('keep')
    expect(onShellExit(0, 'Helper process ended')).toBe('keep')
  })
  it('the message says it ended, why, that typing does nothing, and how to open a new terminal', () => {
    const m = shellEndedMessage(1, '')
    expect(m).toContain('The shell ended (exit code 1)')
    expect(m).toContain('Typing here does nothing')
    expect(m).toContain('open a new terminal with +')
    expect(shellEndedMessage(-1, 'Helper process ended')).toContain('(exit code -1: Helper process ended)')
  })
})

describe('right-click menu position', () => {
  it('opens at the pointer when it fits', () => {
    expect(menuPosition(10, 20, 150, 70, 800, 200)).toEqual({ left: 10, top: 20 })
  })
  it('opens above the pointer near the bottom and to its left near the right edge', () => {
    expect(menuPosition(780, 180, 150, 70, 800, 200)).toEqual({ left: 630, top: 110 })
  })
  it('stays inside a view smaller than the menu', () => {
    expect(menuPosition(30, 30, 150, 70, 100, 50)).toEqual({ left: 0, top: 0 })
  })
})
