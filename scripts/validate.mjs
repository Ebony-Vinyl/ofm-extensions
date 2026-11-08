#!/usr/bin/env node
/**
 * validate.mjs — the marketplace's CI gate.
 *
 * Validates every package under packages/:
 *   - the manifest (`ofm-plugin.json`) parses into the exact normalized shape
 *     the host's extension runtime reads, with marketplace policy on top
 *     (non-empty description, explicit config defaults, `replaces` limited to
 *     the lanes this marketplace actually lets go, one `main.mjs` per package);
 *   - the source (`main.mjs`) passes the same static scan the host runs
 *     before an install: only `ofm:sdk` may be named in an import, the banned
 *     API tripwires, the line-length rule, the size cap;
 *   - registry metadata (summary, tags, publishedAt) is well-formed.
 *
 * With `--check` it additionally verifies the generated registry:
 *   - rebuilding registry.json from packages/ must reproduce the committed
 *     bytes exactly (packages sorted by id, tags sorted, generatedAt
 *     preserved — the build is deterministic);
 *   - every entry's `main.size` / `main.sha256` must match the real file;
 *   - every entry must re-parse into the manifest it was built from;
 *   - `registry.sig` must verify against the committed registry.json with the
 *     pinned Ed25519 public key.
 *
 * Zero dependencies beyond node:*. Self-contained — nothing is imported from
 * the plugin repository, so the marketplace validates on its own.
 *
 * Usage: node scripts/validate.mjs [--check]
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

// ── constants ────────────────────────────────────────────────────────────────

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** The registry repo — must match the slug baked into every main.url. */
export const REPO = process.env.OFM_EXTENSIONS_REPO ?? 'Ebony-Vinyl/ofm-extensions'

export const EXTENSION_SOURCE_MAX_BYTES = 256 * 1024
export const REGISTRY_MAX_BYTES = 512 * 1024
/** The cover is display-only; a bigger file would outweigh every source. */
export const COVER_MAX_BYTES = 192 * 1024
/** Extension of the cover file name → the content type the host serves it as. */
export const COVER_TYPES = new Map([
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['webp', 'image/webp'],
  ['svg', 'image/svg+xml'],
])
const COVER_NAME_RE = /^[\w.-]+\.(?:png|jpe?g|webp|svg)$/i

const MANIFEST_ID_RE = /^[a-z][a-z0-9-]{1,47}$/
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[\w.]+)?$/
const NETWORK_ORIGIN_RE = /^https?:\/\//
const SIMPLE_KEY_RE = /^[\w-]{1,64}$/
const EXTENSION_TYPES = new Set(['channel', 'enhancement'])
const EXTENSION_WIRES = new Set(['chat', 'responses', 'messages'])
const HOOK_NAMES = new Set(['onRequest', 'onModels', 'onUsage'])
const CONFIG_TYPES = new Set(['text', 'password', 'toggle', 'number', 'select'])
/** Marketplace policy: which built-in lanes a package may take over. */
const REPLACEABLE = new Set(['kilo'])

/**
 * The registry's Ed25519 public key (SPKI, base64) — the pin the host's
 * `OFM_EXTENSIONS_PUBLIC_KEY` override and this script's signature check
 * both trust. Reference copy lives in docs/security.md; the matching private
 * key never enters this repository.
 */
export const PINNED_PUBLIC_KEY_SPKI = 'MCowBQYDK2VwAyEA7jxuBMdejAlGd9EnkxEpqKpAnxT8vr3sdVBFHxssy/U='

// ── deterministic JSON ───────────────────────────────────────────────────────

/**
 * Deterministic JSON: sorted keys, no whitespace, `undefined` dropped — the
 * same rules the host's verifier applies, so signer and verifier reduce the
 * registry to one canonical byte string. (Mirrors the host's
 * `stableStringify`; kept inline so this repository stands alone.)
 */
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(row => stableStringify(row ?? null)).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).filter(key => value[key] !== undefined).sort()
    return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

