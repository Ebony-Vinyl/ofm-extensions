const ORIGIN = 'http://127.0.0.1:19281'
const PROVIDER = 'ai-studio'
async function credentials(ctx) {
  const token = await ctx.secrets.get('bridgeToken')
  if (typeof token !== 'string' || token.length < 32) throw new Error('请先配置社区桥并保存 bridgeToken')
  return { authorization: 'Bearer ' + token }
}
export default {
  async listModels(ctx) {
    const response = await ctx.fetch(ORIGIN + '/providers/' + PROVIDER + '/models', { headers: await credentials(ctx) })
    if (!response.ok) throw new Error('社区桥模型读取失败（HTTP ' + response.status + '）')
    const payload = await response.json()
    if (!Array.isArray(payload?.data)) throw new Error('社区桥模型格式无效')
    return payload.data.filter(row => row && typeof row.id === 'string')
  },
  async prepareChat(ctx, req) {
    return {
      url: ORIGIN + '/providers/' + PROVIDER + '/chat/completions',
      headers: { ...await credentials(ctx), 'x-ofm-session': typeof req.sessionId === 'string' ? req.sessionId : '' },
      wire: 'chat',
    }
  },
}
