/*
API adaptation reference: aqiu817/magpie-deepaicode @ e18c6b3bf95a0d79638fd9848da33518dacfa97f
MIT License

Copyright (c) 2026 aqiu817

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
const BASE = 'https://api.deepai.org/deepai_code'
async function headers(ctx) {
  const key = await ctx.secrets.get('apiKey')
  const machine = await ctx.secrets.get('machineFingerprint')
  if (typeof key !== 'string' || !key.trim()) throw new Error('请保存 DeepAI API Key')
  if (typeof machine !== 'string' || !machine.trim()) throw new Error('请保存本人设备实际指纹；扩展不会伪造设备身份')
  return { 'Api-Key': key, 'X-DeepAI-Code-Theos': '2', 'X-DeepAI-Code-Machine': machine }
}
export default {
  async listModels(ctx) {
    const response = await ctx.fetch(BASE + '/models', { headers: await headers(ctx) })
    if (!response.ok) throw new Error('DeepAI 模型读取失败（HTTP ' + response.status + '）')
    const payload = await response.json()
    if (!Array.isArray(payload?.models)) throw new Error('DeepAI 模型目录格式无效')
    return payload.models.filter(row => row && typeof row.id === 'string' && row.id.length > 0 && row.id.length <= 128).map(row => ({
      id: row.id, name: String(row.name ?? row.id),
      ...(Number.isSafeInteger(row.contextWindow) && row.contextWindow > 0 ? { contextWindow: row.contextWindow } : {}),
      ...(Number.isSafeInteger(row.maxTokens) && row.maxTokens > 0 ? { maxOutput: row.maxTokens } : {}),
      vision: Array.isArray(row.input) && row.input.includes('image'), reasoning: row.reasoning === true,
      wire: row.api === 'openai-responses' ? 'responses' : 'chat',
    }))
  },
  async prepareChat(ctx, req) {
    const wire = req.wire === 'responses' ? 'responses' : 'chat'
    const outgoing = await headers(ctx)
    if (typeof req.sessionId === 'string' && req.sessionId) outgoing['X-Session-Affinity'] = req.sessionId
    return { url: BASE + (wire === 'responses' ? '/responses' : '/chat/completions'), headers: outgoing, wire }
  },
}
