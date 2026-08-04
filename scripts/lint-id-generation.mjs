import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const roots = ['server', 'shared', 'src', 'workers', 'scripts']
const files = execFileSync('git', ['ls-files', ...roots], { encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter((file) => file && !/\.(?:test|cf-test|libsql-test)\.[jt]sx?$/.test(file))

const violations = []
const customAlphabetAllowlist = new Set(['shared/ids.ts', 'shared/org-slugs.ts', 'server/auth.ts'])
for (const file of files) {
  const source = readFileSync(file, 'utf8')
  if (/import\s*\{[^}]*\bnanoid\b[^}]*\}\s*from\s*['"]nanoid['"]/.test(source)) {
    violations.push(`${file}: imports the default nanoid generator`)
  }
  if (
    /import\s*\{[^}]*\bcustomAlphabet\b[^}]*\}\s*from\s*['"]nanoid['"]/.test(source) &&
    !customAlphabetAllowlist.has(file)
  ) {
    violations.push(`${file}: imports customAlphabet outside the reviewed generator allowlist`)
  }
}

if (violations.length > 0) {
  throw new Error(`Uncontrolled ID generation:\n${violations.join('\n')}`)
}
