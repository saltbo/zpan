import { zValidator } from '@hono/zod-validator'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import {
  CAPTCHA_ENABLED_KEY,
  CAPTCHA_MIN_SCORE_KEY,
  CAPTCHA_PRIVATE_KEYS,
  CAPTCHA_PROVIDER_KEY,
  CAPTCHA_PUBLIC_KEYS,
} from '../../shared/captcha'
import { SignupMode } from '../../shared/constants'
import { systemOptions } from '../db/schema'
import { hasFeature, loadBindingState } from '../licensing/has-feature'
import { buildCloudInstanceInfo, runtimeInfo } from '../licensing/instance-info'
import { requireAdmin } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { recordActivity } from '../services/activity'
import { loadCaptchaOptionValues, readCaptchaConfig } from '../services/captcha'
import { getSitePublicOrigin, originFromRequestUrl } from '../services/site-public-origin'

const setOptionSchema = z.object({
  value: z.string(),
  public: z.boolean().optional(),
})

const app = new Hono<Env>()
  .get('/instance', requireAdmin, async (c) => {
    const platform = c.get('platform')
    const db = platform.db
    const origin = (await getSitePublicOrigin(db)) ?? originFromRequestUrl(c.req.url) ?? new URL(c.req.url).origin
    const info = await buildCloudInstanceInfo(db, { url: origin, runtime: runtimeInfo(platform) })
    return c.json(info)
  })
  .get('/options', async (c) => {
    const db = c.get('platform').db
    const isAdmin = c.get('userRole') === 'admin'
    const rows = isAdmin
      ? await db.select().from(systemOptions)
      : await db.select().from(systemOptions).where(eq(systemOptions.public, true))
    const items = rows.map((r) => ({ key: r.key, value: r.value, public: !!r.public }))
    return c.json({ items, total: items.length })
  })
  .get('/options/:key', async (c) => {
    const db = c.get('platform').db
    const key = c.req.param('key')
    const rows = await db.select().from(systemOptions).where(eq(systemOptions.key, key))
    const row = rows[0]
    if (!row) return c.json({ error: 'Option not found' }, 404)
    if (!row.public && c.get('userRole') !== 'admin') {
      return c.json({ error: 'Forbidden' }, 403)
    }
    return c.json({ key: row.key, value: row.value, public: !!row.public })
  })
  .put('/options/:key', requireAdmin, zValidator('json', setOptionSchema), async (c) => {
    const db = c.get('platform').db
    const userId = c.get('userId')!
    const orgId = c.get('orgId')!
    const key = c.req.param('key')
    const body = c.req.valid('json')
    let value = body.value
    let isPublic = body.public

    if (key === 'auth_signup_mode' && body.value === SignupMode.OPEN) {
      const state = await loadBindingState(db)
      if (!hasFeature('open_registration', state)) {
        return c.json(
          { error: 'feature_not_available', feature: 'open_registration', upgrade_url: '/settings/billing' },
          402,
        )
      }
    }

    if ((CAPTCHA_PUBLIC_KEYS as readonly string[]).includes(key)) {
      isPublic = true
    }

    if ((CAPTCHA_PRIVATE_KEYS as readonly string[]).includes(key)) {
      isPublic = false
    }

    if (key === CAPTCHA_PROVIDER_KEY || key === CAPTCHA_MIN_SCORE_KEY || key.startsWith('captcha_')) {
      const captchaValues = await loadCaptchaOptionValues(db)
      captchaValues[key] = value
      try {
        readCaptchaConfig(captchaValues)
      } catch (err) {
        if (captchaValues[CAPTCHA_ENABLED_KEY] === 'true') {
          return c.json({ error: err instanceof Error ? err.message : 'Captcha configuration is invalid' }, 400)
        }
      }
    }

    if (key === 'default_org_quota') {
      const quota = Number(body.value)
      if (!Number.isInteger(quota) || quota <= 0) {
        return c.json({ error: 'Default organization quota must be a positive number' }, 400)
      }
    }

    if (key === 'default_org_monthly_traffic_quota') {
      value = body.value.trim()
      const quota = Number(value)
      if (value === '' || !Number.isInteger(quota) || quota < 0) {
        return c.json({ error: 'Default organization monthly traffic quota must be a non-negative number' }, 400)
      }
    }

    const existing = await db
      .select({ key: systemOptions.key, public: systemOptions.public })
      .from(systemOptions)
      .where(eq(systemOptions.key, key))
    if (existing.length > 0) {
      const nextPublic = isPublic ?? existing[0].public
      await db.update(systemOptions).set({ value, public: nextPublic }).where(eq(systemOptions.key, key))
      await recordActivity(db, {
        orgId,
        userId,
        action: 'system_option_set',
        targetType: 'system',
        targetName: key,
        metadata: { key, public: !!nextPublic },
      })
      return c.json({ key, value, public: !!nextPublic })
    }
    const nextPublic = isPublic ?? false
    await db.insert(systemOptions).values({ key, value, public: nextPublic })
    await recordActivity(db, {
      orgId,
      userId,
      action: 'system_option_set',
      targetType: 'system',
      targetName: key,
      metadata: { key, public: nextPublic },
    })
    return c.json({ key, value, public: !!nextPublic }, 201)
  })
  .delete('/options/:key', requireAdmin, async (c) => {
    const db = c.get('platform').db
    const userId = c.get('userId')!
    const orgId = c.get('orgId')!
    const key = c.req.param('key')
    await db.delete(systemOptions).where(eq(systemOptions.key, key))
    await recordActivity(db, {
      orgId,
      userId,
      action: 'system_option_delete',
      targetType: 'system',
      targetName: key,
      metadata: { key },
    })
    return c.json({ key, deleted: true })
  })

export default app
