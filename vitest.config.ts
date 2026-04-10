import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: ['server/**/*.test.ts', 'shared/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['server/**/*.ts', 'shared/**/*.ts', 'src/lib/**/*.ts', 'src/i18n/**/*.ts'],
      exclude: [
        'server/entry-*.ts',
        'server/**/*.test.ts',
        'server/**/*.cf-test.ts',
        'server/test/**',
        'server/platform/**',
        'server/db/**',
        'shared/**/*.test.ts',
        'src/**/*.test.ts',
        'src/i18n/index.ts',
      ],
      thresholds: {
        statements: 90,
        branches: 80,
        functions: 90,
        lines: 90,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, './shared'),
      '@server': path.resolve(__dirname, './server'),
    },
  },
})
