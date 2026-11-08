/*
Protocol reference: magpie-community/plugins packages/astudio, revision 7d84184c327c0564cf8aa78e8a04b595348cab8d.
MIT License
Copyright (c) 2026 Pursuit806
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
const BASE = 'https://astronstudio-api-volces-prod.xf-yun.com/model-gateway/v1'
function keyOf(value) {
  const key = value?.key
  if (typeof key !== 'string' || !key.trim() || /[\s\u0000-\u001f\u007f]/.test(key) || key.length > 16384) throw new Error('请提供本人有效 API Key')
  return key
}
const headers = key => ({ authorization: 'Bearer ' + key, accept: 'application/json' })
function rowsOf(payload) {
  if (!Array.isArray(payload?.data?.models)) throw new Error('厂商模型目录格式无效')
  return payload.data.models.filter(row => row && row.visibility !== 'hidden' && row.supported_in_api !== false).map(row => ({ ...row, id: row.slug }))
}
function wireOf() { return 'responses' }
function modelOf(row) {
  return {
    id: row.id, name: typeof row.display_name === 'string' ? row.display_name : row.id, wire: wireOf(row),
    vision: Array.isArray(row.input_modalities) && row.input_modalities.includes('image'),
    reasoning: Array.isArray(row.supported_reasoning_levels) && row.supported_reasoning_levels.some(level => typeof level?.effort === 'string' && level.effort.trim() && level.effort !== 'none'),
    ...(Number.isSafeInteger(row.context_window) && row.context_window > 0 ? { contextWindow: row.context_window } : {}),
    ...(Number.isSafeInteger(row.max_output_tokens) && row.max_output_tokens > 0 ? { maxOutput: row.max_output_tokens } : {}),
  }
}
async function catalog(ctx, key) {
  const response = await ctx.fetch('https://astronstudio-api-volces-prod.xf-yun.com/api/v1/model-manager/models', { headers: headers(key) })
  if (!response.ok) throw new Error('厂商模型读取失败：' + response.status)
  return rowsOf(await response.json())
}
export default {
  authMethods() { return [{ id: 'api', type: 'api', label: '本人已有 modelBearerToken（无自动续期）', fields: [{ key: 'key', label: 'API Key', type: 'password', required: true }] }] },
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
    if (req.wire && !['responses'].includes(req.wire)) throw new Error('不支持的协议')
    const wire = 'responses'
    return { url: BASE + (wire === 'responses' ? '/responses' : '/chat/completions'), headers: headers(keyOf(await ctx.auth.get())), wire }
  },
}
