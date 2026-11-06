#!/usr/bin/env node
/**
 * sign-registry.mjs — sign registry.json into registry.sig.
 *
 * The signature is base64 Ed25519 over `stableStringify(parsed
 * registry.json)` — sorted keys, no whitespace — exactly what the host's
 * `verifyRegistrySignature` recomputes on the client. `stableStringify` is
 * inlined here (mirroring the host's src/updater.js) so this script is
 * self-contained: nothing is imported from the plugin repository.
 *
 * The private key is a PKCS8 PEM. It is read from, in order:
 *   1. `--key <path>`
 *   2. the `OFM_EXTENSIONS_SIGNING_KEY` environment variable (a PEM file path)
 * The key file must live outside this repository — GitHub Actions reads it
 * from the `OFM_EXTENSIONS_SIGNING_KEY` secret; see docs/publishing.md.
 *
 * Usage: node scripts/sign-registry.mjs [--key <pem-path>] [--registry <path>]
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Deterministic JSON: sorted keys, no whitespace, `undefined` dropped (object
 * fields) or nulled (array slots). Copied from the host's src/updater.js —
 * both signer and verifier must reduce the registry to this exact form.
 */
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(row => stableStringify(row ?? null)).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).filter(key => value[key] !== undefined).sort()
    return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

function readArgs(argv) {
  const args = { key: process.env.OFM_EXTENSIONS_SIGNING_KEY ?? '', registry: path.join(ROOT, 'registry.json') }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--key') args.key = argv[index + 1] ?? ''
    if (argv[index] === '--registry') args.registry = argv[index + 1] ?? ''
  }
  return args
}

function main() {
  const { key, registry } = readArgs(process.argv.slice(2))
  if (key === '') {
    console.error('sign-registry: no signing key — pass --key <pem-path> or set OFM_EXTENSIONS_SIGNING_KEY to the PEM file path')
    process.exitCode = 1
    return
  }
  if (!fs.existsSync(registry)) {
    console.error(`sign-registry: ${registry} does not exist; run node scripts/build-registry.mjs first`)
    process.exitCode = 1
    return
  }
  let privateKey
  try {
    privateKey = crypto.createPrivateKey(fs.readFileSync(key, 'utf8'))
  } catch (error) {
    console.error(`sign-registry: the signing key could not be read (${String(error?.message ?? error)})`)
    process.exitCode = 1
    return
  }
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    console.error(`sign-registry: the signing key must be an Ed25519 key, not ${String(privateKey.asymmetricKeyType)}`)
    process.exitCode = 1
    return
  }
  let document
  try {
    document = JSON.parse(fs.readFileSync(registry, 'utf8'))
  } catch (error) {
    console.error(`sign-registry: ${registry} does not parse: ${String(error?.message ?? error)}`)
    process.exitCode = 1
    return
  }
  const signature = crypto.sign(null, Buffer.from(stableStringify(document)), privateKey).toString('base64')
  // Refuse to write a signature the pinned public half would reject.
  const publicKey = crypto.createPublicKey(privateKey)
  const spkiBase64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
  const verified = crypto.verify(null, Buffer.from(stableStringify(document)), publicKey, Buffer.from(signature, 'base64'))
  if (!verified) {
    console.error('sign-registry: the freshly computed signature failed its own verification; nothing was written')
    process.exitCode = 1
    return
  }
  const sigPath = registry.replace(/\.json$/, '.sig')
  fs.writeFileSync(sigPath, `${signature}\n`)
  console.log(`sign-registry: wrote ${path.basename(sigPath)} over ${path.basename(registry)} (${document.plugins?.length ?? 0} plugins)`)
  console.log(`sign-registry: registry public key (SPKI, base64) — pin this in the host and in docs/security.md when it changes:`)
  console.log(`  ${spkiBase64}`)
}

const invokedAsMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedAsMain) main()