/** Ed25519 verify of one registry document over its canonical form. */
export function verifyRegistrySignature(registry, signatureBase64, publicKeyBase64) {
  if (typeof signatureBase64 !== 'string' || signatureBase64 === '') return false
  if (typeof publicKeyBase64 !== 'string' || publicKeyBase64 === '') return false
  try {
    const key = crypto.createPublicKey({ key: Buffer.from(publicKeyBase64, 'base64'), format: 'der', type: 'spki' })
    return crypto.verify(null, Buffer.from(stableStringify(registry)), key, Buffer.from(signatureBase64, 'base64'))
  } catch {
    return false
  }
}

// ── manifest ─────────────────────────────────────────────────────────────────

/**
 * Validate one `ofm-plugin.json` into the normalized manifest shape, or throw
 * with the reason. Mirrors the host's `parseExtensionManifest` field for
 * field, but enforces marketplace policy instead of silently truncating or
 * dropping: over-limit values, unknown hooks, missing defaults and so on are
 * hard failures, so what CI approves is exactly what the client will read.
 */
export function parseManifestStrict(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('manifest must be a JSON object')
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (!MANIFEST_ID_RE.test(id)) throw new Error(`manifest id "${id}" must match ${MANIFEST_ID_RE}`)
  const version = typeof raw.version === 'string' ? raw.version.trim() : ''
  if (!SEMVER_RE.test(version)) throw new Error(`manifest version "${version}" is not semver`)
  if (!EXTENSION_TYPES.has(raw.type)) throw new Error('manifest type must be "channel" or "enhancement"')
  const name = typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name.trim() : id
  if (name.length > 64) throw new Error('manifest name exceeds 64 characters')
  // A registry row carries `main` as the {url,size,sha256} object; the client
  // then falls back to the default file name. Mirror that fallback here so a
  // registry row re-parses into the same manifest the package built from.
  const main = typeof raw.main === 'string' && raw.main.trim() !== '' ? raw.main.trim() : 'main.mjs'
  if (!/^[\w.-]+\.mjs$/.test(main) || main.includes('..')) throw new Error('manifest main must be a relative .mjs file name')
  if (main !== 'main.mjs') throw new Error('the registry ships exactly one file; "main" must be "main.mjs"')
  // The cover is optional and display-only: a relative file name inside the
  // package directory, served as an image. The registry build hashes it like
  // main.mjs, so a tampered cover can never render.
  let cover
  if (raw.cover !== undefined) {
    if (typeof raw.cover !== 'string' || !COVER_NAME_RE.test(raw.cover) || raw.cover.includes('..')) {
      throw new Error('manifest cover must be a relative image file name (png/jpg/jpeg/webp/svg)')
    }
    cover = raw.cover
  }
  const description = typeof raw.description === 'string' ? raw.description : ''
  if (description.trim() === '') throw new Error('manifest description must not be empty')
  if (description.length > 400) throw new Error('manifest description exceeds 400 characters')
  const author = typeof raw.author === 'string' ? raw.author : ''
  if (author.trim() === '') throw new Error('manifest author must not be empty')
  if (author.length > 80) throw new Error('manifest author exceeds 80 characters')
  const license = typeof raw.license === 'string' ? raw.license : ''
  if (!/^[\w.()+-]{1,40}$/.test(license)) throw new Error('manifest license must be an SPDX expression such as "MIT"')
  const homepage = safeUrl(raw.homepage)
  const repository = safeUrl(raw.repository)
  const icon = typeof raw.icon === 'string' ? raw.icon : ''
  if (icon.length > 200) throw new Error('manifest icon exceeds 200 characters')
  const minHost = typeof raw.minHost === 'string' ? raw.minHost.trim() : ''
  if (minHost === '') throw new Error('manifest minHost is required (e.g. "2.8.1")')
  if (!SEMVER_RE.test(minHost)) throw new Error(`manifest minHost "${minHost}" is not semver`)
  const permissions = parsePermissionsStrict(raw.permissions)
  if (raw.replaces !== undefined) {
    if (typeof raw.replaces !== 'string' || !REPLACEABLE.has(raw.replaces)) {
      throw new Error(`manifest replaces "${raw.replaces}" is not a lane this marketplace lets go (${[...REPLACEABLE].join(', ')})`)
    }
  }
  if (raw.type === 'enhancement') {
    if (!Array.isArray(raw.hooks) || raw.hooks.length === 0) throw new Error('enhancement manifests must declare a non-empty hooks array')
    for (const hook of raw.hooks) {
      if (!HOOK_NAMES.has(hook)) throw new Error(`manifest hook "${hook}" is not one of ${[...HOOK_NAMES].join(', ')}`)
    }
    if (new Set(raw.hooks).size !== raw.hooks.length) throw new Error('manifest hooks carry duplicates')
    if (raw.models !== undefined) throw new Error('enhancement manifests must not carry a models list')
  }
  if (raw.type === 'channel' && raw.hooks !== undefined) throw new Error('channel manifests must not declare hooks')
  let models
  if (raw.type === 'channel' && raw.models !== undefined) {
    if (!Array.isArray(raw.models)) throw new Error('manifest models must be an array')
    if (raw.models.length > 256) throw new Error('manifest models exceed 256 rows')
    models = raw.models.map(parseModelRowStrict)
  }
  if (raw.requires !== undefined && (!Array.isArray(raw.requires) || raw.requires.length > 16 || raw.requires.some(value => typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(value)))) throw new Error('invalid required capabilities')
  const config = parseConfigStrict(raw.config)
  const manifest = {
    schemaVersion: 1,
    id, version, type: raw.type, name, main,
    description, author, license, homepage, repository, icon, minHost,
    permissions,
    ...(raw.requires !== undefined ? { requires: [...new Set(raw.requires)].sort() } : {}),
    ...(raw.replaces !== undefined ? { replaces: raw.replaces } : {}),
    ...(cover !== undefined ? { cover } : {}),
    ...(raw.type === 'enhancement' ? { hooks: raw.hooks } : {}),
    ...(models !== undefined ? { models } : {}),
    config,
  }
  return manifest
}

