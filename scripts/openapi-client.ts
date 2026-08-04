// Generates the downloader's Go OpenAPI client (cmd/internal/openapi/client.gen.go)
// straight from the live public product contract at /api/openapi.json, including
// its explicit Downloader Device Flow whitelist. Code generation applies no
// further endpoint subset and commits no intermediate spec; the temporary spec
// exists only as oapi-codegen input and is discarded.
//
//   pnpm openapi:client          regenerate the committed Go client
//   pnpm openapi:client --check  fail if the committed client is stale
import { execFile as execFileCallback } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { createTestApp } from '../server/test/setup'

const execFile = promisify(execFileCallback)
const CLIENT_PATH = resolve('cmd/internal/openapi/client.gen.go')

type Doc = { openapi?: string; components?: { securitySchemes?: unknown }; paths: Record<string, unknown> }

// oapi-codegen v2 only supports OpenAPI 3.0.x, but the document is 3.1 — which
// expresses nullability as `type: ["string", "null"]`. Rewrite those unions to
// the 3.0 form `type: "string", nullable: true`. Whole-document transform; no
// endpoints are removed.
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

// The client attaches credentials manually via a RequestEditorFn, so the
// generated transport needs no product-wide security metadata. Stripping it
// also avoids client-only oapi-codegen emitting server-mode scope helpers.
function stripSecurity(doc: Doc): void {
  delete (doc as Record<string, unknown>).security
  if (doc.components) delete (doc.components as Record<string, unknown>).securitySchemes
  for (const item of Object.values(doc.paths)) {
    if (!item || typeof item !== 'object') continue
    for (const op of Object.values(item as Record<string, unknown>)) {
      if (op && typeof op === 'object') delete (op as Record<string, unknown>).security
    }
  }
}

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'])

// Declare any `{param}` segment that an operation is missing because
// oapi-codegen rejects undeclared path parameters. Whole-document, mechanical.
function declareMissingPathParams(doc: Doc): void {
  for (const [path, item] of Object.entries(doc.paths)) {
    const names = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1])
    if (names.length === 0 || !item || typeof item !== 'object') continue
    for (const [method, op] of Object.entries(item as Record<string, unknown>)) {
      if (!HTTP_METHODS.has(method) || !op || typeof op !== 'object') continue
      const operation = op as { parameters?: { name?: string; in?: string }[] }
      const params = (operation.parameters ??= [])
      const declared = new Set(params.filter((p) => p.in === 'path').map((p) => p.name))
      for (const name of names) {
        if (!declared.has(name)) params.push({ name, in: 'path', required: true, schema: { type: 'string' } } as never)
      }
    }
  }
}

async function buildCodegenSpec(): Promise<Doc> {
  const { app } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'codegen' })
  const res = await app.request('/api/openapi.json')
  if (res.status !== 200) throw new Error(`/api/openapi.json returned ${res.status}`)
  const doc = (await res.json()) as Doc
  doc.openapi = '3.0.3'
  stripSecurity(doc)
  declareMissingPathParams(doc)
  downconvertTo30(doc)
  return doc
}

async function generateClient(outputPath: string): Promise<void> {
  const tempDir = await mkdtemp(join(tmpdir(), 'zpan-openapi-'))
  try {
    const specPath = join(tempDir, 'openapi.json')
    const configPath = join(tempDir, 'oapi-codegen.yaml')
    await writeFile(specPath, `${JSON.stringify(await buildCodegenSpec(), null, 2)}\n`, 'utf8')
    await writeFile(
      configPath,
      ['package: openapi', 'generate:', '  models: true', '  client: true', `output: ${JSON.stringify(outputPath)}`, ''].join(
        '\n',
      ),
      'utf8',
    )
    await execFile('go', [
      'run',
      'github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@v2.7.0',
      '-config',
      configPath,
      specPath,
    ])
  } finally {
    await rm(tempDir, { force: true, recursive: true })
  }
}

if (process.argv.includes('--check')) {
  const tempDir = await mkdtemp(join(tmpdir(), 'zpan-openapi-check-'))
  try {
    const candidate = join(tempDir, 'client.gen.go')
    await generateClient(candidate)
    const [committed, regenerated] = await Promise.all([readFile(CLIENT_PATH, 'utf8'), readFile(candidate, 'utf8')])
    if (committed !== regenerated) {
      console.error('Go OpenAPI client is stale. Run: pnpm openapi:client')
      process.exit(1)
    }
    console.log('OpenAPI client is up to date.')
  } finally {
    await rm(tempDir, { force: true, recursive: true })
  }
} else {
  await generateClient(CLIENT_PATH)
  console.log(`Generated ${CLIENT_PATH}`)
}
process.exit(0)
