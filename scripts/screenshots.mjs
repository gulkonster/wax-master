// Retakes the documentation pictures in docs/help/img (npm run shots).
//
// What it does: starts the development build (out/, made by `npm run build`) with its own
// data folder C:\wax-shots\data (emptied at start) and the projects folder
// C:\wax-shots\projects, drives it over the DevTools protocol on 127.0.0.1 and takes every
// screen of the documentation in the dark and the light theme, 30 files in all:
//
//   setup, new-project, editor-completion, problems, window, local-chain, network-menu,
//   network-page, keys, deploy, contract-actions, confirm, transaction-view,
//   contract-tables, account-page   (each as <name>-dark.png and <name>-light.png)
//
// The data it makes: a vault with a password made at random in memory (never written or
// printed; the recovery code is passed without a picture), the keys "game key" and
// "player key", the project gametoken (Token template), and on the local chain of this
// computer the first free set of the accounts gameaccount<c>, player<cccccc>,
// shopaccount<c> (c = 1 to 5, then a to z; after those gameacct<cdcd>, player<cdcdcd>,
// shopacct<cdcd>), the token GOLD (create, issue) and one transfer of
// 10.0000 GOLD. Only the local chain is signed on: a signature asked for on any other
// network stops the run. The local chain is used as it is found and never reset: a
// stopped chain is started and stopped again at the end; a chain that is not set up is
// set up and removed again at the end. When no set is free, the run stops and says that
// the chain needs a Reset by hand.
//
// What it needs: Windows with WSL 2, Help > Setup done once (toolchain installed),
// `npm run build` before, and no other WAX Master running (both would use the one
// local chain and its port; the run stops and never closes that program).
//
// Native dialogs it answers (title, button), with scripts/screenshots/answer-dialog.ps1:
//   "Local Chain" (Remove the local chain?)            -> "Remove"     at the end, only when the run set the chain up itself
//   "Unsaved changes" (when the window closes)          -> "Don't Save" only when a step failed with an edited file open
//   "WAX Master" (Close without saving the recovery code?) -> "Close"  only when the run ends while the recovery code window is open
// The same helper gives the confirmation window ("Confirm transaction") the focus of Windows
// before each Approve: the app opens Approve only 1.5 s after that window has the focus.
// The folder dialog of New Project is not met: the folder is typed into the dialog.
// Any other dialog ends the run with its title in the message.
//
// Limits: a step 60 s; Build 3 min; Set up of the local chain 10 min; the whole run
// 25 min. On a limit or a failed step the run says which step, saves a picture of the
// window to C:\wax-shots\failed.png (outside the repository), closes the app and its
// child processes and ends with code 1. It never waits for a person.
//
// Usage: npm run shots            all screens
//        npm run shots -- --only <name>[,<name>...]   these screens only (the flow still runs up to the last)

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = 'C:\\wax-shots'
const DATA = join(BASE, 'data')
const PROJECTS = join(BASE, 'projects')
const FAILED = join(BASE, 'failed.png')
const OUT = join(ROOT, 'docs', 'help', 'img')
const ANSWER = join(ROOT, 'scripts', 'screenshots', 'answer-dialog.ps1')
const PORT = 9339

const STEP = 60_000
const BUILD = 180_000
const SET_UP = 600_000
const RUN = 25 * 60_000
const CLEANUP = 180_000

const VIEW = { width: 1280, height: 800 }
const MAX_FILE = 300 * 1024
const MAX_ALL = 6 * 1024 * 1024

const SCREENS = [
  'setup',
  'new-project',
  'editor-completion',
  'problems',
  'window',
  'local-chain',
  'network-menu',
  'network-page',
  'keys',
  'deploy',
  'contract-actions',
  'confirm',
  'transaction-view',
  'contract-tables',
  'account-page'
]

// ---------------------------------------------------------------------------------------
// Arguments

let only = null
{
  const args = process.argv.slice(2)
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--only' && args[i + 1]) only = args[++i].split(',').map((n) => n.trim()).filter(Boolean)
    else {
      console.error(`Unknown argument: ${args[i]}. Usage: npm run shots [-- --only <name>[,<name>...]]`)
      process.exit(2)
    }
  }
  const unknown = only && only.find((n) => !SCREENS.includes(n))
  if (unknown) {
    console.error(`No screen "${unknown}". Screens: ${SCREENS.join(', ')}`)
    process.exit(2)
  }
}

// ---------------------------------------------------------------------------------------
// Small tools

