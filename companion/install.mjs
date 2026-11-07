import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { writeConfig } from './config.mjs'

// Run explicitly: this program installs pinned upstream code OUTSIDE the sandbox.
const directory = process.argv[2]
if (!directory) throw new Error('用法：node companion/install.mjs /绝对路径/社区桥目录')
const root = path.resolve(directory)
await fs.mkdir(root, { recursive: true, mode: 0o700 })
const file = path.join(root, 'config.json')
try { await fs.access(file); throw new Error('配置已存在；不会覆盖已有账号。请另选目录或手工更新。') }
catch (error) { if (error.code !== 'ENOENT') throw error }
const lock = JSON.parse(await fs.readFile(new URL('./plugins.lock.json', import.meta.url), 'utf8'))
const child = spawn(process.env.OFM_BUN || 'bun', ['add', '--ignore-scripts', ...Object.values(lock).map(row => `${row.alias}@github:${row.repository}#${row.revision}`)], {
  cwd: root, stdio: 'inherit', shell: false,
})
await new Promise((resolve, reject) => {
  child.once('error', reject)
  child.once('exit', code => code === 0 ? resolve() : reject(new Error('固定版本上游插件安装失败：' + code)))
})
const source = name => './node_modules/' + lock[name].alias
await writeConfig(file, {
  token: randomBytes(32).toString('hex'),
  dataDir: './archive', projects: {},
  providers: [
    { id:'deepseek-web', provider:'deepseek-web', root:source('deepseek-web') },
    { id:'gemini-web', provider:'gemini-web', root:source('gemini') },
    { id:'ai-studio', provider:'ai-studio', root:source('gemini') },
    { id:'muse-web', provider:'muse-web', root:source('muse-web') },
  ],
  search: { root:source('search'), provider:'anysearch', options:{} },
  history: { root:source('history'), options:{ allowUnscoped:false, recallRemote:false } },
  compression: { root:source('compression'), options:{} },
})
console.log('已安装固定提交的上游源码。配置：' + file)
console.log('请授权 projects、完成登录，并把 config.json 的 token 保存到扩展 bridgeToken。')
