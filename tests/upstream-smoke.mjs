// Explicit opt-in integration check. Upstream packages must already be installed.
// Every fetch is intercepted; no real account, model or search service is used.
import assert from 'node:assert/strict'
import { readConfig } from '../companion/config.mjs'
import { loadProvider } from '../companion/runtime.mjs'
import { createServices } from '../companion/services.mjs'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'

const { resolved } = await readConfig(process.argv[2])
const calls = []
globalThis.fetch = async (url, init) => { calls.push(String(url)); throw new Error('All network intercepted') }
for (const entry of resolved.providers) {
  const provider = await loadProvider(entry)
  assert.ok(provider.methods().length, entry.id + ': no authentication methods')
  if (entry.id === 'deepseek-web') assert.equal((await provider.usage()).plan,'DeepSeek (web)')
  console.log('ok real upstream entry and login methods:', entry.id)
}
assert.ok(calls.every(value => { const url = new URL(value); return url.hostname === '127.0.0.1' && url.pathname === '/v1/health' }))
const { WebSearch } = await import(pathToFileURL(path.join(resolved.search.root, 'index.mjs')).href)
const hooks = await WebSearch({}, {})
assert.equal(Object.keys(hooks.search).length, 21)
for (const provider of Object.values(hooks.search)) assert.equal(typeof provider.execute, 'function')
console.log('ok real upstream search: 21 executable provider hooks')
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ofm-upstream-fixture-'))
try {
  const bin = path.join(root, 'deja-fixture')
  const payloadFile = path.join(root, 'payload.json')
  await fs.writeFile(bin, `#!/bin/sh
/bin/cat > "${payloadFile}"
printf '%s\n' '<deja-recall>Historical synthetic reference</deja-recall>'
`, { mode: 0o700 })
  const services = createServices({ ...resolved, projects: { fixture:root }, history:{ ...resolved.history, options:{ bin, requestTimeoutMs:1200 } } })
  for (const wire of ['chat','responses','messages']) {
    const content = [{ type:wire==='responses'?'input_text':'text', text:'find the synthetic history for this project' }, { type:'image', source:{ data:'KEEP' } }]
    const key = wire === 'responses' ? 'input' : 'messages'
    const body = { model:'synthetic',stream:true,[key]:[{role:'user',content}] }
    const recalled = await services.recall({body,meta:{wire,sessionId:'fixture-'+wire},project:'fixture'}, AbortSignal.timeout(1500))
    assert.match(JSON.stringify(recalled), /Historical synthetic reference/)
    assert.deepEqual(recalled[key][0].content[1], content[1])
    assert.equal(body[key][0].content.length,2)
    const payload = JSON.parse(await fs.readFile(payloadFile, 'utf8'))
    assert.equal(payload.cwd,root);assert.equal(payload.session_id,'fixture-'+wire)
  }
  console.log('ok actual deja hook subprocess, project scope and three wire shapes')
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url),'https://api.anysearch.com/v1/search')
    assert.equal(JSON.parse(init.body).query,'synthetic search')
    assert.equal(new Headers(init.headers).has('authorization'),false)
    return Response.json({code:0,data:{results:[{url:'https://example.invalid/reference',title:'Fixture',content:'Synthetic search result'}]}})
  }
  const searched = await services.search({body:{messages:[{role:'user',content:'[search] synthetic search'}]},meta:{wire:'chat'}}, AbortSignal.timeout(1500))
  assert.match(searched.messages[0].content, /Synthetic search result/)
  assert.match(searched.messages[0].content, /untrusted="true"/)
  console.log('ok actual search execution with intercepted HTTP and reference injection')
  globalThis.fetch = async () => { throw new Error('Compression must never call network') }
  for (const wire of ['chat','responses','messages']) {
    const key = wire === 'responses' ? 'input' : 'messages'
    const textType = wire === 'responses' ? 'output_text' : 'text'
    const body = { model:'synthetic',stream:true,[key]:[
      {role:'assistant',content:[{type:textType,text:JSON.stringify(Array.from({length:24},(_,i)=>({identifier:i,description:'synthetic repeated description',category:'fixture'})))}]},
      {role:'user',content:[{type:wire==='responses'?'input_text':'text',text:'current    exact prompt'},{type:'image',source:{data:'KEEP'}}]},
    ] }
    const before=JSON.stringify(body)
    const compressed=await services.compress({body,meta:{wire,sessionId:'s'}})
    assert.equal(JSON.stringify(body),before)
    assert.ok(JSON.stringify(compressed).length < before.length, wire+': no actual compression')
    assert.deepEqual(compressed[key][1],body[key][1])
    assert.equal(compressed.model,body.model);assert.equal(compressed.stream,true)
    assert.doesNotMatch(JSON.stringify(compressed),/\u0000pcc:|ccr:|session-dedup:/)
  }
  console.log('ok actual compress-core pipeline, three wires, prompt/image preservation and body immutability')
} finally { await fs.rm(root,{recursive:true,force:true}) }
console.log('ok no real account, generation or search requests')
