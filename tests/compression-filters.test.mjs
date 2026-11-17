import assert from 'node:assert/strict'
import test from 'node:test'
import { filters } from '../companion/compression/filters.mjs'
import { applyLineFilter } from '../companion/compression/line-filter.mjs'

test('Git status keeps changed paths and removes usage guidance', () => {
  const filter = filters.find(row => row.id === 'git-status')
  const result = applyLineFilter('On branch main\n\nChanges not staged for commit:\n  (use git add)\n  modified: src/app.js', filter)
  assert.equal(result.text, 'On branch main\nChanges not staged for commit:\n  modified: src/app.js')
})
test('install and compiler formats retain actionable diagnostics', () => {
  assert.equal(applyLineFilter('Progress: 100\nadded 2 packages\nWARN dependency\n', filters.find(row => row.id === 'npm-install')).text, 'added 2 packages\nWARN dependency')
  assert.equal(applyLineFilter('banner\napp.ts: error TS1234: invalid\nFound 1 error', filters.find(row => row.id === 'build-typescript')).text, 'app.ts: error TS1234: invalid\nFound 1 error')
})
