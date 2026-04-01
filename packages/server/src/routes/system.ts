import { Hono } from 'hono'
import { requireAdmin } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { getOption, listPublicOptions, upsertOption } from '../services/system'

const app = new Hono<Env>()
  .get('/options', async (c) => {
    const db = c.get('platform').db
    const items = await listPublicOptions(db)
    return c.json({ items })
  })
  .get('/options/:key', async (c) => {
    const db = c.get('platform').db
    const key = c.req.param('key')
    const option = await getOption(db, key)
    if (!option) return c.json({ error: 'Not found' }, 404)

    if (!option.public && !c.get('userId')) return c.json({ error: 'Unauthorized' }, 401)

    return c.json({ key: option.key, value: option.value })
  })

export const adminSystem = new Hono<Env>().use(requireAdmin).put('/options/:key', async (c) => {
  const db = c.get('platform').db
  const key = c.req.param('key')
  const body = await c.req.json<{ value: string; public?: boolean }>()
  await upsertOption(db, key, body.value, body.public)
  return c.json({ key, value: body.value })
})

export default app
