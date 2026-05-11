import { and, asc, desc, eq } from 'drizzle-orm'
import { DirType, ObjectStatus } from '../../shared/constants'
import { organization } from '../db/auth-schema'
import { matters } from '../db/schema'
import type { Database } from '../platform/interface'
import type { Matter } from './matter'

export interface WebDavWorkspace {
  id: string
  name: string
  slug: string
  href: string
}

export interface WebDavTarget {
  workspace: WebDavWorkspace
  mountRoot: boolean
  parent: string
  name: string
  matter: Matter | null
}

export class WebDavPathError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}

export function joinMatterPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name
}

export function matterHref(workspace: WebDavWorkspace, matter: Matter): string {
  const path = joinMatterPath(matter.parent, matter.name)
  return `/dav/${encodeURIComponent(workspace.slug)}/${path.split('/').map(encodeURIComponent).join('/')}`
}

export function workspaceHref(workspace: WebDavWorkspace): string {
  return `/dav/${encodeURIComponent(workspace.slug)}/`
}

export async function getWorkspace(db: Database, orgId: string): Promise<WebDavWorkspace | null> {
  const rows = await db
    .select({ id: organization.id, name: organization.name, slug: organization.slug })
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1)
  const row = rows[0]
  return row ? { ...row, href: `/dav/${encodeURIComponent(row.slug)}/` } : null
}

export async function listChildren(db: Database, orgId: string, parent: string): Promise<Matter[]> {
  return db
    .select()
    .from(matters)
    .where(and(eq(matters.orgId, orgId), eq(matters.parent, parent), eq(matters.status, ObjectStatus.ACTIVE)))
    .orderBy(desc(matters.dirtype), asc(matters.name))
}

export async function resolveWebDavPath(db: Database, orgId: string, rawPath: string): Promise<WebDavTarget> {
  const workspace = await getWorkspace(db, orgId)
  if (!workspace) throw new WebDavPathError('Workspace not found', 404)

  const parts = decodeDavPath(rawPath)
  if (parts.length === 0) return { workspace, mountRoot: true, parent: '', name: '', matter: null }
  if (parts[0] !== workspace.slug) throw new WebDavPathError('Workspace not found', 404)
  if (parts.length === 1) return { workspace, mountRoot: false, parent: '', name: '', matter: null }

  const matterParts = parts.slice(1)
  const name = matterParts.at(-1) ?? ''
  const parent = matterParts.slice(0, -1).join('/')
  const matter = await findMatterByPath(db, orgId, parent, name)
  return { workspace, mountRoot: false, parent, name, matter }
}

export async function resolveExistingWebDavPath(db: Database, orgId: string, rawPath: string): Promise<WebDavTarget> {
  const target = await resolveWebDavPath(db, orgId, rawPath)
  if (!target.matter) throw new WebDavPathError('Not found', 404)
  return target
}

function decodeDavPath(rawPath: string): string[] {
  if (!rawPath.startsWith('/')) throw new WebDavPathError('Invalid DAV path', 400)
  if (rawPath.includes('//')) throw new WebDavPathError('Ambiguous DAV path', 400)

  const withoutMount = rawPath.replace(/^\/dav(?:\/|$)/, '/')
  const trimmed = withoutMount.replace(/^\/+|\/+$/g, '')
  if (!trimmed) return []

  return trimmed.split('/').map(decodeSegment)
}

function decodeSegment(segment: string): string {
  if (!segment) throw new WebDavPathError('Ambiguous DAV path', 400)
  if (/%2f|%5c/i.test(segment)) throw new WebDavPathError('Encoded path separators are not allowed', 400)
  if (/%25(?:2e|2f|5c)/i.test(segment)) throw new WebDavPathError('Double-encoded path tricks are not allowed', 400)

  let decoded: string
  try {
    decoded = decodeURIComponent(segment)
  } catch {
    throw new WebDavPathError('Invalid path encoding', 400)
  }

  if (!decoded || decoded === '.' || decoded === '..') throw new WebDavPathError('Invalid DAV path segment', 400)
  if (decoded.includes('/') || decoded.includes('\\')) throw new WebDavPathError('Invalid DAV path segment', 400)
  return decoded
}

async function findMatterByPath(db: Database, orgId: string, parent: string, name: string): Promise<Matter | null> {
  const rows = await db
    .select()
    .from(matters)
    .where(
      and(
        eq(matters.orgId, orgId),
        eq(matters.parent, parent),
        eq(matters.name, name),
        eq(matters.status, ObjectStatus.ACTIVE),
      ),
    )
    .limit(1)
  return rows[0] ?? null
}

export function ensureFolder(target: WebDavTarget): Matter {
  if (!target.matter) throw new WebDavPathError('Parent collection not found', 409)
  if (target.matter.dirtype === DirType.FILE) throw new WebDavPathError('Not a collection', 405)
  return target.matter
}
