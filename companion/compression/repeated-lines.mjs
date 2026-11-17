// Keep the existing summary markers so downstream displays retain their meaning.
export function deduplicateRepeatedLines(text, { threshold = 3 } = {}) {
  const minimum = Math.max(2, Math.floor(threshold ?? 3))
  const output = []
  let previous, count = 0, collapsed = 0
  function flush() {
    if (!count) return
    if (previous.trim() && count >= minimum) {
      output.push(previous, `[line repeated ${count - 1}x]`, `[rtk:dropped ${count - 1} repeated lines]`)
      collapsed += count - 1
    } else {
      for (let index = 0; index < count; index++) output.push(previous)
    }
  }
  let start = 0
  while (start <= text.length) {
    const newline = text.indexOf('\n', start)
    const end = newline < 0 ? text.length : newline
    const line = text.slice(start, newline >= 0 && text[end - 1] === '\r' ? end - 1 : end)
    if (count && line !== previous) { flush(); count = 0 }
    previous = line
    count++
    if (newline < 0) break
    start = newline + 1
  }
  flush()
  return { text: output.join('\n'), collapsed }
}
