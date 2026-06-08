import packageJson from '../package.json'

declare const __ZPAN_APP_VERSION__: string | undefined

export function getAppVersion(): string {
  const injectedVersion = getInjectedAppVersion()
  if (injectedVersion) return injectedVersion
  return process.env.ZPAN_APP_VERSION?.trim() || packageJson.version
}

function getInjectedAppVersion(): string | null {
  if (typeof __ZPAN_APP_VERSION__ === 'undefined') return null
  return __ZPAN_APP_VERSION__.trim() || null
}
