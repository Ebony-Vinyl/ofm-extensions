# Security Policy

## The model in one paragraph

This repository publishes extensions for the Our Free Model plugin. The marketplace is a repo: a deterministic, Ed25519-signed `registry.json` (signature in `registry.sig`, over the canonically sorted JSON) generated from each package's manifest and source digest. The host verifies the signature against a pinned public key before reading any entry, downloads extension code only from this repository's mirrors, checks size + sha256 against the signed entry, statically scans the source, and runs it in a `vm` sandbox behind an origin-fenced bridge. Full details: [docs/security.md](docs/security.md).

## Supported scope

- The registry, its signature, and the packages under `packages/` in this repository.
- The build/sign/validate scripts in `scripts/`.

The host's extension runtime itself lives in the plugin repository (dsh-our-free-model) — report runtime issues there.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report via GitHub Security Advisories on this repository ("Report a vulnerability" under the Security tab), or contact the maintainer directly. Include: the package id and version, what you observed or suspect (a scan bypass, an undeclared network origin, a digest/signature anomaly, a malicious module), and reproduction steps.

You will get an acknowledgement within 7 days. Confirmed issues in a package are handled by unpublishing (registry removal + re-sign) or a fixed release; the audit-friendly install store on hosts keeps the last good version for rollback.

## Package maintainers' obligations

- Declare every network origin you actually contact — the fence is exact-origin match, and surprise origins are a takedown.
- Store credentials only via `permissions.secrets`; never log them, never put them in bodies.
- No obfuscation, no minified code, no dynamic anything — unreadable code is refused at review and again at install.
- If your package must be yanked, open an issue; the registry is rebuilt without it and re-signed.
