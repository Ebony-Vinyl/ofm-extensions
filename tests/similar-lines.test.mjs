import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeLine, groupSimilarLines } from '../companion/compression/similar-lines.mjs'

test('normalizes timestamps, identifiers, versions and counts without altering words', () => {
  assert.equal(normalizeLine(' 2026-01-01T10:00:00.123Z abcdef v1.2.3 count 42 '), '<N> <N> <N> count <N>')
  assert.equal(normalizeLine('[2026-01-01  10:00:00] task_name'), '[<N>] task_name')
  assert.equal(normalizeLine('v1.1234567.2'), 'v1.<N>.<N>')
  assert.equal(normalizeLine('202026-01-01T10:00:00Z'), '<N><N>')
})

test('groups adjacent patterns once and preserves intervening lines', () => {
  assert.deepEqual(groupSimilarLines('task 1\r\ntask 2\r\ntask 3\r\nstop\r\ntask 4'), {
    text: 'task 1 [rtk:grouped ×3]\nstop\ntask 4', grouped: 2,
  })
  assert.deepEqual(groupSimilarLines('task 1\ntask 2', { threshold: 3 }), { text: 'task 1\ntask 2', grouped: 0 })
})
