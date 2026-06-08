import { defineConfig } from 'tsup'
import { resolveAppVersion } from '../scripts/app-version.mjs'

const appVersion = resolveAppVersion()

export default defineConfig({
  define: {
    'globalThis.__ZPAN_APP_VERSION__': JSON.stringify(appVersion),
  },
})
