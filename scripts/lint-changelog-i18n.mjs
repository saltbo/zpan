#!/usr/bin/env node

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const canonicalPath = join(root, 'CHANGELOG.md')
const localesDir = join(root, 'docs', 'i18n')
const localePaths = readdirSync(localesDir)
  .filter((name) => /^CHANGELOG\..+\.md$/.test(name))
  .sort()
  .map((name) => join(localesDir, name))

if (localePaths.length === 0) {
  throw new Error('No localized changelog files found in docs/i18n')
}

function versions(path) {
  return [...readFileSync(path, 'utf8').matchAll(/^## (v\d+\.\d+\.\d+)\b/gm)].map((match) => match[1])
}

const canonicalVersions = versions(canonicalPath)
const failures = localePaths.flatMap((path) => {
  const localizedVersions = versions(path)
  return JSON.stringify(localizedVersions) === JSON.stringify(canonicalVersions)
    ? []
    : [`${path.replace(`${root}/`, '')}: expected ${canonicalVersions.join(', ')}, got ${localizedVersions.join(', ')}`]
})

if (failures.length > 0) {
  console.error('Localized changelog versions must exactly match CHANGELOG.md:')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log(`✔ changelog i18n: ${localePaths.length} locales match ${canonicalVersions.length} releases`)
