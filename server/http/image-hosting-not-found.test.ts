import { describe, expect, it } from 'vitest'
import { imageHostingNotFound } from './image-hosting-not-found'

describe('imageHostingNotFound', () => {
  it('returns an English HTML page for direct navigation', async () => {
    const response = imageHostingNotFound(
      new Request('https://images.example.com/missing.png', {
        headers: { Accept: 'text/html,application/xhtml+xml,image/avif,image/webp,*/*;q=0.8' },
      }),
    )

    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    const body = await response.text()
    expect(body).toContain('<html lang="en">')
    expect(body).toContain('Image not found')
  })

  it('returns a Chinese HTML page when Chinese is preferred', async () => {
    const response = imageHostingNotFound(
      new Request('https://images.example.com/missing.png', {
        headers: { Accept: 'text/html', 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' },
      }),
    )

    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    const body = await response.text()
    expect(body).toContain('<html lang="zh-CN">')
    expect(body).toContain('图片不存在')
  })

  it('returns an English SVG placeholder for an embedded image request', async () => {
    const response = imageHostingNotFound(
      new Request('https://images.example.com/missing.png', {
        headers: {
          Accept: 'image/avif,image/webp,image/svg+xml,image/*,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      }),
    )

    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toBe('image/svg+xml; charset=utf-8')
    const body = await response.text()
    expect(body).toContain('<svg')
    expect(body).toContain('Image not found')
  })
})
