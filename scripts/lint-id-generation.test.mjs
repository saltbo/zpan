import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('ID generation lint', () => {
  it('rejects default nanoid imports in production sources', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zpan-id-lint-'))
    try {
      execFileSync('git', ['init', '-q'], { cwd: dir })
      mkdirSync(join(dir, 'server'))
      writeFileSync(join(dir, 'server/bad.ts'), "import { nanoid } from 'nanoid'\nexport const id = nanoid()\n")
      execFileSync('git', ['add', 'server/bad.ts'], { cwd: dir })
      const script = join(process.cwd(), 'scripts/lint-id-generation.mjs')
      expect(() => execFileSync('node', [script], { cwd: dir, stdio: 'pipe' })).toThrow(/default nanoid generator/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
