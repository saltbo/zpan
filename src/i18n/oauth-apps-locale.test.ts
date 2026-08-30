import { describe, expect, it } from 'vitest'
import en from './locales/en.json'
import zh from './locales/zh.json'

const enLocale = en as Record<string, string>
const zhLocale = zh as Record<string, string>

const OAUTH_APPS_UI_KEYS = [
  'settings.oauthApps.colWorkspace',
  'settings.oauthApps.colScopes',
  'settings.oauthApps.colCreated',
  'settings.oauthApps.colLastUsed',
  'settings.oauthApps.colActions',
  'settings.oauthApps.never',
  'settings.oauthApps.oauthClient',
  'settings.oauthApps.oauthPermissions',
  'settings.oauthApps.permissionCount_one',
  'settings.oauthApps.permissionCount_other',
  'settings.oauthApps.scopeDescriptionMissing',
  'settings.oauthApps.oauthGrantsSection',
  'settings.oauthApps.oauthGrantsDescription',
  'settings.oauthApps.oauthNoGrants',
  'settings.oauthApps.oauthGrantsError',
  'settings.oauthApps.viewDetails',
  'settings.oauthApps.detailsDescription',
  'settings.oauthApps.clientId',
  'settings.oauthApps.status',
  'settings.oauthApps.statusActive',
  'settings.oauthApps.revokeAccess',
  'settings.oauthApps.oauthGrantRevokeTitle',
  'settings.oauthApps.oauthGrantRevokeConfirm',
]

describe('OAuth apps locale coverage', () => {
  for (const key of OAUTH_APPS_UI_KEYS) {
    it(`provides non-empty English and Chinese values for ${key}`, () => {
      expect(enLocale[key]?.trim()).not.toBe('')
      expect(zhLocale[key]?.trim()).not.toBe('')
    })
  }
})
