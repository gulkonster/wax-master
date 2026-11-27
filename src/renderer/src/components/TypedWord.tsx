// E73: the word a delete action asks for, with a copy button next to it, and
// the field it is typed or pasted into. The action's button works as soon as
// the field holds the word; nothing else is asked after it.

import { useState } from 'react'
import { copyText } from '../lib/clipboard'
import { IconCheck, IconCopy } from './Icons'

/** True when the field holds exactly the word. */
export function typedWordMatches(typed: string, word: string): boolean {
  return typed === word
}

export function TypedWord({
  word,
  value,
  onChange,
  before = 'Type',
  after = 'to confirm',
  onEnter,
  mono
}: {
  word: string
  value: string
  onChange: (v: string) => void
  before?: React.ReactNode
  after?: React.ReactNode
  onEnter?: () => void
  mono?: boolean
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const copy = (): void => {
    setError('')
    // A plain copy: the word is not a secret, so the clipboard is not cleared afterwards.
    copyText(word).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      },
      (e) => setError(e instanceof Error ? e.message : String(e))
    )
  }
  return (
    <div className="field typed-word">
      <label>
        {before} <b className={mono ? 'mono' : undefined}>{word}</b>{' '}
        <button type="button" className="icon-btn small typed-word-copy" title={`Copy "${word}"`} aria-label={`Copy ${word}`} onClick={copy}>
          {copied ? <IconCheck size="xs" /> : <IconCopy size="xs" />}
        </button>{' '}
        {after}
      </label>
      <input
        className={`input${mono ? ' mono' : ''}`}
        spellCheck={false}
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && typedWordMatches(value, word) && onEnter?.()}
      />
      {error && <div className="error-text">{error}</div>}
    </div>
  )
}
