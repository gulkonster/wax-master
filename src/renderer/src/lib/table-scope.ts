// Contract page table view: which Scope a table gets when another table is picked.
// Kept in the tab's memory only.

/** Scopes the user typed, per table, in one Contract page tab. */
export type TypedScopes = Readonly<Record<string, string>>

/** Records a scope the user typed while `table` is picked (nothing when no table is picked yet). */
export function rememberTypedScope(typed: TypedScopes, table: string, scope: string): TypedScopes {
  return table ? { ...typed, [table]: scope } : typed
}

/**
 * The Scope shown after the table changes from `from` to `to`.
 * The same table, or the first table picked: the field stays as it is.
 * Another table: the scope typed for that table in this tab before, else the contract account.
 */
export function scopeForTable(from: string, to: string, current: string, account: string, typed: TypedScopes): string {
  if (from === '' || from === to) return current
  return Object.prototype.hasOwnProperty.call(typed, to) ? typed[to] : account
}
