declare global {
  var __ZPAN_APP_VERSION__: string | undefined
  var __ZPAN_APP_COMMIT__: string | undefined
}

export function getAppVersion(): string {
  if (!globalThis.__ZPAN_APP_VERSION__) {
    throw new Error('__ZPAN_APP_VERSION__ is not configured')
  }
  return globalThis.__ZPAN_APP_VERSION__
}

// The commit SHA is best-effort: absent in build environments without git or an
// injected SHA. Returns null rather than throwing so the About page degrades.
export function getAppCommit(): string | null {
  return globalThis.__ZPAN_APP_COMMIT__ || null
}