function safeUrl(value) {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value !== 'string') throw new Error('manifest homepage/repository must be strings')
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'https:') throw new Error('manifest homepage/repository must be https URLs')
    return parsed.href
  } catch (error) {
    if (error instanceof TypeError) throw new Error(`manifest URL "${value}" does not parse`)
    throw error
  }
}

function parsePermissionsStrict(raw) {
  const permissions = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : null
  if (permissions === null) throw new Error('manifest permissions must be an object with network, secrets and storage')
  if (!Array.isArray(permissions.network)) throw new Error('permissions.network must be an array (possibly empty)')
  if (permissions.network.length > 8) throw new Error('permissions.network exceeds 8 origins')
  const network = permissions.network.map(origin => String(origin ?? '').trim().replace(/\/+$/, ''))
  const seenOrigins = new Set()
  for (const origin of network) {
    if (!NETWORK_ORIGIN_RE.test(origin) || origin.length > 128) {
      throw new Error(`permissions.network origin "${origin}" must be an http(s) origin of at most 128 characters`)
    }
    let parsed
    try { parsed = new URL(origin) } catch { throw new Error(`permissions.network origin "${origin}" does not parse`) }
    if (parsed.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) {
      throw new Error(`permissions.network origin "${origin}" is plain http but not loopback; only https may leave the machine`)
    }
    if (seenOrigins.has(origin)) throw new Error(`permissions.network carries the duplicate origin "${origin}"`)
    seenOrigins.add(origin)
  }
  if (!Array.isArray(permissions.secrets)) throw new Error('permissions.secrets must be an array (possibly empty)')
  if (permissions.secrets.length > 8) throw new Error('permissions.secrets exceeds 8 keys')
  const secrets = []
  for (const key of permissions.secrets) {
    const name = String(key ?? '').trim()
    if (!SIMPLE_KEY_RE.test(name)) throw new Error(`permissions.secrets key "${name}" must match ${SIMPLE_KEY_RE}`)
    if (secrets.includes(name)) throw new Error(`permissions.secrets carries the duplicate key "${name}"`)
    secrets.push(name)
  }
  if (permissions.storage !== undefined && typeof permissions.storage !== 'boolean') {
    throw new Error('permissions.storage must be a boolean')
  }
  return { network, secrets, storage: permissions.storage === true }
}

