// Switches a packaged build refuses to start with (debugging, inspector or
// security-weakening). Chromium accepts one or two leading dashes, so the check uses its
// own switch parser as well as the raw arguments.
const BLOCKED_SWITCHES = [
  'remote-debugging-port',
  'remote-debugging-pipe',
  'remote-debugging-address',
  'inspect',
  'inspect-brk',
  'inspect-port',
  'js-flags',
  'ignore-certificate-errors',
  'disable-web-security',
  'allow-running-insecure-content',
  'no-sandbox',
  'disable-site-isolation-trials',
  'host-rules',
  'proxy-server'
]
export function hasBlockedSwitch(argv: string[], has: (name: string) => boolean): boolean {
  if (BLOCKED_SWITCHES.some((s) => has(s))) return true
  const re = new RegExp(`^-{1,2}(${BLOCKED_SWITCHES.join('|')})(=|$)`, 'i')
  return argv.some((a) => re.test(a))
}
