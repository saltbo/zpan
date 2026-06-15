import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActivityRepo, S3Gateway, StorageRecord, StorageRepo, SystemOptionsRepo } from '../ports'
import {
  applyBrandingUpdate,
  BRANDING_KEYS,
  type BrandingDeps,
  type BrandingUpdateInput,
  MAX_BRANDING_FILE_SIZE,
  readBranding,
  resetBranding,
  resetBrandingTheme,
  setBrandingField,
  uploadBrandingImage,
} from './branding'

const sampleStorage = {
  id: 'st-1',
  title: 'Public',
  mode: 'public',
  bucket: 'b',
  endpoint: 'https://s3.example.com',
  region: 'us-east-1',
  accessKey: 'k',
  secretKey: 's',
  customHost: null,
} as unknown as StorageRecord

function makeDeps(overrides: { options?: Map<string, string>; storages?: Partial<StorageRepo> } = {}) {
  const store = overrides.options ?? new Map<string, string>()

  const set = vi.fn(async (key: string, value: string, _isPublic: boolean) => {
    store.set(key, value)
  })
  const del = vi.fn(async (key: string) => {
    store.delete(key)
  })
  const listByKeyLike = vi.fn(async (_pattern: string) => [...store].map(([key, value]) => ({ key, value })))
  const systemOptions = { set, delete: del, listByKeyLike } as unknown as SystemOptionsRepo

  const select = vi.fn(async (_mode: 'private' | 'public') => sampleStorage)
  const storages = { select, ...overrides.storages } as unknown as StorageRepo

  const putObject = vi.fn(async () => 16)
  const getPublicUrl = vi.fn(() => 'https://cdn.example.com/logo.png')
  const s3 = { putObject, getPublicUrl } as unknown as S3Gateway

  const record = vi.fn(async () => {})
  const activity = { record } as unknown as ActivityRepo

  const deps: BrandingDeps = { s3, storages, systemOptions, activity }
  return { deps, store, set, del, listByKeyLike, select, putObject, getPublicUrl, record }
}

function baseUpdate(over: Partial<BrandingUpdateInput> = {}): BrandingUpdateInput {
  return {
    userId: 'u1',
    orgId: 'o1',
    logoFile: null,
    faviconFile: null,
    wordmarkText: null,
    hidePoweredBy: null,
    theme: {},
    ...over,
  }
}

const imageFile = (type = 'image/png', size = 10) => new File([new Uint8Array(size)], 'f', { type }) as unknown as File

beforeEach(() => vi.clearAllMocks())

