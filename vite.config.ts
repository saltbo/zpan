import path from 'node:path'
import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react-swc'
import { defineConfig } from 'vite'
import { resolveAppVersion } from './scripts/app-version.mjs'

const appPort = Number(process.env.E2E_APP_PORT ?? 5185)
const apiPort = Number(process.env.E2E_API_PORT ?? 8222)
const appVersion = resolveAppVersion()

export default defineConfig(({ mode }) => ({
  define: {
    'globalThis.__ZPAN_APP_VERSION__': JSON.stringify(appVersion),
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
    ...(mode === 'node' ? [] : [cloudflare()]),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, './shared'),
      '@server': path.resolve(__dirname, './server'),
    },
  },
  server: {
    port: appPort,
    allowedHosts: process.env.E2E_BASE_URL ? true : undefined,
    ...(mode === 'node'
      ? {
          proxy: {
            '/api': {
              target: `http://localhost:${apiPort}`,
              changeOrigin: true,
            },
          },
        }
      : {}),
  },
}))
