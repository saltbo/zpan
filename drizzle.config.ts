import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: ['./server/db/schema.ts', './server/db/auth-schema.ts'],
  out: './migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'zpan.db',
  },
})
