import { release as osRelease } from 'node:os'
import { Hono } from 'hono'
import type { Env } from '../middleware/platform'
import { INSTANCE_TELEMETRY_CRON, reportInstanceTelemetry } from '../services/instance-telemetry'

const INTERNAL_API_TOKEN_ENV = 'ZPAN_INTERNAL_API_TOKEN'

const internal = new Hono<Env>()

function envAllowsIp(value: string | undefined): boolean {
  return !['0', 'false', 'no', 'off'].includes(value?.trim().toLowerCase() ?? '')
}

internal.post('/instance-telemetry/report', async (c) => {
  const platform = c.get('platform')
  const token = platform.getEnv(INTERNAL_API_TOKEN_ENV)?.trim()
  if (!token) return c.json({ error: 'Not found' }, 404)

  const auth = c.req.header('authorization') ?? ''
  if (auth !== `Bearer ${token}`) return c.json({ error: 'Unauthorized' }, 401)

  const runtime = platform.getBinding('DB')
    ? {
        target: 'cloudflare-worker' as const,
        provider: 'cloudflare' as const,
      }
    : {
        target: 'node/docker' as const,
        provider: 'node' as const,
        osPlatform: process.platform,
        osArch: process.arch,
        osRelease: osRelease(),
        nodeVersion: process.version,
      }

  const result = await reportInstanceTelemetry({
    db: platform.db,
    config: {
      configuredInstanceId: platform.getEnv('ZPAN_INSTANCE_ID'),
      siteUrl: platform.getEnv('ZPAN_PUBLIC_ORIGIN') ?? platform.getEnv('BETTER_AUTH_URL'),
      allowIp: envAllowsIp(platform.getEnv('ZPAN_TELEMETRY_ALLOW_IP')),
    },
    cron: INSTANCE_TELEMETRY_CRON,
    trigger: 'deploy',
    runtime,
  })

  return c.json(result)
})

export default internal
