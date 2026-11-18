// Run against the pinned upstream checkout, kept outside this repository.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'
import { installCompression } from '../companion/install-compression.mjs'
import { apply } from '../companion/compression/index.mjs'

if (!process.argv[2]) throw new Error('Pass the pinned compress-core checkout path')
const root = path.resolve(process.argv[2])
const original = await import(pathToFileURL(path.join(root, 'engines/rtk/index.js')))
const scenarios = [
  ['git status', 'On branch main\n\nChanges not staged for commit:\n  (use git add)\n modified: file.js'],
  ['npm install', Array(100).fill('Progress: fetching').join('\n') + '\nadded 5 packages\nWARN missing peer'],
  ['docker logs service', Array(100).fill('INFO started server').join('\n') + '\nERROR failed'],
  ['tsc', Array(100).fill('file.ts: error TS1234: invalid').join('\n')],
  ['cat file.txt', Array.from({ length: 200 }, (_, i) => `paragraph ${i}`).join('\n')],
  ['git log', Array.from({ length: 100 }, (_, i) => `commit abcdef${i}\nAuthor: Person\nDate: today\n    change ${i}`).join('\n')],
]
const configurations = [{}, { intensity: 'minimal' }, { intensity: 'aggressive' }, { maxCharsPerResult: 100 }, { enableGrouping: true }, { enabled: false }, { disabledFilters: ['npm-install'] }, { applyToCodeBlocks: true }, { applyToToolResults: false, applyToCodeBlocks: true }, { applyToAssistantMessages: true }, { enabledFilters: ['git-log'], maxLinesPerResult: 2 }]
let checked = 0
for (const protocol of ['chat', 'anthropic']) for (const [command, output] of scenarios) for (const config of configurations) {
  const body = { messages: protocol === 'chat'
    ? [{ role: 'assistant', tool_calls: [{ id: 'a', function: { name: 'bash', arguments: JSON.stringify({ command }) } }] }, { role: 'tool', tool_call_id: 'a', content: output }]
    : [{ role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'bash', input: { command } }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: output }] }] }
  const before = structuredClone(body), left = { protocol, state: {} }, right = { protocol, state: {} }
  assert.equal(apply(body, right, config), original.apply(before, left, config), `${protocol} ${command}: changed flag`)
  assert.deepEqual(body, before, `${protocol} ${command}: output`)
  assert.deepEqual(right.state, left.state, `${protocol} ${command}: stats`)
  checked++
}
for (const name of ['bash', 'read_file']) for (const cache of [undefined, { type: 'ephemeral' }]) for (const config of configurations) {
  const body = { messages: [{ role: 'assistant', content: [{ type: 'tool_use', id: 'a', name, input: { command: 'cat file.py' } }, { type: 'text', text: '```py\n# comment\n\nprint(1)  \n```' }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', cache_control: cache, content: [{ type: 'text', text: Array(20).fill('long repeated line').join('\n') }, { type: 'image', source: { type: 'base64', data: 'fixture' } }] }] }] }
  const old = structuredClone(body), left = { protocol: 'anthropic', state: {} }, right = { protocol: 'anthropic', state: {} }
  assert.equal(apply(body, right, config), original.apply(old, left, config))
  assert.deepEqual(body, old, `${name}: block and option parity`)
  assert.deepEqual(right.state, left.state)
  checked++
}
const workload = { messages: [{ role: 'tool', content: Array(10000).fill('INFO started service successfully').join('\n') }] }
const timings = [[], []], implementations = [original.apply, apply]
for (let round = 0; round < 14; round++) for (const index of round % 2 ? [1, 0] : [0, 1]) {
  const body = structuredClone(workload)
  const start = performance.now()
  implementations[index](body, { protocol: 'chat', state: {} }, {})
  if (round >= 2) timings[index].push(performance.now() - start)
}
const [beforeMs, afterMs] = timings.map(values => values.sort((a, b) => a - b)[6])
console.log(JSON.stringify({ workload: '10000 repeated log lines', beforeMs, afterMs, reductionPercent: (1 - afterMs / beforeMs) * 100 }))
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ofm-pipeline-parity-'))
try {
  await fs.cp(root, temporary, { recursive: true })
  await installCompression(temporary)
  const pipeline = await import(pathToFileURL(path.join(temporary, 'pipeline.js')))
  const body = { messages: [{ role: 'tool', content: scenarios[1][1] }] }
  pipeline.runPipeline(body, { protocol: 'chat', state: {} }, { strategies: { ccr: false, 'session-dedup': false, llm: false } })
  assert.ok(JSON.stringify(body).length < scenarios[1][1].length)
  assert.equal(await fs.readFile(path.join(temporary, 'engines/rtk/index.js'), 'utf8'), "export { id, apply, configSchema } from './index.mjs'\n")
} finally { await fs.rm(temporary, { recursive: true, force: true }) }
console.log(`${checked} paired engine cases and installed pipeline passed`)
