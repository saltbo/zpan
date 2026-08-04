type OpenApiOperation = Record<string, unknown>

type BetterAuthOpenApiDocument = {
  paths?: Record<string, unknown>
}

type ZPanOpenApiDocument = {
  paths: Record<string, unknown>
}

export const DOWNLOADER_DEVICE_FLOW_TAG = 'Downloader Device Flow'

const DOWNLOADER_DEVICE_FLOW_OPERATIONS = [
  {
    sourcePath: '/device/code',
    method: 'post',
    publicPath: '/api/auth/device/code',
    operationId: 'createDownloaderDeviceAuthorization',
  },
  {
    sourcePath: '/device/token',
    method: 'post',
    publicPath: '/api/auth/device/token',
    operationId: 'createDownloaderDeviceAccessToken',
  },
] as const

const deviceAccessTokenResponseSchema = {
  type: 'object',
  properties: {
    access_token: { type: 'string' },
    token_type: { type: 'string' },
    expires_in: { type: 'integer' },
    scope: { type: 'string' },
  },
  required: ['access_token', 'token_type', 'expires_in'],
}

export function addDownloaderDeviceFlowOpenApi(doc: ZPanOpenApiDocument, authDoc: BetterAuthOpenApiDocument): void {
  for (const rule of DOWNLOADER_DEVICE_FLOW_OPERATIONS) {
    const sourcePathItem = authDoc.paths?.[rule.sourcePath]
    const sourceOperation =
      sourcePathItem && typeof sourcePathItem === 'object' && !Array.isArray(sourcePathItem)
        ? (sourcePathItem as Record<string, unknown>)[rule.method]
        : undefined
    if (!sourceOperation || typeof sourceOperation !== 'object' || Array.isArray(sourceOperation)) {
      throw new Error(`Better Auth OpenAPI is missing ${rule.method.toUpperCase()} ${rule.sourcePath}`)
    }

    const operation = structuredClone(sourceOperation) as OpenApiOperation
    operation.operationId = rule.operationId
    operation.tags = [DOWNLOADER_DEVICE_FLOW_TAG]
    operation.security = []

    if (rule.sourcePath === '/device/token') normalizeDeviceAccessTokenResponse(operation)
    assertSelfContained(rule.sourcePath, operation)

    // Build a new path item so another method added to the Better Auth path is
    // never published without a separate explicit whitelist entry.
    doc.paths[rule.publicPath] = { [rule.method]: operation }
  }
}

function normalizeDeviceAccessTokenResponse(operation: OpenApiOperation): void {
  const jsonResponse = (
    operation as {
      responses?: Record<string, { content?: Record<string, { schema?: unknown }> }>
    }
  ).responses?.['200']?.content?.['application/json']
  if (!jsonResponse) {
    throw new Error('Better Auth OpenAPI is missing the JSON 200 response for POST /device/token')
  }
  jsonResponse.schema = deviceAccessTokenResponseSchema
}

function assertSelfContained(path: string, operation: OpenApiOperation): void {
  const refs = collectReferences(operation)
  if (refs.length > 0) {
    throw new Error(`Better Auth OpenAPI operation POST ${path} is not self-contained: ${refs.join(', ')}`)
  }
}

function collectReferences(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectReferences)
  if (!value || typeof value !== 'object') return []

  const object = value as Record<string, unknown>
  return [
    ...(typeof object.$ref === 'string' ? [object.$ref] : []),
    ...Object.values(object).flatMap(collectReferences),
  ]
}
