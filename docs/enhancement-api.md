# The enhancement API

An enhancement extension does not add a lane — it observes or rewrites what already flows. Enhancements install **disabled** (a body rewriter is opt-in) and every hook is **fail-open**: if a hook throws, hangs (2s for `onRequest`/`onModels`, 1s for `onUsage`) or returns something unusable, the host logs it and the request ships unchanged. An enhancement can degrade a turn's extras, never the turn.

```js
export default {
  onRequest(ctx, body, meta) { return body },
}
```

The default export carries the hooks the manifest's `hooks` array declares. Each receives `(ctx, …)` — the same context object channels get ([channel-api.md](channel-api.md)) — plus the payload.

## `onRequest(ctx, body, meta)` — rewrite one outgoing body

Called with the fully built upstream body, just before the host sends it, and with `meta = { model, wire, sessionId }`. Return the replacement body (a plain JSON object) or the original.

What `body` looks like depends on `meta.wire`:

| wire | system prompt lives in | sampling limits |
| --- | --- | --- |
| `chat` | `body.messages[0]` where `role === 'system'` | `max_tokens` (also accept `max_completion_tokens`) |
| `responses` | `body.instructions` (string) | `max_output_tokens` |
| `messages` | `body.system` (string) | `max_tokens` (required upstream) |

Rules of the road:

- **Clone before mutating** — `return { ...body, … }` or mutate a copy. The object you return is what ships; the one you were handed belongs to the caller.
- Never touch `model` or `stream` — the host forces them after your hook returns, but a rewriter that mangles them is broken by review.
- Returning a non-object, throwing, or timing out all mean "ship it unchanged".

The shipped `param-override` package is the reference rewriter (cap `max_tokens`, optionally drop `temperature`); `system-prompt` shows per-wire prompt injection across all three shapes.

## `onModels(ctx, rows, meta)` — filter the model listing

Called with the merged model rows during a **list refresh** and expected to return the filtered array:

```js
async onModels(ctx, rows, meta) {
  return rows.filter(row => /* … */)
}
```

> **Reserved hook.** The current host invokes `onModels` only while refreshing its model listing, not on every catalog read — so a filter only bites when the list is actually refreshed. Declare it, implement it defensively (`Array.isArray(rows)` first), and treat it as forward-looking; `onRequest` is the only hook with per-turn reach today.

The shipped `model-filter` package declares both `onRequest` (pass-through) and `onModels` (the actual filter) so its manifest already matches the full contract.

## `onUsage(ctx, record, meta)` — observe usage

Called fire-and-forget with the turn's usage record after it completes. The return value is ignored and the record must not be mutated — this is an observation point for accounting extensions. Timeouts after 1s; failures are logged and dropped.

## Config

Enhancements read their settings from `ctx.config` exactly like channels — with one wrinkle: the host renders config defaults in its settings UI, but `ctx.config` stays **empty until the user actually saves**. Read settings through a saved-or-manifest-default lookup so an unconfigured package behaves exactly as its documented default says:

```js
function configured(ctx, key) {
  const saved = ctx.config?.[key]
  if (saved !== undefined) return saved
  const field = Array.isArray(ctx.manifest?.config) ? ctx.manifest.config.find(row => row?.key === key) : null
  return field !== null && typeof field === 'object' ? field.default : undefined
}
```

Prefer defaults that mean "do no harm": `param-override`'s 8192 cap only lowers values the harness would reject anyway, `system-prompt`'s empty prompt disables it, `model-filter`'s empty hide-list filters nothing. (Saved values reach a running module on its next start — the host snapshots config at load; secrets, by contrast, are read live from the host side on every `secrets.get`.)
