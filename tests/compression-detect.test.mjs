import test from 'node:test'
import assert from 'node:assert/strict'
import { detectCommandType } from '../companion/compression/detect.mjs'

test('explicit command wins weak evidence and stronger output wins weak command evidence', () => {
  assert.equal(detectCommandType('Author: A', 'git status').type, 'git-status')
  assert.equal(detectCommandType('On branch main\nChanges not staged\nUntracked files:', 'git log').type, 'git-status')
})
test('command inference is limited to four lines and respects composite commands', () => {
  assert.equal(detectCommandType('$ git fetch && git status').command, 'git status')
  assert.equal(detectCommandType('a\nb\nc\nd\ngit status').command, null)
  assert.equal(detectCommandType('ordinary document').type, 'unknown')
})

test('build, package and shell evidence selects the expected output format', () => {
  for (const [command, type] of [['npm install', 'npm-install'], ['tsc', 'build-typescript'], ['docker compose logs', 'docker-logs'], ['uv sync', 'uv-sync'], ['rg text', 'shell-grep'], ['npx playwright test', 'playwright']]) {
    assert.equal(detectCommandType('', command).type, type)
  }
  assert.equal(detectCommandType('Traceback (most recent call last):').type, 'error-stacktrace')
  assert.equal(detectCommandType('app.ts: error TS1234: bad').type, 'build-typescript')
})
