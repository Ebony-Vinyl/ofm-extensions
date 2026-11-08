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
Protocol facts derived upstream from 2951461586/DeepAICode2API (MIT), not its code.
Unofficial integration; not affiliated with or endorsed by DeepAI or reference authors.
*/
const BASE = 'https://api.deepai.org/deepai_code'
function account(value) {
  if (typeof value?.key !== 'string' || !value.key || value.key.length > 16384 || /[\s\u0000-\u001f\u007f]/.test(value.key)) throw new Error('请提供本人 API Key')
  if (typeof value.machineFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.machineFingerprint)) throw new Error('请提供本人真实设备的 SHA-256 指纹，不得伪造或轮换')
  return value
}
function headers(value, withKey = true) {
  return { accept: 'application/json', 'X-DeepAI-Code-Theos': '2', 'X-DeepAI-Code-Machine': value.machineFingerprint,
    ...(withKey ? { 'Api-Key': value.key } : {}) }
}
export default {
  authMethods() { return [{ id: 'api', type: 'api', label: '本人 Key 与真实设备指纹（验钥可能触发当日设备额度）', fields: [
    { key: 'key', label: 'DeepAI API Key', type: 'password', required: true },
    { key: 'machineFingerprint', label: '本人真实设备标识的 SHA-256；不接受随机/账号派生值', type: 'password', required: true },
  ] }] },
  async authorize(ctx, inputs = {}) {
    if (inputs.methodId !== 'api') return { status: 'failed' }
    let value
    try { value = account(inputs) } catch { return { status: 'failed' } }
    // Models are public and cannot validate a credential. The allowance endpoint can.
    const response = await ctx.fetch(BASE + '/theos', { headers: headers(value) })
    if (!response.ok) return { status: 'failed' }
    const payload = await response.json()
    if (payload?.error || typeof payload?.enabled !== 'boolean' || typeof payload.balance !== 'string' || typeof payload.granted !== 'string' || String(payload.lane_version) !== '2') return { status: 'failed' }
    await ctx.auth.set({ type: 'api', key: value.key, machineFingerprint: value.machineFingerprint })
    return { status: 'success' }
  },
  async listModels(ctx) {
    const saved = await ctx.auth.get()
    if (!saved) return []
    const response = await ctx.fetch(BASE + '/models', { headers: headers(account(saved), false) })
    if (!response.ok) throw new Error('DeepAI 模型读取失败：' + response.status)
    const payload = await response.json()
    if (!Array.isArray(payload?.models)) throw new Error('DeepAI 模型目录格式无效')
    return payload.models.filter(row => typeof row?.id === 'string' && row.id.trim() && row.id.length <= 128 && (!row.api || ['openai', 'openai-chat', 'openai-chat-completions', 'openai-responses'].includes(row.api))).map(row => ({
      id: row.id, name: typeof row.name === 'string' ? row.name : row.id,
      ...(Number.isSafeInteger(row.contextWindow) && row.contextWindow > 0 ? { contextWindow: row.contextWindow } : {}),
      ...(Number.isSafeInteger(row.maxTokens) && row.maxTokens > 0 ? { maxOutput: row.maxTokens } : {}),
      vision: Array.isArray(row.input) && row.input.includes('image'), reasoning: row.reasoning === true,
      wire: row.api === 'openai-responses' ? 'responses' : 'chat',
    }))
  },
  async prepareChat(ctx, req = {}) {
    if (req.wire && !['chat', 'responses'].includes(req.wire)) throw new Error('不支持的协议')
    const outgoing = headers(account(await ctx.auth.get()))
    if (typeof req.sessionId === 'string' && req.sessionId && req.sessionId.length <= 256 && !/[\u0000-\u001f\u007f]/.test(req.sessionId)) outgoing['X-Session-Affinity'] = req.sessionId
    const wire = req.wire || 'chat'
    return { url: BASE + (wire === 'responses' ? '/responses' : '/chat/completions'), headers: outgoing, wire }
  },
}
