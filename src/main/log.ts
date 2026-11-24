// The single logging function of the app. Every message passes the redaction
// filter, so private keys and passwords never reach a log or the console.

const PATTERNS: RegExp[] = [
  // Legacy WIF private keys
  /\b5[HJK][1-9A-HJ-NP-Za-km-z]{49}\b/g,
  // PVT_K1_ / PVT_R1_ private keys
  /\bPVT_[A-Z0-9]{2}_[1-9A-HJ-NP-Za-km-z]{40,}\b/g,
  // Raw 32-byte hex secrets labelled as keys
  /("?(?:private[_ ]?key|privateKey|secret|seed)"?\s*[:=]\s*"?)[0-9a-fA-F]{64}/gi,
  // Password-like fields in serialized objects
  /("?(?:password|passphrase|pass)"?\s*[:=]\s*")[^"]*(")/gi
]

export function redact(text: string): string {
  let out = text
  out = out.replace(PATTERNS[0], '[redacted key]')
  out = out.replace(PATTERNS[1], '[redacted key]')
  out = out.replace(PATTERNS[2], '$1[redacted]')
  out = out.replace(PATTERNS[3], '$1[redacted]$2')
  return out
}

function format(args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) return `${a.name}: ${a.message}`
      if (typeof a === 'string') return a
      try {
        return JSON.stringify(a)
      } catch {
        return String(a)
      }
    })
    .join(' ')
}

type Sink = (line: string) => void
let sink: Sink = (line) => process.stdout.write(line + '\n')

export function setLogSink(s: Sink): void {
  sink = s
}

function write(level: string, args: unknown[]): void {
  const line = `${new Date().toISOString()} ${level} ${redact(format(args))}`
  try {
    sink(line)
  } catch {
    // logging must never throw
  }
}

export const log = {
  info: (...args: unknown[]): void => write('INFO', args),
  warn: (...args: unknown[]): void => write('WARN', args),
  error: (...args: unknown[]): void => write('ERROR', args)
}
