/*
Protocol reference: magpie-community/plugins packages/commandcode, revision 7d84184c327c0564cf8aa78e8a04b595348cab8d.
MIT License
Copyright (c) 2026 magpie-community contributors
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
const BASE = 'https://api.commandcode.ai/provider/v1'
function keyOf(value) {
  const key = value?.key
  if (typeof key !== 'string' || !key.trim() || /[\s\u0000-\u001f\u007f]/.test(key) || key.length > 16384) throw new Error('请提供本人有效 API Key')
  return key
}
const headers = key => ({ authorization: 'Bearer ' + key, accept: 'application/json', 'x-api-key': key })
function rowsOf(payload) {
  if (!Array.isArray(payload?.data)) throw new Error('厂商模型目录格式无效')
  return payload.data
}
function wireOf(row) {
  const eps = Array.isArray(row.supported_endpoints) ? row.supported_endpoints.map(e => String(e).replace(/^\/v1/, '').replace(/\/$/, '')) : []
  return eps.includes('/chat/completions') ? 'chat' : eps.includes('/responses') ? 'responses' : eps.includes('/messages') || /claude/i.test(row.id) ? 'messages' : 'chat'
}
function modelOf(row) {
  return {
    id: row.id, name: typeof row.name === 'string' ? row.name : row.id, wire: wireOf(row),
    ...(Number.isSafeInteger(row.context_length) && row.context_length > 0 ? { contextWindow: row.context_length } : {}),
    ...(Number.isSafeInteger(row.max_output_tokens) && row.max_output_tokens > 0 ? { maxOutput: row.max_output_tokens } : {}),
  }
}
async function catalog(ctx, key) {
  const response = await ctx.fetch(BASE + '/models', { headers: headers(key) })
  if (!response.ok) throw new Error('厂商模型读取失败：' + response.status)
  return rowsOf(await response.json())
}
export default {
  authMethods() { return [{ id: 'api', type: 'api', label: '本人 API Key', fields: [{ key: 'key', label: 'API Key', type: 'password', required: true }] }] },
  async authorize(ctx, inputs = {}) {
    if (inputs.methodId !== 'api') return { status: 'failed' }
    let key
    try { key = keyOf(inputs) } catch { return { status: 'failed' } }
    // The catalog also answers without credentials; validate at the account API.
    const response = await ctx.fetch('https://api.commandcode.ai/alpha/whoami', { headers: headers(key) })
    if (!response.ok) return { status: 'failed' }
    const payload = await response.json()
    const user = payload?.user
    if (!user || typeof user !== 'object' || !(user.id || user.email || user.userName)) return { status: 'failed' }
    await catalog(ctx, key)
    await ctx.auth.set({ type: 'api', key })
    return { status: 'success' }
  },
  async listModels(ctx) {
    const value = await ctx.auth.get()
    if (!value) return []
    return (await catalog(ctx, keyOf(value))).filter(row => typeof row?.id === 'string' && row.id.trim() && row.id.length <= 128).map(modelOf)
  },
  async prepareChat(ctx, req = {}) {
    if (req.wire && !['chat', 'responses', 'messages'].includes(req.wire)) throw new Error('不支持的协议')
    const wire = req.wire || wireOf({ id: req.model })
    return { url: BASE + (wire === 'responses' ? '/responses' : wire === 'messages' ? '/messages' : '/chat/completions'), headers: { ...headers(keyOf(await ctx.auth.get())), ...(wire === 'messages' ? { 'anthropic-version': '2023-06-01' } : {}) }, wire }
  },
}
