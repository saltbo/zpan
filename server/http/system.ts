import { zValidator } from '@hono/zod-validator'
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
import { compareSemver } from '../../shared/semver'
import { readCaptchaConfig } from '../domain/captcha'
import { hasFeature } from '../domain/licensing'
import { originFromRequestUrl } from '../domain/site-public-origin'
import { buildInstanceInfo, runtimeInfo } from '../licensing/instance-info'
import { requireAdmin } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { loadCaptchaOptionValues } from '../usecases/captcha'
import { loadBindingState } from '../usecases/licensing'
import { getSitePublicOrigin } from '../usecases/site-public-origin'
import { getAppVersion } from '../version'

const setOptionSchema = z.object({
  value: z.string(),
  public: z.boolean().optional(),
})

const app = new Hono<Env>()
  .get('/instance', requireAdmin, async (c) => {
    const platform = c.get('platform')
    const db = platform.db
    const origin =
      (await getSitePublicOrigin(c.get('deps'))) ?? originFromRequestUrl(c.req.url) ?? new URL(c.req.url).origin
    const info = await buildInstanceInfo(db, { url: origin, runtime: runtimeInfo(platform) })
    return c.json(info)
  })
  .get('/changelog', requireAdmin, zValidator('query', z.object({ refresh: z.string().optional() })), async (c) => {
    const force = c.req.valid('query').refresh === 'true'
    const { latestVersion, markdown } = await c.get('deps').changelog.fetchChangelog(Date.now(), { force })
    const currentVersion = getAppVersion()
    const updateAvailable = latestVersion ? compareSemver(latestVersion, currentVersion) > 0 : false
    return c.json({ currentVersion, latestVersion, updateAvailable, markdown })
  })
  .get('/options', async (c) => {
    const isAdmin = c.get('userRole') === 'admin'
    const items = isAdmin ? await c.get('deps').systemOptions.list() : await c.get('deps').systemOptions.listPublic()
    return c.json({ items, total: items.length })
  })
  .get('/options/:key', async (c) => {
    const key = c.req.param('key')
    const row = await c.get('deps').systemOptions.get(key)
    if (!row) return c.json({ error: 'Option not found' }, 404)
    if (!row.public && c.get('userRole') !== 'admin') {
      return c.json({ error: 'Forbidden' }, 403)
    }
    return c.json({ key: row.key, value: row.value, public: row.public })
  })
  .put('/options/:key', requireAdmin, zValidator('json', setOptionSchema), async (c) => {
    const userId = c.get('userId')!
    const orgId = c.get('orgId')!
    const key = c.req.param('key')
    const body = c.req.valid('json')
    let value = body.value
    let isPublic = body.public

    if (key === 'auth_signup_mode' && body.value === SignupMode.OPEN) {
      const state = await loadBindingState(c.get('deps'))
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
      const captchaValues = await loadCaptchaOptionValues(c.get('deps'))
      captchaValues[key] = value
      try {
        readCaptchaConfig(captchaValues)
      } catch (err) {
        if (captchaValues[CAPTCHA_ENABLED_KEY] === 'true') {
          return c.json({ error: err instanceof Error ? err.message : 'Captcha configuration is invalid' }, 400)
        }
      }
    }

    if (key === 'default_org_quota' || key === 'default_team_quota') {
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

    const existing = await c.get('deps').systemOptions.get(key)
    if (existing) {
      const nextPublic = isPublic ?? existing.public
      await c.get('deps').systemOptions.set(key, value, nextPublic)
      await c.get('deps').activity.record({
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
    await c.get('deps').systemOptions.set(key, value, nextPublic)
    await c.get('deps').activity.record({
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
    const userId = c.get('userId')!
    const orgId = c.get('orgId')!
    const key = c.req.param('key')
    await c.get('deps').systemOptions.delete(key)
    await c.get('deps').activity.record({
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