const T0 = Date.now()
const stamp = () => {
  const s = Math.floor((Date.now() - T0) / 1000)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
const say = (line) => console.log(`[${stamp()}] ${line}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

class StepError extends Error {}
/** Thrown after the last screen of --only is taken: the run goes to its normal end. */
class OnlyDone extends Error {}

function withLimit(promise, ms, what) {
  let timer
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new StepError(`${what}: no end within ${Math.round(ms / 1000)} s`)), ms)
    })
  ])
}

let currentStep = 'start'
async function step(name, fn, ms = STEP) {
  currentStep = name
  say(name)
  return withLimit(Promise.resolve().then(fn), ms, `step "${name}"`)
}

/** Runs a program with a time limit; resolves { code, out }. */
function run(cmd, args, ms, opts = {}) {
  return new Promise((resolve) => {
    let out = ''
    const p = spawn(cmd, args, { windowsHide: true, ...opts })
    p.stdout?.on('data', (d) => (out += d))
    p.stderr?.on('data', (d) => (out += d))
    const timer = setTimeout(() => {
      try {
        p.kill()
      } catch {}
      resolve({ code: -1, out })
    }, ms)
    p.on('error', () => {
      clearTimeout(timer)
      resolve({ code: -1, out })
    })
    p.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, out })
    })
  })
}

const powershell = (script, ms) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], ms)

// ---------------------------------------------------------------------------------------
// DevTools protocol

class Session {
  static async open(wsUrl) {
    const ws = new WebSocket(wsUrl)
    await withLimit(
      new Promise((resolve, reject) => {
        ws.onopen = resolve
        ws.onerror = () => reject(new StepError('could not connect to the page'))
      }),
      15_000,
      'connect to the page'
    )
    return new Session(ws)
  }
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    this.closed = false
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data)
      const p = d.id && this.pending.get(d.id)
      if (!p) return
      this.pending.delete(d.id)
      if (d.error) p.reject(new StepError(`${p.method}: ${d.error.message}`))
      else p.resolve(d.result)
    }
    ws.onclose = () => {
      this.closed = true
      for (const p of this.pending.values()) p.reject(new StepError('the page went away'))
      this.pending.clear()
    }
  }
  send(method, params = {}, ms = 20_000) {
    if (this.closed) return Promise.reject(new StepError('the page went away'))
    const id = ++this.id
    const p = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject, method }))
    this.ws.send(JSON.stringify({ id, method, params }))
    return withLimit(p, ms, method)
  }
  async js(expression, ms = 20_000) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true }, ms)
    if (r.exceptionDetails) {
      const text = r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'error'
      throw new StepError(`in the page: ${String(text).split('\n')[0]}`)
    }
    return r.result?.value
  }
  /** Polls an expression until it is truthy; returns its value. */
  async waitFor(expression, what, ms = STEP) {
    const end = Date.now() + ms
    let fault = ''
    while (Date.now() < end) {
      try {
        const v = await this.js(expression)
        if (v) return v
        fault = ''
      } catch (e) {
        if (this.closed) throw e
        fault = e.message
      }
      await sleep(250)
    }
    throw new StepError(`${what}: not seen within ${Math.round(ms / 1000)} s${fault ? ` (${fault})` : ''}`)
  }
  close() {
    try {
      this.ws.close()
    } catch {}
  }
}

async function targets() {
  const r = await withLimit(fetch(`http://127.0.0.1:${PORT}/json/list`), 10_000, 'list of pages')
  return r.json()
}

async function pageTarget(part, ms = STEP) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try {
      const t = (await targets()).find((x) => x.type === 'page' && x.url.includes(part))
      if (t) return t
    } catch {}
    await sleep(300)
  }
  throw new StepError(`the window ${part} did not open within ${Math.round(ms / 1000)} s`)
}

// In-page helpers, passed as source text. Elements are looked for among the visible ones.
const PAGE = String.raw`
  const visible = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden'
  const textOf = (e) => (e.innerText || '').trim()
  const topModal = () => [...document.querySelectorAll('.modal')].filter(visible).pop() || null
  const find = (selector, text, scope) => {
    const root = scope === 'modal' ? topModal() : document
    if (!root) return null
    const all = [...root.querySelectorAll(selector)].filter(visible)
    if (text === null) return all[0] || null
    const hits = all.filter((e) => textOf(e) === text)
    return hits.filter((e) => !hits.some((o) => o !== e && e.contains(o)))[0] || null
  }
  // An item of an open list, by the first line of its text (an item can carry a second line, such as a type).
  const item = (text, scope) => {
    const root = scope === 'modal' ? topModal() : document
    return root ? [...root.querySelectorAll(scope === 'modal' ? '.dd-item' : '.dropdown .dd-item')].filter(visible).find((e) => textOf(e).split('\n')[0].trim() === text) || null : null
  }
  const fieldInput = (label) => {
    const l = [...document.querySelectorAll('.field-label')].filter(visible).find((x) => x.firstChild && x.firstChild.textContent.trim() === label)
    return l ? l.parentElement.querySelector('input, textarea') : null
  }
`
const inPage = (body) => `(() => { ${PAGE}; ${body} })()`

// ---------------------------------------------------------------------------------------
// The app

let app = null // child process of the development build
let main = null // Session of the main window
let password = null // the run's vault password, in memory only

const mouseAway = async (s = main) => {
  try {
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: -50, y: -50 })
  } catch {
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: VIEW.height - 1 })
  }
}

async function clickAt(x, y, s = main) {
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await s.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
  }
  await mouseAway(s)
}

/** Clicks the visible element with this selector and text (null: the first one) with the mouse. */
const click = (selector, text, scope = 'page', what = text ?? selector, s = main) =>
  clickFound(`find(${JSON.stringify(selector)}, ${JSON.stringify(text)}, ${JSON.stringify(scope)})`, what, s)

/** Clicks an item of the open list (scope page) or of a list inside the dialog on top (scope modal). */
const clickItem = (text, scope = 'page') => clickFound(`item(${JSON.stringify(text)}, ${JSON.stringify(scope)})`, text)

async function clickFound(findExpr, what, s = main) {
  const r = await s.waitFor(
    inPage(`const e = ${findExpr};
      if (!e || e.disabled) return null; e.scrollIntoView({ block: 'nearest' }); const b = e.getBoundingClientRect();
      const x = b.x + b.width / 2, y = b.y + b.height / 2;
      // A note in the corner can lie over the element: it goes away when clicked.
      for (const t of document.querySelectorAll('.toast')) t.click();
      const hit = document.elementFromPoint(x, y);
      return hit && (hit === e || e.contains(hit) || hit.contains(e)) ? { x, y } : null`),
    `"${what}"`
  )
  await clickAt(r.x, r.y, s)
}

async function key(k, { modifiers = 0, text, s = main } = {}) {
  const codes = { Enter: 13, Escape: 27, Tab: 9, Backspace: 8, End: 35, z: 90, s: 83 }
  const code = k.length === 1 ? `Key${k.toUpperCase()}` : k
  await s.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key: k, code, modifiers, windowsVirtualKeyCode: codes[k], text })
  await s.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, modifiers, windowsVirtualKeyCode: codes[k] })
}

const typeText = (text, s = main) => s.send('Input.insertText', { text })

/** Focuses an input (found by an in-page expression), clears it and types the value. */
async function fill(findExpr, value, what) {
  await main.waitFor(inPage(`const e = ${findExpr}; if (!e || e.disabled) return false; e.scrollIntoView({ block: 'nearest' }); e.focus(); e.select && e.select(); return true`), what)
  await key('Backspace')
  if (value) await typeText(value)
}

const fillField = (label, value) => fill(`fieldInput(${JSON.stringify(label)})`, value, `the field ${label}`)

