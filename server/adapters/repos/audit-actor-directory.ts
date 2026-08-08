import { inArray } from 'drizzle-orm'
import { apikey, oauthClient, user } from '../../db/auth-schema'
import { downloaders } from '../../db/schema'
import type { Database } from '../../platform/interface'
import type { AuditActorDirectory } from '../../usecases/ports'

export function createAuditActorDirectoryRepo(db: Database): AuditActorDirectory {
  return {
    async findUserProfiles(userIds) {
      const uniqueIds = [...new Set(userIds)]
      if (uniqueIds.length === 0) return new Map()
      const rows = await db
        .select({
          id: user.id,
          name: user.name,
          username: user.username,
          displayUsername: user.displayUsername,
          image: user.image,
        })
        .from(user)
        .where(inArray(user.id, uniqueIds))
      return new Map(
        rows.map(
          (row) =>
            [
              row.id,
              {
                name: row.name || row.displayUsername || row.username || row.id,
                image: row.image,
                resolved: true,
              },
            ] as const,
        ),
      )
    },

    async findApiKeyNames(keyIds) {
      const uniqueIds = [...new Set(keyIds)]
      if (uniqueIds.length === 0) return new Map()
      const rows = await db
        .select({ id: apikey.id, name: apikey.name })
        .from(apikey)
        .where(inArray(apikey.id, uniqueIds))
      return new Map(rows.flatMap((row) => (row.name ? [[row.id, row.name] as const] : [])))
    },

    async findDeviceNames(deviceIds) {
      const uniqueIds = [...new Set(deviceIds)]
      if (uniqueIds.length === 0) return new Map()
      const rows = await db
        .select({ id: downloaders.id, name: downloaders.name })
        .from(downloaders)
        .where(inArray(downloaders.id, uniqueIds))
      return new Map(rows.map((row) => [row.id, row.name] as const))
    },

    async listTrustedAgentIssuerOrigins() {
      const clients = await db
        .select({ disabled: oauthClient.disabled, jwksUri: oauthClient.jwksUri })
        .from(oauthClient)
      const origins = new Set<string>()
      for (const client of clients) {
        if (client.disabled === true || !client.jwksUri) continue
        const url = parseSecureUrl(client.jwksUri)
        if (url) origins.add(url.origin)
      }
      return origins
    },
  }
}

function parseSecureUrl(value: string): URL | null {
  try {
    const url = new URL(value)
    if (url.protocol === 'https:') return url
    if (
      url.protocol === 'http:' &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
    ) {
      return url
    }
    return null
  } catch {
    return null
  }
}
