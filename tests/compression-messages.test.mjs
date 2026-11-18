import test from 'node:test'
import assert from 'node:assert/strict'
import { compressMessages } from '../companion/compression/messages.mjs'
import { compressionConfig } from '../companion/compression/config.mjs'

test('pairs calls without changing tool identifiers or image parts', () => {
  const image = { type: 'image', source: { type: 'base64', data: 'fixture' } }
  const body = { messages: [{ role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'bash', input: { command: 'git status' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: [{ type: 'text', text: 'long output' }, image] }] }] }
  const state = {}
  assert.equal(compressMessages(body, { protocol: 'anthropic', state }, compressionConfig(), (text, meta) => {
    assert.equal(meta.command, 'git status')
    return { text: 'short', compressed: true, techniquesUsed: ['filter'], rulesApplied: ['git'] }
  }), true)
  assert.equal(body.messages[1].content[0].tool_use_id, 'a')
  assert.equal(body.messages[1].content[0].content[1], image)
  assert.deepEqual(state.rtk.rulesApplied, ['git'])
})
test('cached Anthropic results and ordinary user text never reach the processor', () => {
  const body = { messages: [{ role: 'user', content: 'ordinary' }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: 'protected', cache_control: { type: 'ephemeral' } }] }] }
  assert.equal(compressMessages(body, { protocol: 'anthropic' }, compressionConfig(), () => assert.fail('protected text processed')), false)
})