async function menu(top, item) {
  // A click while the page is still busy can be lost: the menu is opened again until the item shows.
  const shown = inPage(`return !!find('.menubar-menu .dd-label', ${JSON.stringify(item)}, 'page')`)
  for (let i = 0; i < 5 && !(await main.js(shown)); i++) {
    await click('button.menubar-label', top)
    try {
      await main.waitFor(shown, `${top} menu`, 3000)
    } catch {}
  }
  await click('.menubar-menu .dd-label', item, 'page', `${top} > ${item}`)
}

async function dismissToasts() {
  await main.waitFor(
    inPage(`for (const t of document.querySelectorAll('.toast')) t.click(); return document.querySelectorAll('.toast').length === 0`),
    'the notes in the corner to go',
    15_000
  )
}

async function nextFrames(s) {
  await s.js(`new Promise((r) => { requestAnimationFrame(() => requestAnimationFrame(() => r(1))); setTimeout(() => r(1), 500) })`)
}

// ---------------------------------------------------------------------------------------
// Pictures

const written = []

function pngSize(buf) {
  const sig = buf.subarray(0, 8).toString('hex')
  if (sig !== '89504e470d0a1a0a') throw new StepError('the picture is not a PNG')
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

async function setTheme(theme, sessions) {
  await main.js(`window.wax.settings.set({ theme: ${JSON.stringify(theme)} }).then(() => 1)`)
  for (const s of sessions) {
    await s.waitFor(`document.documentElement.getAttribute('data-theme') === ${JSON.stringify(theme)}`, `the ${theme} theme`, 15_000)
  }
  await sleep(700)
}

/**
 * Takes one screen in the dark and the light theme. `clip` is an in-page expression that
 * returns { x, y, width, height } (the picture is cut to it), or null for the whole view.
 */
async function picture(name, { s = main, clip = null, ready = null } = {}) {
  if (only && !only.includes(name)) return
  for (const theme of ['dark', 'light']) {
    await setTheme(theme, s === main ? [main] : [main, s])
    if (ready) await ready()
    if (s === main) await dismissToasts()
    await mouseAway(s)
    await nextFrames(s)
    const params = { format: 'png', captureBeyondViewport: false }
    if (clip) {
      const r = await s.js(inPage(`const b = ${clip}; return b && { x: b.x, y: b.y, width: b.width, height: b.height }`))
      if (!r) throw new StepError(`${name}: the part to cut was not found`)
      const view = await s.js(`({ w: innerWidth, h: innerHeight })`)
      const x = Math.max(0, Math.floor(r.x - 16))
      const y = Math.max(0, Math.floor(r.y - 16))
      const right = Math.min(view.w, Math.ceil(r.x + r.width + 16))
      const bottom = Math.min(view.h, Math.ceil(r.y + r.height + 16))
      params.clip = { x, y, width: right - x, height: bottom - y, scale: 1 }
    }
    const shot = await s.send('Page.captureScreenshot', params, 30_000)
    const buf = Buffer.from(shot.data, 'base64')
    const { width, height } = pngSize(buf)
    if (width > VIEW.width || height > VIEW.height) throw new StepError(`${name}-${theme}.png is ${width} x ${height}, more than ${VIEW.width} x ${VIEW.height}`)
    mkdirSync(OUT, { recursive: true })
    const file = `${name}-${theme}.png`
    writeFileSync(join(OUT, file), buf)
    written.push({ file, width, height, bytes: buf.length })
    say(`  ${file}  ${width} x ${height}  ${buf.length} bytes`)
  }
  if (only && name === SCREENS.filter((n) => only.includes(n)).pop()) throw new OnlyDone()
}

const modalBox = `topModal() && topModal().getBoundingClientRect()`

// ---------------------------------------------------------------------------------------
// Confirmation window and vault

/** Answers the vault prompt if it is open; returns true when it was. */
async function unlockIfAsked() {
  const asked = await main.js(inPage(`const m = topModal(); return !!m && textOf(m).startsWith('Unlock the vault')`))
  if (!asked) return false
  await fill(`topModal().querySelector('input[type=password]')`, password, 'the vault password field')
  await click('button', 'Unlock', 'modal')
  return true
}

/** Waits for the confirmation window of a send, answering the vault prompt on the way. */
async function confirmWindow() {
  const end = Date.now() + STEP
  while (Date.now() < end) {
    const t = (await targets()).find((x) => x.type === 'page' && x.url.includes('/confirm.html') && !x.url.includes('#'))
    if (t) {
      const s = await Session.open(t.webSocketDebuggerUrl)
      await s.waitFor(`!!document.querySelector('button') && document.body.innerText.includes('Approve')`, 'the confirmation window to be drawn')
      // Only the local chain is signed on.
      const local = await s.js(`/ · local\\n/.test(document.body.innerText) && document.body.innerText.includes('127.0.0.1')`)
      if (!local) {
        await s.js(`([...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Cancel') || {}).click?.()`).catch(() => {})
        s.close()
        throw new StepError('a signature was asked for on a network that is not the local chain; nothing was signed')
      }
      return s
    }
    await unlockIfAsked()
    await sleep(300)
  }
  throw new StepError(`the confirmation window did not open within ${STEP / 1000} s`)
}

/** Gives the confirmation window the focus of Windows (Approve opens only then, after a short wait). */
async function focusConfirmation() {
  if (!app || app.exited) return false
  const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ANSWER, '-ProcessId', String(app.pid), '-Title', 'Confirm transaction', '-Focus', '-TimeoutSec', '15'], 35_000)
  lastFocus = r.out.trim()
  return r.code === 0
}
let lastFocus = ''

const APPROVE_OPEN = `[...document.querySelectorAll('button')].some((b) => b.innerText.trim() === 'Approve and send' && !b.disabled)`
const APPROVE_LABEL = `([...document.querySelectorAll('button')].find((b) => b.innerText.trim().startsWith('Approve')) || {}).innerText || ''`

/** Waits until the confirmation window has the focus and its Approve button is open. */
async function confirmArmed(s) {
  const end = Date.now() + STEP
  while (Date.now() < end) {
    await focusConfirmation()
    try {
      await s.waitFor(APPROVE_OPEN, 'Approve open', 5000)
      return
    } catch {}
  }
  throw new StepError('the confirmation window did not get the focus of Windows, so Approve stayed closed')
}

