import { ObjectStatus } from '@shared/constants'
import { and, asc, desc, eq, getTableColumns, isNull } from 'drizzle-orm'
import { member, organization } from '../../db/auth-schema'
import { matters } from '../../db/schema'
import type { Database } from '../../platform/interface'
import {
  type Matter,
  WebDavPathError,
  type WebDavPathRepo,
  type WebDavTarget,
  type WebDavWorkspace,
} from '../../usecases/ports'

type WorkspaceRow = Pick<WebDavWorkspace, 'id' | 'name' | 'slug'>
type WorkspaceMatterRow = {
  workspace: WorkspaceRow
  matter: Matter | null
}

export function createWebDavPathRepo(db: Database): WebDavPathRepo {
  async function resolveWebDavPath(userId: string, rawPath: string): Promise<WebDavTarget> {
    const parts = decodeDavPath(rawPath)
    if (parts.length === 0) return { workspace: null, mountRoot: true, parent: '', name: '', matter: null }

    const matterParts = parts.slice(1)
    const name = matterParts.at(-1) ?? ''
    const parent = matterParts.slice(0, -1).join('/')
    const rows =
      parts.length === 1
        ? (await userWorkspaceRows(db, userId)).map((workspace) => ({ workspace, matter: null }))
        : await userWorkspaceMatterRows(db, userId, parent, name)
    const workspaces = toWebDavWorkspaces(rows.map((row) => row.workspace))
    const workspace =
      workspaces.find(
        (candidate) => candidate.slug === parts[0] || candidate.id === parts[0] || candidate.pathSegment === parts[0],
      ) ?? null
    if (!workspace) throw new WebDavPathError('Workspace not found', 404)
    if (parts.length === 1) return { workspace, mountRoot: false, parent: '', name: '', matter: null }

    const matter = rows.find((row) => row.workspace.id === workspace.id)?.matter ?? null
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
            isNull(matters.purgedAt),
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

async function userWorkspaceMatterRows(
  db: Database,
  userId: string,
  parent: string,
  name: string,
): Promise<WorkspaceMatterRow[]> {
  return db
    .select({
      workspace: { id: organization.id, name: organization.name, slug: organization.slug },
      matter: getTableColumns(matters),
    })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .leftJoin(
      matters,
      and(
        eq(matters.orgId, organization.id),
        eq(matters.parent, parent),
        eq(matters.name, name),
        eq(matters.status, ObjectStatus.ACTIVE),
        isNull(matters.trashedAt),
        isNull(matters.purgedAt),
      ),
    )
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
    return { ...row, pathSegment: segment }
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
