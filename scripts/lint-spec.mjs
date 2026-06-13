#!/usr/bin/env node
// Spec ↔ test traceability governance lint (NOT a behavioural test runner).
//
// Every scenario in spec/**/*.feature is tagged `@<capability>/<slug>`. Its home
// test carries `[spec: <capability>/<slug>]` in the test name. This lint enforces
// the link both ways:
//   - ERROR: a spec scenario id with no referencing test (spec drift / missing coverage)
//   - ERROR: a `[spec: id]` breadcrumb whose id has no scenario (stale reference)
// See spec/README.md.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const SPEC_DIR = join(ROOT, 'spec')
const TEST_DIRS = ['server', 'src', 'shared', 'e2e']
const TEST_RE = /\.(test|integration\.test|cf-test|libsql-test|spec)\.[jt]sx?$/
const ID_RE = /@([a-z0-9-]+\/[a-z0-9-]+)\b/g
const REF_RE = /\[spec:\s*([a-z0-9-]+\/[a-z0-9-]+)\s*\]/g

function walk(dir, onFile) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === '.git') continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, onFile)
    else onFile(full)
  }
}

// 1. Collect scenario ids declared in the specs.
const specIds = new Map() // id -> feature file
walk(SPEC_DIR, (file) => {
  if (!file.endsWith('.feature')) return
  const text = readFileSync(file, 'utf8')
  for (const line of text.split('\n')) {
    // Only tag lines (start with @ after trim) carry scenario ids.
    if (!line.trim().startsWith('@')) continue
    for (const m of line.matchAll(ID_RE)) specIds.set(m[1], file)
  }
})

// 2. Collect [spec: id] breadcrumbs from test files.
const refIds = new Map() // id -> [files]
for (const d of TEST_DIRS) {
  walk(join(ROOT, d), (file) => {
    if (!TEST_RE.test(file)) return
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(REF_RE)) {
      const list = refIds.get(m[1]) ?? []
      list.push(file)
      refIds.set(m[1], list)
    }
  })
}

const orphanSpecs = [...specIds.keys()].filter((id) => !refIds.has(id)).sort()
const staleRefs = [...refIds.keys()].filter((id) => !specIds.has(id)).sort()

if (orphanSpecs.length === 0 && staleRefs.length === 0) {
  console.log(`✔ spec traceability: ${specIds.size} scenarios, all covered by tests`)
  process.exit(0)
}

if (orphanSpecs.length) {
  console.error(`\n✖ ${orphanSpecs.length} spec scenario(s) with no [spec: id] test:`)
  for (const id of orphanSpecs) console.error(`    @${id}  (${specIds.get(id).replace(`${ROOT}/`, '')})`)
}
if (staleRefs.length) {
  console.error(`\n✖ ${staleRefs.length} [spec: id] breadcrumb(s) with no matching scenario:`)
  for (const id of staleRefs) console.error(`    [spec: ${id}]  (${refIds.get(id)[0].replace(`${ROOT}/`, '')})`)
}
process.exit(1)
