/*
API adaptation reference: aqiu817/magpie-amd-cloud @ feb76d9136a74e01b418b7f61f2668b623b6c922
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
const BASE = 'https://developer.amd.com.cn/radeon/api/v1'

async function headers(ctx) {
  const key = await ctx.secrets.get('apiKey')
  if (typeof key !== 'string' || !key.trim()) throw new Error('请先保存 AMD Radeon Cloud API Key')
  return { authorization: 'Bearer ' + key, accept: 'application/json' }
}

function model(row) {
  if (!row || typeof row.id !== 'string' || !row.id.trim() || row.id.length > 128) return null
  const output = row.architecture?.output_modalities
  if (Array.isArray(output) && output.length && !output.includes('text')) return null
  if (Array.isArray(row.supported_parameters) && !row.supported_parameters.length) return null
  const provider = Array.isArray(row.providers) ? row.providers[0] : null
  const context = Number(row.context_length)
  const maxOutput = Number(provider?.max_completion_tokens)
  return {
    id: row.id,
    name: typeof row.name === 'string' ? row.name : row.id,
    ...(Number.isSafeInteger(context) && context > 0 ? { contextWindow: context } : {}),
    ...(Number.isSafeInteger(maxOutput) && maxOutput > 0 ? { maxOutput } : {}),
    vision: Array.isArray(row.architecture?.input_modalities) && row.architecture.input_modalities.includes('image'),
    reasoning: provider?.reasoning === true,
    wire: 'chat',
  }
}

export default {
  async listModels(ctx) {
    const response = await ctx.fetch(BASE + '/models', { headers: await headers(ctx) })
    if (!response.ok) throw new Error('AMD 模型目录读取失败（HTTP ' + response.status + '）')
    const payload = await response.json()
    if (!Array.isArray(payload?.data)) throw new Error('AMD 模型目录格式无效')
    const rows = payload.data.map(model).filter(Boolean)
    const seen = new Set()
    return rows.filter(row => {
      if (seen.has(row.id)) return false
      seen.add(row.id)
      return true
    })
  },
  async prepareChat(ctx) {
    return { url: BASE + '/chat/completions', headers: await headers(ctx), wire: 'chat' }
  },
}
