import path from 'node:path'
import { defineConfig } from 'vitest/config'

const aliases = {
  '@': path.resolve(__dirname, './src'),
  '@shared': path.resolve(__dirname, './shared'),
  '@server': path.resolve(__dirname, './server'),
}

const coverageConfig = {
  provider: 'v8' as const,
  include: [
    'server/**/*.ts',
    'shared/**/*.ts',
    'src/lib/**/*.ts',
    'src/i18n/**/*.ts',
    'src/routes/u/**/*.tsx',
    'src/routes/_authenticated/settings/**/*.tsx',
  ],
  exclude: [
    'server/entry-*.ts',
    'server/**/*.test.ts',
    'server/**/*.integration.test.ts',
    'server/**/*.cf-test.ts',
    'server/test/**',
    'server/platform/**',
    'server/db/**',
    'shared/**/*.test.ts',
    'src/**/*.test.ts',
    'src/i18n/index.ts',
  ],
  reporter: ['text', 'json'] as const,
}

export default defineConfig({
  test: {
    globals: true,
    projects: [
      {
        resolve: { alias: aliases },
        test: {
          name: 'unit',
          include: ['server/**/*.test.ts', 'shared/**/*.test.ts', 'src/**/*.test.ts'],
          exclude: ['**/*.integration.test.ts', '**/*.cf-test.ts'],
          coverage: {
            ...coverageConfig,
            thresholds: {
              statements: 60,
              branches: 50,
              functions: 40,
              lines: 60,
            },
          },
        },
      },
      {
        resolve: { alias: aliases },
        test: {
          name: 'integration',
          include: ['server/**/*.integration.test.ts'],
          coverage: {
            ...coverageConfig,
            thresholds: {
              statements: 90,
              branches: 80,
              functions: 90,
              lines: 90,
            },
          },
        },
      },
    ],
  },
})
