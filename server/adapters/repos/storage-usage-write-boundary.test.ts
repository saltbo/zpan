import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const SERVER_ROOT = join(process.cwd(), 'server')
const ALLOWED_WRITERS = new Set(['adapters/repos/image-hosting.ts', 'adapters/repos/matter.ts'])
const TEST_FILE_PATTERN = /\.(?:test|integration\.test|cf-test|libsql-test)\.ts$/
const DRIZZLE_WRITE_PATTERN = /\.(?:insert|update|delete)\s*\(\s*(?:matters|imageHostings)\s*\)/g
const RAW_WRITE_PATTERN = /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:matters|image_hostings)\b/gi

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.isFile() && path.endsWith('.ts') && !TEST_FILE_PATTERN.test(path) ? [path] : []
  })
}

describe('storage usage write boundary', () => {
  it('keeps raw file mutations inside projection-aware repositories', () => {
    const offenders = sourceFiles(SERVER_ROOT).flatMap((path) => {
      const source = readFileSync(path, 'utf8')
      const writes = [...source.matchAll(DRIZZLE_WRITE_PATTERN), ...source.matchAll(RAW_WRITE_PATTERN)]
      if (writes.length === 0) return []
      const file = relative(SERVER_ROOT, path)
      return ALLOWED_WRITERS.has(file) ? [] : [{ file, writes: writes.map((match) => match[0]) }]
    })

    expect(offenders).toEqual([])
  })
})
