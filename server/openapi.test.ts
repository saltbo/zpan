import { describe, expect, it } from 'vitest'
import { createTestApp } from './test/setup'

describe('global OpenAPI document', () => {
  it('aggregates every OpenAPIHono route at /api/openapi.json', async () => {
    const { app } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    const res = await app.request('/api/openapi.json')

    expect(res.status).toBe(200)
    const doc = (await res.json()) as {
      openapi: string
      paths: Record<string, { get?: { tags?: string[] } }>
      tags?: { name: string }[]
    }
    expect(doc.openapi).toBe('3.1.0')
    // Operations are tagged so Scalar groups them (not all under "default").
    expect(doc.paths['/api/objects']?.get?.tags).toContain('Objects')
    expect(doc.paths['/api/events']?.get?.tags).toContain('Events')
    expect((doc.tags ?? []).map((t) => t.name)).toEqual(
      expect.arrayContaining(['Objects', 'Events', 'Download Tasks', 'Downloaders']),
    )
    // Every resource already converted to `.openapi()` shows up automatically.
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        '/api/downloads/tasks',
        '/api/downloads/tasks/{id}',
        '/api/downloads/tasks/{id}/status',
        '/api/downloads/tasks/{id}/attempts',
        '/api/downloads/downloaders',
        '/api/downloads/downloaders/{id}',
        '/api/events',
        '/api/objects',
        '/api/objects/{id}',
        '/api/objects/{id}/uploads/{uploadSessionId}/parts',
        '/api/objects/{id}/uploads/{uploadSessionId}/completions',
        '/api/objects/{id}/uploads/{uploadSessionId}',
        '/api/trash/objects',
        '/api/trash/objects/{id}',
        '/api/trash/objects/{id}/restorations',
      ]),
    )
  })

  it('serves the Scalar reference UI at /api/docs pointing at the spec', async () => {
    const { app } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    const res = await app.request('/api/docs')

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    const html = await res.text()
    expect(html).toContain('/api/openapi.json')
  })

  it('documents the workspace-scoped API-key event-stream authorization contract', async () => {
    const { app } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    const res = await app.request('/api/openapi.json')
    const doc = (await res.json()) as {
      paths: Record<string, { get?: { description?: string; responses?: Record<string, { description?: string }> } }>
    }
    const events = doc.paths['/api/events']?.get

    expect(events?.responses?.['403']?.description).toBe('Forbidden')
    expect(events?.description).toContain('Workspace-scoped API keys')
    expect(events?.description).toContain('remoteDownload:read')
    expect(events?.description).toContain('?downloadTasks=1')
  })

  it('documents the concrete public profile contract without the removed objects placeholder', async () => {
    const { app } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    const res = await app.request('/api/openapi.json')
    const doc = (await res.json()) as {
      paths: Record<
        string,
        {
          get?: {
            responses?: Record<string, { content?: { 'application/json'?: { schema?: { $ref?: string } } } }>
          }
        }
      >
      components?: {
        schemas?: Record<
          string,
          {
            properties?: Record<
              string,
              {
                type?: string
                properties?: Record<string, { type?: string; nullable?: boolean }>
                items?: {
                  type?: string
                  properties?: Record<string, { type?: string; nullable?: boolean }>
                  required?: string[]
                }
              }
            >
            required?: string[]
          }
        >
      }
    }

    expect(doc.paths['/api/users/{username}']?.get?.responses?.['200']?.content?.['application/json']?.schema).toEqual({
      $ref: '#/components/schemas/PublicProfile',
    })
    expect(doc.paths['/api/users/{username}/objects']).toBeUndefined()

    const profile = doc.components?.schemas?.PublicProfile
    expect(profile?.required).toEqual(['user', 'shares'])
    expect(profile?.properties?.user).toMatchObject({
      type: 'object',
      properties: {
        username: { type: 'string' },
        name: { type: 'string' },
        image: { type: 'string', nullable: true },
      },
    })
    expect(profile?.properties?.shares).toMatchObject({
      type: 'array',
      items: {
        type: 'object',
        properties: {
          token: { type: 'string' },
          name: { type: 'string' },
          type: { type: 'string' },
          size: { type: 'integer', nullable: true },
          isFolder: { type: 'boolean' },
        },
        required: ['token', 'name', 'type', 'size', 'isFolder'],
      },
    })
  })

  it("merges better-auth's auto-generated schema (incl. the device flow) into the same doc", async () => {
    const { app } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    const res = await app.request('/api/openapi.json')
    const doc = (await res.json()) as { paths: Record<string, unknown> }
    // better-auth's device-authorization endpoints come from its openAPI plugin,
    // not hand-written stubs — prefixed under /api/auth.
    const authPaths = Object.keys(doc.paths).filter((p) => p.startsWith('/api/auth/'))
    expect(authPaths.length).toBeGreaterThan(0)
    expect(authPaths.some((p) => p.includes('/device/'))).toBe(true)
  })
})
