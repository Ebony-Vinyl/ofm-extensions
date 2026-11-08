/*
Protocol reference: magpie-community/plugins packages/copilot, revision 7d84184c327c0564cf8aa78e8a04b595348cab8d.
MIT License
Copyright (c) 2025 SST
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
// OFM identifies itself, never as VS Code or a first-party Copilot client.
const HEADERS = { 'User-Agent': 'OFM-Native-Extension/1.0' }
function clientId(value) { return typeof value === 'string' && /^[A-Za-z0-9_.-]{3,128}$/.test(value) }
async function json(ctx, url, init) {
  const response = await ctx.fetch(url, init)
  if (!response.ok) throw new Error('GitHub 请求失败：' + response.status)
  return response.json()
}
async function token(ctx) {
  const account = await ctx.auth.get()
  if (!account?.refresh) throw new Error('请先完成 GitHub 设备码登录')
  if (account.access && account.expires > Date.now() + 60000) return account.access
  const renewed = await ctx.auth.refresh()
  if (!renewed?.access || renewed.expires <= Date.now()) throw new Error('Copilot 续期未完成')
  return renewed.access
}
export default {
  async refreshAuth(ctx, account) {
    if (typeof account?.refresh !== 'string' || !account.refresh || /[\s\u0000-\u001f\u007f]/.test(account.refresh)) throw new Error('请先完成 GitHub 设备码登录')
    const data = await json(ctx, 'https://api.github.com/copilot_internal/v2/token', {
      headers: { ...HEADERS, accept: 'application/json', authorization: 'Bearer ' + account.refresh },
    })
    if (typeof data.token !== 'string' || !data.token || /[\s\u0000-\u001f\u007f]/.test(data.token) || !Number.isFinite(data.expires_at) || data.expires_at * 1000 <= Date.now()) throw new Error('Copilot 令牌格式无效')
    return { ...account, access: data.token, expires: data.expires_at * 1000 }
  },
  authMethods() { return [{ id: 'github-device', type: 'oauth', label: '本人获授权 GitHub OAuth App 的设备码（需 Copilot 权限）', fields: [
    { key: 'clientId', label: '本人获授权 OAuth App Client ID', type: 'text', required: true },
  ] }] },
  async authorize(ctx, inputs = {}) {
    if (inputs.methodId !== 'github-device' || !clientId(inputs.clientId)) return { status: 'failed' }
    const data = await json(ctx, 'https://github.com/login/device/code', {
      method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json', ...HEADERS },
      body: { client_id: inputs.clientId, scope: 'read:user' },
    })
    if (typeof data.device_code !== 'string' || !data.device_code || typeof data.user_code !== 'string' || !data.user_code || data.verification_uri !== 'https://github.com/login/device') throw new Error('设备码响应无效')
    if (!Number.isFinite(data.expires_in) || data.expires_in <= 0) throw new Error('设备码有效期无效')
    const interval = Number.isFinite(data.interval) && data.interval > 0 ? data.interval : 5
    return { status: 'pending', url: data.verification_uri, userCode: data.user_code, interval,
      state: { clientId: inputs.clientId, deviceCode: data.device_code, interval, expires: Date.now() + data.expires_in * 1000 } }
  },
  async pollAuthorization(ctx, state) {
    if (!state || !clientId(state.clientId) || typeof state.deviceCode !== 'string' || !state.deviceCode || !Number.isFinite(state.expires) || Date.now() >= state.expires) return { status: 'failed' }
    const data = await json(ctx, 'https://github.com/login/oauth/access_token', {
      method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json', ...HEADERS },
      body: { client_id: state.clientId, device_code: state.deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' },
    })
    if (['authorization_pending','slow_down'].includes(data.error)) {
      const previous = Number.isFinite(state.interval) && state.interval > 0 ? state.interval : 5
      const interval = previous + (data.error === 'slow_down' ? 5 : 0)
      return { status: 'pending', interval, state: { ...state, interval } }
    }
    if (typeof data.access_token !== 'string' || !data.access_token || /[\s\u0000-\u001f\u007f]/.test(data.access_token)) return { status: 'failed' }
    await ctx.auth.set({ type: 'oauth', refresh: data.access_token, expires: 0 })
    return { status: 'success' }
  },
  async listModels(ctx) {
    if (!(await ctx.auth.get())) return []
    const payload = await json(ctx, 'https://api.githubcopilot.com/models', { headers: { ...HEADERS, authorization: 'Bearer ' + await token(ctx) } })
    if (!Array.isArray(payload?.data)) throw new Error('Copilot 模型目录格式无效')
    return payload.data.filter(row => typeof row?.id === 'string' && row.id && row.id.length <= 128 && row.model_picker_enabled !== false).map(row => ({
      id: row.id, name: row.name || row.id,
      wire: Array.isArray(row.supported_endpoints) && row.supported_endpoints.includes('/responses') ? 'responses'
        : Array.isArray(row.supported_endpoints) && row.supported_endpoints.some(value => ['/v1/messages','/messages'].includes(value)) ? 'messages' : 'chat',
      ...(Number.isSafeInteger(row.capabilities?.limits?.max_context_window_tokens) ? { contextWindow: row.capabilities.limits.max_context_window_tokens } : {}),
      ...(Number.isSafeInteger(row.capabilities?.limits?.max_output_tokens) ? { maxOutput: row.capabilities.limits.max_output_tokens } : {}),
      vision: row.capabilities?.supports?.vision === true,
    }))
  },
  async prepareChat(ctx, req = {}) {
    if (req.wire && !['chat', 'responses', 'messages'].includes(req.wire)) throw new Error('不支持的协议')
    const wire = req.wire || 'chat'
    return { url: 'https://api.githubcopilot.com' + (wire === 'responses' ? '/responses' : wire === 'messages' ? '/v1/messages' : '/chat/completions'), wire,
      headers: { ...HEADERS, authorization: 'Bearer ' + await token(ctx), ...(wire === 'messages' ? { 'anthropic-version': '2023-06-01' } : {}) } }
  },
}
