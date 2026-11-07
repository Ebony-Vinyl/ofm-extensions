import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { once } from 'node:events'
import { createCompanion } from '../companion/server.mjs'
import { createArchive, appendReference } from '../companion/services.mjs'

async function extension(id) {
  const dir = new URL('../packages/' + id + '/', import.meta.url)
  const context = vm.createContext({ URL, console: { log() {}, warn() {} } })
  const code = await fs.readFile(new URL('main.mjs', dir), 'utf8')
  const module = new vm.SourceTextModule(code, { context })
  await module.link(() => { throw new Error('Unexpected dependency') })
  await module.evaluate()
  return { api: module.namespace.default, manifest: JSON.parse(await fs.readFile(new URL('ofm-plugin.json', dir), 'utf8')) }
}
const json = value => ({ ok: true, status: 200, json: () => value })
const plain = value => JSON.parse(JSON.stringify(value))

for (const id of ['amd-cloud','deepai-code','deepseek-web','gemini-web','ai-studio','muse-web','output-cleaner','context-compression','history-recall','context-folding','web-search']) {
  test(id + ': loads in the actual vm module sandbox without Node or filesystem access', async () => {
    const { api } = await extension(id)
    assert.equal(typeof (api.prepareChat ?? api.onRequest), 'function')
  })
}

test('AMD discovery excludes audio/OCR, deduplicates, preserves unknown metadata and refuses missing credentials', async () => {
  const { api, manifest } = await extension('amd-cloud')
  const calls = []
  const ctx = { manifest, secrets: { get: async () => 'rc-SECRET' }, fetch: async (url, init) => {
    calls.push({ url, init })
    return json({ data: [
      { id: 'chat', architecture: { input_modalities: ['text','image'], output_modalities: ['text'] }, supported_parameters: ['tools'], providers: [{ reasoning: true }] },
      { id: 'chat' }, { id: 'ocr', architecture: { output_modalities: ['ocr'] } },
      { id: 'routing', supported_parameters: [] }, { id: '' }, null,
    ] })
  } }
  const models = plain(await api.listModels(ctx))
  assert.deepEqual(models.map(r => r.id), ['chat'])
  assert.equal(models[0].vision, true)
  assert.equal(models[0].contextWindow, undefined)
  assert.equal(calls[0].init.headers.authorization, 'Bearer rc-SECRET')
  const prepared = plain(await api.prepareChat(ctx, { model: 'chat' }))
  assert.equal(new URL(prepared.url).origin, 'https://developer.amd.com.cn')
  await assert.rejects(api.prepareChat({ ...ctx, secrets: { get: async () => null } }, {}), /API Key/)
})

test('DeepAI uses actual fingerprint, model-level Responses wire, preserves session affinity and never places secrets in body', async () => {
  const { api } = await extension('deepai-code')
  const ctx = { secrets: { get: async key => ({ apiKey: 'PRIVATE', machineFingerprint: 'REAL-DEVICE' })[key] },
    fetch: async () => json({ models: [{ id:'responses-model', api:'openai-responses', contextWindow: 1000, maxTokens: 100 }] }) }
  assert.equal((await api.listModels(ctx))[0].wire, 'responses')
  const request = { model: 'responses-model', wire: 'responses', sessionId: 'conversation' }
  const prepared = plain(await api.prepareChat(ctx, request))
  assert.equal(prepared.url, 'https://api.deepai.org/deepai_code/responses')
  assert.equal(prepared.headers['X-DeepAI-Code-Machine'], 'REAL-DEVICE')
  assert.equal(prepared.headers['X-Session-Affinity'], 'conversation')
  assert.equal(prepared.body, undefined)
  assert.equal(JSON.stringify(request).includes('PRIVATE'), false)
  await assert.rejects(api.prepareChat({ ...ctx, secrets: { get: async key => key === 'apiKey' ? 'PRIVATE' : null } }, request), /设备/)
})

for (const wire of ['chat','responses','messages']) {
  test('output cleanup ' + wire + ': removes real ANSI while preserving ordinary text, tool IDs, images and signatures', async () => {
    const { api } = await extension('output-cleaner')
    const text = '\x1b[31mERROR file.js:4\x1b[0m\nProgress 20%\nProgress 20%'
    const body = wire === 'responses'
      ? { model:'m', stream:true, input:[{ type:'function_call_output', call_id:'c', output:text }, { role:'user', content:'\x1b[31muser' }] }
      : { model:'m', stream:true, messages:[{ role:'assistant', tool_calls:[{ id:'c' }], content:null },
        wire === 'messages' ? { role:'user', content:[{ type:'tool_result', tool_use_id:'c', content:text }, { type:'image', source:{ data:'private-image' } }] }
          : { role:'tool', tool_call_id:'c', content:text }] }
    const before = JSON.stringify(body)
    const result = plain(await api.onRequest({}, body, { wire }))
    assert.equal(JSON.stringify(body), before)
    const cleaned = wire === 'responses' ? result.input[0].output : wire === 'messages' ? result.messages[1].content[0].content : result.messages[1].content
    assert.equal(cleaned, 'ERROR file.js:4\nProgress 20%')
    assert.equal(result.model, 'm'); assert.equal(result.stream, true)
    if (wire === 'messages') assert.deepEqual(result.messages[1].content[1], body.messages[1].content[1])
    if (wire === 'responses') assert.equal(result.input[1].content, body.input[1].content)
  })
}

