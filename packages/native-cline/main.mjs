/*
Protocol reference: magpie-community/plugins packages/cline, revision 7d84184c327c0564cf8aa78e8a04b595348cab8d.
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
const BASE = 'https://api.cline.bot/api/v1'
// Only the caller's formal API key; no borrowed WorkOS client or CLI identity.
function keyOf(value) {
  const key = value?.key
  if (typeof key !== 'string' || !key || key.length > 16384 || /[\s\u0000-\u001f\u007f]/.test(key)) throw new Error('请先保存本人 Cline API Key')
  return key
}
const headers = key => ({ authorization: 'Bearer ' + key, accept: 'application/json' })
function contextOf(row) {
  for (const value of [row.context_length, row.top_provider?.context_length, row.context]) {
    const n = typeof value === 'string' && value.trim() ? Number(value) : value
    if (typeof n === 'number' && Number.isFinite(n) && n > 0 && Number.isSafeInteger(Math.floor(n))) return Math.floor(n)
  }
}
function identified(user) { return [user.id, user.uid, user.clineUserId, user.email, user.subject].some(value => typeof value === 'string' && value.trim()) }
function allowed(id) { return typeof id === 'string' && id.trim() && id.length <= 128 && !/^(cline-free|stealth)\//i.test(id) }
async function catalog(ctx) {
  const response = await ctx.fetch(BASE + '/ai/cline/models', { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error('Cline 模型读取失败：' + response.status)
  const payload = await response.json()
  const rows = Array.isArray(payload) ? payload : payload?.data
  if (!Array.isArray(rows)) throw new Error('Cline 模型目录格式无效')
  return rows.filter(row => allowed(row?.id) && row.free !== true).map(row => ({
    id: row.id, name: row.display_name || row.name || row.id, wire: 'chat',
    ...(contextOf(row) ? { contextWindow: contextOf(row) } : {}),
    vision: Array.isArray(row.architecture?.input_modalities) && row.architecture.input_modalities.includes('image'),
  }))
}
export default {
  authMethods() { return [{ id: 'api', type: 'api', label: '本人 Cline API Key（不支持客户端专享免费模型）', fields: [
    { key: 'key', label: 'app.cline.bot → Settings → API Keys', type: 'password', required: true },
  ] }] },
  async authorize(ctx, inputs = {}) {
    if (inputs.methodId !== 'api') return { status: 'failed' }
    let key
    try { key = keyOf(inputs) } catch { return { status: 'failed' } }
    const response = await ctx.fetch(BASE + '/users/me', { headers: headers(key) })
    if (!response.ok) return { status: 'failed' }
    const payload = await response.json()
    const user = payload?.success === true ? payload.data : payload
    if (payload?.success === false || !user || typeof user !== 'object' || Array.isArray(user) || !identified(user)) return { status: 'failed' }
    await ctx.auth.set({ type: 'api', key })
    return { status: 'success' }
  },
  async listModels(ctx) { if (!(await ctx.auth.get())) return []; return catalog(ctx) },
  async prepareChat(ctx, req = {}) {
    if (req.wire && req.wire !== 'chat') throw new Error('Cline 只支持 Chat 协议')
    if (!allowed(req.model)) throw new Error('不支持此模型；不会伪装 Cline 客户端解锁免费访问')
    return { url: BASE + '/chat/completions', headers: headers(keyOf(await ctx.auth.get())), wire: 'chat' }
  },
}
