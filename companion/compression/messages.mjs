const isText = part => part && (part.type === 'text' || part.type === undefined) && typeof part.text === 'string'
const isResult = part => part?.type === 'tool_result' && typeof part.tool_use_id === 'string'
const cached = part => part.cache_control !== undefined && part.cache_control !== null
const fenced = content => typeof content === 'string' ? content.includes('```')
  : Array.isArray(content) && content.some(part => isText(part) && part.text.includes('```'))

// Handle protocol structure here; the supplied text processor owns compression rules.
export function compressMessages(body, ctx, config, processText) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.messages) || !config.enabled) return false
  if (ctx?.protocol && !['chat', 'anthropic'].includes(ctx.protocol)) return false
  const calls = new Map()
  for (const message of body.messages) {
    if (message.role !== 'assistant') continue
    for (const call of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
      if (typeof call?.id !== 'string' || !call.id || !call.function) continue
      let args
      try { args = JSON.parse(call.function.arguments) } catch { args = null }
      calls.set(call.id, { name: call.function.name, args })
    }
    if (Array.isArray(message.content)) for (const part of message.content) {
      if (part?.type === 'tool_use' && typeof part.id === 'string' && part.id) calls.set(part.id, { name: part.name, args: part.input })
    }
  }
  function metadata(id) {
    const call = calls.get(id)
    if (!call) return { command: null, skipFilters: false }
    const shell = /\b(bash|shell|terminal|run_command|execute_command|exec|command)\b/.test(String(call.name ?? '').toLowerCase())
    const command = typeof call.args?.command === 'string' ? call.args.command : typeof call.args?.cmd === 'string' ? call.args.cmd : null
    return { command: shell ? command : null, skipFilters: !shell }
  }
  const techniques = new Set(), rules = new Set()
  function text(value, meta) {
    const result = processText(value, meta)
    for (const technique of result.techniquesUsed) techniques.add(technique)
    for (const rule of result.rulesApplied) rules.add(rule)
    return result.compressed ? result.text : value
  }
  const codeOnly = config.applyToCodeBlocks && !config.applyToToolResults && !config.applyToAssistantMessages
  function content(value, meta, protect = false, onlyCode = false) {
    const transform = value => onlyCode ? value.replace(/```[\s\S]*?```/g, block => text(block, {})) : text(value, meta)
    if (typeof value === 'string') return value ? transform(value) : value
    if (!Array.isArray(value)) return value
    let changed = false
    const next = value.map(part => {
      if (!isText(part) || !part.text || (protect && cached(part))) return part
      const nextText = transform(part.text)
      if (nextText === part.text) return part
      changed = true
      return { ...part, text: nextText }
    })
    return changed ? next : value
  }
  let changed = false
  const messages = body.messages.map(message => {
    const results = Array.isArray(message.content) && message.content.some(isResult)
    const eligible = (config.applyToToolResults && results)
      || (message.role === 'tool' && (config.applyToToolResults || (config.applyToCodeBlocks && fenced(message.content))))
      || (message.role === 'assistant' && (config.applyToAssistantMessages || (config.applyToCodeBlocks && fenced(message.content))))
    if (!eligible) return message
    let next
    if (results) {
      let touched = false
      next = message.content.map(part => {
        if (!isResult(part) || cached(part)) return part
        const value = content(part.content, metadata(part.tool_use_id), true)
        if (value === part.content) return part
        touched = true
        return { ...part, content: value }
      })
      if (!touched) next = message.content
    } else next = content(message.content, message.role === 'tool' ? metadata(message.tool_call_id) : {}, false, codeOnly)
    if (next === message.content) return message
    changed = true
    return { ...message, content: next }
  })
  if (!changed) return false
  body.messages = messages
  if (ctx?.state) ctx.state.rtk = { techniquesUsed: [...techniques], rulesApplied: [...rules] }
  return true
}
