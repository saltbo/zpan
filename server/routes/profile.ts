import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { DirType } from '../../shared/constants'
import type { Env } from '../middleware/platform'
import {
  browsePublicDir,
  buildBreadcrumb,
  getPresignedDownloadUrl,
  getUserByUsername,
  getUserOrgId,
  isPublicPath,
  listPublicShares,
} from '../services/profile'

const app = new Hono<Env>()
  .get('/:username', async (c) => {
    const db = c.get('platform').db
    const { username } = c.req.param()

    const profileUser = await getUserByUsername(db, username)
    if (!profileUser) return c.json({ error: 'User not found' }, 404)

    const orgId = await getUserOrgId(db, username)
    if (!orgId) return c.json({ user: profileUser, shares: [] })

    const shares = await listPublicShares(db, orgId)

    const sharesWithUrls = await Promise.all(
      shares.map(async (matter) => {
        if (matter.dirtype !== DirType.FILE) return matter
        const downloadUrl = await getPresignedDownloadUrl(db, matter)
        return downloadUrl ? { ...matter, downloadUrl } : matter
      }),
    )

    return c.json({ user: profileUser, shares: sharesWithUrls })
  })
  .get('/:username/browse', zValidator('query', z.object({ dir: z.string().default('') })), async (c) => {
    const db = c.get('platform').db
    const { username } = c.req.param()
    const { dir } = c.req.valid('query')

    const orgId = await getUserOrgId(db, username)
    if (!orgId) return c.json({ error: 'User not found' }, 404)

    if (dir) {
      const accessible = await isPublicPath(db, orgId, dir)
      if (!accessible) return c.json({ error: 'Not found' }, 404)
    }

    const items = await browsePublicDir(db, orgId, dir)

    const itemsWithUrls = await Promise.all(
      items.map(async (matter) => {
        if (matter.dirtype !== DirType.FILE) return matter
        const downloadUrl = await getPresignedDownloadUrl(db, matter)
        return downloadUrl ? { ...matter, downloadUrl } : matter
      }),
    )

    return c.json({ items: itemsWithUrls, breadcrumb: buildBreadcrumb(dir) })
  })

export default app
