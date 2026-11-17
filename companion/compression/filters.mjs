// Each row describes one supported output format; execution lives in line-filter.mjs.
const formats = [
  ['git-status', 95, 80, 12, 20, {
    stripPatterns: ['^\\s*$', '^\\s*\\(use .*\\)$'],
    keepPatterns: ['^On branch ', '^Your branch ', '^Changes ', '^Untracked files:', '^\\s*(modified|new file|deleted|renamed|both modified):', '^\\s*[MADRCU?!]{1,2}\\s+'],
    priorityPatterns: ['^Changes ', '^Untracked files:'],
  }],
  ['git-diff', 94, 180, 40, 50, {
    stripPatterns: ['^index [0-9a-f]+\\.\\.[0-9a-f]+.*$', '^--- a/', '^\\+\\+\\+ b/'],
    priorityPatterns: ['^diff --git ', '^@@ ', '^[+-](?![+-]{2})'],
    collapsePatterns: ['^\\s*$'], deduplicate: true,
  }],
  ['build-typescript', 93, 120, 20, 40, {
    keepPatterns: ['TS\\d{4}:', 'error TS\\d{4}', '^Found \\d+ errors?'],
    priorityPatterns: ['TS\\d{4}', 'Found \\d+'],
  }],
  ['docker-logs', 84, 120, 20, 60, {
    stripPatterns: ['^Attaching to ', '^\\s*$'],
    keepPatterns: ['ERROR', 'WARN', 'Exception', 'Traceback', 'failed', 'listening', 'started'],
    priorityPatterns: ['ERROR', 'Exception', 'failed', 'started', 'listening'],
    collapsePatterns: ['INFO'], stripAnsi: true, deduplicate: true,
  }],
  ['error-stacktrace', 70, 80, 25, 30, {
    keepPatterns: ['Error:', 'Exception:', 'Traceback', '^\\s+at ', '^panic:', '^thread ', '^Caused by:'],
    priorityPatterns: ['Error:', 'Exception:', '^panic:', 'Traceback', 'Caused by:'],
    collapsePatterns: ['^\\s+at '], stripAnsi: true, deduplicate: true,
  }],
  ['git-log', 70, 120, 40, 20, {
    stripPatterns: ['^Author: ', '^Date: ', '^\\s*$'],
    keepPatterns: ['^commit [0-9a-f]{7,40}', '^\\s{4}\\S'], priorityPatterns: ['^commit '],
  }],
  ['npm-install', 65, 80, 20, 30, {
    stripPatterns: ['^\\s*$', '^\\s*\\|', '^Progress:'],
    keepPatterns: ['added \\d+ packages', 'removed \\d+ packages', 'changed \\d+ packages', 'audited \\d+ packages', 'vulnerabilities', 'WARN', 'ERR!'],
    priorityPatterns: ['WARN', 'ERR', 'vulnerabilities'],
  }],
  ['generic-output', 10, 120, 35, 45, { priorityPatterns: ['error', 'failed', 'exception', 'traceback'] }],
]

export const filters = formats.map(([id, priority, maxLines, preserveHead, preserveTail, rules]) => ({
  id, priority, maxLines, preserveHead, preserveTail,
  stripPatterns: ['^\\s*$'], keepPatterns: [], collapsePatterns: [], priorityPatterns: [],
  replace: [], matchOutput: [], stripAnsi: false, filterStderr: false, truncateLineAt: 0,
  deduplicate: false, onEmpty: '', ...rules,
}))

const selection = [
  [/^git\s+status\b/i, /^On branch |^Changes (?:not staged|to be committed)|^Untracked files:/im],
  [/^git\s+(?:diff|show)\b/i, /^diff --git |^@@\s+-\d+,\d+\s+\+\d+,\d+\s+@@/im],
  [/^(?:tsc|npm\s+run\s+typecheck)\b/i, /TS\d{4}:|error TS\d{4}/im],
  [/^docker\s+(?:compose\s+)?logs\b/i, /\b(?:ERROR|WARN|INFO)\b|^Attaching to /im],
  [null, /Traceback \(most recent call last\):|^\s+at\s+|^panic: /im],
  [/^git\s+log\b/i, /^commit [0-9a-f]{7,40}|^Author: /im],
  [/^(?:npm|pnpm|yarn)\s+(?:install|add|update)\b/i, /added \d+ packages|packages are looking for funding|audited \d+ packages/im],
  [null, /Error:|Exception:|Traceback \(most recent call last\):/im],
]

export function selectFilter(text, detection) {
  const type = detection.type === 'generic-error' ? 'generic-output' : detection.type
  const direct = filters.find(filter => filter.id === type)
  if (direct) return direct
  const byCommand = selection.findIndex(([pattern]) => detection.command && pattern?.test(detection.command))
  if (byCommand >= 0) return filters[byCommand]
  const byContent = selection.findIndex(([, pattern]) => pattern.test(text))
  return filters[byContent < 0 ? filters.length - 1 : byContent]
}
