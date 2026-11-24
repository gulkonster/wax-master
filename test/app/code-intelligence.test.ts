import { describe, expect, it } from 'vitest'
import { MessageReader, frameMessage } from '../../src/shared/lsp-framing'
import {
  clientToServerUri,
  isToolchainPath,
  messageToClient,
  messageToServer,
  serverToClientUri,
  toolchainUriToPath,
  type PathMap
} from '../../src/shared/lsp-paths'
import { filterDiagnostics, keepDiagnostic, type LspDiagnostic } from '../../src/shared/lsp-diagnostics'
import { applyTextEdits } from '../../src/shared/lsp-text'
import { compileCommands, compileFlags } from '../../src/main/compile-commands'
import { searchPattern, searchText } from '../../src/main/search'

const enc = new TextEncoder()

function collect(): { reader: MessageReader; out: string[]; errors: string[] } {
  const out: string[] = []
  const errors: string[] = []
  return { reader: new MessageReader((t) => out.push(t), (e) => errors.push(e), 1024), out, errors }
}

describe('message framing', () => {
  it('frames with the UTF-8 byte length', () => {
    const f = frameMessage('{"a":"é"}')
    const text = new TextDecoder().decode(f)
    expect(text).toBe('Content-Length: 10\r\n\r\n{"a":"é"}')
  })
  it('reads several messages from one chunk', () => {
    const { reader, out } = collect()
    const a = frameMessage('{"id":1}')
    const b = frameMessage('{"id":2}')
    const both = new Uint8Array(a.length + b.length)
    both.set(a)
    both.set(b, a.length)
    reader.push(both)
    expect(out).toEqual(['{"id":1}', '{"id":2}'])
  })
  it('reads a message split byte by byte, including a multi-byte character', () => {
    const { reader, out } = collect()
    const f = frameMessage('{"t":"ğüş"}')
    for (const byte of f) reader.push(Uint8Array.of(byte))
    expect(out).toEqual(['{"t":"ğüş"}'])
  })
  it('accepts extra headers and any header case', () => {
    const { reader, out } = collect()
    reader.push(enc.encode('content-type: application/vscode-jsonrpc\r\nCONTENT-LENGTH: 2\r\n\r\n{}'))
    expect(out).toEqual(['{}'])
  })
  it('drops a message above the size limit and recovers', () => {
    const { reader, out, errors } = collect()
    reader.push(enc.encode('Content-Length: 5000\r\n\r\n'))
    expect(errors).toEqual(['message too large'])
    reader.push(frameMessage('{"ok":true}'))
    expect(out).toEqual(['{"ok":true}'])
  })
  it('skips a header without a length', () => {
    const { reader, out, errors } = collect()
    reader.push(enc.encode('X-Foo: 1\r\n\r\n'))
    reader.push(frameMessage('{}'))
    expect(errors).toEqual(['missing Content-Length'])
    expect(out).toEqual(['{}'])
  })
})

const map: PathMap = { rootWsl: '/mnt/c/Users/me/My Proj', toolchainRoots: ['/usr/opt/cdt/4.1.1wax01/include'] }

