// Opt-in check against an independently checked-out OFM host and pinned upstreams.
// Uses a private temporary host data directory and local developer installation.
// No real DSH/Codex profile, signing key, browser account or model is touched.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { once } from 'node:events'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { readConfig } from '../companion/config.mjs'
import { createCompanion } from '../companion/server.mjs'

if (!process.argv[2] || !process.argv[3]) throw new Error('Usage: node tests/host-integration.mjs /host/checkout /private/companion/config.json')
const host = path.resolve(process.argv[2])
const hostPackage = JSON.parse(await fs.readFile(path.join(host,'package.json'),'utf8'))
const { createExtensionRuntime } = await import(pathToFileURL(path.join(host,'src/extensions.js')).href)
const { resolved } = await readConfig(process.argv[3])
const root = await fs.mkdtemp(path.join(os.tmpdir(),'ofm-real-host-'))
const source = fileURLToPath(new URL('../packages/',import.meta.url))
const web = ['deepseek-web','gemini-web','ai-studio','muse-web']
const enhancements = ['output-cleaner','context-compression','history-recall','context-folding','web-search']
const token = 'synthetic-local-only-'.repeat(4)
const nativeFetch = globalThis.fetch
const requests = []
const warnings = []
let server, runtime
try {
 const bin=path.join(root,'deja-fixture')
 await fs.writeFile(bin,"#!/bin/sh\n/bin/cat >/dev/null\nprintf '%s\\n' '<deja-recall>Host integration synthetic history</deja-recall>'\n",{mode:0o700})
 // The only permitted non-loopback request is answered synthetically here.
 globalThis.fetch=async(url,init)=>{
  const target=new URL(String(url))
  if(target.hostname==='api.anysearch.com')return Response.json({code:0,data:{results:[{url:'https://example.invalid/result',title:'Synthetic',content:'Host integration synthetic search'}]}})
  assert.equal(target.hostname,'127.0.0.1','No external traffic is allowed')
  return nativeFetch(url,init)
 }
 server=createCompanion({...resolved,token,projects:{fixture:root},dataDir:path.join(root,'archive'),
  history:{...resolved.history,options:{bin,requestTimeoutMs:1200}},providers:web.map(id=>({id})),
  load:async entry=>({models:async()=>[{id:'synthetic-model',name:entry.id,wire:'chat',contextWindow:8192,maxOutput:1024}],
   complete:async(body,meta)=>{requests.push({id:entry.id,body,meta});return new Response('data: {"choices":[{"delta":{"content":"host-ok"},"finish_reason":null}]}\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}})},
  }),
 })
 server.listen(19281,'127.0.0.1');await once(server,'listening')
 runtime=createExtensionRuntime({dataDir:path.join(root,'host-data'),hostVersion:hostPackage.version,logger:{warn:message=>warnings.push(message),info(){}}})
 for(const id of ['amd-cloud','deepai-code',...web,...enhancements]){
  const dir=path.join(root,'local-packages',id)
  await fs.mkdir(dir,{recursive:true})
  const manifest=JSON.parse(await fs.readFile(path.join(source,id,'ofm-plugin.json'),'utf8'))
  // Local developer installs require files; registry installs obtain that list
  // from signed metadata. Only this packaging field is added to the fixture.
  await fs.writeFile(path.join(dir,'ofm-plugin.json'),JSON.stringify({...manifest,files:['main.mjs']}))
  await fs.copyFile(path.join(source,id,'main.mjs'),path.join(dir,'main.mjs'))
  const record=await runtime.installLocal({path:dir,acknowledgeUnsigned:true})
  assert.equal(record.enabled,!enhancements.includes(id),id+': default enabled state')
 }
 for(const id of ['amd-cloud','deepai-code']){
  assert.equal(runtime.isRunning(id),true,id+': actual worker did not load')
  await assert.rejects(runtime.prepareChat({extensionId:id,modelId:'synthetic',wire:'chat'},{messages:[]},'s'),/API Key/)
 }
 for(const id of web){
  await runtime.saveSecret(id,'bridgeToken',token)
  const entry=runtime.catalog.find(row=>row.extensionId===id)
  assert.ok(entry,id+': missing real host catalog row')
  const tools=[{type:'function',function:{name:'read',parameters:{type:'object'}}}]
  const prepared=await runtime.prepareChat(entry,{messages:[{role:'user',content:'synthetic'}],tools},'session-'+id)
  assert.equal(prepared.wire,'chat')
  const response=await fetch(prepared.url,{method:'POST',headers:prepared.headers,body:prepared.body})
  assert.match(await response.text(),/host-ok/)
  assert.equal(requests.at(-1).id,id)
  assert.equal(requests.at(-1).meta.sessionId,'session-'+id)
  assert.deepEqual(requests.at(-1).body.tools,tools)
  assert.equal(requests.at(-1).body.stream,true)
 }
 console.log('ok real OFM '+hostPackage.version+': 11 packages load, six channel workers and four model/prepare/stream paths')
 for(const id of enhancements){
  if(id!=='output-cleaner')await runtime.saveSecret(id,'bridgeToken',token)
  if(['history-recall','context-folding'].includes(id))await runtime.saveConfig(id,{project:'fixture'})
  await runtime.setEnabled(id,true)
  for(const wire of ['chat','responses','messages']){
   const key=wire==='responses'?'input':'messages'
   const content=JSON.stringify(Array.from({length:24},(_,i)=>({identifier:i,description:'synthetic repeated description',category:'fixture'})))
   const body={model:'synthetic',stream:true,[key]:[{role:'assistant',content},
    {role:'user',content:[{type:wire==='responses'?'input_text':'text',text:id==='web-search'?'[search] synthetic public query':'current synthetic prompt'},{type:'image',source:{data:'KEEP'}}]}]}
   const before=JSON.stringify(body)
   const result=await runtime.applyRequestHooks(body,{wire,sessionId:'session-'+wire,model:'synthetic'})
   assert.equal(JSON.stringify(body),before,'The host-owned input must remain unchanged')
   assert.deepEqual(result[key].at(-1).content[1],body[key].at(-1).content[1])
   if(id==='context-compression')assert.ok(JSON.stringify(result).length<before.length)
   if(id==='history-recall')assert.match(JSON.stringify(result),/Host integration synthetic history/)
   if(id==='web-search')assert.match(JSON.stringify(result),/Host integration synthetic search/)
  }
  await runtime.setEnabled(id,false)
 }
 // Exercise the combined ordering through the real host worker/RPC pipeline.
 for(const id of enhancements)await runtime.setEnabled(id,true)
 const raw='archive original synthetic text\n'.repeat(60)
 const body={model:'synthetic',stream:true,messages:[{role:'assistant',content:'<!-- @context-fold begin report -->'+raw+'<!-- @context-fold end report -->'},
  {role:'tool',tool_call_id:'c',content:'\x1b[31mERROR diagnostic\x1b[0m'},
  {role:'user',content:[{type:'text',text:'[search] synthetic combined query'},{type:'image',source:{data:'KEEP'}}]}]}
 const first=await runtime.applyRequestHooks(body,{wire:'chat',sessionId:'combined'})
 assert.match(JSON.stringify(first),/Host integration synthetic history/)
 assert.match(JSON.stringify(first),/Host integration synthetic search/)
 assert.equal(first.messages[1].content,'ERROR diagnostic')
 assert.equal(body.messages[1].content,'\x1b[31mERROR diagnostic\x1b[0m')
 const second=await runtime.applyRequestHooks({...body,messages:[...body.messages,{role:'user',content:'next synthetic turn'}]},{wire:'chat',sessionId:'combined'})
 assert.match(second.messages[0].content,/ofm-fold:/)
 assert.deepEqual(second.messages[2].content[1],body.messages[2].content[1])
 assert.ok(!warnings.some(value=>/failed.*onRequest|onRequest failed|did not start|restart failed/.test(value)),warnings.join('\n'))
 console.log('ok real OFM workers/RPC: all enhancements, three wires and combined search/history/cleanup/folding')
 console.log('ok isolated local development install only; no real account generation, live DSH profile or production signature changed')
}finally{
 globalThis.fetch=nativeFetch
 await runtime?.dispose()
 if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
 await fs.rm(root,{recursive:true,force:true})
}
