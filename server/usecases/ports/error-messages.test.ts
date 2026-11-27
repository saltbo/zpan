import { describe, expect, it } from 'vitest'
import { validatePath } from '../../domain/image-hosting'
import { englishMessage, localizeMessage, msg, textMessage, ZH_ERROR_MESSAGES } from './error-messages'

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()

describe('error message catalog', () => {
  it('gives every message non-empty Chinese text with the same parameters [spec: error-messages/catalog-complete]', () => {
    for (const [english, chinese] of Object.entries(ZH_ERROR_MESSAGES)) {
      expect(chinese.trim(), english).not.toBe('')
      expect(placeholders(chinese), english).toEqual(placeholders(english))
    }
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
