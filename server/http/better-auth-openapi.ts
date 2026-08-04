type OpenApiObject = Record<string, unknown>
type OpenApiOperation = OpenApiObject

type OpenApiDocument = {
  paths?: Record<string, unknown>
  components?: object
}

type ZPanOpenApiDocument = OpenApiDocument & {
  paths: Record<string, unknown>
}

export type BetterAuthOpenApiMethod = 'delete' | 'get' | 'head' | 'options' | 'patch' | 'post' | 'put' | 'trace'

type OpenApiSecurityRequirement = Record<string, readonly string[]>

export type BetterAuthOpenApiSecurityPolicy =
  | { mode: 'public' }
  | {
      mode: 'requirements'
      requirements: readonly OpenApiSecurityRequirement[]
    }

type BetterAuthOpenApiContractNormalization = {
  responseSchemas?: Readonly<Record<string, Readonly<Record<string, unknown>>>>
}

export type BetterAuthOpenApiOperationRegistration = {
  sourcePath: string
  method: BetterAuthOpenApiMethod
  publicPath: string
  operationId: string
  tags: readonly [string, ...string[]]
  security: BetterAuthOpenApiSecurityPolicy
  contract?: BetterAuthOpenApiContractNormalization
}

export const DOWNLOADER_DEVICE_FLOW_TAG = 'Downloader Device Flow'

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

// This registry is the complete Better Auth boundary of the ZPan product
// contract. Adding an entry is an explicit compatibility and authorization
// decision; unregistered Better Auth operations remain runtime-only.
export const BETTER_AUTH_OPENAPI_OPERATION_REGISTRY = [
  {
    sourcePath: '/device/code',
    method: 'post',
    publicPath: '/api/auth/device/code',
    operationId: 'createDeviceAuthorization',
    tags: [DOWNLOADER_DEVICE_FLOW_TAG],
    security: { mode: 'public' },
  },
  {
    sourcePath: '/device/token',
    method: 'post',
    publicPath: '/api/auth/device/token',
    operationId: 'createDeviceAccessToken',
    tags: [DOWNLOADER_DEVICE_FLOW_TAG],
    security: { mode: 'public' },
    contract: {
      responseSchemas: {
        '200': {
          'application/json': deviceAccessTokenResponseSchema,
        },
      },
    },
  },
] as const satisfies readonly BetterAuthOpenApiOperationRegistration[]

const OPENAPI_METHODS = new Set<BetterAuthOpenApiMethod>([
  'delete',
  'get',
  'head',
  'options',
  'patch',
  'post',
  'put',
  'trace',
])

export function addRegisteredBetterAuthOpenApiOperations(
  doc: ZPanOpenApiDocument,
  authDoc: OpenApiDocument,
  registry: readonly BetterAuthOpenApiOperationRegistration[] = BETTER_AUTH_OPENAPI_OPERATION_REGISTRY,
): void {
  validateRegistry(registry)

  const nextPaths = structuredClone(doc.paths)
  const nextComponents = structuredClone(doc.components ?? {}) as OpenApiObject
  const importedComponentRoots = new Set<string>()

  for (const registration of registry) {
    const sourcePathValue = authDoc.paths?.[registration.sourcePath]
    const sourcePathItem =
      sourcePathValue === undefined
        ? undefined
        : requireObject(sourcePathValue, `Better Auth OpenAPI path ${registration.sourcePath} is not a path item`)
    const sourceOperationValue = sourcePathItem?.[registration.method]
    if (!isObject(sourceOperationValue) || !sourcePathItem) {
      throw new Error(`Better Auth OpenAPI is missing ${formatOperation(registration.method, registration.sourcePath)}`)
    }
    const sourceParameters = readPathParameters(sourcePathItem, registration)

    const operation = structuredClone(sourceOperationValue) as OpenApiOperation
    applyContractNormalization(operation, registration)
    operation.operationId = registration.operationId
    operation.tags = [...registration.tags]
    operation.security = openApiSecurity(registration.security, registration)

    importReachableComponents(
      [operation, ...(sourceParameters === undefined ? [] : [sourceParameters])],
      authDoc,
      nextComponents,
      importedComponentRoots,
      registration,
    )

    const existingPathItem = nextPaths[registration.publicPath]
    const targetPathItem =
      existingPathItem === undefined
        ? {}
        : requireObject(existingPathItem, `OpenAPI target path ${registration.publicPath} is not a path item`)

    if (Object.hasOwn(targetPathItem, registration.method)) {
      throw new Error(`OpenAPI target already defines ${formatOperation(registration.method, registration.publicPath)}`)
    }
    mergePathParameters(targetPathItem, sourceParameters, registration)
    targetPathItem[registration.method] = operation
    nextPaths[registration.publicPath] = targetPathItem
  }

  assertUniqueOperationIds(nextPaths)
  assertImportedReferencesResolve(nextPaths, nextComponents, registry, importedComponentRoots)

  doc.paths = nextPaths
  doc.components = nextComponents
}

