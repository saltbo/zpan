export const LEGACY_DOWNLOADER_CLIENT_ID = 'zpan-cli'
export const LEGACY_DOWNLOADER_REGISTER_SCOPE = 'downloader:register'
export const LEGACY_DOWNLOADER_BOOTSTRAP_SESSION_ORG = '__zpan_legacy_downloader_bootstrap__'

export function isLegacyDownloaderBootstrapSession(session: { activeOrganizationId?: string } | undefined): boolean {
  return session?.activeOrganizationId === LEGACY_DOWNLOADER_BOOTSTRAP_SESSION_ORG
}

export function isDownloaderBootstrapRegistrationRequest(method: string, path: string): boolean {
  const normalizedPath = path.endsWith('/') ? path.slice(0, -1) : path
  return method.toUpperCase() === 'POST' && normalizedPath === '/api/downloads/downloaders'
}
