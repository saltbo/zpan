import { describe, expect, it } from 'vitest'
import { escapeHtml } from './html'

describe('escapeHtml', () => {
  it('escapes every HTML-significant character', () => {
    expect(escapeHtml(`<a href="x&y">'link'</a>`)).toBe('&lt;a href=&quot;x&amp;y&quot;&gt;&#39;link&#39;&lt;/a&gt;')
  })

  it('leaves plain text unchanged', () => {
    expect(escapeHtml('Alice shared report.pdf')).toBe('Alice shared report.pdf')
  })
})
