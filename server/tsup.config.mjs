import { defineConfig } from 'tsup'
import { resolveAppCommit, resolveAppVersion } from '../scripts/app-version.mjs'

const appVersion = resolveAppVersion()
const appCommit = resolveAppCommit()

export default defineConfig({
  define: {
    'globalThis.__ZPAN_APP_VERSION__': JSON.stringify(appVersion),
    'globalThis.__ZPAN_APP_COMMIT__': JSON.stringify(appCommit),
  },
})