describe('readBranding', () => {
  it('returns defaults when nothing is stored', async () => {
    const { deps } = makeDeps()
    expect(await readBranding(deps)).toEqual({
      logo_url: null,
      favicon_url: null,
      wordmark_text: null,
      hide_powered_by: false,
      theme: { mode: 'preset', preset: 'default', custom: null, configured: false },
    })
  })

  it('ignores non-branding keys returned by the repo', async () => {
    const options = new Map([
      ['branding_wordmark_text', 'MyCloud'],
      ['some_other_option', 'x'],
    ])
    const { deps } = makeDeps({ options })
    const cfg = await readBranding(deps)
    expect(cfg.wordmark_text).toBe('MyCloud')
  })

  it('maps stored scalar values', async () => {
    const options = new Map([
      [BRANDING_KEYS.logo, 'https://cdn/logo.png'],
      [BRANDING_KEYS.favicon, 'https://cdn/fav.ico'],
      [BRANDING_KEYS.wordmark_text, 'MyCloud'],
      [BRANDING_KEYS.hide_powered_by, 'true'],
    ])
    const { deps } = makeDeps({ options })
    const cfg = await readBranding(deps)
    expect(cfg).toMatchObject({
      logo_url: 'https://cdn/logo.png',
      favicon_url: 'https://cdn/fav.ico',
      wordmark_text: 'MyCloud',
      hide_powered_by: true,
    })
  })

  it('treats hide_powered_by other than "true" as false', async () => {
    const { deps } = makeDeps({ options: new Map([[BRANDING_KEYS.hide_powered_by, 'false']]) })
    expect((await readBranding(deps)).hide_powered_by).toBe(false)
  })

  it('reads a preset theme and marks it configured', async () => {
    const options = new Map([
      [BRANDING_KEYS.theme_mode, 'preset'],
      [BRANDING_KEYS.theme_preset, 'forest'],
    ])
    const { deps } = makeDeps({ options })
    expect((await readBranding(deps)).theme).toMatchObject({
      mode: 'preset',
      preset: 'forest',
      custom: null,
      configured: true,
    })
  })

  it('falls back to the default preset when the stored preset id is unknown', async () => {
    const { deps } = makeDeps({ options: new Map([[BRANDING_KEYS.theme_preset, 'not-a-preset']]) })
    expect((await readBranding(deps)).theme.preset).toBe('default')
  })

  it('reads a complete custom theme', async () => {
    const options = new Map([
      [BRANDING_KEYS.theme_mode, 'custom'],
      [BRANDING_KEYS.theme_primary_color, '#123456'],
      [BRANDING_KEYS.theme_primary_foreground, '#ffffff'],
      [BRANDING_KEYS.theme_canvas_color, '#f1f5f9'],
      [BRANDING_KEYS.theme_sidebar_accent_color, '#dbeafe'],
      [BRANDING_KEYS.theme_ring_color, '#0f172a'],
    ])
    const { deps } = makeDeps({ options })
    expect((await readBranding(deps)).theme).toMatchObject({
      mode: 'custom',
      configured: true,
      custom: {
        primary_color: '#123456',
        primary_foreground: '#ffffff',
        canvas_color: '#f1f5f9',
        sidebar_accent_color: '#dbeafe',
        ring_color: '#0f172a',
      },
    })
  })

  it('returns custom: null when the custom theme is incomplete', async () => {
    const options = new Map([
      [BRANDING_KEYS.theme_mode, 'custom'],
      [BRANDING_KEYS.theme_primary_color, '#123456'],
    ])
    const { deps } = makeDeps({ options })
    const theme = (await readBranding(deps)).theme
    expect(theme.custom).toBeNull()
    expect(theme.configured).toBe(true) // any theme key present marks configured
  })
})

describe('uploadBrandingImage', () => {
  it('rejects an invalid logo MIME with 400', async () => {
    const { deps, putObject } = makeDeps()
    const res = await uploadBrandingImage(deps, 'logo', imageFile('application/octet-stream'))
    expect(res).toEqual({ ok: false, status: 400, error: expect.stringContaining('Invalid file type for logo') })
    expect(putObject).not.toHaveBeenCalled()
  })

  it('rejects an invalid favicon MIME with 400 listing favicon mimes', async () => {
    const { deps } = makeDeps()
    const res = await uploadBrandingImage(deps, 'favicon', imageFile('image/webp')) // webp not allowed for favicon
    expect(res).toMatchObject({ ok: false, status: 400 })
  })

  it('accepts an svg favicon', async () => {
    const { deps } = makeDeps()
    const res = await uploadBrandingImage(deps, 'favicon', imageFile('image/svg+xml'))
    expect(res.ok).toBe(true)
  })

  it('rejects a file larger than the max with 413', async () => {
    const { deps, putObject } = makeDeps()
    const big = imageFile('image/png', MAX_BRANDING_FILE_SIZE + 1)
    const res = await uploadBrandingImage(deps, 'logo', big)
    expect(res).toEqual({ ok: false, status: 413, error: 'File too large. Max 2 MiB.' })
    expect(putObject).not.toHaveBeenCalled()
  })

  it('returns 503 when no public storage is configured', async () => {
    const select = vi.fn(async () => {
      throw new Error('no public storage')
    })
    const { deps } = makeDeps({ storages: { select } })
    const res = await uploadBrandingImage(deps, 'logo', imageFile('image/png'))
    expect(res).toEqual({ ok: false, status: 503, error: 'No public storage configured' })
  })

  it('uploads, names the key from the mime ext, stores the public URL, and returns it', async () => {
    const { deps, store, putObject, getPublicUrl, set, select } = makeDeps()
    const res = await uploadBrandingImage(deps, 'logo', imageFile('image/svg+xml'))
    expect(res).toEqual({ ok: true, url: 'https://cdn.example.com/logo.png' })
    expect(select).toHaveBeenCalledWith('public')
    expect(putObject).toHaveBeenCalledWith(
      sampleStorage,
      '_system/branding/logo.svg',
      expect.any(Uint8Array),
      'image/svg+xml',
    )
    expect(getPublicUrl).toHaveBeenCalledWith(sampleStorage, '_system/branding/logo.svg')
    expect(set).toHaveBeenCalledWith(BRANDING_KEYS.logo, 'https://cdn.example.com/logo.png', true)
    expect(store.get(BRANDING_KEYS.logo)).toBe('https://cdn.example.com/logo.png')
  })
})