async function approve(s) {
  const gone = async () => s.closed || !(await targets()).some((x) => x.type === 'page' && x.url.includes('/confirm.html') && !x.url.includes('#'))
  const end = Date.now() + 2 * STEP
  let note = ''
  for (let attempt = 1; Date.now() < end; attempt++) {
    // The app refuses Approve unless the window has had the focus for 1.5 s (a click into a
    // window that just appeared must not sign). Another program in front takes that focus away.
    if (!(await focusConfirmation())) say('  note: the confirmation window did not get the focus of Windows')
    await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 3, y: 3, button: 'left', clickCount: 1 })
    await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 3, y: 3, button: 'left', clickCount: 1 })
    try {
      await s.waitFor(APPROVE_OPEN, 'Approve open', 8000)
    } catch {
      const label = await s.js(APPROVE_LABEL).catch(() => '')
      const page = await s.js(`[document.hasFocus(), document.visibilityState].join(' ')`).catch(() => '')
      say(`  Approve did not open (attempt ${attempt}; the button reads "${label}"; page ${page}; ${lastFocus})`)
      continue
    }
    await click('button', 'Approve and send', 'page', 'Approve and send', s)
    const until = Date.now() + 10_000
    while (Date.now() < until) {
      if (await gone()) return
      await sleep(300)
    }
    note = await s.js(`document.body.innerText.split('\\n').filter((l) => /Approve works|refused|failed|error/i.test(l)).join(' ').slice(0, 300)`).catch(() => '')
    if (note && !/Approve works/.test(note)) break
    say(`  Approve was not taken (attempt ${attempt}); the window gets the focus again`)
  }
  throw new StepError(`the confirmation window did not close after Approve and send${note ? ` (it reads: ${note})` : ''}`)
}

async function viewFor(s) {
  const v = await s.js(`({ w: innerWidth, h: innerHeight })`)
  await s.send('Emulation.setDeviceMetricsOverride', { width: Math.min(v.w, VIEW.width), height: Math.min(v.h, VIEW.height), deviceScaleFactor: 1, mobile: false })
}

// ---------------------------------------------------------------------------------------
// Local chain

const chainStatus = () => main.js(`window.wax.localChain.status().then((s) => ({ phase: s.phase, port: s.port, reason: s.reason || '' }))`)
const LC_PHASE = inPage(`const m = [...document.querySelectorAll('.modal')].filter(visible).find((x) => textOf(x).startsWith('Local Chain')); return m ? textOf(m).split('\\n')[1] : null`)

let chainAtStart = null // the phase found at start
let chainMadeHere = false

async function openLocalChain() {
  await menu('Network', 'Local Chain...')
  return main.waitFor(LC_PHASE, 'the Local Chain dialog')
}

const MODALS = inPage(`return [...document.querySelectorAll('.modal')].filter(visible).length`)

/** Presses Close of the dialog on top and waits until it is gone (a busy dialog ignores the first press). */
async function closeTopModal() {
  const before = await main.js(MODALS)
  for (let i = 0; i < 5; i++) {
    await click('button', 'Close', 'modal', 'Close')
    try {
      await main.waitFor(`(${MODALS}) < ${before}`, 'the dialog closed', 3000)
      return
    } catch {}
  }
  throw new StepError('the dialog on top did not close')
}

async function ensureChainRunning() {
  const st = await chainStatus()
  chainAtStart = st.phase
  say(`  local chain found: ${st.phase}`)
  if (st.phase === 'unavailable' || st.phase === 'failed' || st.phase === 'setting-up' || st.phase === 'starting' || st.phase === 'stopping') {
    throw new StepError(`the local chain is ${st.phase}${st.reason ? ` (${st.reason})` : ''}; open Network > Local Chain in WAX Master and bring it to Stopped or Running first`)
  }
  await openLocalChain()
  if (st.phase === 'not-set-up') {
    await click('button', 'Set up', 'modal')
    chainMadeHere = true
    await main.waitFor(inPage(`const p = ${LC_PHASE}; return p === 'Stopped' || p === 'Running'`), 'the local chain set up', SET_UP)
  }
  if ((await main.js(LC_PHASE)) === 'Stopped') {
    await click('button', 'Start', 'modal')
    await main.waitFor(`(${LC_PHASE}) === 'Running'`, 'the local chain running', SET_UP)
  }
  // The network entry Local chain follows the running chain a moment later.
  await main.waitFor(`window.wax.networks.list().then((l) => l.networks.some((n) => n.id === 'local-chain'))`, 'the network entry Local chain')
  if (await main.js(inPage(`return !!find('button', 'Select this network', 'modal')`))) await click('button', 'Select this network', 'modal')
  await main.waitFor(`document.body.innerText.includes('Local chain · http://127.0.0.1')`, 'Local chain selected')
  await closeTopModal()
}

let names = null

// The last characters of the account names, in this order (an account name allows only a-z, 1-5 and dots).
const SUFFIX = '12345abcdefghijklmnopqrstuvwxyz'

/** The account sets in the order they are tried: one character (31 sets), then two (961 sets). */
function* accountSets() {
  for (const c of SUFFIX) yield { game: `gameaccount${c}`, player: `player${c.repeat(6)}`, shop: `shopaccount${c}` }
  for (const c of SUFFIX) for (const d of SUFFIX) yield { game: `gameacct${c}${d}${c}${d}`, player: `player${(c + d).repeat(3)}`, shop: `shopacct${c}${d}${c}${d}` }
}

/** The first set of which none of the three accounts exists; a set with any existing account is skipped whole. */
async function pickAccountSet() {
  for (const set of accountSets()) {
    const taken = await main.js(`Promise.all(${JSON.stringify(Object.values(set))}.map((a) => window.wax.localChain.accountExists(a))).then((r) => r.some(Boolean))`)
    if (!taken) return set
  }
  throw new StepError('the local chain holds every account set the pictures may use: it needs a Reset by hand (Network > Local Chain > Reset) before the pictures can be retaken')
}

