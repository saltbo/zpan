import { createApp } from './app'
import { createAuth } from './auth'
import { createNodePlatform } from './platform/node'

const platform = createNodePlatform()
const secret = process.env.BETTER_AUTH_SECRET
if (!secret) {
  throw new Error('BETTER_AUTH_SECRET is required. Set it in the environment before starting the server.')
}
const baseURL = process.env.BETTER_AUTH_URL || 'http://localhost:5173'
const trustedOrigins = process.env.TRUSTED_ORIGINS?.split(',')
  .map((o) => o.trim())
  .filter(Boolean) || ['http://localhost:5173']
const auth = createAuth(platform.db, secret, baseURL, trustedOrigins)

export default createApp(platform, auth)
