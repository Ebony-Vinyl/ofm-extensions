import { compressionConfig, lineLimit } from './config.mjs'
import { detectCommandType } from './detect.mjs'
import { selectFilter } from './filters.mjs'
import { applyLineFilter, severity } from './line-filter.mjs'
import { deduplicateRepeatedLines } from './repeated-lines.mjs'
import { groupSimilarLines } from './similar-lines.mjs'
import { compactCodeBlocks } from './code-blocks.mjs'
import { smartTruncate } from './truncate.mjs'
import { compressMessages } from './messages.mjs'

export const id = 'rtk'
export { configSchema } from './config.mjs'

export function apply(body, ctx, options) {
  const config = compressionConfig(options)
  return compressMessages(body, ctx, config, (original, { command, skipFilters } = {}) => {
    const detection = detectCommandType(original, command)
    const document = detection.type === 'unknown' && !detection.command && !/Error:|Exception:|Traceback \(most recent call last\):/.test(original)
    const techniques = new Set(), rules = new Set()
    let text = original, priorities = []
    if (!skipFilters && !document) {
      const filter = selectFilter(original, detection)
      if (!config.disabledFilters.includes(filter.id) && (!config.enabledFilters.length || config.enabledFilters.includes(filter.id))) {
        const result = applyLineFilter(text, { ...filter, maxLines: lineLimit(filter.maxLines || config.maxLinesPerResult, config.intensity) })
        text = result.text
        if (result.appliedRules.length) {
          techniques.add('rtk-filter')
          for (const rule of result.appliedRules) rules.add(rule)
        }
        priorities = filter.priorityPatterns.map(pattern => new RegExp(pattern, 'i'))
      }
    }
    function use(result, changed, technique, rule) {
      if (!changed) return
      text = result.text
      techniques.add(technique)
      rules.add(rule)
    }
    if (config.applyToCodeBlocks) {
      const result = compactCodeBlocks(text)
      use(result, result.changed, 'rtk-code-strip', 'rtk:code-strip')
    }
    if (!skipFilters) {
      const result = deduplicateRepeatedLines(text, { threshold: config.deduplicateThreshold })
      use(result, result.collapsed, 'rtk-dedup', 'rtk:dedup')
    }
    if (config.enableGrouping) {
      const result = groupSimilarLines(text, { threshold: config.groupingThreshold })
      use(result, result.grouped, 'rtk-grouping', 'rtk:grouping')
    }
    if (!document) {
      const result = smartTruncate(text, {
        maxLines: lineLimit(config.maxLinesPerResult, config.intensity), maxChars: config.maxCharsPerResult,
        preserveHead: config.intensity === 'aggressive' ? 16 : 24,
        preserveTail: config.intensity === 'aggressive' ? 16 : 24,
        priorityPatterns: [severity, ...priorities],
      })
      use(result, result.truncated, 'rtk-truncate', 'rtk:truncate')
    }
    return { text, compressed: Math.ceil(text.length / 4) < Math.ceil(original.length / 4), techniquesUsed: [...techniques], rulesApplied: [...rules] }
  })
}
