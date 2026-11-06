# Publishing

How this repository produces a signed marketplace, and what the maintainer does that CI cannot.

## The pipeline

```
packages/<id>/{ofm-plugin.json, main.mjs}
        │  node scripts/build-registry.mjs     (validates, then generates registry.json deterministically)
        ▼
registry.json ──── node scripts/sign-registry.mjs ────► registry.sig
        │                                                    │
        └────────────── pushed to main together ─────────────┘
                             │
        host: fetch registry + sig, verify Ed25519 over canonical form,
              then install: download main.mjs from main.url, check size + sha256,
              static scan, write under the data dir, audit.
```

- `build-registry.mjs` is deterministic: packages sorted by id, tags sorted and deduped, manifest fields in the client's normalized order. `generatedAt` is preserved when nothing but the timestamp would change, so an unchanged tree rebuilds to identical bytes.
- `sign-registry.mjs` signs the parsed registry's canonical form (`stableStringify`: sorted keys, no whitespace) with the Ed25519 private key and self-verifies before writing.
- `validate.mjs --check` is the CI gate: package validation, byte-exact rebuild comparison, digest/size consistency, manifest idempotence, signature verification.

## Adding or updating a package

1. Fork, create `packages/<id>/` with `ofm-plugin.json` + `main.mjs` (see [extension-format.md](extension-format.md); the JSON Schema lives in `schema/ofm-extension.schema.json`).
2. Run locally:
   ```
   node scripts/validate.mjs          # packages only
   node scripts/build-registry.mjs    # regenerate registry.json
   node scripts/sign-registry.mjs --key <path-to-your-key>   # maintainers
   node scripts/validate.mjs --check  # full gate
   ```
   Contributors without the signing key: open the PR with `registry.json` rebuilt but `registry.sig` untouched; the maintainer re-signs (the `sign.yml` workflow does it automatically on merge when the secret is set — but a stale `registry.sig` still fails CI, by design).
3. Open a pull request. CI runs the full gate; a human reviews the source — the scan and the signature gate the pipeline, they do not replace review.
4. On merge to `main`, `sign.yml` rebuilds, re-signs and commits if anything drifted.

Version updates follow the same path: bump `version`, update code, rebuild. The host keeps the previous version on disk for rollback.

## Maintainer setup (once)

### Generate the signing key

```sh
node -e "const c=require('node:crypto'),f=require('node:fs');const{publicKey,privateKey}=c.generateKeyPairSync('ed25519');f.writeFileSync('ofm-extensions-signing-key.pem',privateKey.export({format:'pem',type:'pkcs8'}));console.log(publicKey.export({format:'der',type:'spki'}).toString('base64'))"
```

- Keep the PEM **outside** the repository.
- Pin the printed SPKI base64 in `docs/security.md` **and** `scripts/validate.mjs` (`PINNED_PUBLIC_KEY_SPKI`) — and in the host's `PINNED_EXTENSIONS_PUBLIC_KEY` when the key ever changes (see [security.md](security.md#key-rotation)).

### Set the CI secret

```sh
gh secret set OFM_EXTENSIONS_SIGNING_KEY < ofm-extensions-signing-key.pem -R Ebony-Vinyl/ofm-extensions
```

With the secret present, `sign.yml` rebuilds and re-signs the registry on every push to `main` and commits the result as `github-actions[bot]`. Without it, the workflow skips with a warning and `validate.mjs --check` keeps failing loudly until someone signs.

### Cutting a release

Tags are plain semver (`v0.1.0`) over main with `registry.json` and `registry.sig` in sync. `gh release create v0.1.0 --generate-notes` (or with explicit notes) is enough; the release is a bookmark, the registry is the product.

## Local development

Everything here is dependency-free Node (≥ 22, for the sandbox's `vm.SourceTextModule`):

```sh
node scripts/validate.mjs [--check]
node scripts/build-registry.mjs
node scripts/sign-registry.mjs --key <pem>
```

To exercise the *host* against this marketplace locally: serve this directory over loopback HTTP, set `OFM_EXTENSIONS_REGISTRY=http://127.0.0.1:<port>/registry.json` and `OFM_EXTENSIONS_PUBLIC_KEY=<SPKI base64>` (a loopback registry re-signs with an ephemeral key), then install from the plugin's extensions page. The host accepts loopback `http` registry sources and package URLs precisely for this.
