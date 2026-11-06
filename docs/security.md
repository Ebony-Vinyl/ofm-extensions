# Security

This repository is the extension marketplace for the Our Free Model plugin. Every claim in the host's install dialog reduces to four mechanisms, three of them enforced here.

## The signature

The registry (`registry.json`) is signed as a whole with an Ed25519 key. The signature lives in `registry.sig` — base64, over the **canonical form** of the parsed registry document: keys sorted recursively, no whitespace (`stableStringify`; the same routine the host's verifier recomputes, so the signature is over meaning, not byte layout).

The host verifies this signature before it reads a single entry, against this pinned public key (SPKI, DER, base64):

```
MCowBQYDK2VwAyEA7jxuBMdejAlGd9EnkxEpqKpAnxT8vr3sdVBFHxssy/U=
```

That same base64 string is carried in `scripts/validate.mjs` (`PINNED_PUBLIC_KEY_SPKI`) — the pin the host trusts and the pin CI verifies against must be one and the same. The matching **private key exists in exactly two places**: the maintainer's machine (as a PEM file *outside* this repository) and the repository's GitHub Actions secret `OFM_EXTENSIONS_SIGNING_KEY`. It is never committed, never shipped, never placed in the repo tree (`.gitignore` guards `*.pem` as a backstop).

### Key rotation

1. Generate a new keypair (`openssl genpkey -algorithm ed25519` or `crypto.generateKeyPairSync('ed25519')`); store the PKCS8 PEM outside the repo.
2. Update the pinned SPKI base64 in **both** `docs/security.md` and `scripts/validate.mjs`, in the same commit as a registry rebuild + re-sign.
3. Update the host's pinned key constant (`PINNED_EXTENSIONS_PUBLIC_KEY`) and release it **before** or with the first registry signed by the new key — the new signature is unverifiable for hosts on the old pin, so the release order matters.
4. Re-set the `OFM_EXTENSIONS_SIGNING_KEY` secret.

## What the signature attests — and what it does not

A valid signature says: *the bytes of `registry.json` — every manifest, every `main.mjs` size and digest — were produced by this repository's build from packages someone reviewed here.* The host then:

- downloads extension code **only** from the registry repo's own mirrors (`raw.githubusercontent.com`, the jsDelivr edges, the gh-proxy read-through of this same repo), and only from paths under this repo slug;
- checks the download's byte size and SHA-256 against the signed `main: { url, size, sha256 }` entry — a one-byte tamper is a refused install;
- statically scans the source (banned APIs, foreign imports, line-length, size) before writing anything to disk;
- records the install in an append-only audit log and keeps one version on disk for rollback.

It does **not** say an extension is safe to run — the sandbox is defense-in-depth against accidents, not a boundary against a determined author. The load-bearing gates are the signature, the review and the scan; the settings page says as much before an install.

## What CI enforces here

On every push and pull request (`validate.yml`):

- each package's manifest parses into the exact normalized shape the host's runtime reads, with marketplace policy on top (explicit config defaults, `replaces` limited to allowed lanes, non-empty honest descriptions, one `main.mjs`);
- each `main.mjs` passes the identical static scan the host runs pre-install;
- rebuilding `registry.json` reproduces the committed bytes exactly (deterministic build: sorted ids, sorted tags, preserved `generatedAt`);
- every entry's `size`/`sha256` matches the real file, and every entry re-parses into the manifest it was built from;
- `registry.sig` verifies against the committed registry with the pinned key.

On every push to `main` (`sign.yml`), when the signing secret is present: rebuild, re-sign, and commit `registry.json` + `registry.sig` as the github-actions bot. Without the secret the workflow warns and skips — an unsigned registry fails `--check`, so drift is loud, never silent.

## Reporting

See [SECURITY.md](../SECURITY.md) at the repository root for how to report a vulnerable package or a platform issue.
