import assert from 'node:assert/strict'
import test from 'node:test'
import { applyLineFilter } from '../companion/compression/line-filter.mjs'

const base = { id: 'test', stripPatterns: [], keepPatterns: [], collapsePatterns: [], priorityPatterns: [], replace: [], matchOutput: [], maxLines: 0 }
test('cleanup precedes matching and keep rules retain error output', () => {
  const result = applyLineFilter('\x1b[31mstderr: ERROR bad\x1b[0m\nnoise\nOK', { ...base, stripAnsi: true, filterStderr: true, keepPatterns: ['^OK'] })
  assert.equal(result.text, 'ERROR bad\nOK')
  assert.deepEqual(result.appliedRules, ['test:strip-ansi', 'test:filter-stderr', 'test:keep'])
})
test('summary exceptions, malformed patterns and Unicode truncation', () => {
  const filter = { ...base, matchOutput: [{ pattern: 'done', unless: 'ERROR', message: 'complete' }], stripPatterns: ['['], truncateLineAt: 2 }
  assert.equal(applyLineFilter('done', filter).text, 'complete')
  assert.equal(applyLineFilter('done ERROR\n😀😀😀', filter).text, 'do\n😀😀')
  assert.equal(applyLineFilter('noise', { ...base, stripPatterns: ['noise'], onEmpty: 'empty' }).text, 'empty')
})
