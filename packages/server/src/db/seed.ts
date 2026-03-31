import { systemOptions } from './schema'
import type { Database } from '../platform/interface'

const defaultSystemOptions = [
  { key: 'site.name', value: 'ZPan', public: true },
  { key: 'site.description', value: 'S3-native file hosting', public: true },
]

export async function seedSystemOptions(db: Database) {
  await db
    .insert(systemOptions)
    .values(defaultSystemOptions)
    .onConflictDoNothing({ target: systemOptions.key })
}
