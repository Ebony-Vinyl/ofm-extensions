import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { fileURLToPath, pathToFileURL } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
// Opt-in to the real OFM native-auth host worktree, never a downloaded plugin.
// All vendor origins are replaced ONLY inside temporary fixture copies. The
// server below is local, uses synthetic credentials, and never calls upstream.
const hostRoot = process.env.OFM_NATIVE_HOST_ROOT
const ids = (await fs.readdir(path.join(root, 'packages'))).filter(id => id.startsWith('native-'))
test('native providers through real OFM Worker: forms, scoped accounts and all wire bodies', { skip: !hostRoot, timeout: 120000 }, async () => {
  const { createExtensionRuntime } = await import(pathToFileURL(path.join(hostRoot, 'src/extensions.js')).href)
  const temp = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'ofm-native-fixtures-'))
  let runtime
  const requests = []
  let copilotPolls = 0
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = raw ? JSON.parse(raw) : undefined
    requests.push({ url: req.url, headers: req.headers, body })
    res.setHeader('content-type', 'application/json')
    let result
    if (req.url.endsWith('/device/code')) result = { device_code: 'SYNTHETIC-DEVICE', user_code: 'SYNTHETIC-PUBLIC', verification_uri: 'https://github.com/login/device', expires_in: 600, interval: 13 }
    else if (req.url.endsWith('/access_token')) result = ++copilotPolls <= 3 ? { error: copilotPolls === 3 ? 'authorization_pending' : 'slow_down' } : { access_token: 'SYNTHETIC-OAUTH' }
    else if (req.url.endsWith('/v2/token')) result = { token: 'SYNTHETIC-COPILOT', expires_at: Math.floor(Date.now() / 1000) + 3600 }
    else if (req.url.endsWith('/users/me')) result = { success: true, data: { subject: 'sub1' } }
    else if (req.url.endsWith('/alpha/whoami')) result = { user: { id: 'synthetic-user' } }
    else if (req.url.endsWith('/theos')) result = { enabled: true, balance: '0', granted: '0', lane_version: 2 }
    else if (req.url.includes('/ai/models/search')) result = { success: true, result: [{ name: '@cf/text', task: { name: 'Text Generation' } }] }
    else if (req.url.endsWith('/api/v1/model-manager/models')) result = { data: { models: [
      { slug: 'response', context_window: 8192, input_modalities: ['text', 'image'], supported_reasoning_levels: [{ effort: 'none' }, { effort: 'high' }] },
      { slug: 'no-thinking', input_modalities: ['text'], supported_reasoning_levels: [{ effort: 'none' }] },
    ] } }
    else if (req.url.endsWith('/ai/cline/models')) result = { data: [
      { id: 'inclusionai/ling-3.1-flash', context_length: '262144' },
      { id: 'only/top', top_provider: { context_length: 200000 } },
    ] }
    else if (req.url.endsWith('/river/v1/models')) result = { data: [{ id: 'moonshotai/Kimi-K3' }, { id: 'deepseek-ai/DeepSeek-V4.1-Flash' }, { id: 'unknown/model' }] }
    else if (req.url.endsWith('/inkstone/v1/models')) result = { data: [
      { id: 'image-thinking', input_modalities: ['text', 'image'], supported_features: ['reasoning', 'tools'] },
      { id: 'no-thinking', input_modalities: ['text'], supported_features: ['tools'] },
    ] }
    else if (req.url.endsWith('/deepai_code/models')) result = { models: [{ id: 'chat' }, { id: 'response', api: 'openai-responses' }] }
    else result = { data: [
      { id: 'chat', supported_endpoints: ['/chat/completions'] },
      { id: 'response', supported_endpoints: ['/responses'] },
      { id: 'claude', supported_endpoints: ['/messages'] },
      { id: 'deepseek-v4-pro' }, { id: 'glm-5.3-flash' },
    ] }
    res.end(JSON.stringify(result))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = 'http://127.0.0.1:' + server.address().port
  try {
    runtime = createExtensionRuntime({ dataDir: path.join(temp, 'host'), hostVersion: '2.8.2', logger: { warn(...args) { console.error(...args) } } })
    for (const id of ids) {
      const src = path.join(root, 'packages', id), dst = path.join(temp, id)
      const manifest = JSON.parse(await fs.readFile(path.join(src, 'ofm-plugin.json'), 'utf8'))
      let source = await fs.readFile(path.join(src, 'main.mjs'), 'utf8')
      for (const vendor of manifest.permissions.network) source = source.split(vendor).join(origin)
      if (id === 'native-river') source = source.replace(origin + '/v1', origin + '/river/v1')
      if (id === 'native-inkstone') source = source.replace(origin + '/v1', origin + '/inkstone/v1')
      if (id === 'native-copilot') source = source.replace("data.verification_uri !== '" + origin + "/login/device'", "data.verification_uri !== 'https://github.com/login/device'")
      manifest.permissions.network = id === 'native-copilot' ? [origin, 'https://github.com'] : [origin]
      assert.deepEqual(manifest.files, ['main.mjs'], id + ' ships an installable native manifest')
      await fs.mkdir(dst); await fs.writeFile(path.join(dst, 'ofm-plugin.json'), JSON.stringify(manifest)); await fs.writeFile(path.join(dst, 'main.mjs'), source)
      await runtime.installLocal({ path: dst, acknowledgeUnsigned: true })
      const methods = await runtime.channelAuthentication(id, 'methods')
      assert.ok(methods[0].fields.length > 0, id)
      const isCopilot = id === 'native-copilot'
      const inputs = isCopilot ? { methodId: 'github-device', clientId: 'SYNTHETIC-OWN-APP' }
        : { methodId: 'api', key: 'SYNTHETIC-' + id, accountId: 'a'.repeat(32), machineFingerprint: 'b'.repeat(64) }
      const first = await runtime.channelAuthentication(id, 'authorize', { inputs })
      if (isCopilot) {
        assert.ok(first.flowId); assert.equal(first.state, undefined); assert.doesNotMatch(JSON.stringify(first), /SYNTHETIC-DEVICE/)
        assert.equal(first.interval, 13)
        for (const interval of [18, 23, 23]) {
          const pending = await runtime.channelAuthentication(id, 'poll', { flowId: first.flowId })
          assert.equal(pending.status, 'pending'); assert.equal(pending.interval, interval); assert.equal(pending.state, undefined)
        }
        assert.equal((await runtime.channelAuthentication(id, 'poll', { flowId: first.flowId })).status, 'success')
      } else assert.equal(first.status, 'success', id)
      const status = await runtime.channelAuthentication(id, 'status')
      assert.doesNotMatch(JSON.stringify(status), /SYNTHETIC-(?:OAUTH|COPILOT|native-)/)
      const entries = runtime.catalog.filter(entry => entry.extensionId === id)
      assert.ok(entries.length > 0, id + ' must supply models after authorization')
      // runtime.catalog is built by the real host buildExtensionCatalog, not an
      // adapter-shaped assertion. Check capability false as well as true so the
      // host's default reasoning:true/vision:false cannot hide a missing field.
      const model = modelId => { const entry = entries.find(row => row.modelId === modelId); assert.ok(entry, id + '/' + modelId); return entry }
      if (id === 'native-cline') {
        assert.equal(model('inclusionai/ling-3.1-flash').contextWindow, 262144)
        assert.equal(model('only/top').contextWindow, 200000)
      }
      if (id === 'native-astudio') {
        assert.equal(model('response').vision, true); assert.equal(model('response').reasoning, true)
        assert.equal(model('no-thinking').vision, false); assert.equal(model('no-thinking').reasoning, false)
      }
      if (id === 'native-inkstone') {
        assert.equal(model('image-thinking').vision, true); assert.equal(model('image-thinking').reasoning, true)
        assert.equal(model('no-thinking').vision, false); assert.equal(model('no-thinking').reasoning, false)
      }
      if (id === 'native-river') {
        assert.equal(entries.length, 3)
        assert.equal(model('moonshotai/Kimi-K3').contextWindow, 1048576); assert.equal(model('moonshotai/Kimi-K3').maxOutput, 32768)
        assert.equal(model('deepseek-ai/DeepSeek-V4.1-Flash').maxOutput, 384000)
        assert.equal(model('moonshotai/Kimi-K3').vision, true); assert.equal(model('moonshotai/Kimi-K3').reasoning, true)
        assert.equal(model('unknown/model').vision, false); assert.equal(model('unknown/model').reasoning, false)
        assert.equal(model('unknown/model').contextWindow, 131072); assert.equal(model('unknown/model').maxOutput, 32768)
      }
      for (const entry of entries) {
        const wire = entry.wire || 'chat'
        const body = wire === 'responses' ? { input: [{ role: 'user', content: 'SYNTHETIC' }], max_output_tokens: 17 }
          : wire === 'messages' ? { messages: [{ role: 'user', content: 'SYNTHETIC' }], system: 'SYNTHETIC-SYSTEM', max_tokens: 17 }
            : { messages: [{ role: 'user', content: 'SYNTHETIC' }], max_tokens: 17, tools: [{ type: 'function', function: { name: 'synthetic', parameters: { type: 'object' } } }] }
        const out = await runtime.prepareChat(entry, body, 'synthetic-session')
        assert.equal(new URL(out.url).origin, origin); assert.equal(out.wire, wire)
        const built = JSON.parse(out.body)
        assert.equal(built.model, entry.modelId); assert.equal(built.stream, true)
        for (const [key, value] of Object.entries(body)) assert.deepEqual(built[key], value, id + ': preserve ' + wire + ' ' + key)
        assert.equal(built.key, undefined); assert.equal(built.machineFingerprint, undefined)
        if (wire === 'chat') assert.deepEqual(built.stream_options, { include_usage: true })
        const pathname = new URL(out.url).pathname
        assert.ok(pathname.endsWith(wire === 'responses' ? '/responses' : wire === 'messages' ? '/messages' : '/chat/completions'), id)
      }
      if (!isCopilot) {
        assert.equal((await runtime.channelAuthentication(id, 'authorize', { accountId: 'second', inputs: { ...inputs, key: 'SYNTHETIC-SECOND' } })).status, 'success')
        await runtime.channelAuthentication(id, 'select', { accountId: 'second' })
        const entry = runtime.catalog.find(entry => entry.extensionId === id)
        const out = await runtime.prepareChat(entry, { messages: [] }, 'synthetic-session')
        assert.equal(out.headers.authorization || out.headers['api-key'], id === 'native-deepai-code' ? 'SYNTHETIC-SECOND' : 'Bearer SYNTHETIC-SECOND')
        await runtime.channelAuthentication(id, 'logout', { accountId: 'second' })
        await runtime.channelAuthentication(id, 'select', { accountId: 'default' })
        const restored = await runtime.prepareChat(runtime.catalog.find(entry => entry.extensionId === id), { messages: [] }, 'synthetic-session')
        assert.equal(restored.headers.authorization || restored.headers['api-key'], id === 'native-deepai-code' ? inputs.key : 'Bearer ' + inputs.key)
      }
      await runtime.channelAuthentication(id, 'logout')
      assert.equal(runtime.catalog.some(entry => entry.extensionId === id), false)
    }
    assert.ok(requests.length > 0)
    assert.ok(requests.every(req => req.headers.host === new URL(origin).host))
    for (const req of requests) assert.equal(req.headers['editor-version'], undefined)
  } finally {
    await runtime?.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
    await fs.rm(temp, { recursive: true, force: true })
  }
})
