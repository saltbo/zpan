export interface EplistEndpoint {
  region: string
  endpoint: string
}

export interface EplistProvider {
  slug: string
  displayName: string
  file: string
}

const EPLIST_RAW_BASE = 'https://raw.githubusercontent.com/eplist/eplist/main'
const providerCache = new Map<string, EplistEndpoint[]>()
let providersCache: EplistProvider[] | null = null

export async function listEplistProviders(): Promise<EplistProvider[]> {
  if (providersCache) return providersCache
  const text = await fetchEplistText('index.yml')
  providersCache = parseEplistProviders(text)
  return providersCache
}

export async function listEplistEndpoints(provider: EplistProvider): Promise<EplistEndpoint[]> {
  const cached = providerCache.get(provider.slug)
  if (cached) return cached
  const text = await fetchEplistText(provider.file)
  const endpoints = parseEplistEndpoints(text)
  providerCache.set(provider.slug, endpoints)
  return endpoints
}

export function findEplistProvider(providers: EplistProvider[], provider: string): EplistProvider | undefined {
  const normalized = provider.trim().toLowerCase()
  if (!normalized) return undefined
  return providers.find(
    (item) => item.slug.toLowerCase() === normalized || item.displayName.toLowerCase() === normalized,
  )
}

export function eplistProviderLabel(providers: EplistProvider[], provider: string): string {
  return findEplistProvider(providers, provider)?.displayName ?? provider
}

export function eplistEndpointUrl(endpoint: string): string {
  return /^https?:\/\//i.test(endpoint) ? endpoint : `https://${endpoint}`
}

async function fetchEplistText(file: string): Promise<string> {
  const res = await fetch(`${EPLIST_RAW_BASE}/${file}`)
  if (!res.ok) throw new Error(`Failed to load eplist ${file}: HTTP ${res.status}`)
  return res.text()
}

function parseEplistProviders(text: string): EplistProvider[] {
  const providers: EplistProvider[] = []
  let current: Partial<EplistProvider> | null = null

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.startsWith('- slug:')) {
      if (current?.slug && current.displayName && current.file) providers.push(current as EplistProvider)
      current = { slug: yamlValue(trimmed.slice('- slug:'.length)) }
      continue
    }
    if (!current) continue
    if (trimmed.startsWith('display-name:')) {
      current.displayName = yamlValue(trimmed.slice('display-name:'.length))
    } else if (trimmed.startsWith('file:')) {
      current.file = yamlValue(trimmed.slice('file:'.length))
    }
  }

  if (current?.slug && current.displayName && current.file) providers.push(current as EplistProvider)
  return providers
}

function parseEplistEndpoints(text: string): EplistEndpoint[] {
  const endpoints: EplistEndpoint[] = []
  let current: Partial<EplistEndpoint> | null = null

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.startsWith('- region:')) {
      if (current?.region && current.endpoint) endpoints.push(current as EplistEndpoint)
      current = { region: yamlValue(trimmed.slice('- region:'.length)) }
      continue
    }
    if (!current) continue
    if (trimmed.startsWith('endpoint:')) {
      current.endpoint = yamlValue(trimmed.slice('endpoint:'.length))
    }
  }

  if (current?.region && current.endpoint) endpoints.push(current as EplistEndpoint)
  return endpoints
}

function yamlValue(value: string): string {
  return value.trim().replace(/^["']|["']$/g, '')
}