describe('document addresses', () => {
  it('maps project files both ways', () => {
    const server = 'file:///mnt/c/Users/me/My%20Proj/src/hello.cpp'
    expect(serverToClientUri(server, map)).toBe('project:///src/hello.cpp')
    expect(clientToServerUri('project:///src/hello.cpp', map)).toBe(server)
    expect(clientToServerUri('project:///', map)).toBe('file:///mnt/c/Users/me/My%20Proj')
  })
  it('accepts the editor\'s short form without an authority', () => {
    expect(clientToServerUri('project:/src/hello.cpp', map)).toBe('file:///mnt/c/Users/me/My%20Proj/src/hello.cpp')
    expect(clientToServerUri('toolchain:/usr/opt/cdt/4.1.1wax01/include/libcxx/vector', map)).toBe(
      'file:///usr/opt/cdt/4.1.1wax01/include/libcxx/vector'
    )
    expect(() => clientToServerUri('project:src/a.cpp', map)).toThrow()
  })
  it('matches the project folder without regard to case (Windows drive)', () => {
    expect(serverToClientUri('file:///mnt/c/users/ME/my%20proj/include/a.hpp', map)).toBe('project:///include/a.hpp')
  })
  it('maps toolchain headers to read-only addresses and back', () => {
    const server = 'file:///usr/opt/cdt/4.1.1wax01/include/eosiolib/core/eosio/check.hpp'
    const client = serverToClientUri(server, map)
    expect(client).toBe('toolchain:///usr/opt/cdt/4.1.1wax01/include/eosiolib/core/eosio/check.hpp')
    expect(clientToServerUri(client, map)).toBe(server)
    expect(toolchainUriToPath(client, map.toolchainRoots)).toBe('/usr/opt/cdt/4.1.1wax01/include/eosiolib/core/eosio/check.hpp')
  })
  it('marks anything else as outside', () => {
    expect(serverToClientUri('file:///usr/include/stdio.h', map)).toBe('outside:///usr/include/stdio.h')
    expect(serverToClientUri('file:///mnt/c/Users/me/My%20Projx/a.cpp', map)).toBe('outside:///mnt/c/Users/me/My%20Projx/a.cpp')
  })
  it('refuses window addresses outside the project and the headers', () => {
    expect(() => clientToServerUri('file:///etc/passwd', map)).toThrow()
    expect(() => clientToServerUri('project:///../secret.txt', map)).toThrow()
    expect(() => clientToServerUri('project:///src/%2E%2E/%2E%2E/x', map)).toThrow()
    expect(() => clientToServerUri('project:///C:/Windows/x', map)).toThrow()
    expect(() => clientToServerUri('toolchain:///etc/passwd', map)).toThrow()
    expect(() => clientToServerUri('toolchain:///usr/opt/cdt/4.1.1wax01/include/../../../../etc/passwd', map)).toThrow()
    expect(() => clientToServerUri('toolchain:///usr/opt/cdt/4.1.1wax01/include%2F..%2F..%2Fx', map)).toThrow()
    expect(() => clientToServerUri('outside:///usr/include/stdio.h', map)).toThrow()
  })
  it('checks toolchain paths strictly', () => {
    expect(isToolchainPath('/usr/opt/cdt/4.1.1wax01/include/libcxx/vector', map.toolchainRoots)).toBe(true)
    expect(isToolchainPath('/usr/opt/cdt/4.1.1wax01/includeX/a', map.toolchainRoots)).toBe(false)
    expect(isToolchainPath('/usr/opt/cdt/4.1.1wax01/include/./a', map.toolchainRoots)).toBe(false)
    expect(isToolchainPath('/usr/opt/cdt/4.1.1wax01/include//a', map.toolchainRoots)).toBe(false)
  })
  it('rewrites addresses in messages, not document text', () => {
    const msg = {
      jsonrpc: '2.0',
      method: 'textDocument/didOpen',
      params: { rootPath: 'C:\\x', textDocument: { uri: 'project:///src/a.cpp', text: 'uri project:///src/b.cpp' } }
    }
    messageToServer(msg, map)
    expect(msg.params.textDocument.uri).toBe('file:///mnt/c/Users/me/My%20Proj/src/a.cpp')
    expect(msg.params.textDocument.text).toBe('uri project:///src/b.cpp')
    expect('rootPath' in msg.params).toBe(false)
  })
  it('refuses a whole message that names a foreign file', () => {
    const msg = { jsonrpc: '2.0', id: 1, method: 'textDocument/hover', params: { textDocument: { uri: 'file:///etc/shadow' } } }
    expect(() => messageToServer(msg, map)).toThrow()
  })
  it('rewrites workspace edit keys, location links and bare results', () => {
    const edit = {
      jsonrpc: '2.0',
      id: 3,
      result: {
        changes: { 'file:///mnt/c/Users/me/My%20Proj/src/a.cpp': [{ range: {}, newText: 'x' }] },
        documentChanges: [{ textDocument: { uri: 'file:///mnt/c/Users/me/My%20Proj/include/a.hpp', version: 1 }, edits: [] }]
      }
    }
    messageToClient(edit as Record<string, unknown>, map)
    expect(Object.keys(edit.result.changes)).toEqual(['project:///src/a.cpp'])
    expect(edit.result.documentChanges[0].textDocument.uri).toBe('project:///include/a.hpp')
    const links = { jsonrpc: '2.0', id: 4, result: [{ targetUri: 'file:///usr/opt/cdt/4.1.1wax01/include/eosiolib/core/eosio/name.hpp' }] }
    messageToClient(links as Record<string, unknown>, map)
    expect(links.result[0].targetUri).toBe('toolchain:///usr/opt/cdt/4.1.1wax01/include/eosiolib/core/eosio/name.hpp')
    const sw = { jsonrpc: '2.0', id: 5, result: 'file:///mnt/c/Users/me/My%20Proj/include/a.hpp' } as Record<string, unknown>
    messageToClient(sw, map)
    expect(sw.result).toBe('project:///include/a.hpp')
  })
})

