import { DirType } from '@shared/constants'
import type { Context } from 'hono'
import type { DownloadTaskRecord, Matter, ShareResolution } from '../usecases/ports'
import {
  type AuditRoute,
  type AuditRouteContext,
  type AuditTarget,
  auditRoute,
  defineAuditRoutes,
  firstValue,
  param,
  preparedExists,
  preparedValue,
  responseValue,
  stringValue,
} from './audit-registry'
import { TRANSFER_AUDIT_ROUTES } from './audit-transfers'
import type { Env } from './platform'

const STANDARD_AUDIT_ROUTES: AuditRoute[] = [
  auditRoute('POST', '/api/objects', createObjectAction, responseObjectTarget(), { when: hasResponseObject }),
  auditRoute('PATCH', '/api/objects/:objectId', 'object_update', preparedMatterTarget(), {
    prepare: prepareMatter,
    when: preparedExists,
  }),
  auditRoute('DELETE', '/api/objects/:objectId', 'delete', preparedMatterTarget(), {
    prepare: prepareMatter,
    when: preparedExists,
  }),
  auditRoute('POST', '/api/objects/:objectId/copies', 'object_copy', responseObjectTarget(), {
    prepare: prepareMatter,
    when: preparedExists,
    metadata: {
      sourceId: stringValue(preparedValue('id')),
      sourceName: stringValue(preparedValue('name')),
      targetParent: stringValue(responseValue('parent')),
    },
  }),
  auditRoute('POST', '/api/objects/:objectId/transfers', 'object_transfer', preparedMatterTarget(), {
    prepare: prepareMatter,
    when: preparedExists,
    metadata: objectTransferMetadata,
  }),
  auditRoute('POST', '/api/trash/objects/:objectId/restorations', 'restore', preparedMatterTarget(), {
    prepare: prepareMatter,
    when: preparedExists,
  }),
  auditRoute('DELETE', '/api/trash/objects/:objectId', 'object_purge', preparedMatterTarget(), {
    prepare: prepareMatter,
    when: preparedExists,
  }),
  auditRoute('POST', '/api/shares/:token/objects', 'save_from_share', preparedShareTarget(), {
    prepare: prepareShare,
    when: hasResolvedShare,
    orgId: stringValue(requestField('targetOrgId')),
    metadata: saveFromShareMetadata,
  }),
  auditRoute('POST', '/api/downloads/tasks', 'download_task_created', responseDownloadTaskTarget(), {
    metadata: {
      sourceType: stringValue(responseValue('spec.source.type')),
      targetFolder: stringValue(responseValue('spec.destination.folder')),
    },
  }),
  auditRoute(
    'PUT',
    '/api/downloads/tasks/:taskId/status',
    actionByRequest('status', {
      paused: 'download_task_pause_requested',
      queued: 'download_task_resume_requested',
      canceled: 'download_task_cancel_requested',
    }),
    preparedTaskTarget(),
    {
      prepare: prepareDownloadTask,
      when: preparedExists,
      metadata: { requestedStatus: stringValue(requestField('status')) },
    },
  ),
  auditRoute(
    'POST',
    '/api/downloads/tasks/:taskId/attempts',
    actionByRequest('fresh', { true: 'download_task_restart_requested', false: 'download_task_retry_requested' }),
    preparedTaskTarget(),
    { prepare: prepareDownloadTask, when: preparedExists },
  ),
  auditRoute('DELETE', '/api/downloads/tasks/:taskId', 'download_task_deleted', preparedTaskTarget(), {
    prepare: prepareDownloadTask,
    when: preparedExists,
  }),
  responseResourceRoute('POST', '/api/site/storages', 'storage_create', 'storage', 'bucket'),
  responseResourceRoute('PUT', '/api/site/storages/:storageId', 'storage_update', 'storage', 'bucket', 'storageId'),
  responseResourceRoute(
    'PUT',
    '/api/site/storages/:storageId/egress-billing',
    'storage_update',
    'storage',
    'bucket',
    'storageId',
  ),
  auditRoute(
    'DELETE',
    '/api/site/storages/:storageId',
    'storage_delete',
    {
      type: 'storage',
      id: param('storageId'),
      name: firstValue(stringValue(preparedValue('bucket')), param('storageId')),
    },
    { prepare: prepareStorage },
  ),
  staticResourceRoute('PUT', '/api/site/branding', 'branding_update', 'branding', 'branding'),
  auditRoute(
    'DELETE',
    '/api/site/branding/:field',
    'branding_reset',
    { type: 'branding', id: param('field'), name: param('field') },
    { metadata: { field: param('field') } },
  ),
  auditRoute(
    'POST',
    '/api/site/invite-codes',
    'invite_code_generate',
    { type: 'invite_code', name: inviteCodeTargetName },
    {
      metadata: { count: inviteCodeCount },
    },
  ),
  paramResourceRoute('DELETE', '/api/site/invite-codes/:code', 'invite_code_delete', 'invite_code', 'code'),
  responseResourceRoute('POST', '/api/site/invitations', 'site_invitation_create', 'site_invitation', 'email'),
  paramResourceRoute(
    'DELETE',
    '/api/site/invitations/:invitationId',
    'site_invitation_revoke',
    'site_invitation',
    'invitationId',
  ),
  ...entitlementRoutes('user'),
  ...entitlementRoutes('team'),
  auditRoute('POST', '/api/teams/:teamId/invite-links', 'team_invite_link_create', teamTarget(), {
    orgId: param('teamId'),
    metadata: { role: stringValue(requestField('role')), expiresIn: requestField('expiresIn') },
  }),
  auditRoute('POST', '/api/teams/:teamId/members', 'team_member_join', teamTarget(), { orgId: param('teamId') }),
  auditRoute('PUT', '/api/teams/:teamId/logo', 'team_logo_update', teamTarget(), { orgId: param('teamId') }),
  auditRoute('DELETE', '/api/teams/:teamId/logo', 'team_logo_delete', teamTarget(), { orgId: param('teamId') }),
  ...siteSettingsRoutes(),
  auditRoute('GET', '/api/site/licensing/pairings/:pairingId', licensePairAction, licenseTarget(), {
    metadata: {
      edition: stringValue(responseValue('edition')),
      cloudStoreId: stringValue(responseValue('cloud_store_id')),
    },
  }),
  staticResourceRoute('POST', '/api/site/licensing/refresh-runs', 'license_refresh', 'license', 'license binding'),
  staticResourceRoute('DELETE', '/api/site/licensing/binding', 'license_disconnect', 'license', 'license binding', {
    statuses: [204, 502],
  }),
  auditRoute('DELETE', '/api/objects/:objectId/uploads/:sessionId', 'upload_cancel', preparedMatterTarget(), {
    prepare: prepareMatter,
    when: preparedExists,
    metadata: {
      bytes: ({ resource }: AuditRouteContext) => matterResource(resource)?.size ?? 0,
      source: 'upload',
      status: 'canceled',
      reason: 'upload_canceled',
    },
  }),
  auditRoute('POST', '/api/shares', 'share_create', preparedShareTarget(), {
    resolve: resolveCreatedShare,
    when: hasResolvedShare,
    orgId: shareOrgId,
    metadata: {
      kind: firstValue(stringValue(responseValue('kind')), stringValue(requestField('kind'))),
      hasPassword: async (context: AuditRouteContext) => Boolean(await context.requestValue('password')),
      hasExpiry: async (context: AuditRouteContext) => Boolean(await context.requestValue('expiresAt')),
    },
  }),
  auditRoute('PUT', '/api/shares/:token/status', 'share_revoke', preparedShareTarget(), {
    prepare: prepareShare,
    when: hasResolvedShare,
    orgId: shareOrgId,
  }),
]

