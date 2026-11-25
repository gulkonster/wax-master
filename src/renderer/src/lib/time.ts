/** A chain time (UTC without a zone) or an ISO time, in the user's local form. */
export function fmtTime(t: string): string {
  if (!t) return ''
  const d = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(t) ? t : `${t}Z`)
  return Number.isNaN(d.getTime()) ? t : d.toLocaleString()
}
