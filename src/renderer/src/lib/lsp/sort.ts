// Completion order: members whose name starts with an underscore (compiler and
// library internals) come after the others.

/** The name a completion item stands for, without clangd's leading marker or spaces. */
function nameOf(item: { label: string; filterText?: string }): string {
  return (item.filterText ?? item.label).replace(/^[\s•]+/, '')
}

export function sortTextFor(item: { label: string; filterText?: string; sortText?: string }): string | undefined {
  if (!nameOf(item).startsWith('_')) return item.sortText
  // The server's own order stays inside the group; 'z' sorts after its digit and letter prefixes.
  return 'z' + (item.sortText ?? item.label)
}
