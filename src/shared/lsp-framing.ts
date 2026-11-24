// Language server message framing: "Content-Length: N\r\n\r\n" followed by N
// bytes of UTF-8 JSON. Used by the helper process on the editor engine's pipes.

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8')

/** Frames one JSON text for writing to the server's standard input. */
export function frameMessage(json: string): Uint8Array {
  const body = encoder.encode(json)
  const head = encoder.encode(`Content-Length: ${body.length}\r\n\r\n`)
  const out = new Uint8Array(head.length + body.length)
  out.set(head, 0)
  out.set(body, head.length)
  return out
}

function indexOfHeaderEnd(buf: Uint8Array, len: number): number {
  for (let i = 0; i + 3 < len; i++) {
    if (buf[i] === 13 && buf[i + 1] === 10 && buf[i + 2] === 13 && buf[i + 3] === 10) return i
  }
  return -1
}

/**
 * Collects bytes from the server's standard output and calls `onMessage` with
 * the text of each complete message. A message larger than `maxBytes`, or a
 * header without a valid length, is reported through `onError` and the stream
 * is dropped up to the next header.
 */
export class MessageReader {
  private buf = new Uint8Array(64 * 1024)
  private len = 0

  constructor(
    private readonly onMessage: (text: string) => void,
    private readonly onError: (reason: string) => void = () => undefined,
    private readonly maxBytes = 64 * 1024 * 1024
  ) {}

  push(chunk: Uint8Array): void {
    this.append(chunk)
    for (;;) {
      const end = indexOfHeaderEnd(this.buf, this.len)
      if (end < 0) {
        if (this.len > 8192) {
          this.onError('header too long')
          this.len = 0
        }
        return
      }
      const header = decoder.decode(this.buf.subarray(0, end))
      const m = /(?:^|\r\n)content-length:\s*(\d+)\s*(?:\r\n|$)/i.exec(header)
      const start = end + 4
      if (!m) {
        this.onError('missing Content-Length')
        this.consume(start)
        continue
      }
      const size = Number(m[1])
      if (size > this.maxBytes) {
        this.onError('message too large')
        this.len = 0
        return
      }
      if (this.len - start < size) return
      const text = decoder.decode(this.buf.subarray(start, start + size))
      this.consume(start + size)
      this.onMessage(text)
    }
  }

  private append(chunk: Uint8Array): void {
    if (this.len + chunk.length > this.buf.length) {
      let cap = this.buf.length
      while (cap < this.len + chunk.length) cap *= 2
      const next = new Uint8Array(cap)
      next.set(this.buf.subarray(0, this.len), 0)
      this.buf = next
    }
    this.buf.set(chunk, this.len)
    this.len += chunk.length
  }

  private consume(n: number): void {
    this.buf.copyWithin(0, n, this.len)
    this.len -= n
  }
}
