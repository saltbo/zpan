import { createApp } from './app'
import { createAuth } from './auth'
import type { Platform } from './platform/interface'

export async function createBootstrap(platform: Platform) {
  const secret = platform.getEnv('BETTER_AUTH_SECRET')
  if (!secret) {
    throw new Error('BETTER_AUTH_SECRET is required. Set it in the environment before starting the server.')
  }

  const baseURL = platform.getEnv('BETTER_AUTH_URL') || 'http://localhost:5185'
  const trustedOrigins = platform
    .getEnv('TRUSTED_ORIGINS')
    ?.split(',')
    .map((o) => o.trim())
    .filter(Boolean) || ['http://localhost:5185']

  const auth = await createAuth(platform, secret, baseURL, trustedOrigins)
  return createApp(platform, auth)
}
