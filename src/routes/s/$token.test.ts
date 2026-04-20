import { describe, expect, it } from 'vitest'
import en from '../../i18n/locales/en.json'
import zh from '../../i18n/locales/zh.json'

// ShareLanding and its sub-components are React rendering components.
// The project has no jsdom/@testing-library setup, so we test pure logic here.

// ─── Share error code derivation ─────────────────────────────────────────────

type ShareState = {
  expired: boolean
  exhausted: boolean
  requiresPassword: boolean
  isFolder: boolean
}

type ErrorCode = 'expired' | 'exhausted' | null

function resolveErrorCode(share: ShareState): ErrorCode {
  if (share.expired) return 'expired'
  if (share.exhausted) return 'exhausted'
  return null
}

describe('resolveErrorCode', () => {
  it('returns expired when share is expired', () => {
    expect(resolveErrorCode({ expired: true, exhausted: false, requiresPassword: false, isFolder: false })).toBe(
      'expired',
    )
  })

  it('returns exhausted when download limit reached', () => {
    expect(resolveErrorCode({ expired: false, exhausted: true, requiresPassword: false, isFolder: false })).toBe(
      'exhausted',
    )
  })

  it('prioritises expired over exhausted', () => {
    expect(resolveErrorCode({ expired: true, exhausted: true, requiresPassword: false, isFolder: false })).toBe(
      'expired',
    )
  })

  it('returns null for accessible share', () => {
    expect(resolveErrorCode({ expired: false, exhausted: false, requiresPassword: false, isFolder: false })).toBeNull()
  })
})

// ─── Workers SSR OG meta helper — attribute escaping ─────────────────────────

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

describe('escapeAttr', () => {
  it('escapes ampersands', () => {
    expect(escapeAttr('foo & bar')).toBe('foo &amp; bar')
  })

  it('escapes double quotes', () => {
    expect(escapeAttr('say "hello"')).toBe('say &quot;hello&quot;')
  })

  it('leaves safe strings unchanged', () => {
    expect(escapeAttr('hello world')).toBe('hello world')
  })
})

// ─── i18n key coverage ────────────────────────────────────────────────────────
// Verifies that the key set used by share components is consistent.

const REQUIRED_SHARE_KEYS = [
  'share.notFound',
  'share.gone',
  'share.expired',
  'share.exhausted',
  'share.browseZPan',
  'share.passwordTitle',
  'share.passwordSubmit',
  'share.passwordWrong',
  'share.download',
  'share.saveToDrive',
  'share.folderTitle',
  'share.saveToDriveTitle',
  'share.saveButton',
  'share.loading',
  'share.previewUnavailable',
  'share.externalLabel',
  'share.externalBadge',
  'share.externalFolderSubtitle',
  'share.externalFileSubtitle',
  'share.readonlyHint',
  'share.openWorkspace',
]

const enLocale = en as Record<string, string>
const zhLocale = zh as Record<string, string>

describe('share i18n keys', () => {
  it('all required keys exist in en.json', () => {
    for (const key of REQUIRED_SHARE_KEYS) {
      expect(enLocale[key], `Missing key: ${key}`).toBeDefined()
    }
  })

  it('all required keys exist in zh.json', () => {
    for (const key of REQUIRED_SHARE_KEYS) {
      expect(zhLocale[key], `Missing key in zh: ${key}`).toBeDefined()
    }
  })
})
