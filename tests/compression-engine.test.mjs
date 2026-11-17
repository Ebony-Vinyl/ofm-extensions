import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../companion/compression/index.mjs'

test('compresses shell output in Chat and preserves call pairing', () => {
  const body = { messages: [{ role: 'assistant', tool_calls: [{ id: 'a', function: { name: 'bash', arguments: '{"command":"npm install"}' } }] }, { role: 'tool', tool_call_id: 'a', content: 'Progress: '.repeat(100) + '\nadded 2 packages\nWARN dependency' }] }
  const ctx = { protocol: 'chat', state: {} }
  assert.equal(apply(body, ctx, {}), true)
  assert.equal(body.messages[1].content, 'added 2 packages\nWARN dependency')
  assert.equal(body.messages[1].tool_call_id, 'a')
  assert.ok(ctx.state.rtk.rulesApplied.includes('npm-install:keep'))
})
test('leaves document reads, disabled engines and unsupported protocols unchanged', () => {
  const body = { messages: [{ role: 'tool', content: Array.from({ length: 300 }, (_, i) => `paragraph ${i}`).join('\n') }] }
  const before = structuredClone(body)
  assert.equal(apply(body, { protocol: 'chat' }, {}), false)
  assert.deepEqual(body, before)
  assert.equal(apply(body, { protocol: 'chat' }, { enabled: false }), false)
  assert.equal(apply(body, { protocol: 'responses' }, {}), false)
})
