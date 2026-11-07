import http from 'node:http'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { timingSafeEqual } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { readConfig, writeConfig } from './config.mjs'
import { loadProvider } from './runtime.mjs'
import { createServices, createArchive } from './services.mjs'

export function createCompanion({ token, providers = [], load = loadProvider, ...config }) {
  if (typeof token !== 'string' || token.length < 32) throw new Error('本地桥密钥至少需要 32 个字符')
  const entries = new Map(providers.map(entry => [entry.id, entry]))
  const loaded = new Map()
  const services = createServices(config)
  const archive = config.dataDir ? createArchive(config.dataDir) : null
  async function readBody(request) {
    const chunks = []
    let size = 0
    for await (const chunk of request) {
      size += chunk.length
      if (size > 8 * 1024 * 1024) throw new Error('请求过大')
      chunks.push(chunk)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  }
  const expected = Buffer.from('Bearer ' + token)
  return http.createServer(async (request, response) => {
    const received = Buffer.from(request.headers.authorization ?? '')
    const send = (status, data) => { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(data)) }
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return send(401, { error: { message: '需要本地桥密钥' } })
    const operationPath = (request.url ?? '').split('?')[0]
    if (operationPath.startsWith('/enhancements/') || operationPath === '/archive/read') {
      if (request.method !== 'POST') return send(405, { error: { message: '无效方法' } })
      const controller = new AbortController()
      const abort = () => controller.abort()
      response.on('close', abort)
      const deadline = setTimeout(() => { abort(); if (!response.headersSent) send(504, { error: { message: '本地增强超时，保留原始请求' } }) }, 1600)
      try {
        const payload = await readBody(request)
        if (operationPath === '/archive/read') {
          if (!archive || !config.projects?.[payload.project] || typeof payload.session !== 'string' || !payload.session) throw new Error('尚未配置归档或授权项目/会话')
          return send(200, { text: await archive.read(JSON.stringify([payload.project, payload.session]), payload.id) })
        }
        const name = operationPath.slice('/enhancements/'.length)
        let body
        if (name === 'search') body = await services.search(payload, controller.signal)
        else if (name === 'compression') body = await services.compress(payload, controller.signal)
        else if (name === 'history') body = await services.recall(payload, controller.signal)
        else if (name === 'fold' && archive) {
          if (!config.projects?.[payload.project]) throw new Error('未授权项目')
          if (typeof payload.meta?.sessionId !== 'string' || !payload.meta.sessionId) throw new Error('缺少会话标识')
          body = await archive.fold(payload.body, payload.meta, JSON.stringify([payload.project, payload.meta.sessionId]))
        } else return send(404, { error: { message: '未知增强服务' } })
        if (!controller.signal.aborted) send(200, { body })
      } catch { if (!response.destroyed && !response.writableEnded) send(502, { error: { message: '本地增强服务不可用，保留原始请求' } }) }
      finally { clearTimeout(deadline); response.off('close', abort) }
      return
    }
    const match = /^\/providers\/([a-z0-9-]+)\/(models|chat\/completions|usage)$/.exec((request.url ?? '').split('?')[0])
    if (!match || !entries.has(match[1])) return send(404, { error: { message: '未知供应商' } })
    const [, id, operation] = match
    if (request.method !== (operation === 'chat/completions' ? 'POST' : 'GET')) return send(405, { error: { message: '无效方法' } })
    const controller = new AbortController()
    const abort = () => { if (!response.writableFinished) controller.abort() }
    response.on('close', abort)
    try {
      if (!loaded.has(id)) {
        const pending = Promise.resolve().then(() => load(entries.get(id)))
        loaded.set(id, pending)
        pending.catch(() => { if (loaded.get(id) === pending) loaded.delete(id) })
      }
      const provider = await loaded.get(id)
      if (controller.signal.aborted) return
      if (operation === 'models') return send(200, { data: await provider.models() })
      if (operation === 'usage') return send(200, await provider.usage())
      let bytes = 0
      const chunks = []
      for await (const chunk of request) {
        bytes += chunk.length
        if (bytes > 8 * 1024 * 1024) return send(413, { error: { message: '请求过大' } })
        chunks.push(chunk)
      }
      let body
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return send(400, { error: { message: 'JSON 无效' } }) }
      const upstream = await provider.complete(body, { signal: controller.signal, sessionId: request.headers['x-ofm-session'] })
      const headers = { 'content-type': upstream.headers.get('content-type') ?? 'text/event-stream', 'cache-control': 'no-store' }
      const retry = upstream.headers.get('retry-after')
      if (retry) headers['retry-after'] = retry
      response.writeHead(upstream.status, headers)
      if (upstream.body) await pipeline(Readable.fromWeb(upstream.body), response, { signal: controller.signal })
      else response.end()
    } catch {
      if (controller.signal.aborted) return
      if (response.headersSent) response.destroy()
      else send(502, { error: { message: '本地供应商桥调用失败，请检查配置与登录状态' } })
    } finally { response.off('close', abort) }
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2]
  if (!file) throw new Error('用法：bun companion/server.mjs /绝对路径/config.json')
  const { config, resolved } = await readConfig(file)
  let saving = Promise.resolve()
  resolved.providers.forEach((entry, index) => {
    entry.saveAuth = value => {
      config.providers[index].auth = value
      saving = saving.catch(() => {}).then(() => writeConfig(file, config))
      return saving
    }
  })
  const server = createCompanion(resolved)
  server.listen(19281, '127.0.0.1', () => console.log('OFM community companion: 127.0.0.1:19281'))
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close())
}
