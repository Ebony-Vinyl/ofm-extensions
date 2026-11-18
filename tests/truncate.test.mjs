import assert from 'node:assert/strict'
import test from 'node:test'
import { smartTruncate } from '../companion/compression/truncate.mjs'

test('keeps unchanged text byte-for-byte below the limits', () => {
  assert.deepEqual(smartTruncate('a\r\nb', { maxLines: 3 }), { text: 'a\r\nb', truncated: false, droppedLines: 0 })
})
test('retains head, distinct priority lines and tail in contract order', () => {
  assert.deepEqual(smartTruncate('first\nnoise\nERROR detail\nnoise\nlast', {
    maxLines: 3, preserveHead: 1, preserveTail: 1, priorityPatterns: [/ERROR/],
  }), { text: 'first\n[rtk:truncated 2 lines]\nERROR detail\nlast', truncated: true, droppedLines: 2 })
})
test('character budget preserves a short error among long ordinary lines', () => {
  const input = ['a'.repeat(200), 'ERROR bad', ...Array(20).fill('normal'.repeat(40)), 'z'.repeat(200)].join('\n')
  const result = smartTruncate(input, { maxChars: 120, priorityPatterns: [/ERROR/] })
  assert.ok(result.truncated)
  assert.ok(result.text.length <= 120)
  assert.ok(result.text.includes('ERROR bad'))
  assert.equal(smartTruncate(input, { maxChars: 3 }).text.length, 3)
})
