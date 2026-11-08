/*
Protocol reference: magpie-community/plugins packages/opendesign, revision 7d84184c327c0564cf8aa78e8a04b595348cab8d.
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
const BASE = 'https://amr-link.open-design.ai/v1'
function keyOf(value) {
  const key = value?.key
  if (typeof key !== 'string' || !key.trim() || /[\s\u0000-\u001f\u007f]/.test(key) || key.length > 16384) throw new Error('请提供本人有效 API Key')
  if (key.startsWith('vela_ctrl_')) throw new Error('请使用 runtime key，不是 control key')
  return key
}
const headers = key => ({ authorization: 'Bearer ' + key, accept: 'application/json' })
function rowsOf(payload) {
  if (!Array.isArray(payload?.data)) throw new Error('厂商模型目录格式无效')
  return payload.data
}
function wireOf(row) { return ['claude-haiku-5.5', 'deepseek-v4-pro'].includes(row.id) ? 'responses' : row.id === 'glm-5.3-flash' ? 'messages' : 'chat' }
function modelOf(row) {
  return {
    id: row.id, name: typeof row.name === 'string' ? row.name : row.id, wire: wireOf(row),
    vision: Array.isArray(row.architecture?.input_modalities) && row.architecture.input_modalities.includes('image'),
    ...(Number.isSafeInteger(row.metadata?.context_limit) && row.metadata.context_limit > 0 ? { contextWindow: row.metadata.context_limit } : {}),
    ...(Number.isSafeInteger(row.metadata?.context_budget) && row.metadata.context_budget > 0 ? { maxOutput: row.metadata.context_budget } : {}),
  }
}
async function catalog(ctx, key) {
  const response = await ctx.fetch(BASE + '/models', { headers: headers(key) })
  if (!response.ok) throw new Error('厂商模型读取失败：' + response.status)
  return rowsOf(await response.json())
}
export default {
  authMethods() { return [{ id: 'api', type: 'api', label: '本人 runtime API key（非 control key）', fields: [{ key: 'key', label: 'API Key', type: 'password', required: true }] }] },
  async authorize(ctx, inputs = {}) {
    if (inputs.methodId !== 'api') return { status: 'failed' }
    let key
    try { key = keyOf(inputs) } catch { return { status: 'failed' } }
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
