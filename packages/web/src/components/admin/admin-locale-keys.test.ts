/**
 * Tests that all translation keys consumed by the new admin components exist
 * in both locale files.
 *
 * Components checked:
 *   - admin-sidebar.tsx      (admin.nav.*, nav.admin, nav.backToFiles)
 *   - storage-form-dialog.tsx (admin.storages.form.*, admin.storages.addStorage,
 *                              admin.storages.editStorage, common.*)
 *   - storages/index.tsx     (admin.storages.*, common.*)
 *   - app-sidebar.tsx        (nav.adminPanel)
 */
import { describe, expect, it } from 'vitest'
import en from '@/i18n/locales/en.json'
import zh from '@/i18n/locales/zh.json'

// All translation keys referenced in the changed components.
const requiredKeys: string[] = [
  // admin-sidebar.tsx
  'nav.admin',
  'admin.nav.storages',
  'admin.nav.users',
  'admin.nav.settings',
  'nav.backToFiles',

  // app-sidebar.tsx — new admin panel link
  'nav.adminPanel',

  // storage-form-dialog.tsx
  'admin.storages.addStorage',
  'admin.storages.editStorage',
  'admin.storages.form.title',
  'admin.storages.form.mode',
  'admin.storages.form.modePrivate',
  'admin.storages.form.modePublic',
  'admin.storages.form.bucket',
  'admin.storages.form.endpoint',
  'admin.storages.form.region',
  'admin.storages.form.accessKey',
  'admin.storages.form.secretKey',
  'admin.storages.form.filePath',
  'admin.storages.form.filePathHint',
  'admin.storages.form.customHost',
  'admin.storages.form.customHostHint',
  'admin.storages.form.capacity',
  'common.cancel',
  'common.save',
  'common.loading',

  // storages/index.tsx
  'admin.storages.title',
  'admin.storages.noStorages',
  'admin.storages.deleteStorage',
  'admin.storages.deleteConfirm',
  'admin.storages.deleteHasFiles',
  'admin.storages.createSuccess',
  'admin.storages.updateSuccess',
  'admin.storages.deleteSuccess',
  'admin.storages.col.title',
  'admin.storages.col.mode',
  'admin.storages.col.bucket',
  'admin.storages.col.endpoint',
  'admin.storages.col.capacity',
  'admin.storages.col.status',
  'admin.storages.col.actions',
  'admin.storages.status.active',
  'admin.storages.status.inactive',
  'common.delete',
]

const enLocale = en as Record<string, string>
const zhLocale = zh as Record<string, string>

describe('admin component locale keys — en.json', () => {
  for (const key of requiredKeys) {
    it(`has key "${key}"`, () => {
      expect(enLocale).toHaveProperty(key)
    })

    it(`"${key}" is not empty in en.json`, () => {
      expect(enLocale[key]).toBeTruthy()
    })
  }
})

describe('admin component locale keys — zh.json', () => {
  for (const key of requiredKeys) {
    it(`has key "${key}"`, () => {
      expect(zhLocale).toHaveProperty(key)
    })

    it(`"${key}" is not empty in zh.json`, () => {
      expect(zhLocale[key]).toBeTruthy()
    })
  }
})
