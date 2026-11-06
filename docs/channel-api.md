# The channel API

A channel extension is a model lane. It declares which models exist and turns one harness request into `{ url, headers, wire }`; the host performs the actual HTTP and SSE through the same shared streaming core the built-in lanes use. Channels are deliberately thin — no streaming, no retries, no usage accounting live in extension code.

```js
import { sdk } from 'ofm:sdk'

export default {
  async listModels(ctx) { /* return rows */ },
  async prepareChat(ctx, req) { /* return { url, headers, wire } */ },
}
```

`prepareChat` is required; `listModels` is optional (and unused when the manifest carries a static `models` list — see below).

## The context: `ctx`

Every hook receives one context object:

| property | what it is |
| --- | --- |
| `ctx.config` | The user's saved settings for this package, keyed by the manifest's `config` fields. |
| `ctx.manifest` | The package's manifest as installed (id, version, permissions, …). |
| `ctx.meta` | `{ id, version, type, host }` — the module's own identity and the host version. |
| `ctx.log(...args)` | Lines land in the host's log, prefixed with the package id, each capped at 500 characters. |
| `ctx.fetch(url, init)` | Outbound HTTP, JSON in and out. See below. |
| `ctx.secrets.get(key)` | One of the manifest's declared `permissions.secrets`, or `null` when unset. Values are stored by the host, masked in the API, and never appear in request bodies the UI shows. |
| `ctx.storage` | `get(key)` / `set(key, value)` / `delete(key)` — a small per-package JSON store, only when `permissions.storage` is true. |

### `ctx.fetch`

```js
const response = await ctx.fetch('https://api.example.com/v1/models', { headers: { accept: 'application/json' } })
if (response.ok) {
  const payload = response.json()   // parsed JSON, throws if the body is not JSON
  // response.status, response.ok, response.headers, response.text also available
}
```

- Only http(s) URLs; redirects are refused.
- The URL's **origin** must be one of the manifest's `permissions.network` origins — exact origin match, no wildcards. This is the fence: a package can only ever talk to the hosts its reviewed manifest names.
- The body may be a string or an object (objects are JSON-encoded for you).

## `listModels(ctx)`

Return an array of model rows. Every field is optional except `id`:

```js
return rows.map(row => ({
  id: row.id,                    // required, 1..128 chars — sent upstream as body.model
  name: row.name,                // display name
  contextWindow: 131072,         // tokens; default 131072
  maxOutput: 16384,              // tokens; default min(32768, contextWindow)
  vision: false,                 // image input
  reasoning: true,               // thinking controls shown
  wire: 'chat',                  // 'chat' | 'responses' | 'messages'; default 'chat'
}))
```

Rows with a repeated `id` are dropped. If the manifest carries a static `models` list, the host serves it directly and **never calls `listModels`** — ship the hook anyway when you can do better than the static list (future hosts may prefer it), but keep the manifest list as the honest floor.

## `prepareChat(ctx, req)`

`req` is the harness request: `{ model, wire, messages, tools, maxTokens, temperature, sessionId }`. Return:

```js
return {
  url: 'https://api.example.com/v1/chat/completions',
  headers: { authorization: 'Bearer ' + key },   // optional
  wire: 'chat',                                   // 'chat' | 'responses' | 'messages'
}
```

- The returned `url`'s origin must be in `permissions.network` — the host enforces this again at call time, so a computed URL cannot wander.
- `headers` ride the upstream call as-is, except the hop-by-hop set (`host`, `content-length`, `connection`, `transfer-encoding`, `cookie`) which the host strips. Credentials belong here, never in the body.
- The host builds the body: it starts from the harness payload, forces `model` to the row's `id` and `stream: true`, and adds `stream_options.include_usage` on the chat wire. A channel may return its own `body` (a JSON object) to replace the payload entirely — the model and stream flags are still forced.
- The returned `wire` (if one of the three) decides which streaming dialect the host speaks to `url`.

### The wires

| wire | endpoint shape | body dialect |
| --- | --- | --- |
| `chat` | OpenAI `/chat/completions` | `messages[]`, `max_tokens`, `temperature`, SSE `choices[].delta` |
| `responses` | OpenAI `/responses` | `input[]`, `instructions`, `max_output_tokens` |
| `messages` | Anthropic `/v1/messages` | `messages[]` + `system` string, `max_tokens` (required upstream), `x-api-key` header, SSE `content_block_delta` |

### The origin fence in practice

Origins are pinned in the signed manifest, so a generic "compatible" channel declares the origins its marketplace copy serves. The shipped `openai-compatible` package, for example, serves `https://api.openai.com` plus the common loopback dev ports (`11434` Ollama, `1234` LM Studio, `8080` llama.cpp, `8000` vLLM); `anthropic-compatible` serves `https://api.anthropic.com`. Pointing them at another origin needs one more origin in the manifest — a one-line pull request, which is the point: permissions are reviewed, not configured.

## A complete minimal channel

See `packages/kilo-free/` in this repository — a keyless channel with a live `listModels`, a static fallback shelf, and a four-line `prepareChat`. `packages/openai-compatible/` shows the config-driven shape with a fenced base URL and an optional secret.
