const URL = 'http://127.0.0.1:19281/enhancements/search'
export default {
  async onRequest(ctx, body, meta) {
    if (!body || typeof body !== 'object') return body
    const rows = meta.wire === 'responses' ? body.input : body.messages
    if (!Array.isArray(rows)) return body
    const user = [...rows].reverse().find(row => row?.role === 'user')
    const text = typeof user?.content === 'string' ? user.content
      : Array.isArray(user?.content) ? user.content.filter(part => ['text', 'input_text'].includes(part?.type)).map(part => part.text).join('\n') : ''
    if (!/^\s*\[search\]/i.test(text)) return body
    const token = await ctx.secrets.get('bridgeToken')
    if (typeof token !== 'string' || token.length < 32) return body
    try {
      const response = await ctx.fetch(URL, {
        method: 'POST', headers: { authorization: 'Bearer ' + token },
        body: { body, meta },
      })
      if (!response.ok) return body
      const payload = await response.json()
      return payload?.body && typeof payload.body === 'object' && !Array.isArray(payload.body) ? payload.body : body
    } catch { return body }
  },
}