describe('setBrandingField / resetBrandingField / resetBrandingTheme', () => {
  it('setBrandingField writes the mapped key as public', async () => {
    const { deps, set, store } = makeDeps()
    await setBrandingField(deps, 'wordmark_text', 'Hi')
    expect(set).toHaveBeenCalledWith(BRANDING_KEYS.wordmark_text, 'Hi', true)
    expect(store.get(BRANDING_KEYS.wordmark_text)).toBe('Hi')
  })

  it('resetBrandingTheme deletes every theme key', async () => {
    const { deps, del } = makeDeps()
    await resetBrandingTheme(deps)
    expect(del.mock.calls.map((c) => c[0])).toEqual([
      BRANDING_KEYS.theme_mode,
      BRANDING_KEYS.theme_preset,
      BRANDING_KEYS.theme_primary_color,
      BRANDING_KEYS.theme_primary_foreground,
      BRANDING_KEYS.theme_canvas_color,
      BRANDING_KEYS.theme_sidebar_accent_color,
      BRANDING_KEYS.theme_ring_color,
    ])
  })
})

describe('applyBrandingUpdate', () => {
  it('saves wordmark + hide_powered_by, records one audit event, returns fresh config', async () => {
    const { deps, set, record } = makeDeps()
    const out = await applyBrandingUpdate(deps, baseUpdate({ wordmarkText: 'MyCloud', hidePoweredBy: true }))
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.config).toMatchObject({ wordmark_text: 'MyCloud', hide_powered_by: true })
    expect(set).toHaveBeenCalledWith(BRANDING_KEYS.wordmark_text, 'MyCloud', true)
    expect(set).toHaveBeenCalledWith(BRANDING_KEYS.hide_powered_by, 'true', true)
    expect(record).toHaveBeenCalledTimes(1)
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'branding_update',
        targetType: 'branding',
        targetName: 'branding',
        orgId: 'o1',
        userId: 'u1',
        metadata: { fields: ['wordmark_text', 'hide_powered_by'] },
      }),
    )
  })

  it('writes hide_powered_by = "false" when the parsed flag is false', async () => {
    const { deps, set } = makeDeps()
    await applyBrandingUpdate(deps, baseUpdate({ hidePoweredBy: false }))
    expect(set).toHaveBeenCalledWith(BRANDING_KEYS.hide_powered_by, 'false', true)
  })

  it('writes an empty wordmark string (clear) when provided', async () => {
    const { deps, set } = makeDeps()
    await applyBrandingUpdate(deps, baseUpdate({ wordmarkText: '' }))
    expect(set).toHaveBeenCalledWith(BRANDING_KEYS.wordmark_text, '', true)
  })

  it('persists each provided theme field', async () => {
    const { deps, set, record } = makeDeps()
    const out = await applyBrandingUpdate(deps, baseUpdate({ theme: { theme_mode: 'preset', theme_preset: 'ocean' } }))
    expect(out.ok).toBe(true)
    expect(set).toHaveBeenCalledWith(BRANDING_KEYS.theme_mode, 'preset', true)
    expect(set).toHaveBeenCalledWith(BRANDING_KEYS.theme_preset, 'ocean', true)
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { fields: ['theme_mode', 'theme_preset'] } }),
    )
  })

  it('uploads logo then favicon and lists both as changed', async () => {
    const { deps, putObject, record } = makeDeps()
    const out = await applyBrandingUpdate(
      deps,
      baseUpdate({ logoFile: imageFile('image/png'), faviconFile: imageFile('image/x-icon') }),
    )
    expect(out.ok).toBe(true)
    expect(putObject).toHaveBeenCalledTimes(2)
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ metadata: { fields: ['logo', 'favicon'] } }))
  })

  it('short-circuits on a logo upload failure without touching favicon or recording activity', async () => {
    const { deps, putObject, record } = makeDeps()
    const out = await applyBrandingUpdate(
      deps,
      baseUpdate({ logoFile: imageFile('application/pdf'), faviconFile: imageFile('image/png') }),
    )
    expect(out).toEqual({ ok: false, status: 400, error: expect.stringContaining('Invalid file type for logo') })
    expect(putObject).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })

  it('propagates a 503 storage failure from the favicon upload after the logo succeeded', async () => {
    let calls = 0
    const select = vi.fn(async () => {
      calls += 1
      if (calls === 2) throw new Error('gone') // logo ok, favicon fails
      return sampleStorage
    })
    const { deps, record } = makeDeps({ storages: { select } })
    const out = await applyBrandingUpdate(
      deps,
      baseUpdate({ logoFile: imageFile('image/png'), faviconFile: imageFile('image/png') }),
    )
    expect(out).toEqual({ ok: false, status: 503, error: 'No public storage configured' })
    expect(record).not.toHaveBeenCalled()
  })

  it('does not record an audit event when nothing changed', async () => {
    const { deps, record, set, putObject } = makeDeps()
    const out = await applyBrandingUpdate(deps, baseUpdate())
    expect(out.ok).toBe(true)
    expect(record).not.toHaveBeenCalled()
    expect(set).not.toHaveBeenCalled()
    expect(putObject).not.toHaveBeenCalled()
  })

  it('records the full changed-field list across files, scalars, and theme', async () => {
    const { deps, record } = makeDeps()
    await applyBrandingUpdate(
      deps,
      baseUpdate({
        logoFile: imageFile('image/png'),
        wordmarkText: 'Hi',
        hidePoweredBy: true,
        theme: { theme_mode: 'preset' },
      }),
    )
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { fields: ['logo', 'wordmark_text', 'hide_powered_by', 'theme_mode'] } }),
    )
  })
})

