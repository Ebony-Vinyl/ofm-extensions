# OFM Extensions

**The Our Free Model extension marketplace** — a signed, CI-gated repository of channel and enhancement modules for the [dsh-our-free-model](https://github.com/Ebony-Vinyl/dsh-our-free-model) plugin.

- [简体中文](README.md)

## How it works

The host plugin's extension runtime consumes this repository's `registry.json`:

1. **Verify first** — the registry is signed as a whole with the maintainer's Ed25519 key (`registry.sig`, over the canonically sorted JSON); the client verifies it against a pinned public key and reads nothing on failure.
2. **Then download** — every entry carries its manifest inline plus the byte size and sha256 of its `main.mjs`; code is downloaded only from this registry repo's own mirrors, and a size or digest mismatch refuses the install.
3. **Static scan** — the same scan CI runs is re-run before every install: one legal import (`ofm:sdk`), a banned-API tripwire list (`require`, `process`, `eval`, …), bundles and over-long lines refused.
4. **Sandboxed run** — extensions load inside a `vm.SourceTextModule` sandbox whose only import is the bridged `ofm:sdk`; outbound HTTP is fenced origin-by-origin against the manifest's declared permissions, and secrets, storage and logs all cross as JSON bridge calls.

"Users upload" means "users open a pull request" — the same curation any curated market runs, with a signature the others lack.

## Current catalog

| package | type | tags | what it does |
| --- | --- | --- | --- |
| [`kilo-free`](packages/kilo-free/) | channel | free · gateway · kilo · no-key | The Kilo gateway's free tier, keyless; takes the built-in Kilo lane over (11 models) |
| [`openai-compatible`](packages/openai-compatible/) | channel | chat · compatible · openai · self-hosted | Any OpenAI-compatible `/chat/completions` server (OpenAI, Ollama, LM Studio, llama.cpp, vLLM, loopback proxies) |
| [`anthropic-compatible`](packages/anthropic-compatible/) | channel | anthropic · claude · messages · self-hosted | Any Anthropic-compatible `/v1/messages` server, over the messages wire |
| [`param-override`](packages/param-override/) | enhancement | body · parameters · rewrite | Caps outgoing `max_tokens`, optionally drops `temperature` |
| [`system-prompt`](packages/system-prompt/) | enhancement | prompt · rewrite · system | Prepends one system prompt to every turn, with the correct shape per wire |
| [`model-filter`](packages/model-filter/) | enhancement | catalog · filter · models | Hides catalog models by substring (`onModels` is a reserved hook) |

## Installing

Open the Extensions page in dsh-our-free-model's settings and install from the marketplace. Channels enable on install; enhancements install disabled and are switched on deliberately. Host version ≥ **2.8.1**.

The marketplace page supports search (name / id / summary / tags), type filters (channel / enhancement), sorting (index order / newest / name), a pending-update count with "update all" on the Installed tab, and `/` focuses the search box.

The host refreshes the registry on its own cadence (a TTL cache plus a background timer), so an update published upstream reaches the Installed tab without the user opening the market; when every mirror is unreachable, the host falls back to the signed shelf snapshot shipped with the build, so a first install always has something to see.

## Documentation

- [Extension format](docs/extension-format.md) — manifest fields, registry metadata, scan rules
- [Channel API](docs/channel-api.md) — `listModels` / `prepareChat`, the ctx bridge, the three wires
- [Enhancement API](docs/enhancement-api.md) — `onRequest` / `onModels` / `onUsage`, fail-open semantics
- [Security model](docs/security.md) — signature scheme, pinned key, threat boundary
- [Publishing](docs/publishing.md) — build, sign, CI, key custody

## Contributing

PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). The fastest start is the scaffold:

```bash
node scripts/new-package.mjs my-channel --author "Your Name"
```

It copies a runnable skeleton from [template/](template/) into `packages/<id>/` and immediately runs the same validation CI runs. CI runs the full gate (`node scripts/validate.mjs --check`); on merge to `main`, `sign.yml` rebuilds and re-signs the registry automatically.

## License

[MIT](LICENSE)