export const AUDIT_ROUTES = defineAuditRoutes(STANDARD_AUDIT_ROUTES, TRANSFER_AUDIT_ROUTES)

function responseResourceRoute(
  method: string,
  path: string,
  action: string,
  targetType: string,
  nameField = 'name',
  fallbackIdParam?: string,
): AuditRoute {
  const fallbackId = fallbackIdParam ? param(fallbackIdParam) : undefined
  return auditRoute(method, path, action, {
    type: targetType,
    id: fallbackId ? firstValue(stringValue(responseValue('id')), fallbackId) : stringValue(responseValue('id')),
    name: fallbackId
      ? firstValue(stringValue(responseValue(nameField)), fallbackId)
      : stringValue(responseValue(nameField)),
  })
}

function paramResourceRoute(
  method: string,
  path: string,
  action: string,
  targetType: string,
  idParam: string,
): AuditRoute {
  return auditRoute(method, path, action, { type: targetType, id: param(idParam), name: param(idParam) })
}

function staticResourceRoute(
  method: string,
  path: string,
  action: string,
  targetType: string,
  targetName: string,
  options: Parameters<typeof auditRoute>[4] = {},
): AuditRoute {
  return auditRoute(method, path, action, { type: targetType, name: targetName }, options)
}

function entitlementRoutes(scope: 'user' | 'team'): AuditRoute[] {
  const resource = scope === 'user' ? 'users' : 'teams'
  const idParam = scope === 'user' ? 'userId' : 'teamId'
  const base = `/api/${resource}/:${idParam}/entitlements`
  const orgId = scope === 'team' ? param(idParam) : undefined
  const target = { type: 'quota', id: param(idParam), name: param(idParam) } satisfies AuditTarget
  const metadata = {
    targetUserId: scope === 'user' ? param(idParam) : undefined,
    targetOrgId: scope === 'team' ? param(idParam) : undefined,
    entitlementId: firstValue(stringValue(responseValue('entitlement.id')), param('entitlementId')),
    resourceType: firstValue(
      stringValue(responseValue('entitlement.resourceType')),
      stringValue(requestField('resourceType')),
    ),
    bytes: firstValue(responseField('entitlement.bytes'), requestField('bytes')),
    expiresAt: firstValue(responseField('entitlement.expiresAt'), requestField('expiresAt')),
  }
  return [
    auditRoute('POST', base, 'quota_entitlement_grant', target, { orgId, metadata }),
    auditRoute('PATCH', `${base}/:entitlementId`, 'quota_entitlement_update', target, { orgId, metadata }),
    auditRoute('DELETE', `${base}/:entitlementId`, 'quota_entitlement_revoke', target, {
      orgId,
      metadata: { entitlementId: param('entitlementId') },
    }),
  ]
}

