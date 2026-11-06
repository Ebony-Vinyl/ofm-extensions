/**
 * param-override — cap outgoing sampling parameters, fail-open.
 *
 * onRequest clones the body and lowers max_tokens (and the newer
 * max_completion_tokens spelling) to the configured cap when they exceed it;
 * with dropTemperature on, the temperature field is removed entirely. The
 * model id and the stream flag are never touched. Anything the hook throws
 * is swallowed by the host: the body ships unchanged.
 */
export default {
  onRequest(ctx, body, meta) {
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return body
    const next = { ...body }
    const cap = Number(configured(ctx, 'maxTokens'))
    if (Number.isFinite(cap) && cap > 0) {
      if (typeof next.max_tokens === 'number' && next.max_tokens > cap) next.max_tokens = cap
      if (typeof next.max_completion_tokens === 'number' && next.max_completion_tokens > cap) next.max_completion_tokens = cap
    }
    if (configured(ctx, 'dropTemperature') === true) delete next.temperature
    return next
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
