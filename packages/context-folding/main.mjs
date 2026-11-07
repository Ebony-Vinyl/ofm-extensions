const URL = 'http://127.0.0.1:19281/enhancements/fold'
function option(ctx, key) {
  const value = ctx.config?.[key]
  if (value !== undefined) return value
  return ctx.manifest?.config?.find(row => row.key === key)?.default
}
export default {
  async onRequest(ctx, body, meta) {
    if (!body || typeof body !== 'object') return body
    const token = await ctx.secrets.get('bridgeToken')
    if (typeof token !== 'string' || token.length < 32) return body
    const project = option(ctx, 'project')
    if (typeof project !== 'string' || !project.trim()) return body
    try {
      const response = await ctx.fetch(URL, {
        method: 'POST', headers: { authorization: 'Bearer ' + token },
        body: { body, meta, project },
      })
      if (!response.ok) return body
      const payload = await response.json()
      return payload?.body && typeof payload.body === 'object' && !Array.isArray(payload.body) ? payload.body : body
    } catch { return body }
  },
}