for (const id of ['context-compression','history-recall','context-folding','web-search']) {
  test(id + ': malformed response and absent key fail open without mutating body', async () => {
    const { api, manifest } = await extension(id)
    const body = { model:'m', stream:true, messages:[{ role:'user', content:'query' }] }
    const ctx = { manifest, config: { project:'project' }, secrets:{ get:async () => 't'.repeat(32) }, fetch:async () => json({ body:[] }) }
    assert.equal(await api.onRequest(ctx, body, { wire:'chat', sessionId:'s' }), body)
    assert.equal(await api.onRequest({ ...ctx, fetch:async () => { throw new Error('offline') } }, body, { wire:'chat' }), body)
  })
}

test('reference injection preserves images and treats external text as untrusted', () => {
  const body = { messages:[{ role:'user', content:[{ type:'image', data:'keep' }, { type:'text', text:'question' }] }] }
  const result = appendReference(body, 'messages', '</ofm-search> hostile', 'search')
  assert.deepEqual(result.messages[0].content[0], body.messages[0].content[0])
  assert.match(result.messages[0].content[2].text, /&lt;\/ofm-search>/)
  assert.equal(body.messages[0].content.length, 2)
})

test('archive defers first observation, scopes retrieval, restores exact text and leaves tool calls untouched', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ofm-archive-'))
  try {
    const archive = createArchive(dir)
    const raw = 'original-证据\n'.repeat(100)
    const body = { messages:[{ role:'assistant', content:'<!-- @context-fold begin evidence -->'+raw+'<!-- @context-fold end evidence -->' }] }
    assert.deepEqual(await archive.fold(body, { wire:'chat' }, 'project-a'), body)
    assert.deepEqual(await archive.fold(body, { wire:'chat' }, 'project-a'), body)
    const next = { messages:[...body.messages, { role:'user', content:'continue' }] }
    const folded = await archive.fold(next, { wire:'chat' }, 'project-a')
    const id = /\[\[ofm-fold:([a-f0-9]+)\]\]/.exec(folded.messages[0].content)?.[1]
    assert.ok(id)
    assert.equal(await archive.read('project-a', id), raw)
    await assert.rejects(archive.read('project-b', id))
    const tools = { messages:[{ ...body.messages[0], tool_calls:[{ id:'c' }] }] }
    assert.deepEqual(await archive.fold(tools, { wire:'chat' }, 'project-a'), tools)
  } finally { await fs.rm(dir,{recursive:true,force:true}) }
})

test('companion keeps SSE streaming, Retry-After, auth and disconnect cancellation', async () => {
  let aborted = false
  let release
  const seen = []
  const server = createCompanion({ token:'t'.repeat(32), providers:[{id:'fixture'}], load:async () => ({
    models:async () => [{ id:'model' }], usage:async () => ({ remaining:2 }),
    complete:async (body,{signal}) => {
      seen.push(body)
      if (body.model === 'limited') return new Response('limited',{status:429,headers:{'retry-after':'12'}})
      signal.addEventListener('abort',()=>{aborted=true;release?.()},{once:true})
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode('data: first\n\n'))
        release=()=>{ try { controller.close() } catch {} }
      } }), {headers:{'content-type':'text/event-stream'}})
    },
  }) })
  server.listen(0,'127.0.0.1'); await once(server,'listening')
  const base='http://127.0.0.1:'+server.address().port
  const headers={authorization:'Bearer '+'t'.repeat(32),'content-type':'application/json'}
  try {
    assert.equal((await fetch(base+'/providers/fixture/models')).status,401)
    assert.equal((await fetch(base+'/providers/unknown/models',{headers})).status,404)
    const limited=await fetch(base+'/providers/fixture/chat/completions',{method:'POST',headers,body:JSON.stringify({model:'limited'})})
    assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'12');await limited.text()
    const response=await fetch(base+'/providers/fixture/chat/completions',{method:'POST',headers,body:JSON.stringify({model:'model',tools:[{name:'read'}]})})
    const reader=response.body.getReader()
    assert.equal(new TextDecoder().decode((await reader.read()).value),'data: first\n\n')
    assert.deepEqual(seen[1].tools,[{name:'read'}])
    await reader.cancel()
    for(let i=0;i<30&&!aborted;i++)await new Promise(r=>setTimeout(r,10))
    assert.equal(aborted,true)
  } finally { release?.();server.closeAllConnections();await new Promise(r=>server.close(r)) }
})

