export function smartTruncate(text, options = {}) {
  const chars = Math.max(0, Math.floor(options.maxChars ?? 0))
  const limit = Math.max(0, Math.floor(options.maxLines ?? 0))
  const lines = text.split(/\r?\n/)
  if (!(chars && text.length > chars) && !(limit && lines.length > limit)) {
    return { text, truncated: false, droppedLines: 0 }
  }
  const head = Math.max(0, Math.floor(options.preserveHead ?? 20))
  const tail = Math.max(0, Math.floor(options.preserveTail ?? 20))
  const patterns = options.priorityPatterns ?? []
  const selected = lines.slice(0, head)
  const known = new Set(selected)
  const append = line => { if (!known.has(line)) { known.add(line); selected.push(line) } }
  for (const line of lines) if (patterns.some(pattern => pattern.test(line))) append(line)
  for (let i = Math.max(head, lines.length - tail); i < lines.length; i++) append(lines[i])
  const droppedLines = Math.max(0, lines.length - selected.length)
  selected.splice(Math.min(head, lines.length), 0, `[rtk:truncated ${droppedLines} lines]`)
  let result = selected.join('\n')
  if (chars && result.length > chars) {
    const marker = '\n[rtk:truncated by chars]\n'
    const budget = Math.max(0, chars - marker.length)
    if (!budget) return { text: marker.slice(0, chars), truncated: true, droppedLines }
    const selectedLineCount = result.split(/\r?\n/).length
    const ranked = patterns.map(pattern => ({ pattern, hits: lines.reduce((n, line) => n + Number(pattern.test(line)), 0) }))
      .filter(({ hits }) => hits > 0 && hits * 2 <= selectedLineCount)
      .sort((a, b) => a.hits - b.hits)
    const forced = new Set()
    let used = 0
    for (const { pattern } of ranked) for (const line of lines) {
      if (forced.has(line) || !pattern.test(line)) continue
      if (used + line.length + 1 > Math.floor(budget / 2)) continue
      forced.add(line)
      used += line.length + 1
    }
    const remaining = budget - used
    const front = Math.ceil(remaining * 0.55)
    const back = remaining - front
    const first = result.slice(0, front)
    const last = back ? result.slice(-back) : ''
    const important = [...forced].filter(line => !first.includes(line) && !last.includes(line)).join('\n')
    result = (first + marker + (important ? important + '\n' : '') + last).slice(0, chars)
  }
  return { text: result, truncated: true, droppedLines }
}
