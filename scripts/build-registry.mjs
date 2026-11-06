#!/usr/bin/env node
/**
 * build-registry.mjs — regenerate registry.json from packages/.
 *
 * Validates every package first and refuses to build when any of them is
 * broken (CI validates independently, but the builder does not sign garbage).
 * The output is deterministic: packages sorted by id, tags sorted and
 * deduped, manifest fields in the client's normalized order. `generatedAt`
 * is preserved when nothing but the timestamp would change, so a rebuild of
 * an unchanged tree is byte-stable — reviewable diffs, stable commits.
 *
 * Usage: node scripts/build-registry.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROOT, buildRegistryDocument, listPackageDirs, REGISTRY_MAX_BYTES, validatePackage } from './validate.mjs'

const registryPath = path.join(ROOT, 'registry.json')

function main() {
  const packages = []
  const problems = []
  for (const dir of listPackageDirs()) {
    const pkg = validatePackage(dir)
    packages.push(pkg)
    for (const problem of pkg.problems) problems.push(`packages/${pkg.id}: ${problem}`)
  }
  if (packages.length === 0) problems.push('packages/ carries no packages')
  if (problems.length > 0) {
    console.error(`build-registry: refusing to build; ${problems.length} problem(s):`)
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exitCode = 1
    return
  }

  // Preserve the previous generatedAt when the registry content is unchanged;
  // a fresh timestamp otherwise. Either way the document stays canonical.
  const now = new Date().toISOString()
  let generatedAt = now
  try {
    const previous = JSON.parse(fs.readFileSync(registryPath, 'utf8'))
    const previousWithoutStamp = JSON.parse(JSON.stringify({ ...previous, generatedAt: '' }))
    const candidate = buildRegistryDocument({ packages, generatedAt: '' })
    if (JSON.stringify(previousWithoutStamp) === JSON.stringify(candidate) && typeof previous.generatedAt === 'string' && previous.generatedAt !== '') {
      generatedAt = previous.generatedAt
    }
  } catch { /* no previous registry — a fresh build stamps now */ }

  const document = buildRegistryDocument({ packages, generatedAt })
  const text = JSON.stringify(document, null, 2) + '\n'
  const bytes = Buffer.byteLength(text)
  if (bytes > REGISTRY_MAX_BYTES) {
    console.error(`build-registry: registry.json would be ${bytes} bytes; the host refuses more than ${REGISTRY_MAX_BYTES}`)
    process.exitCode = 1
    return
  }
  fs.writeFileSync(registryPath, text)
  console.log(`build-registry: wrote registry.json — ${document.plugins.length} package(s), ${bytes} bytes, generatedAt ${generatedAt}`)
  console.log('build-registry: now run node scripts/sign-registry.mjs')
}

const invokedAsMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedAsMain) main()
