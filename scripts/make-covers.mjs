#!/usr/bin/env node
/**
 * make-covers.mjs — generate the official packages' cover SVGs.
 *
 * Every official package ships a cover so the marketplace cards render with a
 * face from day one. The covers are generated, not drawn: one script means the
 * six files share a geometry and differ only in their palette, and a re-run is
 * byte-stable (registry digests stay valid). Third-party packages may ship any
 * cover the validator accepts; this script exists for the maintainers' set.
 *
 * Deterministic output, idempotent write (only touched when bytes differ):
 *   node scripts/make-covers.mjs [--force]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** One palette row per official package. Hues are mid-tone so the cover sits
 *  comfortably on both the light and the dark settings surface. */
const COVERS = {
  'kilo-free': { from: '#0E7C66', to: '#0B3B33', glyph: 'K' },
  'openai-compatible': { from: '#2D5FB8', to: '#1B2F5E', glyph: 'O' },
  'anthropic-compatible': { from: '#C25E3A', to: '#5C2A18', glyph: 'A' },
  'param-override': { from: '#6D5BD0', to: '#2E2456', glyph: 'P' },
  'system-prompt': { from: '#B07A2A', to: '#4F3410', glyph: 'S' },
  'model-filter': { from: '#1E8FA0', to: '#0C3A42', glyph: 'M' },
}

/** The shared geometry: gradient ground, two soft circles, one calm wave, a
 *  monogram. 640×240 (5:2) — the aspect the marketplace banner crops to. */
function coverSvg({ from, to, glyph }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 240" width="640" height="240" role="img" aria-label="${glyph}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${from}"/>
      <stop offset="1" stop-color="${to}"/>
    </linearGradient>
  </defs>
  <rect width="640" height="240" fill="url(#g)"/>
  <circle cx="536" cy="28" r="170" fill="#ffffff" opacity="0.08"/>
  <circle cx="64" cy="248" r="130" fill="#ffffff" opacity="0.06"/>
  <circle cx="452" cy="196" r="60" fill="#ffffff" opacity="0.05"/>
  <path d="M0 196 C 150 138, 330 232, 640 152 L 640 240 L 0 240 Z" fill="#ffffff" opacity="0.07"/>
  <text x="42" y="172" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="88" font-weight="700" letter-spacing="-2" fill="#ffffff" opacity="0.92">${glyph}</text>
</svg>
`
}

const force = process.argv.slice(2).includes('--force')
let written = 0
for (const [id, palette] of Object.entries(COVERS)) {
  const target = path.join(ROOT, 'packages', id, 'cover.svg')
  if (!fs.existsSync(path.join(ROOT, 'packages', id))) {
    console.error(`make-covers: packages/${id} does not exist — skipping`)
    continue
  }
  const next = Buffer.from(coverSvg(palette), 'utf8')
  if (!force && fs.existsSync(target) && fs.readFileSync(target).equals(next)) continue
  fs.writeFileSync(target, next)
  written += 1
  console.log(`make-covers: wrote packages/${id}/cover.svg (${next.length} bytes)`)
}
console.log(`make-covers: ${written} file(s) written; now run build-registry + sign-registry`)