function parseModelRowStrict(row) {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) throw new Error('model rows must be objects')
  const id = typeof row.id === 'string' ? row.id.trim() : ''
  if (id === '' || id.length > 128) throw new Error('model rows need an id of 1..128 characters')
  if (row.name !== undefined) {
    if (typeof row.name !== 'string') throw new Error(`model "${id}" name must be a string`)
    if (row.name.length > 200) throw new Error(`model "${id}" name exceeds 200 characters`)
  }
  for (const field of ['contextWindow', 'maxOutput']) {
    if (row[field] !== undefined && (typeof row[field] !== 'number' || !Number.isFinite(row[field]) || row[field] <= 0)) {
      throw new Error(`model "${id}" ${field} must be a positive number`)
    }
  }
  for (const field of ['vision', 'reasoning']) {
    if (row[field] !== undefined && typeof row[field] !== 'boolean') throw new Error(`model "${id}" ${field} must be a boolean`)
  }
  if (row.wire !== undefined && !EXTENSION_WIRES.has(row.wire)) {
    throw new Error(`model "${id}" wire must be one of ${[...EXTENSION_WIRES].join(', ')}`)
  }
  return row
}

function parseConfigStrict(raw) {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) throw new Error('manifest config must be an array')
  if (raw.length > 12) throw new Error('manifest config exceeds 12 fields')
  return raw.map(row => {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) throw new Error('config rows must be objects')
    const key = typeof row.key === 'string' ? row.key : ''
    if (!SIMPLE_KEY_RE.test(key)) throw new Error(`config key "${key}" must match ${SIMPLE_KEY_RE}`)
    if (!CONFIG_TYPES.has(row.type)) throw new Error(`config "${key}" type must be one of ${[...CONFIG_TYPES].join(', ')}`)
    const label = typeof row.label === 'string' && row.label.trim() !== '' ? row.label : key
    if (label.length > 80) throw new Error(`config "${key}" label exceeds 80 characters`)
    const description = typeof row.description === 'string' ? row.description : ''
    if (description.length > 200) throw new Error(`config "${key}" description exceeds 200 characters`)
    if (!('default' in row)) throw new Error(`config "${key}" must carry an explicit default`)
    const out = { key, type: row.type, label, description, default: row.default }
    if (row.type === 'toggle' && typeof row.default !== 'boolean') throw new Error(`config "${key}" is a toggle; its default must be a boolean`)
    if (row.type === 'number' && (typeof row.default !== 'number' || !Number.isFinite(row.default))) throw new Error(`config "${key}" is a number; its default must be a finite number`)
    if ((row.type === 'text' || row.type === 'password') && typeof row.default !== 'string') throw new Error(`config "${key}" is ${row.type}; its default must be a string`)
    if (row.type === 'select') {
      if (typeof row.default !== 'string') throw new Error(`config "${key}" is a select; its default must be a string`)
      if (!Array.isArray(row.options) || row.options.length === 0 || row.options.length > 16) throw new Error(`config "${key}" must carry 1..16 options`)
      if (!row.options.map(String).includes(row.default)) throw new Error(`config "${key}" default must be one of its options`)
      out.options = row.options.slice(0, 16).map(String)
    }
    return out
  })
}

// ── static scan ──────────────────────────────────────────────────────────────

