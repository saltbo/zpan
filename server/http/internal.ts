import { release as osRelease } from 'node:os'
import { Hono } from 'hono'
import { constantTimeEqual } from '../lib/constant-time'
import type { Env } from '../middleware/platform'
import { getDeployPlatform } from '../runtime-platform'
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
  if (!constantTimeEqual(auth, `Bearer ${token}`)) return c.json({ error: 'Unauthorized' }, 401)

  const runtime = platform.getBinding('DB')
    ? {
        runtime: 'workerd' as const,
        platform: 'cloudflare-workers' as const,
      }
    : {
        runtime: 'node' as const,
        platform: getDeployPlatform() ?? 'node',
        osPlatform: process.platform,
        osArch: process.arch,
        osRelease: osRelease(),
        nodeVersion: process.version,
      }

  const result = await reportInstanceTelemetry({
    db: platform.db,
    config: {
      allowIp: envAllowsIp(platform.getEnv('ZPAN_TELEMETRY_ALLOW_IP')),
    },
    cron: INSTANCE_TELEMETRY_CRON,
    trigger: 'deploy',
    runtime,
  })

  return c.json(result)
})

export default internal