function validateRegistry(registry: readonly BetterAuthOpenApiOperationRegistration[]): void {
  const sources = new Set<string>()
  const targets = new Set<string>()
  const operationIds = new Set<string>()

  for (const registration of registry) {
    const source = `${registration.method} ${registration.sourcePath}`
    if (sources.has(source)) {
      throw new Error(
        `Duplicate Better Auth OpenAPI source registration: ${formatOperation(registration.method, registration.sourcePath)}`,
      )
    }
    sources.add(source)

    const target = `${registration.method} ${registration.publicPath}`
    if (targets.has(target)) {
      throw new Error(
        `Duplicate Better Auth OpenAPI target registration: ${formatOperation(registration.method, registration.publicPath)}`,
      )
    }
    targets.add(target)

    if (operationIds.has(registration.operationId)) {
      throw new Error(`Duplicate Better Auth OpenAPI operationId registration: ${registration.operationId}`)
    }
    operationIds.add(registration.operationId)

    if (registration.tags.length === 0) {
      throw new Error(`Better Auth OpenAPI registration ${registration.operationId} must declare at least one tag`)
    }
    if (registration.security.mode === 'requirements' && registration.security.requirements.length === 0) {
      throw new Error(
        `Better Auth OpenAPI registration ${registration.operationId} must use mode public for an empty security requirement`,
      )
    }
  }
}

function readPathParameters(
  sourcePathItem: OpenApiObject,
  registration: BetterAuthOpenApiOperationRegistration,
): unknown[] | undefined {
  if (!Object.hasOwn(sourcePathItem, 'parameters')) return undefined
  if (!Array.isArray(sourcePathItem.parameters)) {
    throw new Error(
      `Better Auth OpenAPI path parameters for ${formatOperation(registration.method, registration.sourcePath)} must be an array`,
    )
  }
  return structuredClone(sourcePathItem.parameters)
}

function mergePathParameters(
  targetPathItem: OpenApiObject,
  sourceParameters: unknown[] | undefined,
  registration: BetterAuthOpenApiOperationRegistration,
): void {
  const hasTargetParameters = Object.hasOwn(targetPathItem, 'parameters')
  if (!hasTargetParameters && sourceParameters === undefined) return
  if (!hasTargetParameters && sourceParameters !== undefined) {
    targetPathItem.parameters = sourceParameters
    return
  }
  if (sourceParameters === undefined || !jsonEqual(targetPathItem.parameters, sourceParameters)) {
    throw new Error(`OpenAPI path parameters conflict at ${registration.publicPath}`)
  }
}

function applyContractNormalization(
  operation: OpenApiOperation,
  registration: BetterAuthOpenApiOperationRegistration,
): void {
  for (const [status, mediaTypes] of Object.entries(registration.contract?.responseSchemas ?? {})) {
    for (const [mediaType, schema] of Object.entries(mediaTypes)) {
      const response = requireObject(
        requireObject(operation.responses, missingResponseSchemaError(registration, status, mediaType))[status],
        missingResponseSchemaError(registration, status, mediaType),
      )
      const content = requireObject(response.content, missingResponseSchemaError(registration, status, mediaType))
      const representation = requireObject(
        content[mediaType],
        missingResponseSchemaError(registration, status, mediaType),
      )
      representation.schema = structuredClone(schema)
    }
  }
}

function missingResponseSchemaError(
  registration: BetterAuthOpenApiOperationRegistration,
  status: string,
  mediaType: string,
): string {
  return `Better Auth OpenAPI cannot apply the ${status} ${mediaType} response schema override for ${formatOperation(registration.method, registration.sourcePath)}`
}

function openApiSecurity(
  policy: BetterAuthOpenApiSecurityPolicy,
  registration: BetterAuthOpenApiOperationRegistration,
): OpenApiSecurityRequirement[] {
  if (policy.mode === 'public') return []
  if (policy.requirements.length === 0) {
    throw new Error(
      `Better Auth OpenAPI registration ${registration.operationId} must use mode public for an empty security requirement`,
    )
  }
  return structuredClone(policy.requirements) as OpenApiSecurityRequirement[]
}

function importReachableComponents(
  values: readonly unknown[],
  authDoc: OpenApiDocument,
  targetComponents: OpenApiObject,
  importedComponentRoots: Set<string>,
  registration: BetterAuthOpenApiOperationRegistration,
): void {
  for (const value of values) {
    for (const reference of collectReferences(value)) {
      const segments = parseComponentReference(reference, registration)
      if (resolvePointer(authDoc, segments) === undefined) {
        throw new Error(
          `Better Auth OpenAPI has a dangling reference ${reference} in ${formatOperation(registration.method, registration.sourcePath)}`,
        )
      }

      const [componentType, componentName] = [segments[1], segments[2]]
      const rootKey = JSON.stringify([componentType, componentName])
      if (importedComponentRoots.has(rootKey)) continue

      const sourceRoot = resolvePointer(authDoc, ['components', componentType, componentName])
      if (sourceRoot === undefined) {
        throw new Error(
          `Better Auth OpenAPI has a dangling component reference ${reference} in ${formatOperation(registration.method, registration.sourcePath)}`,
        )
      }

      const targetSection = targetComponents[componentType]
      const section =
        targetSection === undefined
          ? {}
          : requireObject(targetSection, `OpenAPI component section components.${componentType} is not an object`)
      if (Object.hasOwn(section, componentName)) {
        if (!jsonEqual(section[componentName], sourceRoot)) {
          throw new Error(`OpenAPI component collision at #/components/${componentType}/${componentName}`)
        }
      } else {
        section[componentName] = structuredClone(sourceRoot)
      }
      targetComponents[componentType] = section
      importedComponentRoots.add(rootKey)

      importReachableComponents([sourceRoot], authDoc, targetComponents, importedComponentRoots, registration)
    }
  }
}

