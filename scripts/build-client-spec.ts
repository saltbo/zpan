import { createTestApp } from '../server/test/setup'

// The downloader Go client only talks to these resources. Selecting their paths
// from the (fully auto-generated) merged /api/openapi.json keeps the generated
// client lean and keeps codegen robust — feeding it all 80+ better-auth
// endpoints would bloat the client and risk oapi-codegen choking. This is a
// scope allowlist, not a hand-maintained spec: the path/schema *content* is
// still generated; we only choose which generated paths to emit a client for.
const KEEP_PREFIXES = ['/api/auth/device/', '/api/downloads/', '/api/objects']

type Doc = {
  paths: Record<string, unknown>
  components?: { schemas?: Record<string, unknown> }
  [k: string]: unknown
}

// oapi-codegen v2 only supports OpenAPI 3.0.x, but the served document (and
// better-auth's generated schema) are 3.1 — which expresses nullability as
// `type: ["string", "null"]`. Rewrite those unions to the 3.0 form
// `type: "string", nullable: true` in place so the generator accepts the spec.
// Only the codegen spec is downconverted; the served /api/openapi.json stays 3.1.
function downconvertTo30(node: unknown): void {
  if (Array.isArray(node)) {
    for (const v of node) downconvertTo30(v)
    return
  }
  if (!node || typeof node !== 'object') return
  const obj = node as Record<string, unknown>
  if (Array.isArray(obj.type) && obj.type.includes('null')) {
    const nonNull = (obj.type as string[]).filter((t) => t !== 'null')
    obj.type = nonNull.length === 1 ? nonNull[0] : nonNull
    obj.nullable = true
  }
  for (const v of Object.values(obj)) downconvertTo30(v)
}

// The downloader client attaches its bearer token manually via a RequestEditorFn,
// so it needs no security metadata. Strip it: better-auth's bearerAuth scheme
// otherwise makes oapi-codegen (client-only) emit a `BearerAuthScopes` const whose
// context-key type is only generated in server mode → undefined symbol.
function stripSecurity(spec: Doc): void {
  delete (spec as Record<string, unknown>).security
  if (spec.components) delete (spec.components as Record<string, unknown>).securitySchemes
  for (const item of Object.values(spec.paths)) {
    if (!item || typeof item !== 'object') continue
    for (const op of Object.values(item as Record<string, unknown>)) {
      if (op && typeof op === 'object') delete (op as Record<string, unknown>).security
    }
  }
}

// Collect every `#/components/schemas/X` reachable from `node`, transitively.
function collectRefs(node: unknown, schemas: Record<string, unknown>, used: Set<string>): void {
  if (Array.isArray(node)) {
    for (const v of node) collectRefs(v, schemas, used)
    return
  }
  if (!node || typeof node !== 'object') return
  for (const [k, v] of Object.entries(node)) {
    if (k === '$ref' && typeof v === 'string') {
      const name = v.match(/^#\/components\/schemas\/(.+)$/)?.[1]
      if (name && !used.has(name)) {
        used.add(name)
        collectRefs(schemas[name], schemas, used)
      }
    } else {
      collectRefs(v, schemas, used)
    }
  }
}

// Builds the downloader client OpenAPI spec by reading the real merged document
// from a throwaway in-memory app, then scoping it to the downloader's paths.
export async function buildClientSpec(): Promise<Doc> {
  const { app } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'codegen' })
  const res = await app.request('/api/openapi.json')
  if (res.status !== 200) throw new Error(`/api/openapi.json returned ${res.status}`)
  const doc = (await res.json()) as Doc

  const paths = Object.fromEntries(
    Object.entries(doc.paths).filter(([p]) => KEEP_PREFIXES.some((prefix) => p.startsWith(prefix))),
  )

  const allSchemas = doc.components?.schemas ?? {}
  const used = new Set<string>()
  collectRefs(paths, allSchemas, used)
  const schemas = Object.fromEntries(Object.entries(allSchemas).filter(([name]) => used.has(name)))

  const spec = { ...doc, openapi: '3.0.3', paths, components: { ...doc.components, schemas } }
  stripSecurity(spec)
  downconvertTo30(spec)
  return spec
}
