#!/usr/bin/env node
/**
 * new-package.mjs — scaffold a new extension package from template/.
 *
 * Copies the template into packages/<id>/, renames the placeholder id,
 * stamps publishedAt with today, and runs the same validation CI runs so a
 * broken scaffold never reaches a pull request. Zero dependencies.
 *
 * Usage:
 *   node scripts/new-package.mjs <id> [--type channel|enhancement] [--author "Name"]
 *
 * The id must match /^[a-z][a-z0-9-]{1,47}$/ — the same rule the host and
 * CI enforce.
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { ROOT } from './validate.mjs'

const TEMPLATE_DIR = path.join(ROOT, 'template')
const PACKAGES_DIR = path.join(ROOT, 'packages')
const ID_RE = /^[a-z][a-z0-9-]{1,47}$/

function fail(message) {
  console.error(`new-package: ${message}`)
  process.exit(1)
}

const args = process.argv.slice(2)
const id = args.find(arg => !arg.startsWith('--'))
const flag = (name, fallback) => {
  const at = args.indexOf(name)
  return at !== -1 && args[at + 1] !== undefined && !String(args[at + 1]).startsWith('--') ? args[at + 1] : fallback
}

if (id === undefined || id === '') fail('usage: node scripts/new-package.mjs <id> [--type channel|enhancement] [--author "Name"]')
if (!ID_RE.test(id)) fail(`"${id}" must match ${ID_RE.source}`)
const type = flag('--type', 'channel')
if (type !== 'channel' && type !== 'enhancement') fail(`--type must be "channel" or "enhancement", got "${type}"`)
const author = flag('--author', 'OFM Extensions maintainers')

const target = path.join(PACKAGES_DIR, id)
if (fs.existsSync(target)) fail(`packages/${id} already exists`)
if (!fs.existsSync(path.join(TEMPLATE_DIR, 'ofm-plugin.json'))) fail('template/ofm-plugin.json is missing — the template directory is broken')

fs.mkdirSync(target, { recursive: true })

const manifest = JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, 'ofm-plugin.json'), 'utf8'))
manifest.id = id
manifest.name = id
  .split('-')
  .map(part => part.charAt(0).toUpperCase() + part.slice(1))
  .join(' ')
manifest.type = type
manifest.author = author
manifest.publishedAt = new Date().toISOString()
if (type === 'enhancement') {
  delete manifest.models
  delete manifest.config?.find?.(row => row.key === 'baseUrl')
  manifest.config = []
  manifest.hooks = ['onRequest']
  manifest.permissions = { network: [], secrets: [], storage: false }
}
fs.writeFileSync(path.join(target, 'ofm-plugin.json'), `${JSON.stringify(manifest, null, 2)}\n`)

// The template's main.mjs ships as a channel shape; an enhancement scaffold
// gets the smaller hook-only body so the first `validate` run is honest.
let source = fs.readFileSync(path.join(TEMPLATE_DIR, 'main.mjs'), 'utf8')
if (type === 'enhancement') {
  source = `/**
 * ${id} — rename me, then fill in onRequest.
 *
 * An enhancement observes or rewrites the outgoing body. Return a new object
 * to rewrite it; return nothing (or throw) and the body ships unchanged —
 * every enhancement hook is fail-open by design. See docs/enhancement-api.md.
 */
export default {
  onRequest(ctx, body, meta) {
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return body
    return { ...body }
  },
}
`
} else {
  source = source.replace(/^ \* my-channel —/m, ` * ${id} —`)
}
fs.writeFileSync(path.join(target, 'main.mjs'), source)

console.log(`new-package: created packages/${id} (${type})`)
console.log('new-package: next — edit packages/' + id + '/ofm-plugin.json and main.mjs, then validate:')

const check = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'validate.mjs')], { stdio: 'inherit' })
if (check.status !== 0) {
  console.error('new-package: the scaffold does not validate yet — fix the problems above before opening a PR')
  process.exit(check.status ?? 1)
}
console.log('new-package: the scaffold validates; build the registry when you are done:')
console.log('  node scripts/build-registry.mjs && node scripts/sign-registry.mjs')
