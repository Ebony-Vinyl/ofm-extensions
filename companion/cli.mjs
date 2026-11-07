import { readConfig, writeConfig } from './config.mjs'
import { loadProvider } from './runtime.mjs'
import { createArchive, createServices } from './services.mjs'
import { createInterface } from 'node:readline/promises'

const [command, file, ...args] = process.argv.slice(2)
if (!file || !['login','models','usage','search','unfold'].includes(command)) {
  throw new Error('用法：bun companion/cli.mjs login|models|usage|search|unfold config.json [参数]')
}
const { config, resolved } = await readConfig(file)
if (command === 'unfold') {
  const [project, session, id] = args
  if (!config.projects?.[project] || !session || !id) throw new Error('需要授权项目、会话和归档 ID')
  console.log(await createArchive(resolved.dataDir).read(JSON.stringify([project, session]), id))
} else if (command === 'search') {
  const query = args.join(' ')
  if (!query) throw new Error('请输入搜索词')
  const result = await createServices(resolved).search({ body: { messages:[{role:'user',content:query}] }, meta:{wire:'chat'}, query }, AbortSignal.timeout(30000))
  console.log(JSON.stringify(result, null, 2))
} else {
  const [id, methodIndex] = args
  const index = resolved.providers.findIndex(entry => entry.id === id)
  if (index < 0) throw new Error('未知供应商')
  const entry = resolved.providers[index]
  entry.saveAuth = async value => { config.providers[index].auth = value; await writeConfig(file, config) }
  const provider = await loadProvider(entry)
  if (command === 'models') console.log(JSON.stringify(await provider.models(), null, 2))
  else if (command === 'usage') console.log(JSON.stringify(await provider.usage(), null, 2))
  else {
    const methods = provider.methods()
    if (methodIndex === undefined) console.log(JSON.stringify(methods, null, 2))
    else {
      const method = methods[Number(methodIndex)]
      if (!method) throw new Error('无效登录方式')
      const reader = createInterface({ input:process.stdin, output:process.stdout })
      try {
        const inputs = {}
        await provider.login(Number(methodIndex), inputs, async step => {
          if (step.url) console.log('请在浏览器打开：' + step.url)
          if (step.instructions) console.log(step.instructions)
          if (step.options?.length) console.log(JSON.stringify(step.options))
          if (step.prompt) return reader.question(step.prompt + ': ')
        })
        console.log('登录凭据已保存在本机私有配置。')
      } finally { reader.close() }
    }
  }
}
