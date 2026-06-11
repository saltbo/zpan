import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { createTestApp } from '../test/setup.js'
import { ensureSitePublicOrigin, getSitePublicOrigin, resetSitePublicOriginCache } from './site-public-origin.js'

beforeEach(() => {
  resetSitePublicOriginCache()
})

describe('ensureSitePublicOrigin', () => {
  it('persists the request origin on first call and reports created', async () => {
    const { db } = await createTestApp()

    const result = await ensureSitePublicOrigin(db, 'https://pan.example.com/api/auth/get-session')

    expect(result).toEqual({ origin: 'https://pan.example.com', created: true })
    expect(await getSitePublicOrigin(db)).toBe('https://pan.example.com')
  })

  it('adopts an existing configured origin instead of the request origin', async () => {
    const { db } = await createTestApp()
    await db.run(sql`
      INSERT INTO system_options (key, value, public)
      VALUES ('site_public_origin', 'https://configured.example.com', 0)
    `)

    const result = await ensureSitePublicOrigin(db, 'https://request.example.com/files')

    expect(result).toEqual({ origin: 'https://configured.example.com', created: false })
  })

  it('serves the cached origin without touching the database', async () => {
    const { db } = await createTestApp()
    await ensureSitePublicOrigin(db, 'https://pan.example.com/files')

    // Any DB access would throw on a null handle — the cache must answer.
    const result = await ensureSitePublicOrigin(null as never, 'https://other.example.com/files')

    expect(result).toEqual({ origin: 'https://pan.example.com', created: false })
  })

  it('does not cache when no origin can be determined', async () => {
    const { db } = await createTestApp()

    const first = await ensureSitePublicOrigin(db, 'not-a-url')
    expect(first).toEqual({ origin: null, created: false })

    // A later request with a valid URL must still be able to bootstrap.
    const second = await ensureSitePublicOrigin(db, 'https://pan.example.com/files')
    expect(second).toEqual({ origin: 'https://pan.example.com', created: true })
  })
})
