import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { defineConfig } from 'drizzle-kit'

const tursoUrl = process.env.TURSO_DATABASE_URL

const nodeDbPath = process.env.DATABASE_URL || '.local/node/zpan.db'
if (nodeDbPath !== ':memory:') mkdirSync(dirname(nodeDbPath), { recursive: true })

export default tursoUrl
  ? defineConfig({
      schema: ['./server/db/schema.ts', './server/db/auth-schema.ts'],
      out: './migrations',
      dialect: 'turso',
      dbCredentials: {
        url: tursoUrl,
        authToken: process.env.TURSO_AUTH_TOKEN,
      },
    })
  : defineConfig({
      schema: ['./server/db/schema.ts', './server/db/auth-schema.ts'],
      out: './migrations',
      dialect: 'sqlite',
      dbCredentials: {
        url: nodeDbPath,
      },
    })
