// Opens the Settings page at one setting (E69: Deploy links to "Build automatically on Deploy").

let pending: string | null = null

/** The element id of a setting on the Settings page. */
export function settingId(key: string): string {
  return `setting-${key}`
}

/** Marks the setting the Settings page scrolls to and focuses when it opens next. */
export function requestSetting(key: string): void {
  pending = key
}

/** The setting asked for, once. */
export function takeRequestedSetting(): string | null {
  const k = pending
  pending = null
  return k
}