describe('compile commands', () => {
  const C = '/usr/opt/cdt/4.1.1wax01'
  it('lists one entry per file with the CDT flags', () => {
    const cmds = compileCommands({
      rootWsl: '/mnt/c/p',
      files: ['src/a.cpp', 'src/b.cpp', 'src/a.cpp'],
      include: 'include',
      cdtRoot: C,
      cdtVersion: '4.1.1wax01'
    })
    expect(cmds.map((c) => c.file)).toEqual(['/mnt/c/p/src/a.cpp', '/mnt/c/p/src/b.cpp'])
    const a = cmds[0]
    expect(a.directory).toBe('/mnt/c/p')
    expect(a.arguments[0]).toBe('clang++')
    expect(a.arguments.slice(-2)).toEqual(['-c', '/mnt/c/p/src/a.cpp'])
    for (const f of [
      '--target=x86_64-unknown-linux-gnux32',
      '-nostdinc',
      '-D__wasm32__',
      '-std=gnu++2a',
      '-fno-exceptions',
      '-fno-rtti',
      '-Wno-unknown-attributes',
      '-D__eosio_cdt__',
      '-D__eosio_cdt_major__=4',
      '-D__eosio_cdt_minor__=1',
      '-D__eosio_cdt_patchlevel__=1wax01',
      '-U__x86_64__',
      '-U__APPLE__',
      '-I/mnt/c/p/include'
    ]) {
      expect(a.arguments).toContain(f)
    }
    const sys = a.arguments.flatMap((x, i) => (a.arguments[i - 1] === '-isystem' ? [x] : []))
    expect(sys).toEqual([`${C}/include/libcxx`, `${C}/include/libc`, `${C}/include`, `${C}/include/eosiolib/core`, `${C}/include/eosiolib/contracts`])
  })
  it('has the i386 setup as the fallback', () => {
    const f = compileFlags('i386', C, '4.1.1wax01', ['/mnt/c/p/include'])
    expect(f[0]).toBe('--target=i386-unknown-none-elf')
    expect(f).not.toContain('-U__x86_64__')
  })
  it('uses the configured include folder', () => {
    const [c] = compileCommands({ rootWsl: '/mnt/d/x/', files: ['main.cpp'], include: './headers/', cdtRoot: C, cdtVersion: '4.1.1wax01' })
    expect(c.arguments).toContain('-I/mnt/d/x/headers')
    expect(c.file).toBe('/mnt/d/x/main.cpp')
  })
})

