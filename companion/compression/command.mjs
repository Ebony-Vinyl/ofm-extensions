// Recognize the last top-level command without executing or expanding shell text.
export function lastCommandSegment(command) {
  let quote = '', depth = 0, start = 0, last = '', separated = false
  for (let i = 0; i < command.length; i++) {
    const char = command[i]
    if (char === '\\' && quote !== "'") { i++; continue }
    if (quote) {
      if (char === quote) quote = ''
      continue
    }
    if (char === "'" || char === '"' || char === '`') { quote = char; continue }
    if (char === '(') { depth++; continue }
    if (char === ')' && depth) { depth--; continue }
    if (depth) continue
    const double = (char === '&' || char === '|') && command[i + 1] === char
    if (char !== ';' && !double) continue
    const part = command.slice(start, i).trim()
    if (part) last = part
    separated = true
    if (double) i++
    start = i + 1
  }
  return separated ? command.slice(start).trim() || last || command : command
}
