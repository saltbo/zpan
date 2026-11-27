import { describe, expect, it } from 'vitest'
import { validatePath } from '../../domain/image-hosting'
import { englishMessage, localizeMessage, msg, productMessage, textMessage, ZH_ERROR_MESSAGES } from './error-messages'

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()

describe('error message catalog', () => {
  it('gives every message non-empty Chinese text with the same parameters [spec: error-messages/catalog-complete]', () => {
    for (const [english, chinese] of Object.entries(ZH_ERROR_MESSAGES)) {
      expect(chinese.trim(), english).not.toBe('')
      expect(placeholders(chinese), english).toEqual(placeholders(english))
    }
  })

  it('keeps machine codes out of the catalog, so no code is shown as a message [spec: error-messages/external-failure]', () => {
    for (const english of Object.keys(ZH_ERROR_MESSAGES)) {
      expect(english, english).not.toMatch(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/)
    }
  })

  it('turns text from outside the product into a product message [spec: error-messages/external-failure]', () => {
    const fallback = 'Image upload failed'
    const zh = (text: string) => localizeMessage(productMessage(text, fallback), 'zh')
    const en = (text: string) => localizeMessage(productMessage(text, fallback), 'en')
    expect(en('quota_store_binding_missing')).toBe('This site is not connected to a ZPan Cloud store')
    expect(zh('quota_store_binding_missing')).toBe('此站点尚未绑定 ZPan Cloud 商店')
    expect(en('license_inactive')).toBe('The license is not active')
    expect(en('cloud_required')).toBe('This needs a connection to ZPan Cloud')
    expect(en('cloud_request_failed_503')).toBe('ZPan Cloud could not complete the request. Try again later.')
    expect(en('some_unknown_cloud_code')).toBe('Image upload failed')
    expect(zh('Invalid login: 535 Authentication failed')).toBe('图片上传失败')
    expect(zh('Email is disabled')).toBe('邮件功能未启用')
  })

  it('renders English from the key and fills parameters', () => {
    expect(englishMessage('Team not found')).toBe('Team not found')
    expect(englishMessage(msg('Task is {status}', { status: 'paused' }))).toBe('Task is paused')
    expect(localizeMessage(msg('Task is {status}', { status: 'paused' }), 'zh')).toBe('任务当前状态为 paused')
  })

  it('translates already-filled text that matches a template', () => {
    expect(localizeMessage(textMessage("An item named 'a.txt' already exists in this location"), 'zh')).toBe(
      '此位置已存在名为“a.txt”的项目',
    )
    expect(localizeMessage(textMessage('Logo too large. Max 512 KB.'), 'zh')).toBe('Logo过大，最大 512 KB。')
  })

  it('shows unknown text as is in every language', () => {
    expect(localizeMessage(textMessage('SMTP 535 auth failed'), 'zh')).toBe('SMTP 535 auth failed')
    expect(localizeMessage(textMessage('SMTP 535 auth failed'), 'en')).toBe('SMTP 535 auth failed')
  })

  it('translates every image-hosting path error', () => {
    const invalid = ['a b', '/a', 'a/', 'a/../b', 'a//b', 'a'.repeat(300), 'a/b/c/d/e/f']
    for (const path of invalid) {
      const error = validatePath(path)
      expect(error, path).not.toBeNull()
      const text = `${error?.error}: ${error?.detail}`
      expect(localizeMessage(textMessage(text), 'zh'), text).not.toBe(text)
    }
  })
})
