import { defineConfig } from 'drizzle-kit'

const tursoUrl = process.env.TURSO_DATABASE_URL

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
        url: process.env.DATABASE_URL || 'zpan.db',
      },
    })
