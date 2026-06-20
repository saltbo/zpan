import type { Context } from 'hono'
import type { Env } from '../middleware/platform'
import { PUBLIC_IMAGES_BINDING, type R2BucketLike } from '../platform/interface'

// Public read of a self-hosted avatar blob from the PUBLIC_IMAGES R2 binding. Only used on
// Cloudflare when the binding is present and PUBLIC_IMAGES_URL is NOT set (e.g. local
// miniflare, which gives R2 no public URL); with a custom domain set, or on Node/Docker
// (Cloud avatar service), the stored URL is absolute and this route is never hit.
export async function serveAvatarBlob(c: Context<Env>) {
  const bucket = c.get('platform').getBinding<R2BucketLike>(PUBLIC_IMAGES_BINDING)
  if (!bucket) return c.body(null, 404)

  const obj = await bucket.get(`${c.req.param('scope')}/${c.req.param('id')}`)
  if (!obj) return c.body(null, 404)

  return c.body(await obj.arrayBuffer(), 200, {
    'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
    'Cache-Control': 'public, max-age=31536000, immutable',
  })
}
