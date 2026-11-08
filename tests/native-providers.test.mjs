import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseManifestStrict, buildRegistryDocument, validatePackage, stripStringsAndComments } from '../scripts/validate.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const plain = x => JSON.parse(JSON.stringify(x))
const reply = data => ({ ok: true, status: 200, json: () => plain(data) })
const ids = (await fs.readdir(path.join(root, 'packages'))).filter(id => id.startsWith('native-'))
async function load(id) {
  const source = await fs.readFile(path.join(root, 'packages', id, 'main.mjs'), 'utf8')
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'packages', id, 'ofm-plugin.json'), 'utf8'))
  const mod = new vm.SourceTextModule(source, { context: vm.createContext({}) })
  await mod.link(() => { throw new Error('No dependencies allowed') }); await mod.evaluate()
  return { api: mod.namespace.default, manifest, source }
}
// The native host supplies JSON values and binds auth to package + selected account.
// There is no process fetch, SDK, storage, other-account accessor or real credential.
function context(manifest, fetcher, saved = null) {
  let account = plain(saved), writes = 0
  const calls = []
  const ctx = {
    config: { accountId: 'synthetic-slot' },
    auth: { get: async () => plain(account), set: async value => { account = plain(value); writes++ } },
    fetch: async (url, init = {}) => {
      assert.ok(manifest.permissions.network.includes(new URL(url).origin), 'origin must be declared')
      assert.equal(new URL(url).username, ''); assert.equal(new URL(url).password, '')
      calls.push({ url, init: plain(init) }); return fetcher(url, plain(init))
    },
  }
  return { ctx, calls, saved: () => account, writes: () => writes, logout: () => { account = null } }
}
for (const id of ids) test(id + ': manifest, native sandbox, auth form and methodId gate', async () => {
  const { api, manifest, source } = await load(id)
  assert.deepEqual(parseManifestStrict(manifest).requires, ['native-auth'])
  assert.equal(manifest.minHost, '2.8.2')
  assert.deepEqual(manifest.files, ['main.mjs'])
  assert.deepEqual(manifest.permissions.secrets, ['account'])
  assert.equal(manifest.permissions.storage, false)
  assert.ok(manifest.permissions.network.every(origin => origin.startsWith('https://') && !/localhost|127\.0\.0\.1/.test(origin)))
  assert.doesNotMatch(stripStringsAndComments(source), /child_process|process|globalThis|require\s*\(/)
  assert.doesNotMatch(source.replace(/\/\*[\s\S]*?\*\//g, ''), /1928[123]|bridgeToken|Editor-Version|Editor-Plugin-Version|Copilot-Integration-Id|sec-ch-ua|X-CLIENT-TYPE|X-CORE-VERSION/)
  const pkg = validatePackage(path.join(root, 'packages', id)); assert.deepEqual(pkg.problems, [])
  assert.deepEqual(buildRegistryDocument({ packages: [pkg], generatedAt: 'fixed' }).plugins[0].requires, ['native-auth'])
  const methods = plain(await api.authMethods())
  assert.ok(methods.length > 0)
  for (const method of methods) {
    assert.ok(method.id && method.label); assert.ok(['api', 'oauth'].includes(method.type)); assert.ok(Array.isArray(method.fields))
    for (const field of method.fields) {
      assert.ok(field.key && field.label); assert.ok(['text', 'password'].includes(field.type)); assert.equal(typeof field.required, 'boolean')
    }
  }
  const f = context(manifest, () => { throw new Error('must not send') })
  for (const inputs of [{}, { methodId: 'not-a-method', key: 'SYNTHETIC' }]) assert.equal((await api.authorize(f.ctx, inputs)).status, 'failed')
  assert.equal(f.writes(), 0); assert.equal(f.calls.length, 0)
  assert.deepEqual(plain(await api.listModels(f.ctx)), [])
  await assert.rejects(api.prepareChat(f.ctx, { model: 'model', wire: 'chat' }))
})
const standard = [
  ['native-river', 'https://api.river.ai/v1', 'chat'],
  ['native-agnes', 'https://apihub.agnes-ai.com/v1', 'chat'],
  ['native-agnes-code', 'https://api-agnes-code.agnes-ai.com/v1', 'chat'],
  ['native-sensenova', 'https://token.sensenova.cn/v1', 'chat'],
  ['native-inkstone', 'https://discovery-api.intern-ai.org.cn/v1', 'chat'],
  ['native-opendesign', 'https://amr-link.open-design.ai/v1', 'chat'],
  ['native-commandcode', 'https://api.commandcode.ai/provider/v1', 'chat'],
  ['native-astudio', 'https://astronstudio-api-volces-prod.xf-yun.com/model-gateway/v1', 'responses'],
]
function catalog(id) {
  if (id === 'native-commandcode') return { user: { id: 'synthetic-user' }, data: [{ id: 'model', context_length: 8192 }] }
  if (id === 'native-astudio') return { data: { models: [{ slug: 'model', context_window: 8192 }, { slug: 'hidden', visibility: 'hidden' }, { slug: 'not-api', supported_in_api: false }] } }
  return { data: [{ id: 'model', context_length: 8192, max_input_tokens: 8192, max_output_tokens: 128, metadata: { context_limit: 8192, context_budget: 128 } }, { id: '' }, null] }
}
for (const [id, base, wire] of standard) {
  test(id + ': authenticates before saving; isolated account credentials and live model list', async () => {
    const { api, manifest } = await load(id)
    const f = context(manifest, () => reply(catalog(id)))
    assert.equal((await api.authorize(f.ctx, { methodId: 'api', key: 'SYNTHETIC-A' })).status, 'success')
    assert.equal(f.writes(), 1)
    const models = plain(await api.listModels(f.ctx)); assert.equal(models[0].id, 'model'); assert.equal(models.length, 1)
    assert.equal(models[0].contextWindow, id === 'native-river' ? undefined : 8192); assert.equal(models[0].wire, wire)
    const prepared = plain(await api.prepareChat(f.ctx, { wire, model: 'model', messages: [{ role: 'user', content: 'SYNTHETIC' }] }))
    assert.equal(prepared.url, base + (wire === 'responses' ? '/responses' : '/chat/completions'))
    assert.equal(prepared.headers.authorization, 'Bearer SYNTHETIC-A')
    assert.equal(prepared.body, undefined, 'host owns the wire body, do not replace it with harness shape')
    assert.equal(prepared.wire, wire)
    if (id === 'native-commandcode') assert.equal(prepared.headers['x-api-key'], 'SYNTHETIC-A')
    const second = context(manifest, () => reply(catalog(id)))
    await api.authorize(second.ctx, { methodId: 'api', key: 'SYNTHETIC-B' })
    assert.equal((await api.prepareChat(second.ctx, { wire, model: 'model' })).headers.authorization, 'Bearer SYNTHETIC-B')
    assert.equal((await api.prepareChat(f.ctx, { wire, model: 'model' })).headers.authorization, 'Bearer SYNTHETIC-A')
    f.logout(); await assert.rejects(api.prepareChat(f.ctx, { wire, model: 'model' }))
    assert.equal((await api.prepareChat(second.ctx, { wire, model: 'model' })).headers.authorization, 'Bearer SYNTHETIC-B')
    const modelURL = id === 'native-astudio' ? 'https://astronstudio-api-volces-prod.xf-yun.com/api/v1/model-manager/models' : base + '/models'
    for (const { url, init } of f.calls) {
      assert.ok(url === modelURL || (id === 'native-commandcode' && url === 'https://api.commandcode.ai/alpha/whoami'))
      assert.equal(init.headers.authorization, 'Bearer SYNTHETIC-A'); assert.equal(new URL(url).search, ''); assert.equal(init.body, undefined)
    }
  })
  test(id + ': refusal, malformed catalog, network failure and header injection never save credentials', async () => {
    const { api, manifest } = await load(id)
    for (const fetcher of [() => ({ ok: false, status: 401 }), () => ({ ok: false, status: 429 }), () => reply({ data: 'not-a-list' }), () => { throw new Error('offline') }]) {
      const f = context(manifest, fetcher, { type: 'api', key: 'EXISTING' })
      let success = false
      try { success = (await api.authorize(f.ctx, { methodId: 'api', key: 'REJECTED' })).status === 'success' } catch {}
      assert.equal(success, false); assert.equal(f.saved().key, 'EXISTING'); assert.equal(f.writes(), 0)
    }
    const f = context(manifest, () => { throw new Error('must not send') })
    for (const key of ['', ' ', 'key\r\nx-bad: yes', 'Bearer key']) assert.equal((await api.authorize(f.ctx, { methodId: 'api', key })).status, 'failed')
    assert.equal(f.calls.length, 0)
  })
}
test('River Responses and per-model OpenDesign/CommandCode wires use exact endpoints without client identity headers', async () => {
  for (const [id, base, cases] of [
    ['native-river', 'https://api.river.ai/v1', [['m', 'responses', '/responses']]],
    ['native-opendesign', 'https://amr-link.open-design.ai/v1', [['deepseek-v4-pro', 'responses', '/responses'], ['claude-haiku-5.5', 'responses', '/responses'], ['glm-5.3-flash', 'messages', '/messages'], ['new-model', 'chat', '/chat/completions']]],
    ['native-commandcode', 'https://api.commandcode.ai/provider/v1', [['m', 'responses', '/responses'], ['claude-sonnet', 'messages', '/messages'], ['m', 'chat', '/chat/completions']]],
  ]) {
    const { api, manifest } = await load(id); const f = context(manifest, () => reply(catalog(id)), { type: 'api', key: 'SYNTHETIC' })
    for (const [model, wire, endpoint] of cases) {
      const req = { model, wire, messages: [{ role: 'user', content: 'x' }], tools: [{ type: 'function' }], maxTokens: 7 }
      const before = plain(req), out = plain(await api.prepareChat(f.ctx, req))
      assert.deepEqual(req, before); assert.equal(out.url, base + endpoint); assert.equal(out.wire, wire); assert.equal(out.body, undefined)
      if (wire === 'messages') assert.equal(out.headers['anthropic-version'], '2023-06-01')
    }
    await assert.rejects(api.prepareChat(f.ctx, { wire: 'invalid' }))
  }
})
test('Copilot authorized own app: device body, pending/slow_down/denied/expiry and token wire endpoints', async () => {
  const { api, manifest } = await load('native-copilot'); let phase = 'pending', renewals = 0
  const f = context(manifest, (url, init) => {
    if (url.endsWith('/device/code')) { assert.deepEqual(init.body, { client_id: 'SYNTHETIC-OWN-APP', scope: 'read:user' }); return reply({ device_code: 'PRIVATE-DEVICE', user_code: 'PUBLIC', verification_uri: 'https://github.com/login/device', expires_in: 600 }) }
    if (url.endsWith('/access_token')) {
      assert.deepEqual(init.body, { client_id: 'SYNTHETIC-OWN-APP', device_code: 'PRIVATE-DEVICE', grant_type: 'urn:ietf:params:oauth:grant-type:device_code' })
      return reply(phase === 'success' ? { access_token: 'PRIVATE-OAUTH' } : { error: phase === 'pending' ? 'authorization_pending' : phase })
    }
    if (url.endsWith('/v2/token')) { renewals++; assert.equal(init.headers.authorization, 'Bearer PRIVATE-OAUTH'); return reply({ token: 'PRIVATE-COPILOT', expires_at: Math.floor(Date.now() / 1000) + 3600 }) }
    if (url.endsWith('/models')) return reply({ data: [{ id: 'gpt', supported_endpoints: ['/responses'] }, { id: 'claude', supported_endpoints: ['/v1/messages'] }, { id: 'chat' }] })
    throw new Error('Unexpected URL')
  })
  f.ctx.auth.refresh = async () => { const next = await api.refreshAuth(f.ctx, await f.ctx.auth.get()); await f.ctx.auth.set(next); return next }
  const start = await api.authorize(f.ctx, { methodId: 'github-device', clientId: 'SYNTHETIC-OWN-APP' })
  assert.equal(start.state.deviceCode, 'PRIVATE-DEVICE'); assert.equal(start.userCode, 'PUBLIC')
  assert.equal(start.state.interval, 5)
  let pending = await api.pollAuthorization(f.ctx, start.state)
  assert.equal(pending.status, 'pending'); assert.equal(pending.state.interval, 5)
  phase = 'slow_down'; pending = await api.pollAuthorization(f.ctx, pending.state); assert.equal(pending.interval, 10)
  pending = await api.pollAuthorization(f.ctx, pending.state); assert.equal(pending.interval, 15); assert.equal(pending.state.interval, 15)
  phase = 'pending'; pending = await api.pollAuthorization(f.ctx, pending.state); assert.equal(pending.interval, 15); assert.equal(pending.state.interval, 15)
  phase = 'access_denied'; assert.equal((await api.pollAuthorization(f.ctx, start.state)).status, 'failed'); assert.equal(f.writes(), 0)
  phase = 'success'; assert.equal((await api.pollAuthorization(f.ctx, start.state)).status, 'success')
  assert.deepEqual(plain(await api.listModels(f.ctx)).map(x => x.wire), ['responses', 'messages', 'chat'])
  for (const [wire, endpoint] of [['chat', '/chat/completions'], ['responses', '/responses'], ['messages', '/v1/messages']]) {
    const prepared = await api.prepareChat(f.ctx, { wire }); assert.equal(prepared.url, 'https://api.githubcopilot.com' + endpoint)
    assert.equal(prepared.headers.authorization, 'Bearer PRIVATE-COPILOT')
  }
  assert.equal(renewals, 1); assert.equal((await api.pollAuthorization(f.ctx, { ...start.state, expires: 0 })).status, 'failed')
  assert.equal((await api.pollAuthorization(f.ctx, {})).status, 'failed')
})
test('Cloudflare pagination is account-scoped, filters non-text and rejects malformed envelopes', async () => {
  const { api, manifest } = await load('native-cloudflare'); let pages = 0
  const f = context(manifest, url => {
    pages++; assert.match(url, /\/accounts\/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\/ai\/models\/search/)
    const page = Number(new URL(url).searchParams.get('page'))
    return reply({ success: true, result: page === 1 ? Array.from({ length: 100 }, (_, i) => ({ name: '@cf/text-' + i, task: { name: 'Text Generation' } })) : [{ name: '@cf/image', task: { name: 'Text-to-Image' } }] })
  })
  await api.authorize(f.ctx, { methodId: 'api', key: 'SYNTHETIC', accountId: 'a'.repeat(32) })
  assert.equal((await api.listModels(f.ctx)).length, 100); assert.equal(pages, 4)
  assert.equal((await api.prepareChat(f.ctx)).url, 'https://api.cloudflare.com/client/v4/accounts/' + 'a'.repeat(32) + '/ai/v1/chat/completions')
  assert.equal((await api.authorize(f.ctx, { methodId: 'api', key: 'BAD', accountId: '../other' })).status, 'failed')
  const bad = context(manifest, () => reply({ success: false, result: [] }))
  await assert.rejects(api.authorize(bad.ctx, { methodId: 'api', key: 'BAD', accountId: 'a'.repeat(32) })); assert.equal(bad.writes(), 0)
})
test('Cline validates own key at user API, excludes restricted free client routes and uses native chat SSE contract', async () => {
  const { api, manifest } = await load('native-cline')
  const f = context(manifest, (url, init) => {
    if (url.endsWith('/users/me')) { assert.equal(init.headers.authorization, 'Bearer OWN-KEY'); return reply({ success: true, data: { id: 'synthetic-user' } }) }
    assert.equal(url, 'https://api.cline.bot/api/v1/ai/cline/models'); assert.equal(init.headers.authorization, undefined)
    return reply({ data: [{ id: 'vendor/paid' }, { id: 'cline-free/not-allowed' }, { id: 'stealth/client-only' }, { id: 'marked', free: true }] })
  })
  assert.equal((await api.authorize(f.ctx, { methodId: 'api', key: 'OWN-KEY' })).status, 'success')
  assert.deepEqual(plain(await api.listModels(f.ctx)).map(x => x.id), ['vendor/paid'])
  const prepared = await api.prepareChat(f.ctx, { model: 'vendor/paid', wire: 'chat' })
  assert.equal(prepared.url, 'https://api.cline.bot/api/v1/chat/completions'); assert.equal(prepared.headers.authorization, 'Bearer OWN-KEY'); assert.equal(prepared.body, undefined)
  for (const model of ['cline-free/no', 'stealth/no']) await assert.rejects(api.prepareChat(f.ctx, { model }))
  const bad = context(manifest, () => reply({ success: false, data: { id: 'not-authenticated' } }))
  assert.equal((await api.authorize(bad.ctx, { methodId: 'api', key: 'BAD' })).status, 'failed'); assert.equal(bad.writes(), 0)
})
test('DeepAI verifies key via theos, not public models; keeps true supplied device fingerprint and Chat/Responses headers', async () => {
  const { api, manifest } = await load('native-deepai-code'); const machine = 'a'.repeat(64)
  const f = context(manifest, (url, init) => {
    assert.equal(init.headers['X-DeepAI-Code-Machine'], machine); assert.equal(init.headers['X-DeepAI-Code-Theos'], '2'); assert.equal(init.headers.authorization, undefined)
    if (url.endsWith('/theos')) { assert.equal(init.headers['Api-Key'], 'OWN-KEY'); return reply({ enabled: true, balance: '0', granted: '0', lane_version: 2 }) }
    assert.ok(url.endsWith('/models')); assert.equal(init.headers['Api-Key'], undefined)
    return reply({ models: [{ id: 'chat', contextWindow: 8192, maxTokens: 128, input: ['text', 'image'], reasoning: true }, { id: 'response', api: 'openai-responses' }] })
  })
  assert.equal((await api.authorize(f.ctx, { methodId: 'api', key: 'OWN-KEY', machineFingerprint: machine })).status, 'success')
  assert.deepEqual(plain(await api.listModels(f.ctx)).map(x => x.wire), ['chat', 'responses'])
  for (const wire of ['chat', 'responses']) {
    const out = await api.prepareChat(f.ctx, { wire, sessionId: 'synthetic-session' })
    assert.equal(out.headers['X-Session-Affinity'], 'synthetic-session'); assert.equal(out.headers['Api-Key'], 'OWN-KEY')
    assert.equal(out.headers['X-DeepAI-Code-Machine'], machine); assert.equal(out.url, 'https://api.deepai.org/deepai_code/' + (wire === 'chat' ? 'chat/completions' : 'responses')); assert.equal(out.body, undefined)
  }
  for (const machineFingerprint of ['', 'random', '../other']) assert.equal((await api.authorize(f.ctx, { methodId: 'api', key: 'BAD', machineFingerprint })).status, 'failed')
  assert.equal((await api.prepareChat(f.ctx, { sessionId: 'bad\r\nx-header: value' })).headers['X-Session-Affinity'], undefined)
  const bad = context(manifest, () => reply({ models: [] }))
  assert.equal((await api.authorize(bad.ctx, { methodId: 'api', key: 'BAD', machineFingerprint: machine })).status, 'failed'); assert.equal(bad.writes(), 0)
})
test('provider-specific catalogs retain wire, limit, modality and filtering facts from the source', async () => {
  const cases = [
    ['native-opendesign', { data: [{ id: 'glm-5.3-flash', metadata: { context_limit: 8192, context_budget: 128 }, architecture: { input_modalities: ['text', 'image'] } }] }, row => { assert.equal(row.wire, 'messages'); assert.equal(row.vision, true); assert.equal(row.contextWindow, 8192); assert.equal(row.maxOutput, 128) }],
    ['native-sensenova', { data: [{ id: 'text', context_length: 8192, max_output_length: 128, input_modalities: ['image'], supported_features: ['reasoning'] }, { id: 'picture', output_modalities: ['image'] }, { id: 'deepseek-v4.1-flash' }] }, row => { assert.equal(row.id, 'text'); assert.equal(row.vision, true); assert.equal(row.reasoning, true); assert.equal(row.maxOutput, 128) }],
    ['native-inkstone', { data: [{ id: 'text', max_output_length: 128 }] }, row => assert.equal(row.maxOutput, 128)],
    ['native-agnes-code', { data: [{ id: 'text', max_input_tokens: 8192, max_output_tokens: 128, thinking_toggle: true }] }, row => { assert.equal(row.contextWindow, 8192); assert.equal(row.maxOutput, 128); assert.equal(row.reasoning, true) }],
    ['native-commandcode', { data: [{ id: 'claude-synthetic', supported_endpoints: ['/v1/responses/'] }] }, row => assert.equal(row.wire, 'responses')],
  ]
  for (const [id, payload, check] of cases) {
    const { api, manifest } = await load(id); const f = context(manifest, () => reply(payload), { type: 'api', key: 'SYNTHETIC' })
    const models = await api.listModels(f.ctx); assert.equal(models.length, 1, id); check(models[0])
  }
  const { api, manifest } = await load('native-opendesign'); const f = context(manifest, () => { throw new Error('must not send') })
  assert.equal((await api.authorize(f.ctx, { methodId: 'api', key: 'vela_ctrl_not-a-runtime-key' })).status, 'failed'); assert.equal(f.calls.length, 0)
})
test('CommandCode public catalog cannot authenticate an invalid key', async () => {
  const { api, manifest } = await load('native-commandcode')
  const f = context(manifest, url => url.endsWith('/whoami') ? { ok: false, status: 401 } : reply({ data: [{ id: 'public-model' }] }))
  assert.equal((await api.authorize(f.ctx, { methodId: 'api', key: 'BAD' })).status, 'failed')
  assert.equal(f.writes(), 0); assert.equal(f.calls.length, 1); assert.ok(f.calls[0].url.endsWith('/alpha/whoami'))
})
test('Cline source regression: subject-only identity and string/top-provider context sizes', async () => {
  const { api, manifest } = await load('native-cline')
  const rows = [
    { id: 'anthropic/claude-sonnet-5.5', context: 0, context_length: 1000000, top_provider: { context_length: 1000000, max_completion_tokens: 128000 } },
    { id: 'inclusionai/ling-3.1-flash', context_length: '262144', top_provider: { max_completion_tokens: 32768 } },
    { id: 'only/top', top_provider: { context_length: 200000 } },
    { id: 'no/size', context_length: null },
    { id: 'bad/size', context_length: 'Infinity', top_provider: { context_length: 'invalid' } },
  ]
  const f = context(manifest, url => reply(url.endsWith('/users/me') ? { success: true, data: { subject: 'sub1' } } : { data: rows }))
  assert.equal((await api.authorize(f.ctx, { methodId: 'api', key: 'SYNTHETIC' })).status, 'success')
  const models = plain(await api.listModels(f.ctx))
  assert.deepEqual(models.map(row => row.contextWindow), [1000000, 262144, 200000, undefined, undefined])
  assert.ok(models.every(row => row.maxOutput === undefined), 'source intentionally does not infer reply limit from top_provider')
  for (const subject of ['', ' ', null, {}, 42]) {
    const bad = context(manifest, () => reply({ success: true, data: { subject } }))
    assert.equal((await api.authorize(bad.ctx, { methodId: 'api', key: 'SYNTHETIC' })).status, 'failed'); assert.equal(bad.writes(), 0)
  }
})
test('Copilot source regression: server interval survives every pending and accumulates slow_down', async () => {
  const { api, manifest } = await load('native-copilot'); let error = 'authorization_pending'
  const f = context(manifest, url => reply(url.endsWith('/device/code') ? { device_code: 'SECRET', user_code: 'PUBLIC', verification_uri: 'https://github.com/login/device', expires_in: 600, interval: 13 } : { error }))
  const start = await api.authorize(f.ctx, { methodId: 'github-device', clientId: 'SYNTHETIC-APP' })
  assert.equal(start.interval, 13); assert.equal(start.state.interval, 13)
  let state = start.state
  for (const [code, interval] of [['authorization_pending', 13], ['slow_down', 18], ['slow_down', 23], ['authorization_pending', 23]]) {
    error = code; const out = await api.pollAuthorization(f.ctx, state)
    assert.equal(out.status, 'pending'); assert.equal(out.interval, interval); assert.equal(out.state.interval, interval)
    assert.equal(out.state.deviceCode, state.deviceCode); assert.equal(out.state.expires, state.expires); state = plain(out.state)
  }
})
test('AStudio and Inkstone source regressions: explicit vision and reasoning true/false, not host defaults', async () => {
  for (const [id, payload] of [
    ['native-astudio', { data: { models: [{ slug: 'image-thinking', input_modalities: ['text', 'image'], supported_reasoning_levels: [{ effort: 'none' }, { effort: 'high' }] }, { slug: 'text-only', input_modalities: ['text'], supported_reasoning_levels: [{ effort: 'none' }] }, { slug: 'unknown' }] } }],
    ['native-inkstone', { data: [{ id: 'image-thinking', input_modalities: ['text', 'image'], supported_features: ['tools', 'reasoning'] }, { id: 'text-only', input_modalities: ['text'], supported_features: ['tools'] }, { id: 'unknown' }] }],
  ]) {
    const { api, manifest } = await load(id); const f = context(manifest, () => reply(payload), { type: 'api', key: 'SYNTHETIC' })
    const models = plain(await api.listModels(f.ctx))
    assert.deepEqual(models.map(({ vision, reasoning }) => ({ vision, reasoning })), [{ vision: true, reasoning: true }, { vision: false, reasoning: false }, { vision: false, reasoning: false }])
  }
})
test('River id-only catalog is enriched from the pinned documented table without adding entitlements', async () => {
  const { api, manifest } = await load('native-river')
  const f = context(manifest, () => reply({ data: [{ id: 'moonshotai/Kimi-K3' }, { id: 'deepseek-ai/DeepSeek-V4.1-Flash' }, { id: 'Qwen/Qwen3.8-27B-FP8' }, { id: 'unknown/model' }] }), { type: 'api', key: 'SYNTHETIC' })
  const rows = plain(await api.listModels(f.ctx)); assert.equal(rows.length, 4)
  assert.deepEqual(rows.map(row => [row.contextWindow, row.maxOutput, row.vision, row.reasoning]), [[1048576, 32768, true, true], [1048576, 384000, true, true], [262144, 262143, true, true], [undefined, undefined, false, false]])
})
test('41-channel scope stays exact, each implemented row has a package and agy-cli is blocked', async () => {
  const scope = JSON.parse(await fs.readFile(path.join(root, 'native-providers/scope.json'), 'utf8'))
  assert.equal(scope.channels.length, 41); assert.ok(scope.channels.every(row => ![19, 30, 35].includes(row.number)))
  assert.ok(scope.channels.every(row => row.providers.every(id => !['workbuddy', 'workbuddy-ai', 'codearts', 'officeace', 'orcaterm'].includes(id))))
  for (const row of scope.channels) { assert.ok(row.reason); if (row.extension) assert.ok(ids.includes(row.extension)) }
  assert.match(scope.channels.find(row => row.number === 44).status, /^blocked/)
})
