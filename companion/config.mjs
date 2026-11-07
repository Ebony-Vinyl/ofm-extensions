import fs from 'node:fs/promises'
import path from 'node:path'

export async function readConfig(file) {
  const config = JSON.parse(await fs.readFile(file, 'utf8'))
  const base = path.dirname(path.resolve(file))
  const resolved = {
    ...config,
    dataDir: path.resolve(base, config.dataDir ?? 'archive'),
    projects: Object.fromEntries(Object.entries(config.projects ?? {}).map(([key, value]) => [key, path.resolve(base, value)])),
    providers: (config.providers ?? []).map(entry => ({ ...entry, root: path.resolve(base, entry.root) })),
  }
  for (const name of ['history','search','compression']) if (config[name]?.root) resolved[name] = { ...config[name], root: path.resolve(base, config[name].root) }
  return { config, resolved }
}

export async function writeConfig(file, config) {
  const temp = file + '.tmp'
  await fs.writeFile(temp, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
  await fs.chmod(temp, 0o600)
  await fs.rename(temp, file)
}
