import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.cwd()
const violations = walk(join(root, 'server'))
  .filter((file) => file.endsWith('.test.ts'))
  .filter((file) => !/\.(?:integration|cf|libsql)\.test\.ts$/.test(file))
  .filter((file) => readFileSync(file, 'utf8').includes('createTestApp'))
  .map((file) => relative(root, file))

if (violations.length > 0) {
  console.error('Unit tests must not create the database-backed application fixture.')
  console.error('Rename these files to *.integration.test.ts:')
  for (const file of violations) console.error(`- ${file}`)
  process.exit(1)
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? walk(path) : [path]
  })
}
