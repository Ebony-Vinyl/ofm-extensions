# The extension format

One OFM extension is one directory under `packages/` with exactly two load-bearing files:

```
packages/<id>/
  ofm-plugin.json   the manifest — signed into the registry as-is (plus metadata)
  main.mjs          the module — the only code the host ever downloads and runs
```

The directory name must equal the manifest's `id`. Anything else in the directory (a README, tests) is for humans; the registry never ships it.

## The manifest: `ofm-plugin.json`

```json
{
  "schemaVersion": 1,
  "id": "my-channel",
  "version": "1.0.0",
  "type": "channel",
  "name": "My Channel",
  "description": "One or two honest sentences about what this does.",
  "author": "Your Name",
  "license": "MIT",
  "homepage": "https://github.com/you/your-repo",
  "repository": "https://github.com/you/your-repo",
    "minHost": "2.8.1",
  "permissions": {
    "network": ["https://api.example.com"],
    "secrets": ["apiKey"],
    "storage": false
  },
  "config": [
    { "key": "region", "type": "text", "label": "Region", "description": "...", "default": "us" }
  ],
  "summary": "One-line card text for the marketplace page.",
  "tags": ["free", "gateway"],
  "publishedAt": "2026-11-07T00:00:00.000Z"
}
```

Field by field (the host's normalization rules, which CI enforces strictly — over-limit or malformed values fail the build rather than being silently trimmed):

| field | rules |
| --- | --- |
| `schemaVersion` | `1`, required. |
| `id` | Required. `/^[a-z][a-z0-9-]{1,47}$/`, must equal the directory name. Immutable once published — it is the install key. |
| `version` | Required. Semver (`x.y.z`, optional `-prerelease`). Bump on every release; the host uses it for updates and rollback. |
| `type` | Required. `channel` (a model lane) or `enhancement` (a body/listing hook). |
| `name` | Optional; defaults to `id`. Max 64 chars. |
| `main` | Optional; must be `main.mjs` (the default). The registry format ships exactly one source file per package. |
| `description` | Required, non-empty, max 400 chars. |
| `author` | Required, non-empty, max 80 chars. |
| `license` | Required SPDX expression (`MIT`, `Apache-2.0`, …). Must match the LICENSE the code actually carries. |
| `homepage`, `repository` | Optional, https URLs. |
| `icon` | Optional string, max 200 chars. |
| `cover` | Optional, display-only: a relative image file name inside the package directory (`cover.png` / `.jpg` / `.jpeg` / `.webp` / `.svg`, ≤ 192 KB). The registry build hashes it like `main.mjs`; the host verifies the digest before rendering it as the marketplace card's banner. An SVG cover must be script-free (no `<script>`, no inline event handlers). |
| `minHost` | Required semver. `2.8.1` is the current platform floor — extensions rely on the sandbox and the bridge. |
| `permissions` | Required object: `network` (up to 8 origins — https always, plain http only for loopback hosts `127.0.0.1` / `localhost` / `[::1]`, with the port when one is used), `secrets` (up to 8 key names matching `/^[\w-]{1,64}$/`), `storage` (boolean). |
| `replaces` | Optional, channels only. The built-in lane this channel takes over. Marketplace policy currently allows only `kilo`. |
| `hooks` | Enhancements only, required, from `onRequest` / `onModels` / `onUsage`. Channels must not declare hooks. |
| `models` | Channels only, optional, up to 256 rows: `{ id (required, 1..128 chars), name, contextWindow, maxOutput, vision, reasoning, wire }`. If present, the host serves this list directly and never calls `listModels`. |
| `config` | Optional, up to 12 fields: `{ key, type, label, description, default, options? }` with `type` ∈ `text` / `password` / `toggle` / `number` / `select`. An explicit `default` is required and must match the type; `select` needs 1–16 `options` containing the default. The host renders these and hands values to the module as `ctx.config`. |

### Registry metadata

Three keys in the same file are not host manifest fields — the host's manifest parser ignores them; the registry builder copies them onto the entry:

- `summary` (≤ 300 chars) — the marketplace card text.
- `tags` (≤ 8) — free-form; the build sorts and dedupes them.
- `publishedAt` — ISO date of first publication. Set it when the package first merges and never change it.

## The module: `main.mjs`

Plain ES module. Exactly one import is legal:

```js
import { sdk } from 'ofm:sdk'
```

(Importing it is optional — hooks receive everything as `ctx`. Any other import specifier fails the scan.) The module default-exports one object:

- **channel**: `async listModels(ctx)` and/or `async prepareChat(ctx, req)` — `prepareChat` is required. See [channel-api.md](channel-api.md).
- **enhancement**: the hooks its manifest declares, e.g. `onRequest(ctx, body, meta)`. See [enhancement-api.md](enhancement-api.md).

Everything a module can do crosses the bridge as JSON: `ctx.fetch` (origin-fenced), `ctx.secrets.get`, `ctx.storage`, `ctx.log`, `ctx.config`, `ctx.manifest`, `ctx.meta`.

### Static scan rules

The host runs the same scan before every install that CI runs at review time. A source fails if it:

- names any import other than `ofm:sdk` (the check reads the raw text — so the word "import" must appear in a source only where it means one, never in comments or strings);
- names, outside of strings and comments: `require(`, `process`, `globalThis`, `global.`, `Function(`, `eval(`, `WebAssembly`, `importScripts`, `child_process`, `worker_threads`, the `node:fs|path|os|net|tls|dns|http|https|module|vm|inspector` specifiers, or a dynamic `import(`;
- carries more than 2 lines longer than 500 characters (bundles and minified output are not reviewable);
- exceeds 256 KB or is empty.

## The registry entry

`scripts/build-registry.mjs` turns each package into one `registry.json` entry: the normalized manifest, plus

```json
"main": { "url": "https://raw.githubusercontent.com/Ebony-Vinyl/ofm-extensions/main/packages/<id>/main.mjs", "size": 1234, "sha256": "…" },
"cover": { "url": "https://raw.githubusercontent.com/Ebony-Vinyl/ofm-extensions/main/packages/<id>/cover.svg", "size": 838, "sha256": "…" },
"summary": "…", "tags": ["…"], "publishedAt": "…"
```

`size` (the source's character count — what the host compares after decoding) and `sha256` are computed from the actual `main.mjs`; the host refuses a download that mismatches either. The `cover` object is present only when the manifest declares one and carries the same promise for the image bytes — the host serves them only after the digest verifies, and a cover that cannot be fetched simply renders no banner. The registry is signed as a whole — see [security.md](security.md).
