/**
 * my-channel — rename me, then fill in prepareChat.
 *
 * A channel extension turns one harness request into `{ url, headers, body,
 * wire }`. The host performs the actual HTTP and SSE; this module only names
 * where the turn goes. Everything the module touches arrives on `ctx`:
 *
 *   ctx.config    — the values the user saved for this package's `config` fields
 *   ctx.secrets   — { get(key) }, only for names the manifest's permissions
 *                   declare; values go in and never come back out
 *   ctx.storage   — { get / set / delete }, when permissions.storage is true
 *   ctx.log       — log lines, visible in the host's run log
 *   ctx.meta      — { id, version, type, host }
 *   ctx.fetch     — outbound HTTP, each call checked against the declared
 *                   network origins; use it for anything prepareChat needs to
 *                   look up before answering (a token, a model list)
 *
 * The sandbox allows exactly one module specifier: `ofm:sdk`. No require, no
 * process, no filesystem, no sockets of its own. See docs/channel-api.md for
 * the full contract, docs/extension-format.md for every manifest field.
 */
import { sdk } from 'ofm:sdk'

export default {
  /**
   * Optional. Return the model rows this channel serves when the manifest's
   * static `models` list is not enough (e.g. the upstream names them for you).
   * Omit it and the manifest list is used as-is.
   */
  async listModels(ctx) {
    return [
      {
        id: 'example-model',
        name: 'Example Model',
        contextWindow: 131072,
        maxOutput: 16384,
        vision: false,
        reasoning: false,
        wire: 'chat',
      },
    ]
  },

  /**
   * Required. `req` carries { model, wire, messages, tools, maxTokens,
   * temperature, sessionId }. Return where the turn goes; the host appends
   * `stream: true` and never lets this module change the model or the stream
   * flag. Every header here rides the outgoing request except the hop-by-hop
   * set (host, content-length, connection, transfer-encoding, cookie).
   */
  async prepareChat(ctx, req) {
    const key = await ctx.secrets.get('apiKey')
    const base = configured(ctx, 'baseUrl') ?? 'https://api.example.com'
    return {
      url: `${trimSlash(base)}/chat/completions`,
      headers: key ? { authorization: `Bearer ${key}` } : {},
      wire: 'chat',
      // `body` is optional: omit it and the harness payload ships as-is.
    }
  },

  /**
   * Optional. The host's settings page runs this once on demand and shows the
   * verdict on the card — a good place to ping the endpoint with a tiny
   * request. Keep it cheap; it has the same timeout as every other hook.
   */
  async selfTest(ctx) {
    return { ok: true, detail: 'nothing to test yet' }
  },
}

/** The saved value, or the manifest default while the user has saved none —
 * the host renders defaults in its settings UI but keeps ctx.config empty
 * until the user actually saves. */
function configured(ctx, key) {
  const saved = ctx.config?.[key]
  if (saved !== undefined) return saved
  const field = Array.isArray(ctx.manifest?.config)
    ? ctx.manifest.config.find(row => row !== null && typeof row === 'object' && row.key === key)
    : null
  return field !== null && typeof field === 'object' ? field.default : undefined
}

function trimSlash(value) {
  return String(value ?? '').replace(/\/+$/, '')
}
