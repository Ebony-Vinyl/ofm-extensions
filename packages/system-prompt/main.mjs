/**
 * system-prompt — prepend one configurable system prompt to every turn.
 *
 * Dispatched by meta.wire, because each wire keeps its system prompt in a
 * different place: on the responses wire the prompt prefixes `instructions`;
 * on the Claude messages wire it prefixes the `system` string (a body there
 * also carries a messages array, which must not grow a second system message);
 * on the chat wire it merges into the leading system message of `messages`,
 * or a new one is prepended. An empty prompt disables the enhancement.
 * Fail-open by host design.
 */
export default {
  onRequest(ctx, body, meta) {
    const prompt = String(configured(ctx, 'prompt') ?? '')
    if (prompt.trim() === '') return body
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return body
    const wire = meta !== null && typeof meta === 'object' ? String(meta.wire ?? '') : ''
    if (wire === 'responses') {
      const existing = typeof body.instructions === 'string' ? body.instructions : ''
      return { ...body, instructions: joinPrompt(prompt, existing) }
    }
    if (wire === 'messages') {
      const existing = typeof body.system === 'string' ? body.system : ''
      return { ...body, system: joinPrompt(prompt, existing) }
    }
    if (Array.isArray(body.messages)) {
      const messages = body.messages.slice()
      const first = messages[0]
      if (first !== null && typeof first === 'object' && !Array.isArray(first) && first.role === 'system' && typeof first.content === 'string') {
        messages[0] = { ...first, content: joinPrompt(prompt, first.content) }
        return { ...body, messages }
      }
      return { ...body, messages: [{ role: 'system', content: prompt }].concat(messages) }
    }
    if (typeof body.system === 'string') {
      return { ...body, system: joinPrompt(prompt, body.system) }
    }
    return body
  },
}

/** Prompt first; any existing text keeps its place under it. */
function joinPrompt(prompt, existing) {
  return existing === '' ? prompt : prompt + '\n\n' + existing
}

/** The saved value, or the manifest default while the user has saved none —
 * the host renders defaults in its settings UI but keeps ctx.config empty
 * until the user actually saves. */
function configured(ctx, key) {
  const saved = ctx.config?.[key]
  if (saved !== undefined) return saved
  const field = Array.isArray(ctx.manifest?.config) ? ctx.manifest.config.find(row => row !== null && typeof row === 'object' && row.key === key) : null
  return field !== null && typeof field === 'object' ? field.default : undefined
}
