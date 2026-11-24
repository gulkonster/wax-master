// The vault password rule, shared by the main process and the dialogs: a hard
// minimum length, and a warning (never a refusal) for passwords that are easy
// to guess offline from a copied vault file.

export const MIN_PASSWORD_LENGTH = 6
/** Below this length a password is always called weak. */
export const WEAK_BELOW = 10
/** From this length on a password that is not weak is called good. */
export const GOOD_FROM = 14

export const TOO_SHORT_TEXT = `The password needs at least ${MIN_PASSWORD_LENGTH} characters.`
export const WEAK_TEXT = 'Weak password. Anyone who copies the vault file could guess it. You can still use it.'
export const GOOD_TEXT = 'Good'

/** Some of the most used passwords (compared without case). */
const COMMON = new Set(
  `123456 123456789 12345678 password qwerty123 qwerty1 111111 12345 1234567 dragon 123123 baseball abc123 football monkey
letmein 696969 shadow master 666666 qwertyuiop 123321 mustang 1234567890 michael 654321 superman 1qaz2wsx 7777777 121212
000000 qazwsx 123qwe killer trustno1 jordan jennifer zxcvbnm asdfgh hunter buster soccer harley batman andrew tigger
sunshine iloveyou 2000 charlie robert thomas hockey ranger daniel starwars klaster 112233 george computer michelle jessica
pepper 1111 zxcvbn 555555 11111111 131313 freedom 777777 pass maggie 159753 aaaaaa ginger princess joshua cheese amanda
summer love ashley 6969 nicole chelsea biteme matthew access yankees 987654321 dallas austin thunder taylor matrix
password1 password123 welcome welcome1 admin admin123 login passw0rd p@ssword p@ssw0rd changeme secret qwerty12 1q2w3e4r
1q2w3e4r5t q1w2e3r4t5 zaq12wsx letmein1 football1 iloveyou1 monkey1 dragon1 abcd1234 a1b2c3d4 abc12345 secret123`
    .split(/\s+/)
    .filter(Boolean)
)

/** Keyboard and alphabet runs; a password that is a piece of one (either direction) is weak. */
const RUNS = ['0123456789', 'abcdefghijklmnopqrstuvwxyz', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm', 'qwertyuiopasdfghjklzxcvbnm', '1234567890']

function isRun(lower: string): boolean {
  // A run may go round (7890123), so each is repeated before the search.
  return RUNS.some((r) => r.repeat(4).includes(lower) || [...r].reverse().join('').repeat(4).includes(lower))
}

export type PasswordLevel = 'empty' | 'short' | 'weak' | 'ok' | 'good'

export interface PasswordCheck {
  level: PasswordLevel
  /** False only for an empty or too short password. */
  allowed: boolean
  /** Text under the field ('' when nothing is said). */
  text: string
}

/** True when the password is easy to guess (it is still allowed from the minimum length on). */
export function isWeakPassword(pw: string): boolean {
  const lower = pw.toLowerCase()
  if (pw.length < WEAK_BELOW) return true
  const letters = /[a-z]/i.test(pw)
  const digits = /\d/.test(pw)
  const others = /[^a-z\d]/i.test(pw)
  const kinds = [letters, digits, others].filter(Boolean).length
  if (pw.length < GOOD_FROM && kinds === 1 && !others) return true
  if (new Set(pw).size === 1) return true
  if (isRun(lower)) return true
  if (COMMON.has(lower)) return true
  return false
}

export function checkPassword(pw: string): PasswordCheck {
  if (!pw) return { level: 'empty', allowed: false, text: '' }
  if (pw.length < MIN_PASSWORD_LENGTH) return { level: 'short', allowed: false, text: TOO_SHORT_TEXT }
  if (isWeakPassword(pw)) return { level: 'weak', allowed: true, text: WEAK_TEXT }
  if (pw.length >= GOOD_FROM) return { level: 'good', allowed: true, text: GOOD_TEXT }
  return { level: 'ok', allowed: true, text: '' }
}

/** The main-process check: throws for a password under the minimum. */
export function requirePasswordLength(pw: string): void {
  if (pw.length < MIN_PASSWORD_LENGTH) throw new Error(TOO_SHORT_TEXT)
}
