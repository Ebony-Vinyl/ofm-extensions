# Contributing

Thanks for wanting to publish here. The short version: **one package per pull request, one directory, two files, no dependencies.**

## What a package is

```
packages/<your-id>/
  ofm-plugin.json   the manifest (validated against schema/ofm-extension.schema.json)
  main.mjs          the module (the only file the host downloads)
```

- `<your-id>` is lowercase, `/^[a-z][a-z0-9-]{1,47}$/`, and must equal the manifest's `id`. It is immutable once published — it is the install key on every user's machine.
- Read [docs/extension-format.md](docs/extension-format.md) for the manifest fields, and the API doc for your type: [channel](docs/channel-api.md) or [enhancement](docs/enhancement-api.md).
- The fastest start is the scaffold — it copies [template/](template/) into `packages/<id>/` and validates immediately:
  ```sh
  node scripts/new-package.mjs <your-id> --author "Your Name"
  ```
- Otherwise copy an existing package as the shape reference — `kilo-free` (channel with a live list), `openai-compatible` (config-driven), `param-override` (enhancement).

## The rules the scanner enforces (so you can write for them)

Your `main.mjs`:

- may name exactly one import: `import { sdk } from 'ofm:sdk'` (and may skip imports entirely — hooks receive everything via `ctx`);
- must not name `require(`, `process`, `globalThis`, `global.`, `Function(`, `eval(`, `WebAssembly`, `importScripts`, `child_process`, `worker_threads`, the `node:*` built-ins the sandbox withholds, or a dynamic `import(` — anywhere outside strings and comments;
- must keep every line ≤ 500 characters (max 2 exceptions) and the file ≤ 256 KB — no bundles, no minified output, nothing a reviewer cannot read as a diff;
- must not contain the word "import" in comments or strings — the import check reads raw text.

Everything else is policy, enforced by `scripts/validate.mjs`: honest non-empty `description` and `summary`, an explicit `default` for every config field, `replaces` only for lanes the marketplace lets go (currently `kilo`), https-only non-loopback network origins, secrets declared before used.

## The workflow

1. Fork, branch, add your package directory.
2. Regenerate the registry — the build refuses to run when a package is broken:
   ```sh
   node scripts/validate.mjs
   node scripts/build-registry.mjs
   node scripts/validate.mjs --check
   ```
3. Commit the package **and** the rebuilt `registry.json`. Do not touch `registry.sig` unless you hold the signing key (see below).
4. Open the PR. CI runs the full gate; a maintainer reviews the source. The scan and the signature gate the pipeline — they do not replace review. Expect comments on error handling (fail-open), origin fences (no more origins than you need) and honesty of model metadata.

## Versioning

Semver. Bump `version` on every change to your package; CI verifies the registry matches. `minHost` moves up only when your module genuinely needs a newer host bridge. When you bump, prepend one line to `changelog` (≤ 200 chars, newest first) — that is what the marketplace detail view renders as "what's new".

## Duplicates

Duplicates are judged by the **service** a package talks to, not by its package shape: two packages that wrap the same upstream service compete; two packages with a similar shape that talk to different services do not. A duplicate must say, in the PR description, the README and the registry `summary`, how it differs — sign-in method, endpoints, capabilities — or it will not merge.

## Testing before you PR

The host can install an unsigned local directory so you can exercise your package end-to-end without a registry round trip:

1. Build it where the host runs: `node scripts/new-package.mjs <id> --author "You"` (or copy an existing package of the same kind and rename it).
2. `node scripts/validate.mjs` — the same gate CI runs.
3. In the host console (desktop 独立端 or dsh 设置页) open the plugin/extension center, enable **developer mode**, and install the directory with an explicit unsigned-package acknowledgement. The card is badged 「未验证」 and runs in the same sandbox as any market install.
4. Iterate on `main.mjs` and reinstall; every install re-scans and re-verifies.

## Maintainers: signing

Only maintainers hold the Ed25519 private key (PEM outside the repo + the `OFM_EXTENSIONS_SIGNING_KEY` Actions secret). After merging a PR whose author could not re-sign, run:

```sh
node scripts/build-registry.mjs
node scripts/sign-registry.mjs
git add registry.json registry.sig && git commit -m "chore: re-sign the registry" && git push
```

On pushes to `main` with the secret set, `sign.yml` does this automatically. A registry whose signature does not verify fails CI loudly — that is the system working.

## Reporting problems

A package behaving badly, a scan bypass, a signature concern — see [SECURITY.md](SECURITY.md).