function siteSettingsRoutes(): AuditRoute[] {
  return [
    ['PUT', 'identity', 'site_identity_update'],
    ['PUT', 'registration', 'site_registration_update'],
    ['PUT', 'captcha', 'site_captcha_update'],
    ['PUT', 'quotas', 'site_quotas_update'],
    ['POST', 'webdav/verification', 'site_webdav_verify'],
  ].map(([method, path, action]) =>
    staticResourceRoute(method, `/api/site/settings/${path}`, action, 'site_settings', action),
  )
}

function responseObjectTarget(): AuditTarget {
  return {
    type: async (context) => ((await context.responseValue('dirtype')) === DirType.FILE ? 'file' : 'folder'),
    id: stringValue(responseValue('id')),
    name: firstValue(stringValue(responseValue('name')), stringValue(responseValue('id'))),
  }
}

function preparedMatterTarget(): AuditTarget {
  return {
    type: ({ resource }) => (matterResource(resource)?.dirtype === DirType.FILE ? 'file' : 'folder'),
    id: stringValue(preparedValue('id')),
    name: stringValue(preparedValue('name')),
  }
}

function responseDownloadTaskTarget(): AuditTarget {
  return {
    type: 'download_task',
    id: stringValue(responseValue('id')),
    name: firstValue(
      stringValue(responseValue('spec.destination.name')),
      stringValue(responseValue('spec.source.uri')),
      'download task',
    ),
  }
}

function preparedTaskTarget(): AuditTarget {
  return {
    type: 'download_task',
    id: stringValue(preparedValue('id')),
    name: ({ resource }) => {
      const task = taskResource(resource)
      return task ? task.displayName || task.sourceUri : undefined
    },
  }
}

function preparedShareTarget(): AuditTarget {
  return {
    type: 'share',
    id: ({ resource }) => resolvedShare(resource)?.share.id,
    name: ({ resource }) => resolvedShare(resource)?.matter.name,
  }
}

function teamTarget(): AuditTarget {
  return { type: 'team', id: param('teamId'), name: param('teamId') }
}

function licenseTarget(): AuditTarget {
  return { type: 'license', name: 'license binding' }
}

async function prepareMatter({ c, params }: { c: Context<Env>; params: Record<string, string> }) {
  const orgId = c.get('orgId')
  return orgId ? c.get('deps').matter.get(params.objectId, orgId) : null
}

