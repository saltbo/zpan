import path from 'node:path'
import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { resolveAppCommit, resolveAppVersion } from './scripts/app-version.mjs'

const appPort = Number(process.env.E2E_APP_PORT ?? 5185)
const apiPort = Number(process.env.E2E_API_PORT ?? 8222)
const nodeApiProxy = { target: `http://localhost:${apiPort}`, changeOrigin: false }
const appVersion = resolveAppVersion()
const appCommit = resolveAppCommit()
const configuredDevHosts = (process.env.ZPAN_DEV_ALLOWED_HOSTS ?? '')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean)
const e2eWorkerVars =
  process.env.E2E_RUNTIME === 'cf'
    ? {
        BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET!,
        BETTER_AUTH_URL: process.env.BETTER_AUTH_URL!,
        TRUSTED_ORIGINS: process.env.TRUSTED_ORIGINS!,
        ZPAN_CLOUD_URL: process.env.ZPAN_CLOUD_URL!,
        ZPAN_LICENSE_PUBLIC_KEYS: process.env.ZPAN_LICENSE_PUBLIC_KEYS!,
        E2E_STORAGE_ENDPOINT: process.env.E2E_STORAGE_ENDPOINT!,
        E2E_STORAGE_BUCKET: process.env.E2E_STORAGE_BUCKET!,
        E2E_STORAGE_REGION: process.env.E2E_STORAGE_REGION!,
        E2E_STORAGE_ACCESS_KEY: process.env.E2E_STORAGE_ACCESS_KEY!,
        E2E_STORAGE_SECRET_KEY: process.env.E2E_STORAGE_SECRET_KEY!,
      }
    : undefined

export default defineConfig(({ mode }) => ({
  define: {
    'globalThis.__ZPAN_APP_VERSION__': JSON.stringify(appVersion),
    'globalThis.__ZPAN_APP_COMMIT__': JSON.stringify(appCommit),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  environments:
    mode === 'node'
      ? undefined
      : {
          zpan: {
            optimizeDeps: {
              exclude: ['@aws-sdk/client-s3', '@aws-sdk/s3-request-presigner'],
            },
            resolve: {
              conditions: ['browser', 'workerd', 'worker', 'module', 'development|production'],
              mainFields: ['browser', 'module', 'jsnext:main', 'jsnext'],
            },
          },
        },
  plugins: [
    TanStackRouterVite({
      routesDirectory: './src/routes',
      generatedRouteTree: './src/routeTree.gen.ts',
      routeFileIgnorePattern: '.test.ts',
    }),
    react(),
    tailwindcss(),
    ...(mode === 'node'
      ? []
      : [
          cloudflare({
            persistState: process.env.E2E_STATE_DIR ? { path: process.env.E2E_STATE_DIR } : undefined,
            inspectorPort: process.env.E2E_RUNTIME === 'cf' ? false : undefined,
            config: e2eWorkerVars
              ? (config) => ({ vars: { ...config.vars, ...e2eWorkerVars } })
              : undefined,
          }),
        ]),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      '@shared': path.resolve(import.meta.dirname, './shared'),
      '@server': path.resolve(import.meta.dirname, './server'),
    },
  },
  server: {
    port: appPort,
    allowedHosts:
      process.env.E2E_BASE_URL
        ? true
        : mode === 'development'
          ? ['.trycloudflare.com', ...configuredDevHosts]
          : undefined,
    ...(mode === 'node'
      ? {
          proxy: {
            '/api': nodeApiProxy,
            '^/\\.well-known/oauth-authorization-server/': nodeApiProxy,
            '^/\\.well-known/openid-configuration/': nodeApiProxy,
            '^/\\.well-known/oauth-protected-resource/': nodeApiProxy,
            '^/\\.well-known/zpan-domain-verification/': nodeApiProxy,
          },
        }
      : {}),
  },
}))