/** The APIs an extension must never name. Mirrors the host's tripwires. */
const BANNED_SOURCE_PATTERNS = [
  /\brequire\s*\(/,
  /\bprocess\b/,
  /\bglobalThis\b/,
  /\bglobal\s*\./,
  /\bFunction\s*\(/,
  /\beval\s*\(/,
  /\bWebAssembly\b/,
  /\bimportScripts\b/,
  /\bchild_process\b/,
  /\bworker_threads\b/,
  /\bnode\s*:\s*(?:fs|path|os|net|tls|dns|http|https|child_process|worker_threads|module|vm|inspector)\b/,
  /\bimport\s*\(/,
]

/** Blank comments and string bodies so pattern scans read code, not prose. */
export function stripStringsAndComments(source) {
  let out = ''
  let index = 0
  while (index < source.length) {
    const char = source[index]
    const next = source[index + 1]
    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1
      continue
    }
    if (char === '/' && next === '*') {
      index += 2
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) index += 1
      index += 2
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      const end = stringEnd(source, index, char)
      if (end !== -1) {
        out += char + char
        index = end + 1
        continue
      }
    }
    out += char
    index += 1
  }
  return out
}

/**
 * The index of the quote closing the string opened at `start`, or -1 when this
 * quote does not open one. A single- or double-quoted literal cannot span a raw
 * newline, so a lone quote is a character inside something else — a regular
 * expression such as `/['"]/`, for one. Repairing to end-of-file from there
 * would blank everything after it and retire every tripwire below, silently and
 * depending only on the author's punctuation. Template literals may span lines,
 * so they keep scanning for their backtick. Kept identical to the host's copy in
 * src/extensions.js: CI and the client must refuse the same sources.
 */
function stringEnd(source, start, quote) {
  let index = start + 1
  while (index < source.length) {
    const char = source[index]
    if (char === '\\') { index += 2; continue }
    if (char === quote) return index
    if (char === '\n' && quote !== '`') return -1
    index += 1
  }
  return -1
}

/**
 * The same static scan the host runs before an install, over one package's
 * source. Note the import check reads the raw text (specifiers live inside
 * strings), so the word "import" must appear in a source only where it means
 * one — not in comments.
 */
export function scanSource(source) {
  const violations = []
  const text = String(source ?? '')
  if (text.length > EXTENSION_SOURCE_MAX_BYTES) violations.push(`source is ${text.length} bytes; the limit is ${EXTENSION_SOURCE_MAX_BYTES}`)
  if (text.trim() === '') violations.push('source is empty')
  const imports = text.matchAll(/\bimport\b[^'";]*['"]([^'"]+)['"]/g)
  for (const match of imports) {
    if (match[1] !== 'ofm:sdk') violations.push(`import of "${match[1]}" — only "ofm:sdk" is available`)
  }
  const withoutStringsAndComments = stripStringsAndComments(text)
  for (const pattern of BANNED_SOURCE_PATTERNS) {
    if (pattern.test(withoutStringsAndComments)) violations.push(`source names a forbidden API: ${pattern}`)
  }
  const lines = text.split('\n')
  const longLines = lines.filter(line => line.length > 500).length
  if (longLines > 2) violations.push(`${longLines} lines exceed 500 characters — bundles and minified output are not reviewable`)
  return { ok: violations.length === 0, violations }
}

// ── packages ─────────────────────────────────────────────────────────────────

/**
 * Validate one package directory: manifest, registry metadata, source scan,
 * and the size/digest of main.mjs. Returns everything the registry builder
 * needs, plus a `problems` array (empty means the package is clean).
 */
export function validatePackage(packageDir) {
  const id = path.basename(packageDir)
  const problems = []
  const manifestPath = path.join(packageDir, 'ofm-plugin.json')
  const sourcePath = path.join(packageDir, 'main.mjs')
  if (!fs.existsSync(manifestPath)) {
    return { id, problems: ['ofm-plugin.json is missing'] }
  }
  if (!fs.existsSync(sourcePath)) {
    return { id, problems: ['main.mjs is missing'] }
  }
  let raw
  try {
    raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    return { id, problems: [`ofm-plugin.json does not parse: ${String(error?.message ?? error)}`] }
  }
  let manifest
  try {
    manifest = parseManifestStrict(raw)
  } catch (error) {
    return { id, problems: [String(error?.message ?? error)] }
  }
  if (manifest.id !== id) problems.push(`manifest id "${manifest.id}" does not match the directory name "${id}"`)
  const summary = typeof raw.summary === 'string' ? raw.summary : ''
  if (summary.trim() === '') problems.push('registry metadata: summary must not be empty')
  if (summary.length > 300) problems.push('registry metadata: summary exceeds 300 characters')
  if (!Array.isArray(raw.tags)) problems.push('registry metadata: tags must be an array')
  else if (raw.tags.length > 8) problems.push('registry metadata: more than 8 tags')
  const publishedAt = typeof raw.publishedAt === 'string' ? raw.publishedAt : ''
  if (publishedAt !== '' && Number.isNaN(Date.parse(publishedAt))) problems.push('registry metadata: publishedAt is not an ISO date string')
  // Optional, newest-first release notes the client renders in the detail view.
  // Reviewable prose, not a dump: eight entries of one line each.
  let changelog = []
  if (raw.changelog !== undefined) {
    if (!Array.isArray(raw.changelog)) problems.push('registry metadata: changelog must be an array of strings')
    else {
      changelog = raw.changelog.map(row => typeof row === 'string' ? row.trim() : '')
      if (changelog.some(row => row === '')) problems.push('registry metadata: changelog entries must be non-empty strings')
      if (changelog.some(row => row.length > 200)) problems.push('registry metadata: changelog entries exceed 200 characters')
      if (changelog.length > 8) problems.push('registry metadata: changelog carries more than 8 entries')
      changelog = changelog.slice(0, 8)
    }
  }
  const source = fs.readFileSync(sourcePath, 'utf8')
  const scan = scanSource(source)
  if (!scan.ok) problems.push(...scan.violations)
  // The host compares the decoded source's string length against the signed
  // `size` (and hashes the string, which for a UTF-8 file equals the file
  // bytes) — so `size` is the character count, exactly what install enforces.
  const size = source.length
  const sha256 = crypto.createHash('sha256').update(source).digest('hex')
  let cover
  if (manifest.cover !== undefined) {
    const coverCheck = validateCoverFile(path.join(packageDir, manifest.cover), manifest.cover)
    if (coverCheck.problem !== null) problems.push(`cover: ${coverCheck.problem}`)
    else cover = coverCheck
  }
  return { id, manifest, summary, tags: Array.isArray(raw.tags) ? [...new Set(raw.tags.map(String))].sort() : [], publishedAt, changelog, size, sha256, cover, problems }
}

/**
 * Check one cover file: present, within the byte budget, and actually an image
 * of its extension — the magic bytes, not the file name, decide. An SVG must
 * additionally be script-free; it renders inside an <img> (script-free there
 * by spec) but a reviewer-facing rule is cheaper than a reviewer's vigilance.
 * Returns the { size, sha256 } the registry build signs, or the problem text.
 */
function validateCoverFile(coverPath, name) {
  if (!fs.existsSync(coverPath)) return { problem: `"${name}" does not exist in the package directory` }
  const bytes = fs.readFileSync(coverPath)
  if (bytes.length > COVER_MAX_BYTES) return { problem: `"${name}" is ${bytes.length} bytes; the limit is ${COVER_MAX_BYTES}` }
  if (bytes.length === 0) return { problem: `"${name}" is empty` }
  const extension = name.split('.').pop().toLowerCase()
  let problem = null
  if (extension === 'png') {
    if (!bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) problem = '"cover" is named .png but does not carry the PNG magic bytes'
  } else if (extension === 'jpg' || extension === 'jpeg') {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) problem = '"cover" is named .jpg but does not carry the JPEG magic bytes'
  } else if (extension === 'webp') {
    if (bytes.subarray(0, 4).toString('latin1') !== 'RIFF' || bytes.subarray(8, 12).toString('latin1') !== 'WEBP') problem = '"cover" is named .webp but does not carry the RIFF/WEBP magic bytes'
  } else if (extension === 'svg') {
    const head = bytes.subarray(0, 1024).toString('utf8').replace(/^\uFEFF/, '').trimStart()
    const afterXml = head.startsWith('<?xml') ? head.slice(head.indexOf('?>') + 2).trimStart() : head
    if (!afterXml.toLowerCase().startsWith('<svg')) problem = '"cover" is named .svg but does not start with an <svg> element'
    else if (/<script[\s>]/i.test(bytes.toString('utf8'))) problem = '"cover" is an SVG carrying a <script> element'
    else if (/on[a-z]+\s*=\s*["']?/i.test(bytes.toString('utf8'))) problem = '"cover" is an SVG carrying inline event handlers'
  }
  if (problem !== null) return { problem }
  return { size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), problem: null }
}

// ── the registry document ────────────────────────────────────────────────────

/**
 * Build the registry document from validated packages. Deterministic:
 * packages sorted by id, tags pre-sorted by validatePackage, manifest fields
 * in the client's normalized order. The caller owns `generatedAt` — the
 * builder never invents a timestamp so rebuilds can be byte-compared.
 */
export function buildRegistryDocument({ packages, repo = REPO, generatedAt }) {
  const plugins = packages
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(pkg => {
      const entry = { ...pkg.manifest }
      entry.main = {
        url: `https://raw.githubusercontent.com/${repo}/main/packages/${pkg.id}/main.mjs`,
        size: pkg.size,
        sha256: pkg.sha256,
      }
      if (pkg.cover !== undefined && pkg.manifest.cover !== undefined) {
        entry.cover = {
          url: `https://raw.githubusercontent.com/${repo}/main/packages/${pkg.id}/${pkg.manifest.cover}`,
          size: pkg.cover.size,
          sha256: pkg.cover.sha256,
        }
      }
      entry.summary = pkg.summary
      entry.tags = pkg.tags
      entry.publishedAt = pkg.publishedAt
      if (pkg.changelog !== undefined && pkg.changelog.length > 0) entry.changelog = pkg.changelog
      return entry
    })
  return { schemaVersion: 1, generatedAt, plugins }
}

/** Every package directory under packages/, in id order. */
export function listPackageDirs() {
  const root = path.join(ROOT, 'packages')
  if (!fs.existsSync(root)) return []
  return fs.readdirSync(root).sort()
    .map(name => path.join(root, name))
    .filter(dir => { try { return fs.statSync(dir).isDirectory() } catch { return false } })
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function main() {
  const check = process.argv.slice(2).includes('--check')
  const problems = []
  const packages = listPackageDirs().map(dir => validatePackage(dir))
  for (const pkg of packages) {
    for (const problem of pkg.problems) problems.push(`packages/${pkg.id}: ${problem}`)
  }
  if (packages.length === 0) problems.push('packages/ carries no packages')

  if (check) {
    const registryPath = path.join(ROOT, 'registry.json')
    const sigPath = path.join(ROOT, 'registry.sig')
    let committedText = null
    let committedDoc = null
    if (!fs.existsSync(registryPath)) {
      problems.push('registry.json does not exist; run node scripts/build-registry.mjs')
    } else {
      committedText = fs.readFileSync(registryPath, 'utf8')
      if (Buffer.byteLength(committedText) > REGISTRY_MAX_BYTES) {
        problems.push(`registry.json is ${Buffer.byteLength(committedText)} bytes; the host refuses more than ${REGISTRY_MAX_BYTES}`)
      }
      try {
        committedDoc = JSON.parse(committedText)
      } catch (error) {
        problems.push(`registry.json does not parse: ${String(error?.message ?? error)}`)
      }
    }
    if (committedDoc !== null) {
      // Rebuild, preserving the committed generatedAt, and demand byte equality.
      const committedGeneratedAt = typeof committedDoc.generatedAt === 'string' && committedDoc.generatedAt !== ''
        ? committedDoc.generatedAt
        : new Date().toISOString()
      const clean = packages.filter(pkg => pkg.problems.length === 0)
      const rebuilt = buildRegistryDocument({ packages: clean, generatedAt: committedGeneratedAt })
      const rebuiltText = JSON.stringify(rebuilt, null, 2) + '\n'
      if (rebuiltText !== committedText) {
        problems.push('registry.json is stale or diverges from packages/ — run node scripts/build-registry.mjs, then node scripts/sign-registry.mjs')
      }
      if (!Array.isArray(committedDoc.plugins)) {
        problems.push('registry.json must carry a plugins array')
      } else {
        const ids = committedDoc.plugins.map(row => (row !== null && typeof row === 'object' ? row.id : undefined)).filter(Boolean)
        if (JSON.stringify(ids) !== JSON.stringify([...ids].sort())) problems.push('registry.json plugins are not sorted by id')
        for (const row of committedDoc.plugins) {
          if (row === null || typeof row !== 'object') { problems.push('registry.json carries a non-object entry'); continue }
          if (typeof row.id !== 'string') { problems.push('registry.json carries an entry without an id'); continue }
          const pkg = packages.find(candidate => candidate.id === row.id)
          if (pkg === undefined) { problems.push(`registry.json carries "${row.id}" but packages/${row.id}/ does not exist`); continue }
          if (pkg.problems.length > 0) continue // already reported above
          const main = row.main !== null && typeof row.main === 'object' ? row.main : {}
          const expectedUrl = `https://raw.githubusercontent.com/${REPO}/main/packages/${row.id}/main.mjs`
          if (main.url !== expectedUrl) problems.push(`registry entry "${row.id}" main.url must be ${expectedUrl}`)
          if (main.size !== pkg.size) problems.push(`registry entry "${row.id}" main.size ${main.size} does not match main.mjs (signed size ${pkg.size})`)
          if (main.sha256 !== pkg.sha256) problems.push(`registry entry "${row.id}" main.sha256 does not match main.mjs`)
          // The cover rides the same promise main.mjs does: the URL points at
          // this repo's canonical raw path, the bytes hash to the signed value.
          const cover = row.cover !== null && typeof row.cover === 'object' ? row.cover : null
          if (pkg.manifest.cover !== undefined) {
            if (cover === null) {
              problems.push(`registry entry "${row.id}" must carry a cover object for "${pkg.manifest.cover}"`)
            } else {
              const expectedCoverUrl = `https://raw.githubusercontent.com/${REPO}/main/packages/${row.id}/${pkg.manifest.cover}`
              if (cover.url !== expectedCoverUrl) problems.push(`registry entry "${row.id}" cover.url must be ${expectedCoverUrl}`)
              if (cover.size !== pkg.cover.size) problems.push(`registry entry "${row.id}" cover.size ${cover.size} does not match ${pkg.manifest.cover} (signed size ${pkg.cover.size})`)
              if (cover.sha256 !== pkg.cover.sha256) problems.push(`registry entry "${row.id}" cover.sha256 does not match ${pkg.manifest.cover}`)
            }
          } else if (cover !== null) {
            problems.push(`registry entry "${row.id}" carries a cover but packages/${row.id}/ofm-plugin.json declares none`)
          }
          try {
            // The row carries main/cover as signed {url,size,sha256} objects;
            // the manifest parse wants the plain file names, so substitute and
            // compare manifest fields only — the objects were checked above.
            const normalized = parseManifestStrict({
              ...row,
              main: 'main.mjs',
              ...(pkg.manifest.cover !== undefined ? { cover: pkg.manifest.cover } : { cover: undefined }),
            })
            if (JSON.stringify(normalized) !== JSON.stringify(pkg.manifest)) {
              problems.push(`registry entry "${row.id}" manifest fields diverge from packages/${row.id}/ofm-plugin.json`)
            }
          } catch (error) {
            problems.push(`registry entry "${row.id}" does not re-parse as a manifest: ${String(error?.message ?? error)}`)
          }
        }
        for (const pkg of packages) {
          if (!ids.includes(pkg.id)) problems.push(`package "${pkg.id}" is missing from registry.json`)
        }
      }
    }
    if (!fs.existsSync(sigPath)) {
      problems.push('registry.sig does not exist; run node scripts/sign-registry.mjs')
    } else if (committedDoc !== null) {
      const signature = fs.readFileSync(sigPath, 'utf8').trim()
      if (!verifyRegistrySignature(committedDoc, signature, PINNED_PUBLIC_KEY_SPKI)) {
        problems.push('registry.sig does not verify against registry.json with the pinned public key — re-sign after every rebuild')
      }
    }
  }

  if (problems.length === 0) {
    console.log(`ok  ${packages.length} package(s) validated${check ? '; registry.json is in sync with packages/ and its signature verifies' : ''}`)
    for (const pkg of packages) {
      console.log(`    ${pkg.id} v${pkg.manifest?.version ?? '?'} — size ${pkg.size}, sha256 ${(pkg.sha256 ?? '').slice(0, 16)}…, ${pkg.manifest?.type ?? '?'}`)
    }
    return
  }
  console.error(`${problems.length} problem(s):`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exitCode = 1
}

const invokedAsMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedAsMain) main()
