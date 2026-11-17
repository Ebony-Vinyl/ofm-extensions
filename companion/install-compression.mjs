import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { readConfig } from './config.mjs'

// Replace only the pinned pipeline's RTK implementation; retain its other engines.
export async function installCompression(root) {
  const directory = path.resolve(root)
  const metadata = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'))
  if (metadata.name !== '@magpie-community/middleware-compress-core' || metadata.version !== '0.5.0') {
    throw new Error('仅支持已验收的 compress-core 0.5.0；未修改安装目录')
  }
  const engines = path.join(directory, 'engines')
  const target = path.join(engines, 'rtk')
  await fs.access(path.join(target, 'index.js'))
  const staging = await fs.mkdtemp(path.join(engines, '.ofm-rtk-'))
  const prepared = path.join(staging, 'next'), previous = path.join(staging, 'previous')
  let moved = false, installed = false, restored = false
  try {
    await fs.cp(new URL('./compression/', import.meta.url), prepared, { recursive: true })
    await fs.writeFile(path.join(prepared, 'index.js'), "export { id, apply, configSchema } from './index.mjs'\n")
    await fs.rename(target, previous)
    moved = true
    await fs.rename(prepared, target)
    installed = true
  } catch (error) {
    if (moved && !installed) { await fs.rename(previous, target); restored = true }
    throw error
  } finally {
    // A failed rollback leaves its recovery copy intact.
    if (installed || !moved || restored) {
      await fs.rm(staging, { recursive: true, force: true })
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw new Error('用法：node companion/install-compression.mjs /绝对路径/config.json')
  const { resolved } = await readConfig(process.argv[2])
  if (!resolved.compression?.root) throw new Error('配置未指定压缩插件目录')
  await installCompression(resolved.compression.root)
  console.log('RTK 引擎已替换；请重启社区桥以加载新实现。')
}
