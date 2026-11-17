import test from 'node:test'
import assert from 'node:assert/strict'
import { compressionConfig, lineLimit } from '../companion/compression/config.mjs'
import { compactCodeBlocks } from '../companion/compression/code-blocks.mjs'

test('configuration retains defaults, switches and intensity scaling', () => {
  const config = compressionConfig({ enabled: false, intensity: 'aggressive', maxLinesPerResult: 51.9, enabledFilters: ['git-log', 2] })
  assert.equal(config.enabled, false)
  assert.equal(config.applyToToolResults, true)
  assert.deepEqual(config.enabledFilters, ['git-log'])
  assert.equal(lineLimit(config.maxLinesPerResult, config.intensity), 26)
  assert.equal(lineLimit(0, 'minimal'), 1)
})
test('code block cleanup preserves comments, indentation and surrounding prose', () => {
  const result = compactCodeBlocks('before\n```py\n# comment\n\n  print(1)  \n```\nafter')
  assert.equal(result.text, 'before\n```py\n# comment\n  print(1)\n```\nafter')
  assert.equal(result.changed, 1)
})
