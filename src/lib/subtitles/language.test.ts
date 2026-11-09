import { describe, expect, it } from 'vitest'
import { languageFromSidecarTag, languageLabel, normalizeLanguage, pickDefaultSubtitle } from './language'

describe('normalizeLanguage', () => {
  it('maps Matroska ISO 639-2 codes, including bibliographic ones', () => {
    expect(normalizeLanguage('chi')).toBe('zh')
    expect(normalizeLanguage('ger')).toBe('de')
    expect(normalizeLanguage('eng')).toBe('en')
  })

  it('turns Chinese regions into scripts and keeps other BCP 47 tags', () => {
    expect(normalizeLanguage('zh-CN')).toBe('zh-Hans')
    expect(normalizeLanguage('zh-tw')).toBe('zh-Hant')
    expect(normalizeLanguage('zh-hans')).toBe('zh-Hans')
    expect(normalizeLanguage('pt-BR')).toBe('pt-BR')
  })

  it('rejects undetermined and invalid codes', () => {
    expect(normalizeLanguage('und')).toBeNull()
    expect(normalizeLanguage('')).toBeNull()
    expect(normalizeLanguage('not a tag!')).toBeNull()
  })
})

describe('languageFromSidecarTag', () => {
  it('understands release-group tags', () => {
    expect(languageFromSidecarTag('chs')).toBe('zh-Hans')
    expect(languageFromSidecarTag('CHT')).toBe('zh-Hant')
    expect(languageFromSidecarTag('简体')).toBe('zh-Hans')
    expect(languageFromSidecarTag('chs&eng')).toBe('zh-Hans')
    expect(languageFromSidecarTag('en.forced')).toBe('en')
    expect(languageFromSidecarTag('zh-CN')).toBe('zh-Hans')
  })

  it('returns null when no part names a language', () => {
    expect(languageFromSidecarTag('')).toBeNull()
    expect(languageFromSidecarTag('forced.sdh')).toBeNull()
  })
})

describe('languageLabel', () => {
  it('names the language in the interface language', () => {
    expect(languageLabel('zh-Hans', 'zh')).toBe('简体中文')
    expect(languageLabel('en', 'en')).toBe('English')
  })
})

describe('pickDefaultSubtitle', () => {
  const track = (language: string | null, isDefault = false, isForced = false) => ({ language, isDefault, isForced })

  it('prefers the interface language, simplified Chinese before traditional', () => {
    const tracks = [track('en', true), track('zh-Hant'), track('zh-Hans')]
    expect(pickDefaultSubtitle(tracks, 'zh')).toBe(tracks[2])
    expect(pickDefaultSubtitle([track('zh-Hant')], 'zh-CN')?.language).toBe('zh-Hant')
  })

  it('ignores forced tracks and falls back to the file’s default', () => {
    const tracks = [track('zh', false, true), track('ja', true)]
    expect(pickDefaultSubtitle(tracks, 'zh')).toBe(tracks[1])
  })

  it('shows nothing when no track qualifies', () => {
    expect(pickDefaultSubtitle([track('ja')], 'en')).toBeNull()
  })
})
