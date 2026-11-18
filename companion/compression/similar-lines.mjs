export function normalizeLine(line) {
  // Separate passes matter: a long numeric version component is an identifier first.
  return line.replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?/g, '<N>')
    .replace(/\[\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\]/g, '[<N>]')
    .replace(/\b[\da-fA-F]{6,40}\b/g, '<N>')
    .replace(/\bv?\d+\.\d+\.\d+(?:\.\d+)*\b/g, '<N>')
    .replace(/\b\d+\b/g, '<N>')
    .replace(/\s+/g, ' ').trim()
}

export function groupSimilarLines(text, { threshold = 3 } = {}) {
  const minimum = Math.max(2, Math.floor(threshold ?? 3))
  const output = []
  let key, pending = [], count = 0, grouped = 0
  function flush() {
    if (count >= minimum) {
      output.push(`${pending[0]} [rtk:grouped ×${count}]`)
      grouped += count - 1
    } else for (const line of pending) output.push(line)
  }
  let start = 0
  while (start <= text.length) {
    const newline = text.indexOf('\n', start)
    const end = newline < 0 ? text.length : newline
    const line = text.slice(start, newline >= 0 && text[end - 1] === '\r' ? end - 1 : end)
    const nextKey = normalizeLine(line)
    if (count && nextKey !== key) { flush(); pending = []; count = 0 }
    count++
    if (count < minimum || pending.length === 0) pending.push(line)
    key = nextKey
    if (newline < 0) break
    start = newline + 1
  }
  flush()
  return { text: output.join('\n'), grouped }
}