async function newLocalAccount(name, keyLabel) {
  await click('button', 'New account...', 'modal')
  await main.waitFor(inPage(`return !!topModal() && textOf(topModal()).startsWith('New Account on Local chain')`), 'the New Account dialog')
  await fill(`topModal().querySelector('input.input')`, name, 'the account name')
  await main.js(
    inPage(`const s = topModal().querySelector('select'); const o = [...s.options].find((x) => x.text.startsWith(${JSON.stringify(keyLabel + ' - ')}));
      if (!o) throw new Error('no key ${keyLabel}'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, o.value);
      s.dispatchEvent(new Event('change', { bubbles: true })); return true`)
  )
  await key('Tab')
  await main.waitFor(inPage(`return textOf(topModal()).includes('The name is free on Local chain.')`), `${name} free on the local chain`)
  await click('button', 'Create', 'modal')
  await main.waitFor(inPage(`return !!topModal() && textOf(topModal()).startsWith('Local Chain')`), `${name} created`)
}

// ---------------------------------------------------------------------------------------
// Start and end

async function otherInstance() {
  const r = await powershell(
    `Get-CimInstance Win32_Process -Filter "Name='WAX Master.exe' OR Name='electron.exe'" | ForEach-Object { $_.Name + '|' + $_.ExecutablePath }`,
    30_000
  )
  if (r.code !== 0) throw new StepError('could not read the list of programs')
  const root = ROOT.toLowerCase()
  return r.out
    .split(/\r?\n/)
    .filter(Boolean)
    .some((l) => {
      const [name, path = ''] = l.split('|')
      return name.toLowerCase() === 'wax master.exe' || path.toLowerCase().startsWith(root)
    })
}

function removeDir(dir) {
  for (let i = 0; i < 20; i++) {
    try {
      rmSync(dir, { recursive: true, force: true })
      return true
    } catch {
      const until = Date.now() + 500
      while (Date.now() < until) {}
    }
  }
  return !existsSync(dir)
}

async function launch() {
  if (!existsSync(join(ROOT, 'out', 'main', 'index.js'))) throw new StepError('out/ is missing: run npm run build first')
  if (await otherInstance()) throw new StepError('WAX Master is running. Close it first: the run and it would use the one local chain and its port')
  try {
    await withLimit(fetch(`http://127.0.0.1:${PORT}/json/version`), 3000, 'port check')
    throw new StepError(`port ${PORT} is in use by another program`)
  } catch (e) {
    if (e instanceof StepError && e.message.startsWith('port')) throw e
  }
  if (!removeDir(DATA)) throw new StepError(`${DATA} could not be emptied`)
  if (!removeDir(PROJECTS)) throw new StepError(`${PROJECTS} could not be emptied`)
  rmSync(FAILED, { force: true })
  mkdirSync(DATA, { recursive: true })
  mkdirSync(PROJECTS, { recursive: true })

  const electron = createRequire(import.meta.url)('electron')
  const env = { ...process.env }
  delete env.ELECTRON_RENDERER_URL
  delete env.ELECTRON_RUN_AS_NODE
  app = spawn(
    electron,
    [
      ROOT,
      `--user-data-dir=${DATA}`,
      `--remote-debugging-port=${PORT}`,
      // The window may be covered by others while the run goes; its pages must still count as shown.
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling'
    ],
    { cwd: ROOT, env, stdio: 'ignore', windowsHide: false }
  )
  app.exited = false
  app.on('exit', () => (app.exited = true))

  const t = await pageTarget('index.html', STEP)
  main = await Session.open(t.webSocketDebuggerUrl)
  await main.send('Emulation.setDeviceMetricsOverride', { ...VIEW, deviceScaleFactor: 1, mobile: false })
  await main.waitFor(`!!window.wax && !!document.querySelector('button.menubar-label')`, 'the main window')
  await main.js(
    `window.wax.settings.set({ theme: 'dark', updateCheck: false, autoLockMinutes: 60, lockAfterSignature: false, defaultProjectFolder: ${JSON.stringify(PROJECTS)} }).then(() => 1)`
  )
  const shown = await main.js(`document.visibilityState`)
  if (shown !== 'visible') say(`  note: the window counts as ${shown}`)
}

async function answer(title, button, seconds) {
  if (!app || app.exited) return false
  const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ANSWER, '-ProcessId', String(app.pid), '-Title', title, '-Button', button, '-TimeoutSec', String(seconds)], (seconds + 20) * 1000)
  return r.code === 0
}

async function openDialogs() {
  if (!app || app.exited) return []
  const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ANSWER, '-ProcessId', String(app.pid), '-List'], 30_000)
  return r.out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
}

/** Brings the local chain back to the state it was found in. */
async function restoreChain() {
  if (!main || main.closed) return
  const st = await chainStatus()
  if (chainMadeHere) {
    say('remove the local chain (it was set up by this run)')
    if (st.phase === 'running') {
      await main.js(`window.wax.localChain.stop().then(() => 1)`, 120_000)
      await main.waitFor(`window.wax.localChain.status().then((s) => s.phase === 'stopped')`, 'the local chain stopped', 120_000)
    }
    // The app asks "Remove the local chain?" natively before it removes anything.
    main.send('Runtime.evaluate', { expression: 'window.wax.localChain.remove()' }).catch(() => {})
    if (!(await answer('Local Chain', 'Remove', 30))) throw new StepError('the question "Remove the local chain?" did not come')
    await main.waitFor(`window.wax.localChain.status().then((s) => s.phase === 'not-set-up')`, 'the local chain removed', 120_000)
  } else if (chainAtStart === 'stopped' && st.phase === 'running') {
    say('stop the local chain (it was stopped at start)')
    await main.js(`window.wax.localChain.stop().then(() => 1)`, 120_000)
    await main.waitFor(`window.wax.localChain.status().then((s) => s.phase === 'stopped')`, 'the local chain stopped', 120_000)
  }
}

