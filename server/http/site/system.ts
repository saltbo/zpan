import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { requireAdmin } from '../../middleware/auth'
import type { Env } from '../../middleware/platform'
import { runtimeInfo } from '../../usecases/site/instance-info'
import {
  deleteSystemOption,
  getChangelog,
  getSystemOption,
  listSystemOptions,
  resolveInstanceInfo,
  setSystemOption,
} from '../../usecases/site/system'

const setOptionSchema = z.object({
  value: z.string(),
  public: z.boolean().optional(),
})

const app = new Hono<Env>()
  .get('/instance', requireAdmin, async (c) => {
    const info = await resolveInstanceInfo(c.get('deps'), {
      requestUrl: c.req.url,
      runtime: runtimeInfo(c.get('platform')),
    })
    return c.json(info)
  })
  .get('/changelog', requireAdmin, zValidator('query', z.object({ refresh: z.string().optional() })), async (c) => {
    const result = await getChangelog(c.get('deps'), {
      now: Date.now(),
      force: c.req.valid('query').refresh === 'true',
    })
    return c.json(result)
  })
  .get('/options', async (c) => {
    const result = await listSystemOptions(c.get('deps'), { isAdmin: c.get('userRole') === 'admin' })
    return c.json(result)
  })
  .get('/options/:key', async (c) => {
    const result = await getSystemOption(c.get('deps'), {
      key: c.req.param('key'),
      isAdmin: c.get('userRole') === 'admin',
    })
    if (result.ok) return c.json(result.option)
    if (result.reason === 'not_found') return c.json({ error: 'Option not found' }, 404)
    return c.json({ error: 'Forbidden' }, 403)
  })
  .put('/options/:key', requireAdmin, zValidator('json', setOptionSchema), async (c) => {
    const body = c.req.valid('json')
    const result = await setSystemOption(c.get('deps'), {
      userId: c.get('userId')!,
      orgId: c.get('orgId')!,
      key: c.req.param('key'),
      value: body.value,
      public: body.public,
    })
    if (!result.ok) {
      if (result.reason === 'feature_blocked') {
        return c.json(
          { error: 'feature_not_available', feature: result.feature, upgrade_url: '/settings/billing' },
          402,
        )
      }
      return c.json({ error: result.message }, 400)
    }
    return c.json(result.option, result.created ? 201 : 200)
  })
  .delete('/options/:key', requireAdmin, async (c) => {
    const result = await deleteSystemOption(c.get('deps'), {
      userId: c.get('userId')!,
      orgId: c.get('orgId')!,
      key: c.req.param('key'),
    })
    return c.json(result)
  })

export default app
