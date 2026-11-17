import assert from 'node:assert/strict'
import test from 'node:test'
import { deduplicateRepeatedLines } from '../companion/compression/repeated-lines.mjs'

test('folds consecutive runs, preserving blank lines and a final newline', () => {
  assert.deepEqual(deduplicateRepeatedLines('a\na\na\n\n\n\nb\nb\n'), {
    text: 'a\n[line repeated 2x]\n[rtk:dropped 2 repeated lines]\n\n\n\nb\nb\n', collapsed: 2,
  })
})

test('normalizes CRLF but retains a standalone carriage return', () => {
  assert.deepEqual(deduplicateRepeatedLines('x\r\nx\r\nx\r\nend\r'), {
    text: 'x\n[line repeated 2x]\n[rtk:dropped 2 repeated lines]\nend\r', collapsed: 2,
  })
})

test('honors the configured threshold and never merges separated runs', () => {
  assert.deepEqual(deduplicateRepeatedLines('a\na\nb\na\na', { threshold: 4 }), {
    text: 'a\na\nb\na\na', collapsed: 0,
  })
  assert.equal(deduplicateRepeatedLines('a\na', { threshold: 1 }).collapsed, 1)
})
