import { timingSafeEqual } from 'node:crypto'
import { Hono } from 'hono'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../shared/constants'
import type { BindingState } from '../../shared/types'
import { loadBindingState } from '../licensing/has-feature'
import type { Env } from '../middleware/platform'
import { runLicensingRefresh } from '../services/licensing-refresh-runner'

function secretsMatch(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false
  const enc = new TextEncoder()
  return timingSafeEqual(enc.encode(provided), enc.encode(expected))
}

const app = new Hono<Env>()
  .get('/status', async (c) => {
    const db = c.get('platform').db
    const state = await loadBindingState(db)
    return c.json(state satisfies BindingState)
  })

  // POST /api/licensing/refresh-cron?secret=<REFRESH_CRON_SECRET>
  // External schedulers (Vercel Cron, Netlify Scheduled Functions, etc.) call
  // this endpoint every 6 hours instead of running a native cron trigger.
  // Set REFRESH_CRON_SECRET to a random string (e.g. openssl rand -hex 32)
  // and pass it as the `secret` query parameter.
  .post('/refresh-cron', async (c) => {
    const expectedSecret = c.get('platform').getEnv('REFRESH_CRON_SECRET')
    const provided = c.req.query('secret') ?? ''
    if (!expectedSecret || !secretsMatch(provided, expectedSecret)) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const db = c.get('platform').db
    const cloudBaseUrl = c.get('platform').getEnv('ZPAN_CLOUD_URL') ?? ZPAN_CLOUD_URL_DEFAULT
    await runLicensingRefresh(db, cloudBaseUrl)

    return c.json({ ok: true })
  })

export default app
