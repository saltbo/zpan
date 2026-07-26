import { createApp } from './app'
import { createAuth } from './auth'
import { createDeps } from './composition'
import type { Platform } from './platform/interface'
import type { Deps } from './usecases/deps'

export async function createBootstrap(platform: Platform, deps: Deps = createDeps(platform)) {
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
  return createApp(platform, auth, deps)
}