async function prepareDownloadTask({ c, params }: { c: Context<Env>; params: Record<string, string> }) {
  const orgId = c.get('orgId')
  return orgId ? c.get('deps').downloadTasks.getRecord(orgId, params.taskId) : null
}

async function prepareStorage({ c, params }: { c: Context<Env>; params: Record<string, string> }) {
  return c.get('deps').storages.get(params.storageId)
}

async function prepareShare({ c, params }: { c: Context<Env>; params: Record<string, string> }) {
  return c.get('deps').share.resolveByToken(params.token)
}

async function resolveCreatedShare(context: AuditRouteContext): Promise<ShareResolution | null> {
  const token = await context.responseValue('token')
  return typeof token === 'string' ? context.c.get('deps').share.resolveByToken(token) : null
}

function createObjectAction(context: AuditRouteContext): Promise<string | null> {
  return context.responseValue('upload').then((upload) => (upload ? null : 'create'))
}

async function hasResponseObject(context: AuditRouteContext): Promise<boolean> {
  return typeof (await context.responseValue('id')) === 'string'
}

async function objectTransferMetadata(context: AuditRouteContext): Promise<Record<string, unknown>> {
  const [request, response] = await Promise.all([context.request(), context.response()])
  return {
    mode: stringField(request, 'mode'),
    targetOrgId: stringField(request, 'targetOrgId'),
    targetParent: stringField(request, 'targetParent'),
    savedCount: arrayField(response, 'saved').length,
    skippedCount: arrayField(response, 'skipped').length,
    sourceDeleted: response.sourceDeleted === true,
  }
}

async function saveFromShareMetadata(context: AuditRouteContext): Promise<Record<string, unknown>> {
  const [request, response] = await Promise.all([context.request(), context.response()])
  const resolution = resolvedShare(context.resource)
  const saved = arrayField(response, 'saved')
  return {
    shareId: resolution?.share.id,
    sourceOrgId: resolution?.share.orgId,
    sourceMatterId: resolution?.matter.id,
    targetOrgId: stringField(request, 'targetOrgId'),
    targetParent: stringField(request, 'targetParent'),
    savedCount: saved.length,
    skippedCount: arrayField(response, 'skipped').length,
    bytes: saved.reduce<number>((total, item) => total + (numberField(objectValue(item), 'size') ?? 0), 0),
  }
}

function actionByRequest(field: string, actions: Record<string, string>) {
  return async (context: AuditRouteContext): Promise<string | null> => {
    const value = await context.requestValue(field)
    return actions[String(value)] ?? null
  }
}

async function licensePairAction(context: AuditRouteContext): Promise<string | null> {
  return (await context.responseValue('status')) === 'approved' ? 'license_pair' : null
}

async function inviteCodeCount(context: AuditRouteContext): Promise<number> {
  const codes = await context.responseValue('codes')
  return Array.isArray(codes) ? codes.length : 0
}

async function inviteCodeTargetName(context: AuditRouteContext): Promise<string> {
  return `${await inviteCodeCount(context)} codes`
}

function requestField(path: string) {
  return (context: AuditRouteContext) => context.requestValue(path)
}

function responseField(path: string) {
  return (context: AuditRouteContext) => context.responseValue(path)
}

function shareOrgId({ resource }: AuditRouteContext): string | undefined {
  return resolvedShare(resource)?.share.orgId
}

function hasResolvedShare({ resource }: AuditRouteContext): boolean {
  return resolvedShare(resource) !== null
}

function resolvedShare(value: unknown): Extract<ShareResolution, { status: 'ok' }> | null {
  if (!value || typeof value !== 'object') return null
  const resolution = value as ShareResolution
  return resolution.status === 'ok' ? resolution : null
}

function matterResource(value: unknown): Matter | null {
  return value && typeof value === 'object' ? (value as Matter) : null
}

function taskResource(value: unknown): DownloadTaskRecord | null {
  return value && typeof value === 'object' ? (value as DownloadTaskRecord) : null
}

function stringField(value: Record<string, unknown>, field: string): string | undefined {
  return typeof value[field] === 'string' ? value[field] : undefined
}

function numberField(value: Record<string, unknown>, field: string): number | undefined {
  return typeof value[field] === 'number' ? value[field] : undefined
}

function arrayField(value: Record<string, unknown>, field: string): unknown[] {
  return Array.isArray(value[field]) ? value[field] : []
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}
