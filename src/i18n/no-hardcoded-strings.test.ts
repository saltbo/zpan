// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const BIOME = join(process.cwd(), 'node_modules', '.bin', 'biome')
// Fixtures live under src/ so biome.json's includes and plugins apply to them.
const FIXTURES = mkdtempSync(join(process.cwd(), 'src', 'i18n', 'lint-fixture-'))

afterAll(() => rmSync(FIXTURES, { recursive: true, force: true }))

let fixtureCount = 0

function lint(source: string, suffix = '.tsx') {
  const file = join(FIXTURES, `fixture-${fixtureCount++}${suffix}`)
  writeFileSync(file, source)
  const result = spawnSync(BIOME, ['lint', file], { encoding: 'utf8' })
  return { failed: result.status !== 0, output: `${result.stdout}${result.stderr}` }
}

describe('no hard-coded UI strings lint [spec: language/no-hard-coded-strings]', () => {
  it('rejects a string literal in an aria-label', () => {
    const { failed, output } = lint('export const A = () => <button type="button" aria-label="Help" />\n')
    expect(failed).toBe(true)
    expect(output).toContain('Accessible names and labels come from the locale files')
  })

  it('rejects a string literal in a label prop such as badge', () => {
    const { failed, output } = lint('import { Card } from \'./card\'\nexport const A = () => <Card badge="30D" />\n')
    expect(failed).toBe(true)
    expect(output).toContain('Accessible names and labels come from the locale files')
  })

  it('rejects a string literal in a toast', () => {
    const { failed, output } = lint(
      "import { toast } from 'sonner'\nexport const f = () => toast.error('Copy failed')\n",
    )
    expect(failed).toBe(true)
    expect(output).toContain('Toast text comes from the locale files')
  })

  it('rejects JSX text that contains a word', () => {
    const { failed, output } = lint('export const A = () => <p>Powered by</p>\n')
    expect(failed).toBe(true)
    expect(output).toContain('Visible text comes from the locale files')
  })

  it('accepts translated text, units, file names, and symbols', () => {
    const source = [
      "import { useTranslation } from 'react-i18next'",
      'export function A() {',
      '  const { t } = useTranslation()',
      '  return (',
      "    <nav aria-label={t('common.help')}>",
      "      {t('common.more')} <span>MB</span> <span>/{t('common.more')}/library.json</span> <span>{42}%</span> ·",
      '    </nav>',
      '  )',
      '}',
      '',
    ].join('\n')
    const { failed, output } = lint(source)
    expect(output).not.toContain('locale files')
    expect(failed).toBe(false)
  })

  it('skips test files', () => {
    const { output } = lint('export const A = () => <p aria-label="Help">Powered by</p>\n', '.test.tsx')
    expect(output).not.toContain('locale files')
  })
})
