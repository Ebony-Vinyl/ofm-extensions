import assert from 'node:assert/strict'
import test from 'node:test'
import { lastCommandSegment } from '../companion/compression/command.mjs'

test('selects only the last nonempty top-level command', () => {
  assert.equal(lastCommandSegment('cd project && npm test || git status; '), 'git status')
  assert.equal(lastCommandSegment('  git status  '), '  git status  ')
  assert.equal(lastCommandSegment('git log | head'), 'git log | head')
})
test('ignores separators inside quoted, escaped and nested text', () => {
  for (const command of ["echo 'a;b'", 'echo "a && b"', 'echo `a;b`', 'echo $(first; (second))', 'echo a\\;b']) {
    assert.equal(lastCommandSegment(command), command)
    assert.equal(lastCommandSegment(command + ' && git status'), 'git status')
  }
  assert.equal(lastCommandSegment('echo "$(first; second)" && git status'), 'git status')
})
