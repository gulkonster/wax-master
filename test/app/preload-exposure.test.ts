import { describe, expect, it } from 'vitest'
import { devUrlFromArgv, interfaceFor } from '../../src/shared/preload-exposure'

const DEV = 'http://localhost:5173'

describe('preload exposure by exact origin', () => {
  it('gives the editor interface only to the top frame of app://bundle', () => {
    expect(interfaceFor({ isTopFrame: true, origin: 'app://bundle', pathname: '/index.html' })).toBe('editor')
    expect(interfaceFor({ isTopFrame: false, origin: 'app://bundle', pathname: '/index.html' })).toBeNull()
    expect(interfaceFor({ isTopFrame: true, origin: 'app://other', pathname: '/index.html' })).toBeNull()
    expect(interfaceFor({ isTopFrame: true, origin: 'https://example.com', pathname: '/' })).toBeNull()
    expect(interfaceFor({ isTopFrame: true, origin: 'http://localhost:5173', pathname: '/' })).toBeNull()
  })
  it('gives the terminal interface only to the terminal page of app://terminal in a sub frame', () => {
    expect(interfaceFor({ isTopFrame: false, origin: 'app://terminal', pathname: '/terminal.html' })).toBe('terminal')
    expect(interfaceFor({ isTopFrame: true, origin: 'app://terminal', pathname: '/terminal.html' })).toBeNull()
    expect(interfaceFor({ isTopFrame: false, origin: 'app://terminal', pathname: '/index.html' })).toBeNull()
    expect(interfaceFor({ isTopFrame: false, origin: 'http://localhost:5173', pathname: '/terminal.html' })).toBeNull()
    expect(interfaceFor({ isTopFrame: false, origin: 'http://127.0.0.1:5173', pathname: '/terminal.html' })).toBeNull()
  })
  it('accepts the exact development server origins only when one is given', () => {
    expect(interfaceFor({ isTopFrame: true, origin: 'http://localhost:5173', pathname: '/' }, DEV)).toBe('editor')
    expect(interfaceFor({ isTopFrame: true, origin: 'http://localhost:5174', pathname: '/' }, DEV)).toBeNull()
    expect(interfaceFor({ isTopFrame: true, origin: 'http://127.0.0.1:5173', pathname: '/' }, DEV)).toBeNull()
    expect(interfaceFor({ isTopFrame: false, origin: 'http://127.0.0.1:5173', pathname: '/terminal.html' }, DEV)).toBe('terminal')
    expect(interfaceFor({ isTopFrame: false, origin: 'http://localhost:5173', pathname: '/terminal.html' }, DEV)).toBeNull()
    expect(interfaceFor({ isTopFrame: false, origin: 'http://127.0.0.1:9999', pathname: '/terminal.html' }, DEV)).toBeNull()
  })
  it('keeps the terminal and confirmation pages out of the editor interface', () => {
    expect(interfaceFor({ isTopFrame: true, origin: 'app://bundle', pathname: '/terminal.html' })).toBeNull()
    expect(interfaceFor({ isTopFrame: true, origin: 'app://bundle', pathname: '/confirm.html' })).toBeNull()
  })
  it('reads the development address from the arguments', () => {
    expect(devUrlFromArgv(['a', `--wax-dev-url=${DEV}`])).toBe(DEV)
    expect(devUrlFromArgv(['a'])).toBeUndefined()
  })
})