function parseComponentReference(reference: string, registration: BetterAuthOpenApiOperationRegistration): string[] {
  if (!reference.startsWith('#/')) {
    throw new Error(
      `Better Auth OpenAPI external reference ${reference} is not allowed in ${formatOperation(registration.method, registration.sourcePath)}`,
    )
  }
  const segments = parseJsonPointer(reference)
  if (segments.length < 3 || segments[0] !== 'components') {
    throw new Error(
      `Better Auth OpenAPI local reference ${reference} must target a component in ${formatOperation(registration.method, registration.sourcePath)}`,
    )
  }
  return segments
}

function assertImportedReferencesResolve(
  paths: Record<string, unknown>,
  components: OpenApiObject,
  registry: readonly BetterAuthOpenApiOperationRegistration[],
  importedComponentRoots: ReadonlySet<string>,
): void {
  const document = { paths, components }
  const values: unknown[] = []

  for (const registration of registry) {
    const pathItem = requireObject(
      paths[registration.publicPath],
      `OpenAPI target path ${registration.publicPath} is missing`,
    )
    values.push(pathItem[registration.method])
    if (Object.hasOwn(pathItem, 'parameters')) values.push(pathItem.parameters)
  }
  for (const rootKey of importedComponentRoots) {
    const [componentType, componentName] = JSON.parse(rootKey) as [string, string]
    values.push(resolvePointer(document, ['components', componentType, componentName]))
  }

  for (const value of values) {
    for (const reference of collectReferences(value)) {
      if (!reference.startsWith('#/')) {
        throw new Error(`OpenAPI imported operation contains unsupported external reference ${reference}`)
      }
      if (resolvePointer(document, parseJsonPointer(reference)) === undefined) {
        throw new Error(`OpenAPI imported operation contains dangling reference ${reference}`)
      }
    }
  }
}

function assertUniqueOperationIds(paths: Record<string, unknown>): void {
  const operationIds = new Map<string, string>()
  for (const [path, value] of Object.entries(paths)) {
    if (!isObject(value)) continue
    for (const [method, operation] of Object.entries(value)) {
      if (!OPENAPI_METHODS.has(method as BetterAuthOpenApiMethod) || !isObject(operation)) continue
      if (typeof operation.operationId !== 'string') continue
      const existing = operationIds.get(operation.operationId)
      const current = formatOperation(method as BetterAuthOpenApiMethod, path)
      if (existing) {
        throw new Error(`OpenAPI operationId ${operation.operationId} conflicts between ${existing} and ${current}`)
      }
      operationIds.set(operation.operationId, current)
    }
  }
}

function collectReferences(value: unknown, seen = new WeakSet<object>()): string[] {
  if (!value || typeof value !== 'object') return []
  if (seen.has(value)) return []
  seen.add(value)
  if (Array.isArray(value)) return value.flatMap((item) => collectReferences(item, seen))

  const object = value as OpenApiObject
  return [
    ...(typeof object.$ref === 'string' ? [object.$ref] : []),
    ...Object.values(object).flatMap((item) => collectReferences(item, seen)),
  ]
}

function parseJsonPointer(reference: string): string[] {
  try {
    return reference
      .slice(2)
      .split('/')
      .map((segment) => decodeURIComponent(segment).replaceAll('~1', '/').replaceAll('~0', '~'))
  } catch {
    throw new Error(`Invalid OpenAPI JSON reference: ${reference}`)
  }
}

function resolvePointer(value: unknown, segments: readonly string[]): unknown {
  return segments.reduce<unknown>((current, segment) => {
    if (!isObject(current) && !Array.isArray(current)) return undefined
    return (current as Record<string, unknown>)[segment]
  }, value)
}

function requireObject(value: unknown, error: string): OpenApiObject {
  if (!isObject(value)) throw new Error(error)
  return value
}

function isObject(value: unknown): value is OpenApiObject {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((v, i) => jsonEqual(v, right[i]))
    )
  }
  if (!isObject(left) || !isObject(right)) return false
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => Object.hasOwn(right, key) && jsonEqual(left[key], right[key]))
  )
}

function formatOperation(method: BetterAuthOpenApiMethod, path: string): string {
  return `${method.toUpperCase()} ${path}`
}
