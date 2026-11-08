/*
Protocol reference: magpie-community/plugins packages/cloudflare-workers-ai, revision 7d84184c327c0564cf8aa78e8a04b595348cab8d.
MIT License
Copyright (c) 2026 Guislabert
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
const BASE = 'https://api.cloudflare.com/client/v4/accounts/'
function valid(value) { return typeof value?.accountId === 'string' && /^[a-f0-9]{32}$/i.test(value.accountId) && typeof value.key === 'string' && value.key.length > 0 && value.key.length <= 16384 && !/[\s\u0000-\u001f\u007f]/.test(value.key) }
async function account(ctx) {
  const value = await ctx.auth.get()
  if (!valid(value)) throw new Error('请先保存本人 Cloudflare Token 和账号 ID')
  return value
}
async function models(ctx, value) {
  const rows = []
  for (let page = 1; page <= 100; page++) {
    const response = await ctx.fetch(BASE + value.accountId + '/ai/models/search?per_page=100&page=' + page, { headers: { authorization: 'Bearer ' + value.key } })
    if (!response.ok) throw new Error('Cloudflare 模型读取失败：' + response.status)
    const payload = await response.json()
    if (payload?.success !== true || !Array.isArray(payload.result)) throw new Error('Cloudflare 模型目录格式无效')
    rows.push(...payload.result)
    if (payload.result.length < 100 || (Number.isFinite(payload.result_info?.total_pages) && page >= payload.result_info.total_pages)) return rows
  }
  throw new Error('Cloudflare 模型目录页数异常')
}
export default {
  authMethods() { return [{ id: 'api', type: 'api', label: 'Cloudflare API Token 与 Account ID', fields: [
    { key: 'key', label: 'API Token', type: 'password', required: true },
    { key: 'accountId', label: 'Cloudflare Account ID（不是 OFM 账号槽）', type: 'text', required: true },
  ] }] },
  async authorize(ctx, inputs = {}) {
    if (inputs.methodId !== 'api' || !valid(inputs)) return { status: 'failed' }
    await models(ctx, inputs)
    await ctx.auth.set({ type: 'api', key: inputs.key, accountId: inputs.accountId })
    return { status: 'success' }
  },
  async listModels(ctx) {
    if (!(await ctx.auth.get())) return []
    return (await models(ctx, await account(ctx))).filter(row => row?.task?.name === 'Text Generation' && typeof row.name === 'string' && row.name.length <= 128).map(row => ({
      id: row.name, name: row.name, wire: 'chat',
    }))
  },
  async prepareChat(ctx, req = {}) {
    if (req.wire && req.wire !== 'chat') throw new Error('不支持的协议')
    const value = await account(ctx)
    return { url: BASE + value.accountId + '/ai/v1/chat/completions', wire: 'chat', headers: { authorization: 'Bearer ' + value.key } }
  },
}
