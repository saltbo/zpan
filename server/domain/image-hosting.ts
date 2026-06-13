const PATH_PATTERN = /^[a-zA-Z0-9._/-]+$/
const MAX_DEPTH = 5
const MAX_PATH_LENGTH = 256

export type PathValidationError = { error: 'invalid path'; detail: string }

export function validatePath(path: string): PathValidationError | null {
  if (!PATH_PATTERN.test(path)) {
    return { error: 'invalid path', detail: 'path contains invalid characters' }
  }
  if (path.startsWith('/')) {
    return { error: 'invalid path', detail: 'path must not start with /' }
  }
  if (path.endsWith('/')) {
    return { error: 'invalid path', detail: 'path must not end with /' }
  }
  if (path.includes('..')) {
    return { error: 'invalid path', detail: 'path must not contain ..' }
  }
  if (path.includes('//')) {
    return { error: 'invalid path', detail: 'path must not contain //' }
  }
  if (path.length > MAX_PATH_LENGTH) {
    return { error: 'invalid path', detail: `path exceeds ${MAX_PATH_LENGTH} characters` }
  }
  const depth = path.split('/').length
  if (depth > MAX_DEPTH) {
    return { error: 'invalid path', detail: `path depth exceeds ${MAX_DEPTH} segments` }
  }
  return null
}

export interface ImageUrlConfig {
  customDomain: string | null
  domainVerifiedAt: Date | null
}

export function buildImageUrl(config: ImageUrlConfig | null, path: string, tokenUrl: string): string {
  if (config?.customDomain && config.domainVerifiedAt) {
    return `https://${config.customDomain}/${path}`
  }
  return tokenUrl
}
