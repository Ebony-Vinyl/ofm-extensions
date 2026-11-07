import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { loadProvider } from '../companion/runtime.mjs'
import { createServices } from '../companion/services.mjs'

async function fixture(run) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ofm-provider-'))
  try {
    await fs.writeFile(path.join(root,'package.json'),JSON.stringify({type:'module',main:'./entry.mjs'}))
    await fs.writeFile(path.join(root,'entry.mjs'),`
      export default async () => ({
        config(cfg) { cfg.provider.fixture = { api:'https://fixture.invalid/v1', models:{ m:{name:'Model',limit:{context:1000,output:100},modalities:{input:['text','image']}} } } },
        auth:{ provider:'fixture',
          methods:[{ type:'oauth',label:'Fixture browser',async authorize() { return { url:'https://fixture.invalid/login',method:'auto',callback:async()=>({type:'success',key:'ROTATED'}) } } }],
          async loader(getAuth) { return {baseURL:'https://fixture.invalid/v1', headers:{'x-provider':'kept'}, apiKey:(await getAuth()).key,
            fetch:async(url,init)=>new Response(JSON.stringify({url,body:JSON.parse(init.body),headers:init.headers}))} },
          async usage(getAuth) { return {keyPresent:!!(await getAuth()).key} }
        },
        'chat.headers':async(input,output)=>{output.headers['x-session']=input.sessionID},
      })
    `)
    await run(root)
  }finally{await fs.rm(root,{recursive:true,force:true})}
}

test('real compatibility loader supports default exports, model metadata, session headers, tools and native login callbacks',async()=>{
 await fixture(async root=>{
  let saved
  const provider=await loadProvider({root,provider:'fixture',auth:{type:'api',key:'INITIAL'},saveAuth:async value=>{saved=value}})
  assert.equal((await provider.models())[0].vision,true)
  assert.equal(provider.methods()[0].label,'Fixture browser')
  let loginUrl
  await provider.login(0,{},async step=>{loginUrl=step.url})
  assert.equal(loginUrl,'https://fixture.invalid/login')
  assert.equal(saved.key,'ROTATED');assert.equal(saved.type,'api')
  const body={model:'m',stream:true,tools:[{function:{name:'read'}}],messages:[{role:'user',content:'hi'}]}
  const result=await (await provider.complete(body,{sessionId:'s'})).json()
  assert.equal(result.headers.authorization,'Bearer ROTATED')
  assert.equal(result.headers['x-session'],'s')
  assert.deepEqual(result.body,body)
  assert.deepEqual(await provider.usage(),{keyPresent:true})
  const controller=new AbortController();controller.abort()
  await assert.rejects(provider.complete(body,{signal:controller.signal}),{name:'AbortError'})
 })
})

test('history adapter supplies local provenance and maps Anthropic wire to the actual upstream contract',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'ofm-history-'))
 try{
  await fs.mkdir(path.join(root,'extensions/magpie'),{recursive:true})
  await fs.writeFile(path.join(root,'extensions/magpie/deja.hooks.mjs'),`
    export async function onRequest(body,ctx){
      if(ctx.origin!=='local'||ctx.protocol!=='anthropic'||ctx.cwd!=='/allowed/project') throw new Error('contract mismatch')
      if(ctx.options.allowUnscoped||ctx.options.recallRemote) throw new Error('scope widened')
      return {...body, recalled:true}
    }
  `)
  const services=createServices({history:{root},projects:{approved:'/allowed/project'}})
  const result=await services.recall({body:{messages:[]},meta:{wire:'messages',sessionId:'s'},project:'approved'})
  assert.equal(result.recalled,true)
  await assert.rejects(services.recall({body:{},meta:{wire:'chat'},project:'/etc'}),/授权/)
 }finally{await fs.rm(root,{recursive:true,force:true})}
})

