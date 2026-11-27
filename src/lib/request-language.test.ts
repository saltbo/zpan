import { afterEach, describe, expect, it } from 'vitest'
import i18n, { i18nReady } from '@/i18n'
import { requestLanguageHeaders } from './request-language'

describe('requestLanguageHeaders', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('follows the UI language [spec: error-messages/ui-language]', async () => {
    await i18nReady
    await i18n.changeLanguage('zh')
    expect(requestLanguageHeaders()).toEqual({ 'Accept-Language': 'zh' })
    await i18n.changeLanguage('en')
    expect(requestLanguageHeaders()).toEqual({ 'Accept-Language': 'en' })
  })

  it('maps a regional locale to its supported language', async () => {
    await i18nReady
    await i18n.changeLanguage('zh-CN')
    expect(requestLanguageHeaders()).toEqual({ 'Accept-Language': 'zh' })
  })
})
