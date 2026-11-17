const languageEvidence = [
  ['typescript', /\b(?:interface|type)\s+\w+\s*=|:\s*(?:string|number|boolean)\b/],
  ['javascript', /\b(?:const|let|function|import|export)\b|=>/],
  ['python', /\bdef\s+\w+\(|\bimport\s+\w+|print\(/],
  ['rust', /\bfn\s+\w+\(|\blet\s+mut\b|println!\(/],
  ['go', /\bfunc\s+\w+\(|package\s+\w+/],
  ['java', /\bclass\s+\w+|System\.out\.println/],
  ['ruby', /\bdef\s+\w+|puts\s+|end\s*$/],
]

export function compactCodeBlocks(text) {
  let changed = 0
  const output = text.replace(/```([A-Za-z0-9_+.-]*)\r?\n([\s\S]*?)```/g, (original, hint, code) => {
    const clean = code.replace(/^\s*$(?:\r?\n)?/gm, '').split(/\r?\n/)
      .map(line => line.replace(/[ \t]+$/g, '')).join('\n').replace(/^\s*\n/, '').replace(/\n\s*$/, '')
    if (clean === code.trim() && code.split(/\r?\n/).length <= (clean ? clean.split(/\r?\n/).length : 0)) return original
    changed++
    const language = hint || languageEvidence.find(([, pattern]) => pattern.test(code))?.[0] || 'unknown'
    return '```' + language + '\n' + clean + '\n```'
  })
  return { text: output, changed }
}