describe('diagnostic filtering', () => {
  const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }
  const header = 'toolchain:///usr/opt/cdt/4.1.1wax01/include/eosiolib/core/eosio/binary_extension.hpp'
  const fromHeader = (code: string): LspDiagnostic => ({
    range,
    code,
    message: 'In included file: cannot assign to non-static data member within const member function',
    relatedInformation: [{ location: { uri: header, range }, message: 'Error occurred here' }]
  })
  const own = (code: string): LspDiagnostic => ({ range, code, message: 'cannot assign' })

  it('drops header-only codes when they come from a toolchain header', () => {
    expect(keepDiagnostic(fromHeader('typecheck_assign_const'), 'project:///src/a.cpp', 'x32')).toBe(false)
    expect(keepDiagnostic(fromHeader('static_assert_requirement_failed'), 'project:///src/a.cpp', 'x32')).toBe(false)
    expect(keepDiagnostic(own('typecheck_assign_const'), header, 'x32')).toBe(false)
  })
  it('keeps the same codes in the user\'s own files', () => {
    expect(keepDiagnostic(own('typecheck_assign_const'), 'project:///src/a.cpp', 'x32')).toBe(true)
    expect(keepDiagnostic(own('static_assert_requirement_failed'), 'project:///src/a.cpp', 'x32')).toBe(true)
    const projectHeader = { ...fromHeader('typecheck_assign_const') }
    projectHeader.relatedInformation = [{ location: { uri: 'project:///include/a.hpp', range }, message: 'Error occurred here' }]
    expect(keepDiagnostic(projectHeader, 'project:///src/a.cpp', 'x32')).toBe(true)
  })
  it('drops type_unsupported everywhere only with the i386 setup', () => {
    expect(keepDiagnostic(own('type_unsupported'), 'project:///src/a.cpp', 'i386')).toBe(false)
    expect(keepDiagnostic(own('type_unsupported'), 'project:///src/a.cpp', 'x32')).toBe(true)
  })
  it('keeps ordinary errors', () => {
    const list = [own('undeclared_var_use'), fromHeader('typecheck_assign_const'), fromHeader('ovl_no_viable_function_in_call')]
    expect(filterDiagnostics(list, 'project:///src/a.cpp', 'x32').map((d) => d.code)).toEqual(['undeclared_var_use', 'ovl_no_viable_function_in_call'])
  })
})

describe('text edits on files that are not open', () => {
  const r = (l1: number, c1: number, l2: number, c2: number): { start: { line: number; character: number }; end: { line: number; character: number } } => ({
    start: { line: l1, character: c1 },
    end: { line: l2, character: c2 }
  })
  it('applies several edits against the original text', () => {
    const text = 'void foo();\nint x = foo();\nfoo();\n'
    const out = applyTextEdits(text, [
      { range: r(0, 5, 0, 8), newText: 'bar_baz' },
      { range: r(1, 8, 1, 11), newText: 'bar_baz' },
      { range: r(2, 0, 2, 3), newText: 'bar_baz' }
    ])
    expect(out).toBe('void bar_baz();\nint x = bar_baz();\nbar_baz();\n')
  })
  it('keeps Windows line endings', () => {
    expect(applyTextEdits('a\r\nfoo\r\n', [{ range: r(1, 0, 1, 99), newText: 'x' }])).toBe('a\r\nx\r\n')
  })
  it('inserts and deletes across lines', () => {
    expect(applyTextEdits('ab\ncd', [{ range: r(0, 1, 1, 1), newText: '' }, { range: r(0, 0, 0, 0), newText: '>' }])).toBe('>ad')
  })
})

describe('find in files', () => {
  it('finds plain text, case and whole word', () => {
    const text = 'check(x);\nCHECK\nrecheck check\n'
    expect(searchText('a.cpp', text, searchPattern('check', false, false), 100).map((m) => [m.line, m.column])).toEqual([
      [1, 1],
      [2, 1],
      [3, 3],
      [3, 9]
    ])
    expect(searchText('a.cpp', text, searchPattern('check', true, true), 100).map((m) => [m.line, m.column])).toEqual([
      [1, 1],
      [3, 9]
    ])
  })
  it('treats the query as text, not a pattern', () => {
    expect(searchText('a', 'a.b axb (x)', searchPattern('a.b', true, false), 10)).toHaveLength(1)
    expect(searchText('a', 'f(x) (x)', searchPattern('(x)', true, false), 10)).toHaveLength(2)
  })
})
