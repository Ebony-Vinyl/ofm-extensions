import { smartTruncate } from './truncate.mjs'
import { deduplicateRepeatedLines } from './repeated-lines.mjs'

export const severity = /error|fail(?:ed|ure)?|exception|traceback|ts\d{4}|✖|panic|fatal|critical|severe|oomkilled|out of memory|denied|time(?:out|d out)|unreachable|refused|aborted|rollback|corrupt|deadlock/i

function compile(source, flags) {
  try { return new RegExp(source, flags) } catch { return null }
}

export function applyLineFilter(text, filter) {
  const patterns = field => filter[field].map(value => compile(value, 'i')).filter(Boolean)
  const strip = patterns('stripPatterns'), keep = patterns('keepPatterns')
  const collapse = patterns('collapsePatterns'), priority = patterns('priorityPatterns')
  let lines = text.split(/\r?\n/)
  const originalCount = lines.length, appliedRules = []
  const record = name => appliedRules.push(`${filter.id}:${name}`)
  function mapLines(name, transform) {
    let changed = false
    lines = lines.map(line => { const next = transform(line); changed ||= next !== line; return next })
    if (changed) record(name)
  }
  if (filter.stripAnsi) mapLines('strip-ansi', line => line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, ''))
  if (filter.filterStderr) mapLines('filter-stderr', line => line.replace(/^\s*(?:stderr|err)\s*(?:\||:)\s*/i, ''))
  for (const { pattern, replacement } of filter.replace) {
    const regex = compile(pattern, 'g')
    if (regex) mapLines('replace', line => line.replace(regex, replacement))
  }
  const blob = filter.matchOutput.length ? lines.join('\n') : ''
  for (const rule of filter.matchOutput) {
    if (!compile(rule.pattern, 'im')?.test(blob) || (rule.unless && compile(rule.unless, 'im')?.test(blob))) continue
    record('match-output')
    return { text: rule.message, strippedLines: Math.max(0, originalCount - 1), keptByRule: false, appliedRules }
  }
  if (strip.length) {
    lines = lines.filter(line => !strip.some(re => re.test(line)))
    if (lines.length !== originalCount) record('strip')
  }
  if (keep.length) {
    const retained = lines.filter(line => severity.test(line) || keep.some(re => re.test(line)))
    if (retained.length) { lines = retained; record('keep') }
  }
  if (collapse.length) {
    const seen = new Set()
    lines = lines.filter(line => {
      if (!collapse.some(re => re.test(line))) return true
      const key = line.trim()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    record('collapse')
  }
  if (filter.truncateLineAt > 0) mapLines('truncate-line', line => {
    const chars = [...line], cap = filter.truncateLineAt
    return chars.length <= cap ? line : chars.slice(0, cap <= 3 ? cap : cap - 3).join('') + (cap <= 3 ? '' : '...')
  })
  let output = lines.join('\n')
  if (filter.deduplicate) {
    const result = deduplicateRepeatedLines(output)
    if (result.collapsed) { output = result.text; record('deduplicate') }
  }
  const result = smartTruncate(output, { maxLines: filter.maxLines, preserveHead: filter.preserveHead, preserveTail: filter.preserveTail, priorityPatterns: priority })
  if (result.truncated) record('truncate')
  output = !result.text.trim() && filter.onEmpty ? filter.onEmpty : result.text
  return { text: output, strippedLines: Math.max(0, originalCount - output.split(/\r?\n/).length), keptByRule: keep.length > 0, appliedRules }
}