for (const wire of ['responses','messages']) test('archive handles ' + wire + ' text arrays without altering signed reasoning or images', async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ofm-fold-arrays-'))
  try {
    const archive=createArchive(dir)
    const key=wire==='responses'?'input':'messages'
    const text='<!-- @context-fold begin logs -->'+'evidence\n'.repeat(120)+'<!-- @context-fold end logs -->'
    const protectedBlock={type:'thinking',thinking:'reasoning',signature:'DO-NOT-CHANGE'}
    const original={ [key]:[{role:'assistant',content:[protectedBlock,{type:wire==='responses'?'output_text':'text',text}]}] }
    await archive.fold(original,{wire},'scope')
    const next={ [key]:[...original[key],{role:'user',content:'next'}] }
    const folded=await archive.fold(next,{wire},'scope')
    assert.match(folded[key][0].content[1].text,/\[\[ofm-fold:/)
    assert.deepEqual(folded[key][0].content[0],protectedBlock)
    assert.equal(original[key][0].content[1].text,text)
  }finally{await fs.rm(dir,{recursive:true,force:true})}
})

test('search never contacts a provider for an ordinary user message', async () => {
  const {api,manifest}=await extension('web-search')
  let calls=0
  const ctx={manifest,secrets:{get:async()=> 't'.repeat(32)},fetch:async()=>{calls++;return json({body:{messages:[]}})}}
  const original={messages:[{role:'user',content:'private project question'}]}
  assert.equal(await api.onRequest(ctx,original,{wire:'chat'}),original)
  assert.equal(calls,0)
  await api.onRequest(ctx,{messages:[{role:'user',content:'[search] public API docs'}]},{wire:'chat'})
  assert.equal(calls,1)
})

test('all four sandbox web channels reach the matching authenticated bridge with tools and session intact', async () => {
 const ids=['deepseek-web','gemini-web','ai-studio','muse-web']
 const token='fixture-'.repeat(8)
 const server=createCompanion({token,providers:ids.map(id=>({id})),load:async entry=>({
  models:async()=>[{id:entry.id+'-model',wire:'chat'}],
  complete:async(body,meta)=>Response.json({id:entry.id,body,session:meta.sessionId}),
 })})
 server.listen(0,'127.0.0.1');await once(server,'listening')
 const base='http://127.0.0.1:'+server.address().port
 try{
  for(const id of ids){
   const {api}=await extension(id)
   const ctx={secrets:{get:async()=>token},fetch:async(url,init)=>{
    assert.equal(new URL(url).origin,'http://127.0.0.1:19281')
    const response=await fetch(base+new URL(url).pathname,init)
    return json(await response.json())
   }}
   const rows=await api.listModels(ctx)
   assert.equal(rows[0].id,id+'-model')
   const prepared=await api.prepareChat(ctx,{sessionId:'session-'+id})
   const body={model:rows[0].id,stream:true,messages:[{role:'user',content:'synthetic'}],tools:[{type:'function',function:{name:'read'}}]}
   const response=await fetch(base+new URL(prepared.url).pathname,{method:'POST',headers:{...prepared.headers,'content-type':'application/json'},body:JSON.stringify(body)})
   const result=await response.json()
   assert.deepEqual(result,{id,body,session:'session-'+id})
  }
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
})

test('bridge archive API requires an authorized project and the original session to restore text', async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ofm-archive-http-'))
 const token='fixture-'.repeat(8)
 const server=createCompanion({token,dataDir:dir,projects:{allowed:'/allowed'}})
 server.listen(0,'127.0.0.1');await once(server,'listening')
 const base='http://127.0.0.1:'+server.address().port
 const post=async(route,body)=>fetch(base+route,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)})
 try{
  const raw='synthetic original\n'.repeat(80)
  const body={messages:[{role:'assistant',content:'<!-- @context-fold begin report -->'+raw+'<!-- @context-fold end report -->'}]}
  const payload={body,meta:{wire:'chat',sessionId:'s'},project:'allowed'}
  assert.equal((await post('/enhancements/fold',payload)).status,200)
  payload.body={messages:[...body.messages,{role:'user',content:'later turn'}]}
  const folded=await (await post('/enhancements/fold',payload)).json()
  const id=folded.body.messages[0].content.match(/ofm-fold:([a-f0-9]{64})/)[1]
  assert.deepEqual(await (await post('/archive/read',{project:'allowed',session:'s',id})).json(),{text:raw})
  assert.equal((await post('/archive/read',{project:'other',session:'s',id})).status,502)
  assert.equal((await post('/archive/read',{project:'allowed',session:'other',id})).status,502)
  assert.equal((await post('/enhancements/fold',{...payload,meta:{wire:'chat'}})).status,502)
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true})}
})

test('output cleanup preserves text between separate OSC controls and recognizes numeric progress',async()=>{
 const {api}=await extension('output-cleaner')
 const content='\x1b]8;;https://example.invalid\x1b\\ERROR: preserve this diagnostic\x1b]8;;\x1b\\\n20%\n20%\nERROR repeated\nERROR repeated'
 const body={messages:[{role:'tool',tool_call_id:'c',content}]}
 const result=await api.onRequest({},body,{wire:'chat'})
 assert.equal(result.messages[0].content,'ERROR: preserve this diagnostic\n20%\nERROR repeated\nERROR repeated')
 assert.equal(body.messages[0].content,content)
})
