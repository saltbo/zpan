import { type AuthorizationScope, AuthorizationScope as Scope } from './authorization'

export interface OAuthScopeMetadata {
  description: {
    en: string
    zh: string
  }
}

export const OAUTH_GRANT_SCOPE_METADATA = {
  [Scope.WORKSPACES_DISCOVER]: scope('Discover accessible workspaces', '发现可访问的工作空间'),
  [Scope.OBJECTS_READ]: scope('List, inspect, and download objects', '列出、查看和下载文件'),
  [Scope.OBJECTS_CREATE]: scope('Create folders and upload objects', '创建文件夹和上传文件'),
  [Scope.OBJECTS_UPDATE]: scope('Rename, move, and copy objects', '重命名、移动和复制文件'),
  [Scope.OBJECTS_DELETE]: scope('Move objects to trash', '将文件移入回收站'),
  [Scope.OBJECTS_PURGE]: scope('Permanently delete trashed objects', '永久删除回收站文件'),
  [Scope.SHARES_READ]: scope('List and inspect shares', '列出和查看分享'),
  [Scope.SHARES_CREATE]: scope('Create public shares', '创建公开分享'),
  [Scope.SHARES_DELETE]: scope('Revoke shares', '撤销分享'),
  [Scope.QUOTA_READ]: scope('Inspect workspace quota', '查看工作空间配额'),
  [Scope.QUOTA_PURCHASE]: scope('Purchase workspace storage capacity', '购买工作空间存储容量'),
  [Scope.STORAGE_USAGE_READ]: scope('Inspect workspace storage usage', '查看工作空间存储用量'),
  [Scope.IMAGES_UPLOAD]: scope('Upload images', '上传图片'),
  [Scope.DOWNLOAD_TASKS_READ]: scope('List and inspect download tasks', '列出和查看下载任务'),
  [Scope.DOWNLOAD_TASKS_CREATE]: scope('Create download tasks', '创建下载任务'),
  [Scope.DOWNLOAD_TASKS_CANCEL]: scope('Cancel download tasks', '取消下载任务'),
  [Scope.SITE_ANALYTICS_READ]: scope('Read site analytics', '查看站点分析数据'),
  [Scope.OAUTH_GRANTS_READ]: scope('List and inspect OAuth grants', '列出和查看 OAuth 授权'),
  [Scope.OAUTH_GRANTS_CREATE]: scope('Create OAuth grants', '创建 OAuth 授权'),
  [Scope.OAUTH_GRANTS_DELETE]: scope('Revoke OAuth grants', '撤销 OAuth 授权'),
  [Scope.BACKGROUND_JOBS_READ]: scope('List and inspect background jobs', '列出和查看后台任务'),
  [Scope.BACKGROUND_JOBS_CREATE]: scope('Create background jobs', '创建后台任务'),
  [Scope.BACKGROUND_JOBS_UPDATE]: scope('Update background jobs', '更新后台任务'),
  [Scope.DOWNLOADERS_READ]: scope('List and inspect downloaders', '列出和查看下载器'),
  [Scope.DOWNLOADERS_CREATE]: scope('Create downloaders', '创建下载器'),
  [Scope.DOWNLOADERS_UPDATE]: scope('Update downloaders', '更新下载器'),
  [Scope.DOWNLOADERS_DELETE]: scope('Delete downloaders', '删除下载器'),
  [Scope.IMAGE_HOSTING_CONFIG_READ]: scope('Read image hosting configuration', '查看图床配置'),
  [Scope.IMAGE_HOSTING_CONFIG_UPDATE]: scope('Update image hosting configuration', '更新图床配置'),
  [Scope.IMAGE_HOSTING_CONFIG_DELETE]: scope('Delete image hosting configuration', '删除图床配置'),
  [Scope.IMAGES_READ]: scope('List and inspect images', '列出和查看图片'),
  [Scope.IMAGES_CREATE]: scope('Create images', '创建图片'),
  [Scope.IMAGES_UPDATE]: scope('Update images', '更新图片'),
  [Scope.IMAGES_DELETE]: scope('Delete images', '删除图片'),
  [Scope.NOTIFICATIONS_READ]: scope('List and inspect notifications', '列出和查看通知'),
  [Scope.NOTIFICATIONS_UPDATE]: scope('Update notification state', '更新通知状态'),
  [Scope.ANNOUNCEMENTS_READ]: scope('List and inspect announcements', '列出和查看公告'),
  [Scope.ANNOUNCEMENTS_CREATE]: scope('Create announcements', '创建公告'),
  [Scope.ANNOUNCEMENTS_UPDATE]: scope('Update announcements', '更新公告'),
  [Scope.ANNOUNCEMENTS_DELETE]: scope('Delete announcements', '删除公告'),
  [Scope.AUDIT_EVENTS_READ]: scope('Read audit events', '查看审计事件'),
  [Scope.AUTH_PROVIDERS_READ]: scope('List and inspect authentication providers', '列出和查看认证提供商'),
  [Scope.AUTH_PROVIDERS_UPDATE]: scope('Update authentication providers', '更新认证提供商'),
  [Scope.AUTH_PROVIDERS_DELETE]: scope('Delete authentication providers', '删除认证提供商'),
  [Scope.BRANDING_UPDATE]: scope('Update site branding', '更新站点品牌设置'),
  [Scope.EMAIL_CONFIG_READ]: scope('Read email configuration', '查看邮件配置'),
  [Scope.EMAIL_CONFIG_UPDATE]: scope('Update email configuration', '更新邮件配置'),
  [Scope.EMAIL_CONFIG_TEST]: scope('Test email configuration', '测试邮件配置'),
  [Scope.IMAGE_DOMAIN_PROVIDER_READ]: scope('Read image domain provider configuration', '查看图片域名提供商配置'),
  [Scope.IMAGE_DOMAIN_PROVIDER_UPDATE]: scope('Update image domain provider configuration', '更新图片域名提供商配置'),
  [Scope.IMAGE_DOMAIN_PROVIDER_TEST]: scope('Test image domain provider configuration', '测试图片域名提供商配置'),
  [Scope.SITE_INVITATIONS_READ]: scope('List and inspect site invitations', '列出和查看站点邀请'),
  [Scope.SITE_INVITATIONS_CREATE]: scope('Create site invitations', '创建站点邀请'),
  [Scope.SITE_INVITATIONS_DELETE]: scope('Delete site invitations', '删除站点邀请'),
  [Scope.INVITE_CODES_READ]: scope('List and inspect invite codes', '列出和查看邀请码'),
  [Scope.INVITE_CODES_CREATE]: scope('Create invite codes', '创建邀请码'),
  [Scope.INVITE_CODES_DELETE]: scope('Delete invite codes', '删除邀请码'),
  [Scope.LICENSING_READ]: scope('Read licensing information', '查看许可信息'),
  [Scope.LICENSING_UPDATE]: scope('Update licensing information', '更新许可信息'),
  [Scope.SITE_SETTINGS_READ]: scope('Read site settings', '查看站点设置'),
  [Scope.SITE_SETTINGS_UPDATE]: scope('Update site settings', '更新站点设置'),
  [Scope.STORAGES_READ]: scope('List and inspect storage backends', '列出和查看存储后端'),
  [Scope.STORAGES_CREATE]: scope('Create storage backends', '创建存储后端'),
  [Scope.STORAGES_UPDATE]: scope('Update storage backends', '更新存储后端'),
  [Scope.STORAGES_DELETE]: scope('Delete storage backends', '删除存储后端'),
  [Scope.SYSTEM_READ]: scope('Read system information', '查看系统信息'),
  [Scope.STORE_READ]: scope('Read store and purchase information', '查看商店和购买信息'),
  [Scope.STORE_CREATE]: scope('Create store purchases', '创建商店购买'),
  [Scope.STORE_UPDATE]: scope('Update store purchases', '更新商店购买'),
  [Scope.TEAMS_READ]: scope('List and inspect teams', '列出和查看团队'),
  [Scope.TEAMS_CREATE]: scope('Create teams', '创建团队'),
  [Scope.TEAMS_UPDATE]: scope('Update teams', '更新团队'),
  [Scope.TEAM_INVITATIONS_READ]: scope('List and inspect team invitations', '列出和查看团队邀请'),
  [Scope.TEAM_INVITATIONS_CREATE]: scope('Create team invitations', '创建团队邀请'),
  [Scope.TEAM_MEMBERS_CREATE]: scope('Add team members', '添加团队成员'),
  [Scope.TEAM_ENTITLEMENTS_READ]: scope('List and inspect team entitlements', '列出和查看团队权益'),
  [Scope.TEAM_ENTITLEMENTS_CREATE]: scope('Create team entitlements', '创建团队权益'),
  [Scope.TEAM_ENTITLEMENTS_UPDATE]: scope('Update team entitlements', '更新团队权益'),
  [Scope.TEAM_ENTITLEMENTS_DELETE]: scope('Delete team entitlements', '删除团队权益'),
  [Scope.USERS_READ]: scope('List and inspect users', '列出和查看用户'),
  [Scope.USERS_UPDATE]: scope('Update users', '更新用户'),
  [Scope.USER_ENTITLEMENTS_READ]: scope('List and inspect user entitlements', '列出和查看用户权益'),
  [Scope.USER_ENTITLEMENTS_CREATE]: scope('Create user entitlements', '创建用户权益'),
  [Scope.USER_ENTITLEMENTS_UPDATE]: scope('Update user entitlements', '更新用户权益'),
  [Scope.USER_ENTITLEMENTS_DELETE]: scope('Delete user entitlements', '删除用户权益'),
} satisfies Record<AuthorizationScope, OAuthScopeMetadata>

export const OAUTH_STANDARD_SCOPE_METADATA = {
  openid: scope('Verify your identity', '验证你的身份'),
  profile: scope('Read your basic profile', '读取你的基本资料'),
  email: scope('Read your email address', '读取你的电子邮箱地址'),
  offline_access: scope('Keep access while you are away', '在你离开后继续保持访问权限'),
} as const satisfies Record<string, OAuthScopeMetadata>

export function getOAuthScopeMetadata(value: string): OAuthScopeMetadata | null {
  if (Object.hasOwn(OAUTH_STANDARD_SCOPE_METADATA, value)) {
    return OAUTH_STANDARD_SCOPE_METADATA[value as keyof typeof OAUTH_STANDARD_SCOPE_METADATA]
  }
  if (Object.hasOwn(OAUTH_GRANT_SCOPE_METADATA, value)) {
    return OAUTH_GRANT_SCOPE_METADATA[value as AuthorizationScope]
  }
  return null
}

function scope(en: string, zh: string): OAuthScopeMetadata {
  return { description: { en, zh } }
}