test('API authorizers preserve the entered key and dynamic login prompts use current choices', async () => {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'ofm-login-'))
 try {
  await fs.writeFile(path.join(root,'package.json'),JSON.stringify({type:'module',main:'./entry.mjs'}))
  await fs.writeFile(path.join(root,'entry.mjs'),`
   export default async()=>({config(c){c.provider.p={models:{}}},auth:{provider:'p',methods:[
    {type:'api',label:'Backend',prompts:[{key:'baseURL',message:'URL'}],authorize:async i=>({type:'success',metadata:{baseURL:i.baseURL}})},
    {type:'oauth',label:'Pool',prompts:[{key:'account',options:[]}],async ask(i){return i.account?null:{key:'account',message:'Account',options:[{value:'live',label:'Live'}]}},
     authorize:async i=>({type:'success',key:i.account})},
    {type:'api',label:'Key'}
   ]}})
  `)
  let saved
  const provider=await loadProvider({root,provider:'p',saveAuth:async value=>{saved=value}})
  await provider.login(0,{},async step=>step.prompt==='URL'?'https://backend.invalid':'KEY')
  assert.equal(saved.type,'api');assert.equal(saved.key,'KEY');assert.equal(saved.metadata.baseURL,'https://backend.invalid')
  await provider.login(1,{},async step=>{assert.equal(step.options[0].value,'live');return 'live'})
  assert.equal(saved.key,'live')
  await provider.login(2,{},async()=> 'PLAIN')
  assert.equal(saved.key,'PLAIN')
 }finally{await fs.rm(root,{recursive:true,force:true})}
})

test('concurrent requests share one auth renewal and persist the renewed credential before use', async () => {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'ofm-refresh-'))
 try {
  await fs.writeFile(path.join(root,'package.json'),JSON.stringify({type:'module',main:'./entry.mjs'}))
  await fs.writeFile(path.join(root,'entry.mjs'),`
   let calls=0
   export default async()=>({config(c){c.provider.p={api:'https://fixture.invalid/v1',models:{}}},auth:{provider:'p',methods:[],refreshLead:1000,
    async refresh(a){calls++;await new Promise(r=>setTimeout(r,5));return {access:'NEW',expires:Date.now()+60000}},
    async loader(get){const a=await get();return {fetch:async()=>Response.json({access:a.access,calls})}}
   }})
  `)
  let writes=0
  const provider=await loadProvider({root,provider:'p',auth:{type:'oauth',access:'OLD',expires:0},saveAuth:async()=>{writes++}})
  const results=await Promise.all([provider.complete({model:'m'}),provider.complete({model:'m'})])
  for(const result of results)assert.deepEqual(await result.json(),{access:'NEW',calls:1})
  assert.equal(writes,1)
 }finally{await fs.rm(root,{recursive:true,force:true})}
})

test('upstream concurrency limit spans the full stream and queued cancellation does not send a request', async () => {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'ofm-concurrency-'))
 try {
  await fs.writeFile(path.join(root,'package.json'),JSON.stringify({type:'module',main:'./entry.mjs'}))
  await fs.writeFile(path.join(root,'entry.mjs'),`
   let calls=0
   export default async()=>({config(c){c.provider.p={api:'https://fixture.invalid/v1',models:{}}},auth:{provider:'p',maxConcurrency:1,
    async loader(){return {fetch:async()=>{calls++;let sent=false;return new Response(new ReadableStream({pull(c){if(!sent){sent=true;c.enqueue(new TextEncoder().encode(String(calls)))}}}))}}}
   }})
  `)
  const provider=await loadProvider({root,provider:'p'})
  const first=await provider.complete({model:'m'})
  let secondStarted=false
  const secondPromise=provider.complete({model:'m'}).then(r=>{secondStarted=true;return r})
  const abort=new AbortController()
  const queued=provider.complete({model:'m'},{signal:abort.signal})
  abort.abort()
  await assert.rejects(queued,{name:'AbortError'})
  await new Promise(r=>setTimeout(r,10))
  assert.equal(secondStarted,false)
  await first.body.cancel()
  const second=await secondPromise
  const reader=second.body.getReader()
  assert.equal(new TextDecoder().decode((await reader.read()).value),'2')
  await reader.cancel()
 }finally{await fs.rm(root,{recursive:true,force:true})}
})
