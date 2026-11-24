// Result of "Save All" before the app quits or switches project.

export interface SaveFailure {
  title: string
  error: string
}

export interface SaveAllResult {
  failed: SaveFailure[]
}

/** One line per file that was not saved, for a toast. */
export function failureText(failed: SaveFailure[]): string {
  return failed.map((f) => `${f.title}: ${f.error}`).join('\n')
}