async function closeApp() {
  if (!app || app.exited) return
  try {
    if (main && !main.closed) main.send('Runtime.evaluate', { expression: 'window.wax.app.quitNow()' }).catch(() => {})
  } catch {}
  // Questions the closing can raise; each helper ends by itself when its dialog does not come.
  const answers = [answer('Unsaved changes', "Don't Save", 20), answer('WAX Master', 'Close', 20)]
  const end = Date.now() + 90_000
  while (!app.exited && Date.now() < end) await sleep(300)
  await Promise.allSettled(answers)
  if (!app.exited) {
    say('the app did not close by itself; its processes are ended')
    await run('taskkill.exe', ['/PID', String(app.pid), '/T', '/F'], 30_000)
  }
  main?.close()
}

function cleanFolders() {
  const ok = removeDir(DATA) & removeDir(PROJECTS)
  try {
    if (existsSync(BASE) && readdirSync(BASE).length === 0) rmSync(BASE, { recursive: true, force: true })
  } catch {}
  if (!ok) say(`note: ${DATA} or ${PROJECTS} could not be deleted; delete it by hand`)
}

// ---------------------------------------------------------------------------------------
// The flow

async function flow() {
  await step('start the development build', launch)
  await step('local chain: start it and select it', ensureChainRunning, SET_UP + STEP)
  await step('local chain: choose the account names', async () => {
    names = await pickAccountSet()
    say(`  accounts: ${names.game}, ${names.player}, ${names.shop}`)
  })

  await step('Help > Setup', async () => {
    await menu('Help', 'Setup')
    await main.waitFor(`document.querySelectorAll('.setup-icon').length === 4`, 'the Setup checks')
    const allOk = `document.querySelectorAll('.setup-icon.ok').length === 4`
    try {
      await main.waitFor(allOk, 'all four checks passed', 30_000)
    } catch {
      const testBuild = await main.js(inPage(`return !!find('button', 'Run test build', 'page')`))
      const others = await main.js(`[...document.querySelectorAll('.setup-icon')].slice(0, 3).every((e) => e.classList.contains('ok'))`)
      if (!others || !testBuild) throw new StepError('Help > Setup is not done on this computer: run it once in WAX Master first')
      await click('button', 'Run test build')
      await main.waitFor(allOk, 'the test build', BUILD)
    }
  }, BUILD + STEP)
  await step('picture setup', () => picture('setup'))

  await step('vault with two keys', async () => {
    password = randomBytes(18).toString('base64url')
    await menu('Accounts', 'Create Vault...')
    await main.waitFor(inPage(`return !!topModal() && textOf(topModal()).startsWith('Create the vault')`), 'the Create the vault dialog')
    for (const n of [0, 1]) {
      await main.js(inPage(`const e = topModal().querySelectorAll('input[type=password]')[${n}]; e.focus(); return 1`))
      await typeText(password)
    }
    await click('button', 'Create vault', 'modal')
    // The recovery code window: passed with "I saved it", never shown or read.
    const t = await pageTarget('confirm.html#code')
    const code = await Session.open(t.webSocketDebuggerUrl)
    await code.waitFor(`!!([...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'I saved it'))`, 'the recovery code window')
    await code.js(`[...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'I saved it').click()`)
    code.close()
    await main.waitFor(`document.body.innerText.includes('Vault unlocked (0 keys)')`, 'the vault unlocked')
    await menu('Accounts', 'Manage Keypairs...')
    for (const label of ['game key', 'player key']) {
      await click('button', 'Create', 'modal')
      await fill(`topModal().querySelector('input[placeholder="e.g. deploy key"]')`, label, 'the key label')
      await click('button', 'Save', 'modal')
      await click('button', 'Skip: I understand that losing the vault or its password loses this key', 'modal', 'Skip the backup')
      await main.waitFor(inPage(`return textOf(topModal()).startsWith('Manage Keypairs') && textOf(topModal()).includes(${JSON.stringify(label)})`), `the key ${label}`)
    }
    await closeTopModal()
  })

  await step('File > New Project', async () => {
    await menu('File', 'New Project...')
    await main.waitFor(inPage(`return !!topModal() && textOf(topModal()).startsWith('New Project')`), 'the New Project dialog')
    await fill(`topModal().querySelectorAll('input.input')[0]`, 'gametoken', 'the project name')
    await fill(`topModal().querySelectorAll('input.input')[1]`, PROJECTS, 'the project folder')
    await click('.modal *', 'Token', 'modal', 'the Token template')
    // Name and folder are at the end of the dialog.
    await main.js(inPage(`const b = topModal().querySelector('.modal-body'); b.scrollTop = b.scrollHeight; return 1`))
    await sleep(300)
  })
  await step('picture new-project', () => picture('new-project', { clip: modalBox }))
  const source = join(PROJECTS, 'gametoken', 'src', 'gametoken.cpp')
  await step('create the project', async () => {
    await click('button', 'Create', 'modal')
    await main.waitFor(`[...document.querySelectorAll('.monaco-editor .view-line')].some((l) => l.innerText.replace(/\u00a0/g, ' ').includes('void gametoken::create'))`, 'gametoken.cpp in the editor')
  })

  const original = readFileSync(source, 'utf8')
  const LINE = `[...document.querySelectorAll('.monaco-editor .view-line')].sort((a, b) => a.getBoundingClientRect().y - b.getBoundingClientRect().y)`
  const clickLineEnd = async (text) => {
    const r = await main.waitFor(
      `(() => { const l = ${LINE}.find((x) => x.innerText.replace(/\u00a0/g, ' ').trim() === ${JSON.stringify(text)}); if (!l) return null; const s = l.firstElementChild || l;
        const b = s.getBoundingClientRect(); return { x: b.right + 30, y: b.y + b.height / 2 } })()`,
      `the line ${text}`
    )
    await clickAt(r.x, r.y)
    await key('End')
  }
  await step('editor: completion after issuer.', async () => {
    await sleep(1500)
    await clickLineEnd('require_auth(get_self());')
    await key('Enter', { text: '\r' })
    await typeText('issuer.')
    await main.waitFor(`(() => { const w = document.querySelector('.suggest-widget.visible'); return !!w && w.querySelectorAll('.monaco-list-row').length > 2 && !w.innerText.includes('Loading') })()`, 'the completion list', STEP)
    await sleep(800)
  })
  await step('picture editor-completion', () => picture('editor-completion'))
  await step('editor: a mistake and Problems', async () => {
    await key('Escape')
    await typeText(';')
    await main.waitFor(`!!document.querySelector('.monaco-editor .squiggly-error')`, 'the underline of the mistake')
    await menu('View', 'Problems')
    await main.waitFor(`document.body.innerText.includes('gametoken.cpp:5')`, 'the mistake in Problems')
    await clickLineEnd('issuer.;')
    await sleep(500)
  })
  await step('picture problems', () => picture('problems'))
  await step('editor: undo and save', async () => {
    await clickLineEnd('issuer.;')
    for (let i = 0; i < 6; i++) {
      await key('z', { modifiers: 2 })
      await key('s', { modifiers: 2 })
      await sleep(700)
      if (readFileSync(source, 'utf8') === original) return
    }
    throw new StepError('the edit of gametoken.cpp could not be undone')
  })

  await step('Build', async () => {
    await click('button', 'Build', 'page', 'the Build button')
    await main.waitFor(`/Build finished|Build failed/.test(document.body.innerText)`, 'the end of the build', BUILD)
    if (!(await main.js(`document.body.innerText.includes('Build finished')`))) throw new StepError('the build of gametoken failed')
    await sleep(500)
  }, BUILD + STEP)
  await step('picture window', () => picture('window'))

  await step('local chain: three accounts', async () => {
    await main.js(`(document.querySelector('button[title="Close panel"]') || {}).click?.()`)
    await openLocalChain()
    await newLocalAccount(names.shop, 'game key')
    await newLocalAccount(names.player, 'player key')
    await newLocalAccount(names.game, 'game key')
    await main.waitFor(`(${LC_PHASE}) === 'Running'`, 'the Local Chain dialog running')
  }, 4 * STEP)
  await step('picture local-chain', () => picture('local-chain', { clip: modalBox }))

  await step('the Network list', async () => {
    await closeTopModal()
    await sleep(500)
    const arrows = await main.js(`[...document.querySelectorAll('.topbar button.tb-arrow')].map((b) => { const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })`)
    await clickAt(arrows[3].x, arrows[3].y)
    await main.waitFor(inPage(`const d = find('.dropdown', null, 'page'); return !!d && textOf(d).includes('Local chain')`), 'the Network list')
  })
  await step('picture network-menu', () =>
    picture('network-menu', {
      clip: `(() => { const t = document.querySelector('.topbar').getBoundingClientRect(); const d = find('.dropdown', null, 'page').getBoundingClientRect();
        return { x: 16, y: t.y + 16, width: innerWidth - 32, height: d.bottom - t.y - 16 } })()`
    })
  )
  await step('the Network page', async () => {
    await clickItem('Network Page')
    await main.waitFor(`(document.body.innerText.match(/\\b\\d\\d:\\d\\d:\\d\\d\\b/g) || []).length >= 5`, 'the latest blocks')
  })
  await step('picture network-page', () => picture('network-page'))

  await step('Accounts > Manage Keypairs', async () => {
    await menu('Accounts', 'Manage Keypairs...')
    await main.waitFor(inPage(`return !!topModal() && textOf(topModal()).startsWith('Manage Keypairs') && textOf(topModal()).includes('player key')`), 'Manage Keypairs')
  })
  await step('picture keys', () => picture('keys', { clip: modalBox }))

  await step('Contract > Deploy', async () => {
    await closeTopModal()
    await menu('Contract', 'Deploy')
    await main.waitFor(inPage(`return !!topModal() && textOf(topModal()).startsWith('Deploy')`), 'the Deploy dialog')
    const chosen = await main.js(inPage(`const b = topModal().querySelector('.acct-pick-btn'); return !!b && textOf(b) === ${JSON.stringify(names.game)}`))
    if (!chosen) {
      await click('.acct-pick-btn', null, 'modal', 'the account list')
      await clickItem(names.game, 'modal')
    }
    await main.waitFor(inPage(`const t = textOf(topModal()); return t.includes('Account\\n${names.game}') && /RAM needed/.test(t) && !t.includes('Checking...')`), 'the deploy check')
    await sleep(500)
  })
  await step('picture deploy', () => picture('deploy', { clip: modalBox }))
  await step('Deploy and approve', async () => {
    await click('button.primary', 'Deploy', 'modal')
    const c = await confirmWindow()
    await approve(c)
    c.close()
    await main.waitFor(inPage(`return textOf(topModal()).includes('Status\\nexecuted')`), 'the deploy executed')
    await closeTopModal()
  }, 4 * STEP) // Approve may need a few tries to get the focus (up to 2 min)

  const chooseAction = async (action) => {
    await main.waitFor(inPage(`return !!find('button.pick-btn', null, 'page')`), 'the action list')
    const r = await main.js(`(() => { const b = [...document.querySelectorAll('button.pick-btn')].filter((e) => e.getClientRects().length).sort((a, b) => a.getBoundingClientRect().x - b.getBoundingClientRect().x)[0]; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
    await clickAt(r.x, r.y)
    await clickItem(action)
    await main.waitFor(`[...document.querySelectorAll('button.pick-btn')].some((b) => b.innerText.trim() === ${JSON.stringify(action)})`, `the action ${action}`)
  }
  const RESULT = `(document.body.innerText.split('\\nResult\\n')[1] || '').split('\\n')[0]`
  const runAction = async (picturesOfConfirm) => {
    const before = await main.js(RESULT)
    await click('button', 'Run', 'page', 'Run')
    const c = await confirmWindow()
    if (picturesOfConfirm) {
      await viewFor(c)
      // Both pictures show the window as it is before Approve: focused, its short wait over.
      await picture('confirm', { s: c, ready: () => confirmArmed(c) })
    }
    await approve(c)
    c.close()
    await main.waitFor(`(() => { const r = ${RESULT}; return r !== ${JSON.stringify(before)} && r.includes('· executed') })()`, 'the transaction executed')
  }
  const blur = () => main.js(`document.activeElement && document.activeElement.blur && document.activeElement.blur(), 1`)

  await step('Contract page: create and issue GOLD', async () => {
    await clickAt(...(await main.js(`(() => { const b = [...document.querySelectorAll('.topbar button.tb-main')][1].getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2] })()`)))
    await fill(`document.querySelector('input[placeholder="Contract account"]')`, names.game, 'the contract account')
    await key('Enter', { text: '\r' })
    await chooseAction('create')
    await fillField('issuer', names.game)
    await fillField('maximum_supply', '1000000.0000 GOLD')
    await key('Escape')
    await blur()
    await runAction(false)
    await chooseAction('issue')
    await fillField('to', names.game)
    await fillField('quantity', '1000.0000 GOLD')
    await fillField('memo', 'first issue')
    await key('Escape')
    await blur()
    await runAction(false)
  }, 6 * STEP)
  await step('Contract page: transfer filled', async () => {
    await chooseAction('transfer')
    await fillField('from', names.game)
    await fillField('to', names.player)
    await fillField('quantity', '10.0000 GOLD')
    await fillField('memo', 'reward')
    await key('Escape')
    await blur()
    await main.waitFor(`document.body.innerText.includes('bytes packed')`, 'the transfer form checked')
  })
  await step('picture contract-actions', () => picture('contract-actions'))
  await step('Run the transfer (picture confirm)', () => runAction(true), 5 * STEP)

  await step('the transaction view', async () => {
    await click('button, a, span', 'Open in inspector')
    await main.waitFor(inPage(`return !!topModal() && textOf(topModal()).startsWith('Transaction')`), 'the transaction view')
    await main.js(inPage(`const t = [...topModal().querySelectorAll('[role=tab]')].find((x) => textOf(x).startsWith('Traces')); t.click(); return 1`))
    await main.waitFor(inPage(`return textOf(topModal()).includes('notification to ${names.player}')`), 'the notification in the traces')
    await click('button', 'Collapse all', 'modal')
    await sleep(500)
  })
  await step('picture transaction-view', () => picture('transaction-view'))

  await step('the accounts table', async () => {
    await closeTopModal()
    await click('button', 'Pick a table')
    await clickItem('accounts')
    await fillField('Scope', names.player)
    await click('button', 'Run query')
    await main.waitFor(`document.body.innerText.includes('1 row') && document.body.innerText.includes('10.0000 GOLD')`, 'the balance row')
    await blur()
  })
  await step('picture contract-tables', () => picture('contract-tables'))

  await step('the Account page', async () => {
    const arrows = await main.js(`[...document.querySelectorAll('.topbar button.tb-arrow')].map((b) => { const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })`)
    await clickAt(arrows[2].x, arrows[2].y)
    await clickItem(names.game)
    await main.waitFor(`document.body.innerText.includes('Total balance') && document.body.innerText.includes('You control')`, 'the Account page')
    // The page was opened when the account was made: read it again after the deploy and the sends.
    const ramBefore = await main.js(`(document.body.innerText.match(/RAM\\n([^\\n]+)/) || [])[1] || ''`)
    await click('button[title="Refresh"]', null, 'page', 'Refresh')
    await main
      .waitFor(`((document.body.innerText.match(/RAM\\n([^\\n]+)/) || [])[1] || '') !== ${JSON.stringify(ramBefore)}`, 'the Account page read again', 15_000)
      .catch(() => {}) // already up to date
    await main.js(`for (const e of document.querySelectorAll('*')) if (e.scrollTop > 0) e.scrollTop = 0; 1`)
    await sleep(1000)
  })
  await step('picture account-page', () => picture('account-page'))
}

// ---------------------------------------------------------------------------------------

let ending = false

async function finish(error) {
  if (ending) return
  ending = true
  const hard = setTimeout(() => {
    console.error('The end of the run took too long; its processes are ended.')
    if (app && !app.exited) spawn('taskkill.exe', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    process.exit(1)
  }, CLEANUP)
  if (error) {
    console.error(`\nFAILED at step "${currentStep}": ${error.message}`)
    const dialogs = await openDialogs().catch(() => [])
    if (dialogs.length) console.error(`Open dialog(s) of the app: ${dialogs.map((d) => `"${d}"`).join(', ')}`)
    if (main && !main.closed) {
      try {
        const text = await main.js(inPage(`const m = topModal(); return m ? textOf(m).replace(/\\s+/g, ' ').slice(0, 400) : ''`))
        if (text) console.error(`The dialog on top reads: ${text}`)
      } catch {}
      try {
        mkdirSync(BASE, { recursive: true })
        const shot = await main.send('Page.captureScreenshot', { format: 'png' }, 15_000)
        writeFileSync(FAILED, Buffer.from(shot.data, 'base64'))
        console.error(`A picture of the window: ${FAILED}`)
      } catch {}
    }
  }
  currentStep = 'end'
  try {
    await withLimit(restoreChain(), 150_000, 'the local chain back to its state')
  } catch (e) {
    console.error(`The local chain could not be brought back (${e.message}); check Network > Local Chain.`)
    error = error || e
  }
  say('close the app')
  await closeApp()
  password = null
  cleanFolders()
  clearTimeout(hard)

  if (written.length) {
    const total = written.reduce((n, w) => n + w.bytes, 0)
    console.log(`\n${written.length} file(s) in docs/help/img, ${total} bytes in all.`)
    const big = written.filter((w) => w.bytes > MAX_FILE)
    for (const w of big) console.log(`Over 300 KB: ${w.file} (${w.bytes} bytes)`)
    if (!only && total > MAX_ALL) console.log('All files together are over 6 MB.')
    if (!error && (big.length || (!only && total > MAX_ALL))) error = new Error('size limit')
  }
  say(error ? 'ended with an error' : 'done')
  process.exit(error ? 1 : 0)
}

const runLimit = setTimeout(() => void finish(new StepError(`the whole run took longer than ${RUN / 60_000} min`)), RUN)
process.on('SIGINT', () => void finish(new StepError('stopped by Ctrl+C')))

try {
  await flow()
  clearTimeout(runLimit)
  await finish(null)
} catch (e) {
  clearTimeout(runLimit)
  if (e instanceof OnlyDone) await finish(null)
  else await finish(e)
}
