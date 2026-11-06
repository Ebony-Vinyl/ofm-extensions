/**
 * model-filter — hide catalog models by substring, fail-open.
 *
 * onModels receives the merged model rows during a list refresh and drops
 * every row whose id or name contains one of the configured (comma-separated,
 * case-insensitive) substrings. The host currently calls onModels only while
 * refreshing the listing — the hook is reserved; see docs/enhancement-api.md.
 * onRequest is a pass-through so the manifest can declare both hooks today.
 */
export default {
  onRequest(ctx, body, meta) {
    return body
  },

  async onModels(ctx, rows, meta) {
    const terms = String(configured(ctx, 'hide') ?? '')
      .split(',')
      .map(term => term.trim().toLowerCase())
      .filter(term => term !== '')
    if (terms.length === 0 || !Array.isArray(rows)) return rows
    return rows.filter(row => {
      if (row === null || typeof row !== 'object') return true
      const haystack = (String(row.id ?? '') + ' ' + String(row.name ?? '')).toLowerCase()
      return !terms.some(term => haystack.includes(term))
    })
  },
}

/** The saved value, or the manifest default while the user has saved none —
 * the host renders defaults in its settings UI but keeps ctx.config empty
 * until the user actually saves. */
function configured(ctx, key) {
  const saved = ctx.config?.[key]
  if (saved !== undefined) return saved
  const field = Array.isArray(ctx.manifest?.config) ? ctx.manifest.config.find(row => row !== null && typeof row === 'object' && row.key === key) : null
  return field !== null && typeof field === 'object' ? field.default : undefined
}
