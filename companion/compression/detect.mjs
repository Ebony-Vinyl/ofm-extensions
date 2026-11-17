import { lastCommandSegment } from './command.mjs'

const commandStart = /^(?:git|make|gradle|gradlew|dotnet|terraform|tofu|opentofu|systemctl|npm|pnpm|yarn|vitest|jest|pytest|python|go|cargo|tsc|eslint|webpack|vite|biome|prettier|turbo|nx|playwright|ruff|mypy|pip|uv|poetry|golangci-lint|bundle|rubocop|kubectl|composer|gh|docker|aws|gcloud|ssh|rsync|curl|wget|ls|find|grep|rg|ag|ps|df|du)\b/

// Ordered by the established tie-breaking precedence, independent of filter priority.
const rules = [
  ['git-status', /^git\s+status\b/i, [/^On branch /m, /^Changes (?:not staged|to be committed)/m, /^Untracked files:/m]],
  ['git-branch', /^git\s+(?:branch|checkout|switch)\b/i, [/^\*\s+\S+/m, /Switched to (?:a new )?branch/i, /Already on ['"][^'"]+['"]/i]],
  ['git-diff', /^git\s+(?:diff|show)\b/i, [/^diff --git /m, /^@@\s+-\d+,\d+\s+\+\d+,\d+\s+@@/m]],
  ['git-log', /^git\s+log\b/i, [/^commit [0-9a-f]{7,40}/m, /^Author: /m]],
  ['make', /^make\b/i, [/^make\[\d+\]: (?:Entering|Leaving) directory/m, /make: \*\*\* /]],
  ['gradle', /^(?:gradle|gradlew|\.\/gradlew)\b/i, [/^> Task :/m, /^BUILD (?:SUCCESSFUL|FAILED)\b/m]],
  ['dotnet', /^dotnet\b/i, [/^Build (?:succeeded|FAILED)\b/m, /\b(?:error|warning) CS\d+\b/m]],
  ['terraform-plan', /^terraform\s+plan\b/i, [/Terraform will perform the following actions:/, /Plan: \d+ to add/i]],
  ['tofu-plan', /^(?:tofu|opentofu)\s+plan\b/i, [/OpenTofu will perform the following actions:/, /Plan: \d+ to add/i]],
  ['systemctl-status', /^systemctl\s+status\b/i, [/^\s*Loaded:\s+/m, /^\s*Active:\s+/m, /^●\s+\S+\.service/m]],
  ['test-vitest', /^(?:vitest\b|npm\s+(?:run\s+)?test:vitest\b)/i, [/\bvitest\b/i, /^ ✓ /m, /^ ❯ /m, /Test Files\s+\d+\s+(?:passed|failed)/i]],
  ['test-jest', /^(?:jest\b|npm\s+(?:run\s+)?test\b)/i, [/Test Suites:\s+\d+/i, /Tests:\s+\d+/i, /^PASS\s+/m, /^FAIL\s+/m]],
  ['test-pytest', /^(?:pytest\b|python\s+-m\s+pytest\b)/i, [/=+\s+(?:\d+\s+)?(?:passed|failed|errors?)/i, /^E\s+/m, /^FAILED /m]],
  ['test-cargo', /^cargo\s+(?:test|nextest)\b/i, [/^running \d+ tests?/m, /^test\s+[\w:.-]+\s+\.\.\.\s+(?:ok|FAILED|ignored)/m, /test result:\s+(?:ok|FAILED)/i]],
  ['test-go', /^go\s+test\b/i, [/^(?:ok|FAIL)\s+[\w./-]+\s+[\d.]+s/m, /^--- FAIL: /m, /^panic: /m]],
  ['build-typescript', /^(?:tsc\b|npm\s+run\s+typecheck\b)/i, [/TS\d{4}:/, /error TS\d{4}/i]],
  ['build-eslint', /^(?:eslint\b|npm\s+run\s+lint\b)/i, [/\s+\d+:\d+\s+(?:error|warning)\s+/, /✖\s+\d+\s+problems?/]],
  ['build-webpack', /^(?:webpack\b|npx\s+webpack\b|npm\s+run\s+build:webpack\b)/i, [/webpack\s+\d/i, /compiled (?:successfully|with \d+ errors?)/i, /asset .+\.js/i]],
  ['build-vite', /^(?:vite\s+build\b|npm\s+run\s+build\b|pnpm\s+build\b)/i, [/vite v[\d.]+/i, /✓ built in/i, /transforming \(\d+\)/i]],
  ['biome', /^(?:biome|npx\s+biome)\b/i, [/lint\/[A-Za-z0-9/.-]+/, /Checked \d+ files? in/i]],
  ['prettier', /^(?:prettier|npx\s+prettier)\b/i, [/^Checking formatting\.\.\./m, /Code style issues found/i]],
  ['turbo', /^(?:turbo|npx\s+turbo)\b/i, [/^• Packages in scope:/m, /^Tasks:\s+\d+\s+successful/m]],
  ['nx', /^(?:nx|npx\s+nx)\b/i, [/^NX\s+/m, /^> nx run /m]],
  ['playwright', /^(?:playwright|npx\s+playwright)\s+test\b/i, [/Running \d+ tests? using \d+ workers?/i, /^\s+\d+ failed/m]],
  ['npm-install', /^(?:npm|pnpm|yarn)\s+(?:install|add|update)\b/i, [/added \d+ packages/i, /packages are looking for funding/i, /audited \d+ packages/i]],
  ['npm-audit', /^(?:npm|pnpm|yarn)\s+audit\b/i, [/found \d+ vulnerabilities/i, /\b(?:low|moderate|high|critical)\b/i]],
  ['ruff', /^(?:ruff|uv\s+run\s+ruff)\b/i, [/^[\w./-]+\.py:\d+:\d+:\s+[A-Z]\d+/m, /Found \d+ errors?\./i]],
  ['mypy', /^(?:mypy|python\s+-m\s+mypy)\b/i, [/^[\w./-]+\.py:\d+:\s+error:/m, /Found \d+ errors? in \d+ files?/i]],
  ['pip', /^(?:pip\s+(?:install|download|uninstall)|python\s+-m\s+pip)\b/i, [/^Collecting /m, /^Successfully installed /m]],
  ['uv-sync', /^uv\s+(?:sync|pip\s+install)\b/i, [/^Resolved \d+ packages?/m, /^Installed \d+ packages?/m]],
  ['poetry-install', /^poetry\s+install\b/i, [/^Installing dependencies from lock file/m, /^Package operations:/m]],
  ['golangci-lint', /^golangci-lint\b/i, [/^[\w./-]+\.go:\d+:\d+:/m, /^\d+ issues?:/m]],
  ['bundle-install', /^bundle\s+install\b/i, [/^Fetching gem metadata from /m, /^Bundle complete!/m]],
  ['rubocop', /^(?:rubocop|bundle\s+exec\s+rubocop)\b/i, [/^Inspecting \d+ files/m, /^[\w./-]+\.rb:\d+:\d+:\s+[A-Z]:/m]],
  ['docker-ps', /^docker\s+ps\b/i, [/^CONTAINER ID\s+IMAGE\s+COMMAND/m]],
  ['docker-logs', /^docker\s+(?:compose\s+)?logs\b/i, [/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/m, /\b(?:ERROR|WARN|INFO)\b/, /^Attaching to /m]],
  ['aws', /^aws\b/i, [/An error occurred \([A-Za-z0-9]+\) when calling/, /^(?:upload|download): /m]],
  ['gcloud', /^gcloud\b/i, [/^ERROR: \(gcloud\./m, /^Updated property \[/m]],
  ['ssh', /^ssh\b/i, [/Permission denied \(/, /Host key verification failed/, /Connection timed out/]],
  ['rsync', /^rsync\b/i, [/^sending incremental file list/m, /^rsync error:/m]],
  ['curl', /^curl\b/i, [/curl: \(\d+\)/, /^HTTP\/\d(?:\.\d)? \d{3}/m]],
  ['wget', /^wget\b/i, [/^--\d{4}-\d{2}-\d{2}/m, /^ERROR \d{3}:/m]],
  ['json-output', /^(?:jq\b|cat\s+.*\.json\b)/i, [/^\s*[\[{][\s\S]*[\]}]\s*$/]],
  ['shell-ls', /^ls(?:\s+-[A-Za-z]+)?\b/i, [/^total \d+/m, /^\S+\s+\S+\s+\d+\s+\w+\s+\d{1,2}\s+/m]],
  ['shell-find', /^find\b/i, [/^(?:\.{1,2}|\/|[\w.-]+\/).+/m]],
  ['shell-grep', /^(?:grep|rg|ag)\b/i, [/^[\w./-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|rb|md|json|ya?ml|txt):\d*:/m, /^[\w./-]+\/[\w./-]+:\d*:/m]],
  ['shell-ps', /^ps\b/i, [/^(?:USER\s+PID|\s*PID\s+)/m]],
  ['shell-df', /^df\b/i, [/^Filesystem\s+.*Use%/m]],
  ['shell-du', /^du\b/i, [/^\d+(?:\.\d+)?[KMGTP]?\s+\S+/m]],
  ['error-stacktrace', null, [/Traceback \(most recent call last\):/, /^\s+at\s+\S+\s+\(.+:\d+:\d+\)/m, /^panic: /m, /^thread '[^']+' panicked at/m]],
  ['generic-error', null, [/Error:/, /Exception:/, /Traceback \(most recent call last\):/]],
]

export function detectCommandType(text, explicitCommand) {
  let command = (explicitCommand || '').trim()
  if (!command) {
    let start = 0
    for (let count = 0; count < 4; count++) {
      const end = text.indexOf('\n', start)
      const line = text.slice(start, end < 0 ? text.length : end).trim().replace(/^\$\s+/, '')
      if (commandStart.test(line)) { command = line; break }
      if (end < 0) break
      start = end + 1
    }
  }
  command = lastCommandSegment(command) || null
  let type = 'unknown', confidence = 0
  for (const [candidate, commandPattern, outputPatterns] of rules) {
    let score = command && commandPattern?.test(command) ? 0.55 : 0
    for (const pattern of outputPatterns) if (pattern.test(text)) score += 0.25
    score = Math.min(1, score)
    if (score > confidence) { type = candidate; confidence = score }
  }
  return { type, command, confidence: confidence || (command ? 0.35 : 0.1) }
}
