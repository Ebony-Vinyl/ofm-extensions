// Normalize caller-supplied options once, before the compression stages run.
export function compressionConfig(options) {
  const input = options && typeof options === 'object' ? options : {}
  const number = (key, fallback, minimum) => typeof input[key] === 'number'
    ? Math.max(minimum, Math.floor(input[key])) : fallback
  const names = key => Array.isArray(input[key]) ? input[key].filter(value => typeof value === 'string') : []
  return {
    enabled: input.enabled !== false,
    intensity: ['minimal', 'standard', 'aggressive'].includes(input.intensity) ? input.intensity : 'standard',
    applyToToolResults: input.applyToToolResults !== false,
    applyToAssistantMessages: input.applyToAssistantMessages === true,
    applyToCodeBlocks: input.applyToCodeBlocks === true,
    enabledFilters: names('enabledFilters'), disabledFilters: names('disabledFilters'),
    maxLinesPerResult: number('maxLinesPerResult', 120, 0),
    maxCharsPerResult: number('maxCharsPerResult', 0, 0),
    deduplicateThreshold: number('deduplicateThreshold', 3, 2),
    groupingThreshold: number('groupingThreshold', 3, 2),
    enableGrouping: input.enableGrouping === true,
    preserveDocstrings: input.preserveDocstrings !== false,
    customFiltersEnabled: false, trustProjectFilters: false, enableRenderers: false, stripCodeComments: false,
  }
}

export function lineLimit(base, intensity) {
  return Math.max(1, Math.round(base * (intensity === 'minimal' ? 1.5 : intensity === 'aggressive' ? 0.5 : 1)))
}

export const configSchema = [
  { key: 'intensity', type: 'select', label: '强度', defaultValue: 'standard', options: ['minimal', 'standard', 'aggressive'].map(value => ({ value, label: value })) },
  ...[
    ['maxLinesPerResult', '每个结果最多行数', 120, 0, 10000],
    ['maxCharsPerResult', '每个结果最多字符', 0, 0, 1000000],
    ['deduplicateThreshold', '重复行折叠阈值', 3, 2, 100],
    ['groupingThreshold', '分组阈值', 3, 2, 100],
  ].map(([key, label, defaultValue, min, max]) => ({ key, type: 'number', label, defaultValue, min, max })),
  ...[
    ['enableGrouping', '相似行分组', false],
    ['applyToToolResults', '作用于工具结果', true],
    ['preserveDocstrings', '保留文档字符串', true],
  ].map(([key, label, defaultValue]) => ({ key, type: 'boolean', label, defaultValue })),
  { key: 'disabledFilters', type: 'multiselect', label: '停用的内置过滤器', defaultValue: [], options: ['git-status', 'git-log', 'git-diff', 'docker-logs', 'npm-install', 'build-typescript', 'error-stacktrace', 'generic-output'].map(value => ({ value, label: value })) },
]
