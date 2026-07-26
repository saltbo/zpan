import { ObjectStatus } from '@shared/constants'
import { and, asc, desc, eq, getTableColumns, isNull, or } from 'drizzle-orm'
import { member, organization } from '../../db/auth-schema'
import { matters } from '../../db/schema'
import type { Database } from '../../platform/interface'
import {
  type CachePolicy,
  type CacheService,
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

const WEB_DAV_WORKSPACES_CACHE_POLICY: CachePolicy<WebDavWorkspace[]> = {
  namespace: 'webdav-workspaces',
  version: 1,
  ttlMs: 5_000,
  maxEntries: 256,
  distributed: false,
  validate(value): value is WebDavWorkspace[] {
    return (
      Array.isArray(value) &&
      value.every(
        (workspace) =>
          typeof workspace === 'object' &&
          workspace !== null &&
          typeof workspace.id === 'string' &&
          typeof workspace.name === 'string' &&
          typeof workspace.slug === 'string' &&
          typeof workspace.pathSegment === 'string',
      )
    )
  },
}

const WEB_DAV_CHILDREN_CACHE_POLICY: CachePolicy<Matter[]> = {
  namespace: 'webdav-children',
  version: 1,
  ttlMs: 5_000,
  maxEntries: 512,
  distributed: false,
  validate(value): value is Matter[] {
    return (
      Array.isArray(value) &&
      value.every(
        (matter) =>
          typeof matter === 'object' &&
          matter !== null &&
          typeof matter.id === 'string' &&
          typeof matter.orgId === 'string' &&
          typeof matter.parent === 'string' &&
          typeof matter.name === 'string',
      )
    )
  },
}

export function createWebDavPathRepo(db: Database, cache?: CacheService): WebDavPathRepo {
  const childrenCacheKey = (orgId: string, parent: string) => JSON.stringify([orgId, parent])

  async function cachedChildren(orgId: string, parent: string): Promise<Matter[] | undefined> {
    return (await cache?.get(WEB_DAV_CHILDREN_CACHE_POLICY, childrenCacheKey(orgId, parent)))?.value
  }

  async function replaceCachedChildren(orgId: string, parent: string, children: Matter[]): Promise<void> {
    await cache?.replace(WEB_DAV_CHILDREN_CACHE_POLICY, childrenCacheKey(orgId, parent), children)
  }

  async function listUserWorkspaces(userId: string): Promise<WebDavWorkspace[]> {
    if (!cache) return toWebDavWorkspaces(await userWorkspaceRows(db, userId))
    return (
      await cache.getOrLoad(WEB_DAV_WORKSPACES_CACHE_POLICY, userId, async () =>
        toWebDavWorkspaces(await userWorkspaceRows(db, userId)),
      )
    ).value
  }

  async function resolveWebDavPath(userId: string, rawPath: string): Promise<WebDavTarget> {
    const parts = decodeDavPath(rawPath)
    if (parts.length === 0) return { workspace: null, mountRoot: true, parent: '', name: '', matter: null }

    const matterParts = parts.slice(1)
    const name = matterParts.at(-1) ?? ''
    const parent = matterParts.slice(0, -1).join('/')
    if (cache) {
      const cachedWorkspaces = await cache.get(WEB_DAV_WORKSPACES_CACHE_POLICY, userId)
      if (cachedWorkspaces) {
        const workspace = findWorkspace(cachedWorkspaces.value, parts[0])
        if (!workspace) throw new WebDavPathError('Workspace not found', 404)
        if (parts.length === 1) return { workspace, mountRoot: false, parent: '', name: '', matter: null }
        const children = await cachedChildren(workspace.id, parent)
        if (children) {
          const matter = children.find((candidate) => candidate.name === name) ?? null
          return { workspace, mountRoot: false, parent, name, matter }
        }
        const matter = await workspaceMatterRow(db, workspace.id, parent, name)
        return { workspace, mountRoot: false, parent, name, matter }
      }

      const rows =
        parts.length === 1
          ? (await userWorkspaceRows(db, userId)).map((workspace) => ({ workspace, matter: null }))
          : await userWorkspaceMatterRows(db, userId, parent, name)
      const workspaces = toWebDavWorkspaces(rows.map((row) => row.workspace))
      await cache.replace(WEB_DAV_WORKSPACES_CACHE_POLICY, userId, workspaces)
      const workspace = findWorkspace(workspaces, parts[0])
      if (!workspace) throw new WebDavPathError('Workspace not found', 404)
      if (parts.length === 1) return { workspace, mountRoot: false, parent: '', name: '', matter: null }
      const matter = rows.find((row) => row.workspace.id === workspace.id)?.matter ?? null
      return { workspace, mountRoot: false, parent, name, matter }
    }

    const rows =
      parts.length === 1
        ? (await userWorkspaceRows(db, userId)).map((workspace) => ({ workspace, matter: null }))
        : await userWorkspaceMatterRows(db, userId, parent, name)
    const workspaces = toWebDavWorkspaces(rows.map((row) => row.workspace))
    const workspace = findWorkspace(workspaces, parts[0])
    if (!workspace) throw new WebDavPathError('Workspace not found', 404)
    if (parts.length === 1) return { workspace, mountRoot: false, parent: '', name: '', matter: null }

    const matter = rows.find((row) => row.workspace.id === workspace.id)?.matter ?? null
    return { workspace, mountRoot: false, parent, name, matter }
  }

  async function loadChildren(orgId: string, parent: string): Promise<Matter[]> {
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
  }

  async function listChildren(orgId: string, parent: string): Promise<Matter[]> {
    const children = await cachedChildren(orgId, parent)
    if (children) return children
    const loaded = await loadChildren(orgId, parent)
    await replaceCachedChildren(orgId, parent, loaded)
    return loaded
  }

  return {
    async listUserWorkspaces(userId) {
      return listUserWorkspaces(userId)
    },

    async listChildren(orgId, parent) {
      return listChildren(orgId, parent)
    },

    resolveWebDavPath,

    async resolveWithChildren(userId, rawPath) {
      const parts = decodeDavPath(rawPath)
      if (parts.length === 0) {
        return {
          target: { workspace: null, mountRoot: true, parent: '', name: '', matter: null },
          children: [],
        }
      }

      const cachedWorkspaces = cache ? await cache.get(WEB_DAV_WORKSPACES_CACHE_POLICY, userId) : undefined
      if (!cachedWorkspaces) {
        const target = await resolveWebDavPath(userId, rawPath)
        if (!target.workspace) return { target, children: [] }
        const childParent = target.matter ? buildMatterPath(target.parent, target.name) : ''
        return { target, children: await listChildren(target.workspace.id, childParent) }
      }

      const workspace = findWorkspace(cachedWorkspaces.value, parts[0])
      if (!workspace) throw new WebDavPathError('Workspace not found', 404)
      const matterParts = parts.slice(1)
      const name = matterParts.at(-1) ?? ''
      const parent = matterParts.slice(0, -1).join('/')
      const childParent = matterParts.join('/')
      const [cachedSiblings, cachedDirectChildren] = await Promise.all([
        matterParts.length === 0 ? Promise.resolve(undefined) : cachedChildren(workspace.id, parent),
        cachedChildren(workspace.id, childParent),
      ])
      const cachedMatter =
        matterParts.length === 0 ? null : (cachedSiblings?.find((candidate) => candidate.name === name) ?? null)
      if ((matterParts.length === 0 || cachedSiblings) && cachedDirectChildren) {
        return {
          target: { workspace, mountRoot: false, parent, name, matter: cachedMatter },
          children: cachedDirectChildren,
        }
      }
      if (matterParts.length === 0 || cachedSiblings) {
        const children = await listChildren(workspace.id, childParent)
        return {
          target: { workspace, mountRoot: false, parent, name, matter: cachedMatter },
          children,
        }
      }
      const rows = await db
        .select()
        .from(matters)
        .where(
          and(
            eq(matters.orgId, workspace.id),
            eq(matters.status, ObjectStatus.ACTIVE),
            isNull(matters.trashedAt),
            isNull(matters.purgedAt),
            matterParts.length === 0
              ? eq(matters.parent, '')
              : or(and(eq(matters.parent, parent), eq(matters.name, name)), eq(matters.parent, childParent)),
          ),
        )
        .orderBy(desc(matters.dirtype), asc(matters.name))

      const matter =
        matterParts.length === 0 ? null : (rows.find((row) => row.parent === parent && row.name === name) ?? null)
      const children = rows.filter((row) => row.parent === childParent && row.id !== matter?.id)
      await replaceCachedChildren(workspace.id, childParent, children)
      return {
        target: { workspace, mountRoot: false, parent, name, matter },
        children,
      }
    },

    async resolveExistingWebDavPath(userId, rawPath) {
      const target = await resolveWebDavPath(userId, rawPath)
      if (!target.matter) throw new WebDavPathError('Not found', 404)
      return target
    },

    async invalidatePaths(userId, rawPaths) {
      if (!cache || rawPaths.length === 0) return
      const cachedWorkspaces = await cache.get(WEB_DAV_WORKSPACES_CACHE_POLICY, userId)
      if (!cachedWorkspaces) return
      const keys = new Set<string>()
      for (const rawPath of rawPaths) {
        const parts = decodeDavPath(rawPath)
        if (parts.length === 0) continue
        const workspace = findWorkspace(cachedWorkspaces.value, parts[0])
        if (!workspace) continue
        const matterParts = parts.slice(1)
        keys.add(childrenCacheKey(workspace.id, matterParts.slice(0, -1).join('/')))
        keys.add(childrenCacheKey(workspace.id, matterParts.join('/')))
      }
      await Promise.all([...keys].map((key) => cache.invalidate(WEB_DAV_CHILDREN_CACHE_POLICY, key)))
    },
  }
}

function buildMatterPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name
}

function findWorkspace(workspaces: WebDavWorkspace[], segment: string): WebDavWorkspace | null {
  return (
    workspaces.find(
      (candidate) => candidate.slug === segment || candidate.id === segment || candidate.pathSegment === segment,
    ) ?? null
  )
}

async function workspaceMatterRow(db: Database, orgId: string, parent: string, name: string): Promise<Matter | null> {
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
        isNull(matters.purgedAt),
      ),
    )
    .limit(1)
  return rows[0] ?? null
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
