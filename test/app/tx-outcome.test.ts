// A cancel is a neutral note, never an error; a refusal is explained once; the
// confirmation window keeps the transaction it showed when the send failed.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CANCELLED_NOT_SENT, CANCELLED_NOT_SIGNED, formLineClass, outcomeLine } from '../../src/renderer/src/lib/tx-outcome'
import { NOT_SENT_MAX, confirmPageKind, notSentText, oneLine } from '../../src/renderer/src/confirm/not-sent'
import type { InspectedTransaction } from '../../src/shared/trace-types'

const RAM_TEXT = 'Rejected for RAM: alice does not have enough RAM for this transaction (alice: RAM 177,528 of 177,528 bytes used).'
const trace = (errorMessage: string | null): InspectedTransaction => ({ errorMessage }) as unknown as InspectedTransaction

const src = (rel: string): string => readFileSync(join(__dirname, '../../src/renderer/src', rel), 'utf8')

function tsxFiles(dir: string): string[] {
  const out: string[] = []
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) out.push(...tsxFiles(p))
    else if (/\.tsx?$/.test(f)) out.push(p)
  }
  return out
}

describe('the line of a signing form', () => {
  it('a cancel is a note in the hint style, never the error class', () => {
    for (const text of [CANCELLED_NOT_SIGNED, CANCELLED_NOT_SENT]) {
      const line = outcomeLine({ status: 'cancelled' }, text)
      expect(line).toEqual({ kind: 'note', text })
      expect(formLineClass(line!)).toBe('hint')
    }
    expect(CANCELLED_NOT_SIGNED).toBe('Cancelled; nothing was signed.')
    expect(CANCELLED_NOT_SENT).toBe('Cancelled; nothing was sent.')
  })

  it('a refusal whose inspector carries the explanation gets no line of its own', () => {
    expect(outcomeLine({ status: 'failed', trace: trace(RAM_TEXT), error: RAM_TEXT }, CANCELLED_NOT_SENT)).toBeNull()
  })

  it('without an inspector, or without its text, the error line stays', () => {
    expect(outcomeLine({ status: 'failed', trace: null, error: 'No answer' }, CANCELLED_NOT_SENT)).toEqual({ kind: 'error', text: 'No answer' })
    expect(outcomeLine({ status: 'failed', trace: trace(null), error: 'x' }, CANCELLED_NOT_SENT)?.kind).toBe('error')
    expect(outcomeLine({ status: 'failed', trace: trace(RAM_TEXT), error: RAM_TEXT }, CANCELLED_NOT_SENT, false)?.kind).toBe('error')
    expect(formLineClass({ kind: 'error', text: 'x' })).toBe('error-text')
  })

  it('a sent transaction gets no line', () => {
    expect(outcomeLine({ status: 'sent', trace: trace(null) }, CANCELLED_NOT_SENT)).toBeNull()
  })

  it('no form writes a cancel in the error style', () => {
    for (const f of tsxFiles(join(__dirname, '../../src/renderer/src'))) {
      const text = readFileSync(f, 'utf8')
      expect(text, f).not.toMatch(/setError\(\s*['"`]Cancelled/)
      expect(text, f).not.toMatch(/Cancelled;[^'"`]*['"`],\s*(bad: true|kind: 'error')/)
    }
  })

  it('the signing forms use the shared line', () => {
    for (const f of ['components/ActionForm.tsx', 'components/DeployDialog.tsx', 'components/AccountDialogs.tsx', 'components/MoreDialogs.tsx']) {
      expect(src(f), f).toContain('outcomeLine(r, ')
    }
    // Deploy shows the inspector of the failed transaction and no second copy of its text.
    expect(src('components/DeployDialog.tsx')).not.toContain('setError(r.error)')
    expect(src('components/ActionForm.tsx')).not.toContain('setResultNote(r.error)')
    expect(src('components/BuyRamPanel.tsx')).toContain("text: 'Cancelled; nothing was bought.', kind: 'note'")
  })
})

describe('the confirmation window after a refused send', () => {
  it('adds one line with the node text, one line of at most 300 characters', () => {
    expect(notSentText('account alice has insufficient ram; needs 183035 bytes has 177528 bytes', true)).toBe(
      'Not sent. The node refused the transaction: account alice has insufficient ram; needs 183035 bytes has 177528 bytes'
    )
    const long = notSentText(`first line\nsecond\tline ${'x'.repeat(1000)}`, true)
    expect(long).not.toMatch(/[\r\n\t]/)
    expect(long.length).toBe('Not sent. The node refused the transaction: '.length + NOT_SENT_MAX)
    expect(oneLine('a\r\n  b')).toBe('a b')
    expect(notSentText('No answer from https://node.example', false)).toBe('Not sent: No answer from https://node.example')
    expect(notSentText(undefined, false)).toBe('Not sent: Failed')
  })

  it('keeps the transaction rows; only a load failure gives the bare page', () => {
    expect(confirmPageKind('Nothing to confirm.', false)).toBe('bare')
    expect(confirmPageKind('', false)).toBe('loading')
    expect(confirmPageKind('', true)).toBe('transaction')
    const page = src('confirm/main.tsx')
    const confirm = page.slice(page.indexOf('function Confirm()'), page.indexOf('function Reveal()'))
    // The send failure is set as a line of the page, not as the bare page's text.
    expect(confirm).toContain("setLoadError('Nothing to confirm.')")
    expect(confirm).toContain('setError(notSentText(r.error, r.refused === true))')
    expect(confirm).not.toMatch(/if \(error\) return/)
    expect(confirm).toMatch(/if \(kind === 'bare'\) return <div className="c-page">\{loadError\}<\/div>/)
    // The rows and the line are in the same page, and Close replaces the buttons.
    const rows = confirm.indexOf('<Row label="Transaction id"')
    const line = confirm.indexOf('{error && <div className="error-text">{error}</div>}')
    expect(rows).toBeGreaterThan(0)
    expect(line).toBeGreaterThan(rows)
    expect(confirm).toMatch(/state === 'failed' \|\| state === 'done' \? \(\s*<button className="btn" onClick=\{\(\) => window\.close\(\)\}>\s*Close/)
  })
})
