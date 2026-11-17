import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { installCompression } from '../companion/install-compression.mjs'

test('replaces the old engine without retaining its files or touching other strategies', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ofm-compression-install-'))
  try {
    await fs.mkdir(path.join(root, 'engines/rtk'), { recursive: true })
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ type: 'module', name: '@magpie-community/middleware-compress-core', version: '0.5.0' }))
    await fs.writeFile(path.join(root, 'engines/rtk/index.js'), '// old entry')
    await fs.writeFile(path.join(root, 'engines/rtk/old.js'), '// old implementation')
    await fs.writeFile(path.join(root, 'engines/lite.js'), '// untouched')
    await installCompression(root)
    await assert.rejects(fs.access(path.join(root, 'engines/rtk/old.js')), { code: 'ENOENT' })
    assert.equal(await fs.readFile(path.join(root, 'engines/lite.js'), 'utf8'), '// untouched')
    assert.deepEqual((await fs.readdir(path.join(root, 'engines'))).sort(), ['lite.js', 'rtk'])
    const engine = await import(pathToFileURL(path.join(root, 'engines/rtk/index.js')))
    assert.equal(engine.id, 'rtk')
    assert.equal(engine.configSchema.find(field => field.key === 'intensity').defaultValue, 'standard')
    assert.equal(engine.configSchema.find(field => field.key === 'disabledFilters').options.length, 8)
    assert.match(await fs.readFile(path.join(root, 'engines/rtk/NOTICE'), 'utf8'), /630e2d512b1e2e5a063562f664dbf6e2accfb103/)
    assert.match(await fs.readFile(path.join(root, 'engines/rtk/LICENSES/Apache-2.0.txt'), 'utf8'), /Apache License/)
    assert.equal(engine.apply({ messages: [] }, { protocol: 'chat' }, {}), false)
    await installCompression(root)
    assert.deepEqual((await fs.readdir(path.join(root, 'engines'))).sort(), ['lite.js', 'rtk'])
    await fs.writeFile(path.join(root, 'package.json'), '{"name":"unrelated","version":"0.5.0"}')
    const before = await fs.readFile(path.join(root, 'engines/rtk/index.js'), 'utf8')
    await assert.rejects(installCompression(root), /仅支持/)
    assert.equal(await fs.readFile(path.join(root, 'engines/rtk/index.js'), 'utf8'), before)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('failed switch restores old bytes; failed restoration retains the recovery directory', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ofm-compression-rollback-'))
  const rename = fs.rename.bind(fs)
  let failRestore = false
  t.mock.method(fs, 'rename', async (source, destination) => {
    if (path.basename(source) === 'next' || (failRestore && path.basename(source) === 'previous')) {
      throw new Error('simulated directory switch failure')
    }
    return rename(source, destination)
  })
  try {
    await fs.mkdir(path.join(root, 'engines/rtk'), { recursive: true })
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: '@magpie-community/middleware-compress-core', version: '0.5.0' }))
    await fs.writeFile(path.join(root, 'engines/rtk/index.js'), '// original bytes')
    await assert.rejects(installCompression(root), /simulated directory switch failure/)
    assert.equal(await fs.readFile(path.join(root, 'engines/rtk/index.js'), 'utf8'), '// original bytes')
    assert.deepEqual(await fs.readdir(path.join(root, 'engines')), ['rtk'])
    failRestore = true
    await assert.rejects(installCompression(root), /simulated directory switch failure/)
    const [recovery] = await fs.readdir(path.join(root, 'engines'))
    assert.ok(recovery.startsWith('.ofm-rtk-'))
    assert.equal(await fs.readFile(path.join(root, 'engines', recovery, 'previous/index.js'), 'utf8'), '// original bytes')
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
