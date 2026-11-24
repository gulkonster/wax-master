// Copy for the editor page. The clipboard calls belong to the terminal frame,
// so the editor page copies with the browser's own copy command on a
// temporary text field, in response to the user's click.

export function copyText(text: string): Promise<void> {
  const field = document.createElement('textarea')
  field.value = text
  field.setAttribute('readonly', '')
  field.style.position = 'fixed'
  field.style.left = '-10000px'
  field.style.top = '0'
  field.style.userSelect = 'text'
  const previous = document.activeElement as HTMLElement | null
  document.body.appendChild(field)
  try {
    field.select()
    const ok = document.execCommand('copy')
    if (!ok) return Promise.reject(new Error('The text could not be copied.'))
    return Promise.resolve()
  } finally {
    field.remove()
    previous?.focus?.()
  }
}
