import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActivityRepo, SystemOptionsRepo } from '../ports'
import {
  applyBrandingUpdate,
  BRANDING_KEYS,
  type BrandingDeps,
  type BrandingUpdateInput,
  MAX_FAVICON_SIZE,
  MAX_LOGO_SIZE,
  readBranding,
  resetBranding,
  resetBrandingTheme,
  setBrandingField,
  uploadBrandingImage,
} from './branding'

function makeDeps(overrides: { options?: Map<string, string> } = {}) {
  const store = overrides.options ?? new Map<string, string>()

  const set = vi.fn(async (key: string, value: string, _isPublic: boolean) => {
    store.set(key, value)
  })
  const del = vi.fn(async (key: string) => {
    store.delete(key)
  })
  const listByKeyLike = vi.fn(async (_pattern: string) => [...store].map(([key, value]) => ({ key, value })))
  const systemOptions = { set, delete: del, listByKeyLike } as unknown as SystemOptionsRepo

  const record = vi.fn(async () => {})
  const activity = { record } as unknown as ActivityRepo

  const deps: BrandingDeps = { systemOptions, activity }
  return { deps, store, set, del, listByKeyLike, record }
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
const imageFileFrom = (type: string, bytes: Uint8Array<ArrayBuffer>) =>
  new File([bytes], 'f', { type }) as unknown as File
const dataUri = (type: string, bytes: Uint8Array) => `data:${type};base64,${Buffer.from(bytes).toString('base64')}`

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
    const { deps, set } = makeDeps()
    const res = await uploadBrandingImage(deps, 'logo', imageFile('application/octet-stream'))
    expect(res).toEqual({ ok: false, status: 400, error: expect.stringContaining('Invalid file type for logo') })
    expect(set).not.toHaveBeenCalled()
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

  it('rejects a logo larger than 256 KB with 413 naming the limit', async () => {
    const { deps, set } = makeDeps()
    const big = imageFile('image/png', MAX_LOGO_SIZE + 1)
    const res = await uploadBrandingImage(deps, 'logo', big)
    expect(res).toEqual({ ok: false, status: 413, error: 'Logo too large. Max 256 KB.' })
    expect(set).not.toHaveBeenCalled()
  })

  it('rejects a favicon larger than 64 KB with 413 naming the limit', async () => {
    const { deps, set } = makeDeps()
    const big = imageFile('image/png', MAX_FAVICON_SIZE + 1)
    const res = await uploadBrandingImage(deps, 'favicon', big)
    expect(res).toEqual({ ok: false, status: 413, error: 'Favicon too large. Max 64 KB.' })
    expect(set).not.toHaveBeenCalled()
  })

  it('applies per-field caps: a 128 KB file is fine for a logo but too large for a favicon', async () => {
    const { deps } = makeDeps()
    const size = 128 * 1024
    expect((await uploadBrandingImage(deps, 'logo', imageFile('image/png', size))).ok).toBe(true)
    expect(await uploadBrandingImage(deps, 'favicon', imageFile('image/png', size))).toMatchObject({
      ok: false,
      status: 413,
    })
  })

  it('encodes the logo as a data URI matching the uploaded bytes, stores it, and returns it', async () => {
    const { deps, store, set } = makeDeps()
    const bytes = new Uint8Array([0x3c, 0x73, 0x76, 0x67, 0x3e]) // "<svg>"
    const res = await uploadBrandingImage(deps, 'logo', imageFileFrom('image/svg+xml', bytes))
    const expected = dataUri('image/svg+xml', bytes)
    expect(res).toEqual({ ok: true, url: expected })
    expect(set).toHaveBeenCalledWith(BRANDING_KEYS.logo, expected, true)
    expect(store.get(BRANDING_KEYS.logo)).toBe(expected)
  })

  it('encodes a favicon as a data URI carrying its own mime type', async () => {
    const { deps, store } = makeDeps()
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7])
    const res = await uploadBrandingImage(deps, 'favicon', imageFileFrom('image/x-icon', bytes))
    const expected = dataUri('image/x-icon', bytes)
    expect(res).toEqual({ ok: true, url: expected })
    expect(store.get(BRANDING_KEYS.favicon)).toBe(expected)
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

  it('stores logo then favicon as data URIs and lists both as changed', async () => {
    const { deps, store, record } = makeDeps()
    const logoBytes = new Uint8Array([10, 20, 30])
    const faviconBytes = new Uint8Array([40, 50, 60, 70])
    const out = await applyBrandingUpdate(
      deps,
      baseUpdate({
        logoFile: imageFileFrom('image/png', logoBytes),
        faviconFile: imageFileFrom('image/x-icon', faviconBytes),
      }),
    )
    expect(out.ok).toBe(true)
    expect(store.get(BRANDING_KEYS.logo)).toBe(dataUri('image/png', logoBytes))
    expect(store.get(BRANDING_KEYS.favicon)).toBe(dataUri('image/x-icon', faviconBytes))
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ metadata: { fields: ['logo', 'favicon'] } }))
  })

  it('short-circuits on a logo upload failure without touching favicon or recording activity', async () => {
    const { deps, store, record } = makeDeps()
    const out = await applyBrandingUpdate(
      deps,
      baseUpdate({ logoFile: imageFile('application/pdf'), faviconFile: imageFile('image/png') }),
    )
    expect(out).toEqual({ ok: false, status: 400, error: expect.stringContaining('Invalid file type for logo') })
    expect(store.has(BRANDING_KEYS.logo)).toBe(false)
    expect(store.has(BRANDING_KEYS.favicon)).toBe(false)
    expect(record).not.toHaveBeenCalled()
  })

  it('propagates a 413 from the favicon upload after the logo succeeded', async () => {
    const { deps, store, record } = makeDeps()
    const out = await applyBrandingUpdate(
      deps,
      baseUpdate({
        logoFile: imageFile('image/png'),
        faviconFile: imageFile('image/png', MAX_FAVICON_SIZE + 1),
      }),
    )
    expect(out).toEqual({ ok: false, status: 413, error: 'Favicon too large. Max 64 KB.' })
    expect(store.has(BRANDING_KEYS.favicon)).toBe(false)
    expect(record).not.toHaveBeenCalled()
  })

  it('does not record an audit event when nothing changed', async () => {
    const { deps, record, set } = makeDeps()
    const out = await applyBrandingUpdate(deps, baseUpdate())
    expect(out.ok).toBe(true)
    expect(record).not.toHaveBeenCalled()
    expect(set).not.toHaveBeenCalled()
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
