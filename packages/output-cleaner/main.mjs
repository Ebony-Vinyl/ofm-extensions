function clean(text) {
  if (typeof text !== 'string') return text
  const withoutAnsi = text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '')
  const lines = withoutAnsi.split('\n')
  return lines.filter((line, i) => i === 0 || line !== lines[i - 1] || !/^\s*(?:(?:\d+%|[=.#-]{3,})(?:\s|$)|(?:Downloading|Progress)\b)/i.test(line)).join('\n')
}
function content(value) {
  if (typeof value === 'string') return clean(value)
  if (!Array.isArray(value)) return value
  return value.map(part => part?.type === 'text' ? { ...part, text: clean(part.text) } : part)
}
export default {
  onRequest(ctx, body, meta) {
    if (!body || typeof body !== 'object') return body
    if (meta.wire === 'responses' && Array.isArray(body.input)) return { ...body, input: body.input.map(item => item?.type === 'function_call_output' ? { ...item, output: content(item.output) } : item) }
    if (!Array.isArray(body.messages)) return body
    return { ...body, messages: body.messages.map(message => {
      if (message?.role === 'tool') return { ...message, content: content(message.content) }
      if (meta.wire !== 'messages' || !Array.isArray(message?.content)) return message
      return { ...message, content: message.content.map(part => part?.type === 'tool_result' ? { ...part, content: content(part.content) } : part) }
    }) }
  },
}
