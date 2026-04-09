import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/i18n/**/*.ts', 'src/lib/api.ts', 'src/lib/file-manager-adapter.ts'],
      exclude: ['src/**/*.test.ts', 'src/i18n/index.ts'],
      thresholds: {
        lines: 90,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