describe('resetBranding', () => {
  it('resets a single scalar field and records the reset', async () => {
    const { deps, del, record } = makeDeps()
    await resetBranding(deps, { userId: 'u1', orgId: 'o1', field: 'wordmark_text' })
    expect(del).toHaveBeenCalledWith(BRANDING_KEYS.wordmark_text)
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'branding_reset',
        targetType: 'branding',
        targetName: 'wordmark_text',
        metadata: { field: 'wordmark_text' },
        orgId: 'o1',
        userId: 'u1',
      }),
    )
  })

  it('resets the whole theme for the umbrella "theme" field', async () => {
    const { deps, del } = makeDeps()
    await resetBranding(deps, { userId: 'u1', orgId: 'o1', field: 'theme' })
    expect(del.mock.calls.length).toBe(7) // every theme key
    expect(del).toHaveBeenCalledWith(BRANDING_KEYS.theme_mode)
    expect(del).toHaveBeenCalledWith(BRANDING_KEYS.theme_ring_color)
  })

  it('resets the whole theme even for an individual theme knob (theme_preset)', async () => {
    const { deps, del, record } = makeDeps()
    await resetBranding(deps, { userId: 'u1', orgId: 'o1', field: 'theme_preset' })
    expect(del.mock.calls.length).toBe(7)
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ targetName: 'theme_preset' }))
  })

  it('records the reset for an image field', async () => {
    const { deps, del, record } = makeDeps()
    await resetBranding(deps, { userId: 'u1', orgId: 'o1', field: 'logo' })
    expect(del).toHaveBeenCalledWith(BRANDING_KEYS.logo)
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ targetName: 'logo' }))
  })
})
