import { ObjectStatus } from '@shared/constants'
import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import { member, organization } from '../../db/auth-schema'
import { matters } from '../../db/schema'
import { encodeDavPathSegment } from '../../domain/webdav'
import type { Database } from '../../platform/interface'
import {
  type Matter,
  WebDavPathError,
  type WebDavPathRepo,
  type WebDavTarget,
  type WebDavWorkspace,
} from '../../usecases/ports'

type WorkspaceRow = Pick<WebDavWorkspace, 'id' | 'name' | 'slug'>

export function createWebDavPathRepo(db: Database): WebDavPathRepo {
  async function getUserWorkspace(userId: string, pathSegment: string): Promise<WebDavWorkspace | null> {
    const workspaces = toWebDavWorkspaces(await userWorkspaceRows(db, userId))
    return (
      workspaces.find(
        (workspace) =>
          workspace.slug === pathSegment ||
          workspace.id === pathSegment ||
          workspace.href === `/dav/${encodeDavPathSegment(pathSegment)}/`,
      ) ?? null
    )
  }

  async function resolveWebDavPath(userId: string, rawPath: string): Promise<WebDavTarget> {
    const parts = decodeDavPath(rawPath)
    if (parts.length === 0) return { workspace: null, mountRoot: true, parent: '', name: '', matter: null }

    const workspace = await getUserWorkspace(userId, parts[0])
    if (!workspace) throw new WebDavPathError('Workspace not found', 404)
    if (parts.length === 1) return { workspace, mountRoot: false, parent: '', name: '', matter: null }

    const matterParts = parts.slice(1)
    const name = matterParts.at(-1) ?? ''
    const parent = matterParts.slice(0, -1).join('/')
    const matter = await findMatterByPath(db, workspace.id, parent, name)
    return { workspace, mountRoot: false, parent, name, matter }
  }

  return {
    async listUserWorkspaces(userId) {
      return toWebDavWorkspaces(await userWorkspaceRows(db, userId))
    },

    async listChildren(orgId, parent) {
      return db
        .select()
        .from(matters)
        .where(
          and(
            eq(matters.orgId, orgId),
            eq(matters.parent, parent),
            eq(matters.status, ObjectStatus.ACTIVE),
            isNull(matters.trashedAt),
          ),
        )
        .orderBy(desc(matters.dirtype), asc(matters.name))
    },

    resolveWebDavPath,

    async resolveExistingWebDavPath(userId, rawPath) {
      const target = await resolveWebDavPath(userId, rawPath)
      if (!target.matter) throw new WebDavPathError('Not found', 404)
      return target
    },
  }
}

async function userWorkspaceRows(db: Database, userId: string): Promise<WorkspaceRow[]> {
  return db
    .select({ id: organization.id, name: organization.name, slug: organization.slug })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId))
    .orderBy(asc(organization.name), asc(organization.slug))
}

function toWebDavWorkspaces(rows: WorkspaceRow[]): WebDavWorkspace[] {
  const preferredSegments = new Map<string, number>()
  for (const row of rows) {
    const segment = preferredWorkspaceSegment(row)
    preferredSegments.set(segment, (preferredSegments.get(segment) ?? 0) + 1)
  }

  return rows.map((row) => {
    const preferredSegment = preferredWorkspaceSegment(row)
    const conflictsWithOtherWorkspace = rows.some(
      (other) => other.id !== row.id && (other.slug === preferredSegment || other.id === preferredSegment),
    )
    const segment =
      preferredSegments.get(preferredSegment) === 1 && !conflictsWithOtherWorkspace ? preferredSegment : row.slug
    return { ...row, href: `/dav/${encodeDavPathSegment(segment)}/` }
  })
}

function preferredWorkspaceSegment(row: WorkspaceRow): string {
  const name = row.name.trim()
  if (isSafeDavPathSegment(name)) return name
  return row.slug
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

function isSafeDavPathSegment(segment: string): boolean {
  return Boolean(segment) && segment !== '.' && segment !== '..' && !segment.includes('/') && !segment.includes('\\')
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
        isNull(matters.trashedAt),
      ),
    )
    .limit(1)
  return rows[0] ?? null
}
