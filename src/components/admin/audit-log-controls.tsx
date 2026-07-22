import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { AdminAuditFilter } from '@/lib/api'

export const AUDIT_DEFAULT_PAGE_SIZE = 20
export const AUDIT_PAGE_SIZE_OPTIONS = [20, 50, 100]
export const AUDIT_FILTER_ALL = 'all'

export const AUDIT_EVENT_ACTIONS = [
  'create',
  'delete',
  'object_update',
  'object_copy',
  'object_transfer',
  'restore',
  'object_purge',
  'upload_confirm',
  'upload_cancel',
  'upload_failed',
  'object_download',
  'image_hosting_download',
  'webdav_download',
  'download_failed',
  'share_create',
  'share_revoke',
  'share_download',
  'save_from_share',
  'team_create',
  'team_invite_link_create',
  'team_member_join',
  'team_member_remove',
  'team_member_role_update',
  'team_settings_update',
  'team_delete',
  'team_logo_update',
  'team_logo_delete',
  'storage_create',
  'storage_update',
  'storage_delete',
  'quota_entitlement_grant',
  'quota_entitlement_update',
  'quota_entitlement_revoke',
  'quota_order_increase',
  'quota_order_decrease',
  'invite_code_generate',
  'invite_code_delete',
  'site_invitation_create',
  'site_invitation_revoke',
  'user_disable',
  'user_enable',
  'user_register',
  'user_delete',
  'site_identity_update',
  'site_registration_update',
  'site_captcha_update',
  'site_quotas_update',
  'site_webdav_verify',
  'license_pair',
  'license_refresh',
  'license_disconnect',
  'branding_update',
  'branding_reset',
  'download_task_created',
  'download_task_pause_requested',
  'download_task_resume_requested',
  'download_task_cancel_requested',
  'download_task_retry_requested',
  'download_task_restart_requested',
  'download_task_deleted',
]

export type AuditTimeRange = 'all' | '24h' | '7d' | '30d' | '90d'

const TIME_RANGE_MS: Record<Exclude<AuditTimeRange, 'all'>, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
}

const TIME_RANGE_KEYS: Record<AuditTimeRange, string> = {
  all: 'admin.audit.allTime',
  '24h': 'admin.audit.last24Hours',
  '7d': 'admin.audit.last7Days',
  '30d': 'admin.audit.last30Days',
  '90d': 'admin.audit.last90Days',
}

export function auditActionToFilter(action: string): string | undefined {
  return action === AUDIT_FILTER_ALL ? undefined : action
}

export function auditTimeRangeToFilter(
  timeRange: AuditTimeRange,
  now = new Date(),
): Pick<AdminAuditFilter, 'createdFrom' | 'createdTo'> {
  if (timeRange === 'all') return {}
  return {
    createdFrom: new Date(now.getTime() - TIME_RANGE_MS[timeRange]).toISOString(),
    createdTo: now.toISOString(),
  }
}

interface AuditLogFiltersProps {
  action: string
  timeRange: AuditTimeRange
  disabled?: boolean
  onActionChange: (value: string) => void
  onTimeRangeChange: (value: AuditTimeRange) => void
}

export function AuditLogFilters({
  action,
  timeRange,
  disabled = false,
  onActionChange,
  onTimeRangeChange,
}: AuditLogFiltersProps) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="grid gap-1.5 text-sm">
        <span className="text-xs font-medium text-muted-foreground">{t('admin.audit.eventType')}</span>
        <Select value={action} onValueChange={onActionChange} disabled={disabled}>
          <SelectTrigger className="h-8 w-full sm:w-56" aria-label={t('admin.audit.eventType')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={AUDIT_FILTER_ALL}>{t('admin.audit.allEvents')}</SelectItem>
            {AUDIT_EVENT_ACTIONS.map((item) => (
              <SelectItem key={item} value={item}>
                {t(`activity.action.${item}`, { defaultValue: item })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-1.5 text-sm">
        <span className="text-xs font-medium text-muted-foreground">{t('admin.audit.timeRange')}</span>
        <Select
          value={timeRange}
          onValueChange={(value) => onTimeRangeChange(value as AuditTimeRange)}
          disabled={disabled}
        >
          <SelectTrigger className="h-8 w-full sm:w-44" aria-label={t('admin.audit.timeRange')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(TIME_RANGE_KEYS) as AuditTimeRange[]).map((item) => (
              <SelectItem key={item} value={item}>
                {t(TIME_RANGE_KEYS[item])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

interface AuditPaginationProps {
  page: number
  pageSize: number
  total: number
  disabled?: boolean
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
}

export function AuditPagination({
  page,
  pageSize,
  total,
  disabled = false,
  onPageChange,
  onPageSizeChange,
}: AuditPaginationProps) {
  const { t } = useTranslation()
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>{t('admin.users.pageSize')}</span>
        <Select value={String(pageSize)} onValueChange={(value) => onPageSizeChange(Number(value))} disabled={disabled}>
          <SelectTrigger className="h-8 w-32" aria-label={t('admin.users.pageSize')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AUDIT_PAGE_SIZE_OPTIONS.map((option) => (
              <SelectItem key={option} value={String(option)}>
                {t('admin.users.pageSizeOption', { count: option })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" disabled={disabled || page <= 1} onClick={() => onPageChange(page - 1)}>
          {t('admin.users.prevPage')}
        </Button>
        <span className="text-sm text-muted-foreground">{t('admin.users.pageInfo', { page, total: totalPages })}</span>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          {t('admin.users.nextPage')}
        </Button>
      </div>
    </div>
  )
}
