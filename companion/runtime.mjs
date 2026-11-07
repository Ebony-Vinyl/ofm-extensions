import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// This companion is a separately launched, trusted local program. Reviewed
// provider code runs here; it is never evaluated in an OFM extension sandbox.
export async function loadProvider(entry) {
  const root = path.resolve(entry.root)
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
  const relative = pkg.exports?.['./server'] ?? pkg.main ?? (typeof pkg.exports === 'string' ? pkg.exports : pkg.exports?.['.']) ?? 'index.mjs'
  if (typeof relative !== 'string') throw new Error('插件入口必须是文件路径')
  const file = path.resolve(root, relative)
  if (!file.startsWith(root + path.sep)) throw new Error('插件入口越界')
  const mod = await import(pathToFileURL(file).href)
  const functions = mod.default?.server ? [mod.default.server]
    : [...new Set([...(typeof mod.default === 'function' ? [mod.default] : []), ...Object.entries(mod).filter(([name, value]) => typeof value === 'function' && (name === 'server' || /Plugin$/.test(name))).map(([, value]) => value)])]
  if (!functions.length) throw new Error('插件未导出 OpenCode provider 入口')
  const config = { provider: {} }
  let hooks
  for (const fn of functions) {
    const current = await fn({ directory: entry.project ?? root }, entry.options ?? {})
    if (typeof current?.config === 'function') await current.config(config)
    if (current?.auth?.provider === entry.provider) hooks = current
  }
  if (!hooks) throw new Error('插件没有声明所配置的供应商')
  const provider = config.provider[entry.provider]
  if (!provider) throw new Error('插件没有提供供应商模型配置')
  const auth = () => entry.auth ?? null
  async function saveAuth(value) {
    if (!value || typeof value !== 'object' || !['api','oauth'].includes(value.type)) throw new Error('登录没有返回有效凭据')
    await entry.saveAuth?.(value)
    entry.auth = value
  }
  const max = Number.isInteger(hooks.auth.maxConcurrency) && hooks.auth.maxConcurrency > 0 ? hooks.auth.maxConcurrency : Infinity
  let active = 0
  const waiting = []
  function acquire(signal) {
    signal?.throwIfAborted()
    return new Promise((resolve, reject) => {
      const item = { grant() {
        signal?.removeEventListener('abort', abort)
        active++
        let held = true
        resolve(() => {
          if (!held) return
          held = false
          active--
          waiting.shift()?.grant()
        })
      } }
      const abort = () => {
        const index = waiting.indexOf(item)
        if (index >= 0) waiting.splice(index, 1)
        reject(signal.reason)
      }
      if (active < max) item.grant()
      else { waiting.push(item); signal?.addEventListener('abort', abort, { once: true }) }
    })
  }
  async function holdResponse(operation, signal) {
    const release = await acquire(signal)
    const finish = () => { signal?.removeEventListener('abort', finish); release() }
    signal?.addEventListener('abort', finish, { once: true })
    try {
      signal?.throwIfAborted()
      const response = await operation()
      if (!response.body) { finish(); return response }
      const reader = response.body.getReader()
      return new Response(new ReadableStream({
        async pull(controller) {
          try {
            const { value, done } = await reader.read()
            if (done) { finish(); controller.close() }
            else controller.enqueue(value)
          } catch (error) { finish(); controller.error(error) }
        },
        async cancel(reason) { try { await reader.cancel(reason) } finally { finish() } },
      }), { status:response.status, statusText:response.statusText, headers:response.headers })
    } catch (error) { finish(); throw error }
  }
  let refreshing
  async function freshAuth() {
    const current = auth()
    if (typeof hooks.auth.refresh !== 'function' || !Number.isFinite(current?.expires)) return
    const lead = Number.isFinite(hooks.auth.refreshLead) ? hooks.auth.refreshLead : 0
    if (current.expires > Date.now() + lead) return
    if (!refreshing) {
      refreshing = Promise.resolve().then(async () => {
        const renewed = await hooks.auth.refresh(current)
        if (!renewed || typeof renewed !== 'object') throw new Error('凭据续期没有返回结果')
        await saveAuth({ ...current, ...renewed, type: current.type })
      }).finally(() => { refreshing = undefined })
    }
    await refreshing
  }
  return {
    methods() {
      return (hooks.auth.methods ?? []).map((method, index) => ({ index, type: method.type, label: method.label, prompts: method.prompts ?? [] }))
    },
    async login(methodIndex, inputs, interact) {
      const method = hooks.auth.methods?.[methodIndex]
      if (!method) throw new Error('无效登录方式')
      if (method.type === 'api' && typeof method.authorize !== 'function') {
        const key = inputs.key ?? await interact({ prompt: 'API Key' })
        if (typeof key !== 'string' || !key.trim()) throw new Error('API Key 不能为空')
        await saveAuth({ type: 'api', key })
        return
      }
      if (typeof method.authorize !== 'function') throw new Error('该方式没有登录入口')
      inputs = { ...inputs }
      const ask = async prompt => {
        if (!prompt?.key) throw new Error('登录问题缺少字段名')
        if (inputs[prompt.key] === undefined) inputs[prompt.key] = await interact({ prompt: prompt.message ?? prompt.label ?? prompt.key, options: prompt.options })
        const problem = typeof prompt.validate === 'function' ? await prompt.validate(inputs[prompt.key]) : undefined
        if (problem) throw new Error(String(problem))
      }
      if (typeof method.ask === 'function') {
        for (let count = 0; ; count++) {
          const prompt = await method.ask(inputs)
          if (!prompt) break
          if (count >= 12 || inputs[prompt.key] !== undefined) throw new Error('登录问题未能推进')
          await ask(prompt)
        }
      } else for (const prompt of method.prompts ?? []) await ask(prompt)
      if (method.type === 'api' && !inputs.key) inputs.key = await interact({ prompt: 'API Key' })
      const authorization = await method.authorize(inputs)
      if (authorization?.url || authorization?.instructions) await interact(authorization)
      let result = authorization
      if (typeof authorization?.callback === 'function') {
        const code = authorization.method === 'code' ? await interact({ prompt: '授权码' }) : undefined
        result = await authorization.callback(code)
      }
      if (result?.type !== 'success') throw new Error('上游未确认登录成功')
      const value = result.key !== undefined || method.type === 'api'
        ? { ...result, type: 'api', key: result.key ?? inputs.key }
        : { ...result, type: 'oauth' }
      await saveAuth(value)
    },
    async models() {
      await freshAuth()
      const rows = typeof hooks.provider?.models === 'function'
        ? await hooks.provider.models(provider, { auth: auth() }) : provider.models
      const models = Array.isArray(rows) ? rows : Object.entries(rows ?? {}).map(([id, row]) => ({ id, ...row }))
      return models.filter(row => typeof row?.id === 'string').map(row => ({
        id: row.id, name: row.name ?? row.id,
        contextWindow: row.limit?.context, maxOutput: row.limit?.output,
        vision: row.modalities?.input?.includes('image') === true,
        reasoning: row.reasoning === true, wire: 'chat',
      }))
    },
    async complete(body, { signal, sessionId } = {}) {
      signal?.throwIfAborted()
      if (!body || typeof body !== 'object' || typeof body.model !== 'string') throw new Error('缺少模型')
      return holdResponse(async () => {
        await freshAuth()
        signal?.throwIfAborted()
        const loader = await hooks.auth.loader(auth, provider) ?? {}
        const base = loader.baseURL ?? provider.api
        const url = new URL(String(base).replace(/\/+$/, '') + '/chat/completions')
        if (!['https:', 'http:'].includes(url.protocol)) throw new Error('无效上游地址')
        const headers = { 'content-type': 'application/json', ...loader.headers }
        const key = loader.apiKey ?? (auth()?.type === 'api' ? auth().key : undefined)
        if (key) headers.authorization = 'Bearer ' + key
        if (typeof hooks['chat.headers'] === 'function') {
          const output = { headers: {} }
          await hooks['chat.headers']({ sessionID: sessionId ?? '', model: { id: body.model, providerID: entry.provider }, provider: { info: provider } }, output)
          Object.assign(headers, output.headers)
        }
        const fetcher = typeof loader.fetch === 'function' ? loader.fetch : fetch
        signal?.throwIfAborted()
        return fetcher(url.href, { method: 'POST', headers, body: JSON.stringify(body), signal, redirect: 'error' })
      }, signal)
    },
    async usage() {
      if (typeof hooks.auth.usage === 'function') return hooks.auth.usage(auth)
      return typeof hooks.usage === 'function' ? hooks.usage() : null
    },
  }
}
