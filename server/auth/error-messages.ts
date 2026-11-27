import { type ErrorLanguage, localizeMessage, msg, textMessage } from '../usecases/ports'

// Chinese text for every error Better Auth (and the plugins ZPan configures) can
// answer on /api/auth/*, keyed by its stable `code`. Better Auth writes its messages
// in English only, so the auth route translates them here, like every other API
// error (spec/error-messages.feature). A test checks that every code the configured
// auth instance declares has an entry. ZPan's own auth messages carry no Better Auth
// code and are translated by text from the server catalog instead.
export const ZH_AUTH_ERROR_MESSAGES: Record<string, string> = {
  // Accounts, sign-in and sign-up
  USER_NOT_FOUND: '未找到用户',
  FAILED_TO_CREATE_USER: '创建用户失败',
  FAILED_TO_CREATE_SESSION: '创建会话失败',
  FAILED_TO_UPDATE_USER: '更新用户失败',
  FAILED_TO_GET_SESSION: '获取会话失败',
  INVALID_PASSWORD: '密码错误',
  INVALID_EMAIL: '邮箱无效',
  INVALID_EMAIL_OR_PASSWORD: '邮箱或密码错误',
  INVALID_USER: '用户无效',
  SOCIAL_ACCOUNT_ALREADY_LINKED: '该第三方账号已被绑定',
  PROVIDER_NOT_FOUND: '未找到登录方式',
  INVALID_TOKEN: '链接无效或已过期',
  TOKEN_EXPIRED: '链接已过期',
  ID_TOKEN_NOT_SUPPORTED: '不支持 id_token 登录',
  FAILED_TO_GET_USER_INFO: '获取用户信息失败',
  USER_EMAIL_NOT_FOUND: '未获取到用户邮箱',
  EMAIL_NOT_VERIFIED: '邮箱尚未验证',
  PASSWORD_TOO_SHORT: '密码太短',
  PASSWORD_TOO_LONG: '密码太长',
  USER_ALREADY_EXISTS: '用户已存在',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: '该邮箱已被注册，请换一个邮箱',
  EMAIL_CAN_NOT_BE_UPDATED: '邮箱无法修改',
  CHANGE_EMAIL_DISABLED: '未开放修改邮箱',
  CREDENTIAL_ACCOUNT_NOT_FOUND: '未找到密码登录账号',
  SESSION_EXPIRED: '会话已过期，请重新登录后再操作。',
  FAILED_TO_UNLINK_LAST_ACCOUNT: '不能解绑最后一个登录方式',
  ACCOUNT_NOT_FOUND: '未找到账号',
  USER_ALREADY_HAS_PASSWORD: '该用户已设置密码，请输入密码后再删除账号。',
  CROSS_SITE_NAVIGATION_LOGIN_BLOCKED: '已阻止跨站登录请求',
  VERIFICATION_EMAIL_NOT_ENABLED: '未启用验证邮件',
  EMAIL_ALREADY_VERIFIED: '邮箱已验证',
  EMAIL_MISMATCH: '邮箱不匹配',
  SESSION_NOT_FRESH: '登录时间过久，请重新登录后再操作',
  LINKED_ACCOUNT_ALREADY_EXISTS: '已绑定该账号',
  INVALID_ORIGIN: '请求来源无效',
  INVALID_CALLBACK_URL: '回调地址无效',
  INVALID_REDIRECT_URL: '跳转地址无效',
  INVALID_ERROR_CALLBACK_URL: '错误回调地址无效',
  INVALID_NEW_USER_CALLBACK_URL: '新用户回调地址无效',
  MISSING_OR_NULL_ORIGIN: '缺少请求来源',
  CALLBACK_URL_REQUIRED: '缺少回调地址',
  FAILED_TO_CREATE_VERIFICATION: '创建验证失败',
  FIELD_NOT_ALLOWED: '不允许设置该字段',
  ASYNC_VALIDATION_NOT_SUPPORTED: '不支持异步校验',
  VALIDATION_ERROR: '请求无效',
  MISSING_FIELD: '缺少必填字段',
  METHOD_NOT_ALLOWED_DEFER_SESSION_REQUIRED: '当前会话配置不支持此请求方式',
  BODY_MUST_BE_AN_OBJECT: '请求体须为对象',
  PASSWORD_ALREADY_SET: '该用户已设置密码',
  RATE_LIMIT_EXCEEDED: '请求过于频繁，请稍后再试。',

  // Usernames
  INVALID_USERNAME_OR_PASSWORD: '用户名或密码错误',
  UNEXPECTED_ERROR: '发生意外错误',
  USERNAME_IS_ALREADY_TAKEN: '用户名已被占用，请换一个。',
  USERNAME_TOO_SHORT: '用户名太短',
  USERNAME_TOO_LONG: '用户名太长',
  INVALID_USERNAME: '用户名无效',
  INVALID_DISPLAY_USERNAME: '显示名无效',
  USERNAME_IS_IMMUTABLE: '用户名无法修改',

  // Teams (Better Auth organizations), their members and invitations
  YOU_ARE_NOT_ALLOWED_TO_CREATE_A_NEW_ORGANIZATION: '你没有权限创建团队',
  YOU_HAVE_REACHED_THE_MAXIMUM_NUMBER_OF_ORGANIZATIONS: '你的团队数量已达上限',
  ORGANIZATION_ALREADY_EXISTS: '团队已存在',
  ORGANIZATION_SLUG_ALREADY_TAKEN: '团队标识已被占用',
  ORGANIZATION_NOT_FOUND: '未找到团队',
  USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION: '该用户不是团队成员',
  YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_ORGANIZATION: '你没有权限修改该团队',
  YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_ORGANIZATION: '你没有权限删除该团队',
  NO_ACTIVE_ORGANIZATION: '没有当前空间',
  USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION: '该用户已是团队成员',
  MEMBER_NOT_FOUND: '未找到成员',
  ROLE_NOT_FOUND: '未找到角色',
  YOU_ARE_NOT_ALLOWED_TO_CREATE_A_NEW_TEAM: '你没有权限创建小组',
  TEAM_ALREADY_EXISTS: '小组已存在',
  TEAM_NOT_FOUND: '未找到小组',
  YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER: '你是团队唯一的所有者，不能退出团队',
  YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER: '团队不能没有所有者',
  YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_MEMBER: '你没有权限移除该成员',
  YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION: '你没有权限邀请成员加入该团队',
  USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION: '该用户已被邀请加入团队',
  INVITATION_NOT_FOUND: '未找到邀请',
  YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION: '这不是发给你的邀请',
  EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION: '请先验证邮箱，再接受或拒绝邀请',
  EMAIL_VERIFICATION_REQUIRED_FOR_INVITATION: '请先验证邮箱，再查看邀请',
  YOU_ARE_NOT_ALLOWED_TO_CANCEL_THIS_INVITATION: '你没有权限撤销该邀请',
  INVITER_IS_NO_LONGER_A_MEMBER_OF_THE_ORGANIZATION: '邀请人已不是团队成员',
  YOU_ARE_NOT_ALLOWED_TO_INVITE_USER_WITH_THIS_ROLE: '你没有权限以该角色邀请成员',
  FAILED_TO_RETRIEVE_INVITATION: '获取邀请失败',
  YOU_HAVE_REACHED_THE_MAXIMUM_NUMBER_OF_TEAMS: '小组数量已达上限',
  UNABLE_TO_REMOVE_LAST_TEAM: '不能删除最后一个小组',
  YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER: '你没有权限修改该成员',
  ORGANIZATION_MEMBERSHIP_LIMIT_REACHED: '团队成员数量已达上限',
  YOU_ARE_NOT_ALLOWED_TO_CREATE_TEAMS_IN_THIS_ORGANIZATION: '你没有权限在该团队中创建小组',
  YOU_ARE_NOT_ALLOWED_TO_DELETE_TEAMS_IN_THIS_ORGANIZATION: '你没有权限删除该团队中的小组',
  YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_TEAM: '你没有权限修改该小组',
  YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_TEAM: '你没有权限删除该小组',
  INVITATION_LIMIT_REACHED: '邀请数量已达上限',
  TEAM_MEMBER_LIMIT_REACHED: '小组成员数量已达上限',
  USER_IS_NOT_A_MEMBER_OF_THE_TEAM: '该用户不是小组成员',
  YOU_CAN_NOT_ACCESS_THE_MEMBERS_OF_THIS_TEAM: '你没有权限查看该小组的成员',
  YOU_DO_NOT_HAVE_AN_ACTIVE_TEAM: '你没有当前小组',
  YOU_ARE_NOT_ALLOWED_TO_CREATE_A_NEW_TEAM_MEMBER: '你没有权限添加成员',
  YOU_ARE_NOT_ALLOWED_TO_REMOVE_A_TEAM_MEMBER: '你没有权限移除小组成员',
  YOU_ARE_NOT_ALLOWED_TO_ACCESS_THIS_ORGANIZATION: '你没有以所有者身份访问该团队的权限',
  YOU_ARE_NOT_A_MEMBER_OF_THIS_ORGANIZATION: '你不是该团队的成员',
  MISSING_AC_INSTANCE: '服务器未配置动态权限控制',
  YOU_MUST_BE_IN_AN_ORGANIZATION_TO_CREATE_A_ROLE: '须在团队中才能创建角色',
  YOU_ARE_NOT_ALLOWED_TO_CREATE_A_ROLE: '你没有权限创建角色',
  YOU_ARE_NOT_ALLOWED_TO_UPDATE_A_ROLE: '你没有权限修改角色',
  YOU_ARE_NOT_ALLOWED_TO_DELETE_A_ROLE: '你没有权限删除角色',
  YOU_ARE_NOT_ALLOWED_TO_READ_A_ROLE: '你没有权限查看角色',
  YOU_ARE_NOT_ALLOWED_TO_LIST_A_ROLE: '你没有权限列出角色',
  YOU_ARE_NOT_ALLOWED_TO_GET_A_ROLE: '你没有权限获取角色',
  TOO_MANY_ROLES: '该团队的角色过多',
  INVALID_RESOURCE: '权限中包含无效的资源',
  ROLE_NAME_IS_ALREADY_TAKEN: '角色名已被占用',
  CANNOT_DELETE_A_PRE_DEFINED_ROLE: '不能删除预置角色',
  ROLE_IS_ASSIGNED_TO_MEMBERS: '该角色仍有成员使用，请先为这些成员更换角色',
  INVALID_TEAM_ID: '小组 ID 包含保留字符',

  // User administration
  YOU_CANNOT_BAN_YOURSELF: '不能封禁自己',
  YOU_ARE_NOT_ALLOWED_TO_CHANGE_USERS_ROLE: '你没有权限修改用户角色',
  YOU_ARE_NOT_ALLOWED_TO_CREATE_USERS: '你没有权限创建用户',
  YOU_ARE_NOT_ALLOWED_TO_LIST_USERS: '你没有权限查看用户列表',
  YOU_ARE_NOT_ALLOWED_TO_LIST_USERS_SESSIONS: '你没有权限查看用户会话',
  YOU_ARE_NOT_ALLOWED_TO_BAN_USERS: '你没有权限封禁用户',
  YOU_ARE_NOT_ALLOWED_TO_IMPERSONATE_USERS: '你没有权限模拟用户登录',
  YOU_ARE_NOT_ALLOWED_TO_REVOKE_USERS_SESSIONS: '你没有权限注销用户会话',
  YOU_ARE_NOT_ALLOWED_TO_DELETE_USERS: '你没有权限删除用户',
  YOU_ARE_NOT_ALLOWED_TO_SET_USERS_PASSWORD: '你没有权限设置用户密码',
  BANNED_USER: '你的账号已被封禁',
  YOU_ARE_NOT_ALLOWED_TO_GET_USER: '你没有权限查看该用户',
  NO_DATA_TO_UPDATE: '没有需要更新的内容',
  YOU_ARE_NOT_ALLOWED_TO_UPDATE_USERS: '你没有权限修改用户',
  YOU_CANNOT_REMOVE_YOURSELF: '不能删除自己',
  YOU_ARE_NOT_ALLOWED_TO_SET_NON_EXISTENT_VALUE: '不能设置不存在的角色',
  YOU_CANNOT_IMPERSONATE_ADMINS: '不能模拟管理员登录',
  INVALID_ROLE_TYPE: '角色类型无效',
  YOU_ARE_NOT_ALLOWED_TO_SET_USERS_EMAIL: '你没有权限修改用户邮箱',
  PASSWORD_CANNOT_BE_UPDATED_VIA_UPDATE_USER: '不能通过修改用户资料来修改密码',

  // API keys
  INVALID_METADATA_TYPE: 'metadata 须为对象',
  REFILL_AMOUNT_AND_INTERVAL_REQUIRED: '设置补充间隔时须同时设置补充数量',
  REFILL_INTERVAL_AND_AMOUNT_REQUIRED: '设置补充数量时须同时设置补充间隔',
  USER_BANNED: '用户已被封禁',
  UNAUTHORIZED_SESSION: '未登录或登录已失效',
  KEY_NOT_FOUND: '未找到 API 密钥',
  KEY_DISABLED: 'API 密钥已停用',
  KEY_EXPIRED: 'API 密钥已过期',
  USAGE_EXCEEDED: 'API 密钥已达使用次数上限',
  KEY_NOT_RECOVERABLE: 'API 密钥无法找回',
  EXPIRES_IN_IS_TOO_SMALL: '有效期短于允许的最小值。',
  EXPIRES_IN_IS_TOO_LARGE: '有效期长于允许的最大值。',
  INVALID_REMAINING: '剩余次数超出允许范围。',
  INVALID_PREFIX_LENGTH: '前缀长度超出允许范围。',
  INVALID_NAME_LENGTH: '名称长度超出允许范围。',
  METADATA_DISABLED: '未启用 metadata。',
  NO_VALUES_TO_UPDATE: '没有需要更新的内容。',
  KEY_DISABLED_EXPIRATION: '不允许自定义有效期。',
  INVALID_API_KEY: 'API 密钥无效。',
  INVALID_USER_ID_FROM_API_KEY: 'API 密钥对应的用户无效。',
  INVALID_REFERENCE_ID_FROM_API_KEY: 'API 密钥的归属无效。',
  INVALID_API_KEY_GETTER_RETURN_TYPE: '读取到的 API 密钥类型无效。',
  SERVER_ONLY_PROPERTY: '该属性只能由服务器设置。',
  FAILED_TO_UPDATE_API_KEY: '更新 API 密钥失败',
  NAME_REQUIRED: '请填写 API 密钥名称。',
  ORGANIZATION_ID_REQUIRED: '团队所有的 API 密钥须指定团队。',
  USER_NOT_MEMBER_OF_ORGANIZATION: '你不是该 API 密钥所属团队的成员。',
  INSUFFICIENT_API_KEY_PERMISSIONS: '你没有权限管理该团队的 API 密钥。',
  NO_DEFAULT_API_KEY_CONFIGURATION_FOUND: '未找到默认的 API 密钥配置。',
  ORGANIZATION_PLUGIN_REQUIRED: '团队所有的 API 密钥需要启用团队功能。',

  // Device sign-in (CLI and agents)
  ACCESS_DENIED: '已拒绝访问',
  AUTHENTICATION_REQUIRED: '请先登录',
  AUTHORIZATION_PENDING: '等待授权',
  DEVICE_CODE_ALREADY_PROCESSED: '该设备码已处理',
  DEVICE_CODE_NOT_CLAIMED: '请先在登录状态下打开设备验证页面，再批准或拒绝',
  EXPIRED_DEVICE_CODE: '设备码已过期',
  EXPIRED_USER_CODE: '验证码已过期',
  INVALID_DEVICE_CODE: '设备码无效',
  INVALID_DEVICE_CODE_STATUS: '设备码状态无效',
  INVALID_USER_CODE: '验证码无效',
  POLLING_TOO_FREQUENTLY: '轮询过于频繁',

  // Third-party sign-in providers
  INVALID_OAUTH_CONFIGURATION: '第三方登录配置无效',
  TOKEN_URL_NOT_FOUND: '第三方登录配置无效：缺少令牌地址。',

  // CAPTCHA
  VERIFICATION_FAILED: '人机验证失败',
  MISSING_RESPONSE: '请完成人机验证',
  UNKNOWN_ERROR: '出了点问题',
}

type AuthErrorBody = { message: string; code?: string }

const isAuthErrorBody = (body: unknown): body is AuthErrorBody =>
  typeof body === 'object' && body !== null && typeof (body as AuthErrorBody).message === 'string'

// Better Auth reports a request that fails its schema as "[body.email] Invalid email
// address". The bracketed path is internal; the message names only the field.
const VALIDATION_FIELD = /^\[(?:body|query)\.([\w.]+)\]/

/** The message an /api/auth error body should carry in `language`. */
export function localizeAuthErrorMessage(body: AuthErrorBody, language: ErrorLanguage): string {
  if (body.code === 'VALIDATION_ERROR') {
    const field = VALIDATION_FIELD.exec(body.message)?.[1]
    return localizeMessage(field ? msg('Invalid value for {field}', { field }) : 'Invalid request', language)
  }
  if (language === 'en') return body.message
  const byCode = body.code ? ZH_AUTH_ERROR_MESSAGES[body.code] : undefined
  return byCode ?? localizeMessage(textMessage(body.message), language)
}

/**
 * Rewrites the message of a Better Auth JSON error response into `language`,
 * keeping its status, headers and every other field. Other responses pass through.
 */
export async function localizeAuthErrorResponse(response: Response, language: ErrorLanguage): Promise<Response> {
  if (response.ok || !response.headers.get('Content-Type')?.includes('application/json')) return response
  const body: unknown = await response
    .clone()
    .json()
    .catch(() => null)
  if (!isAuthErrorBody(body)) return response
  const message = localizeAuthErrorMessage(body, language)
  if (message === body.message) return response
  const headers = new Headers(response.headers)
  headers.delete('Content-Length')
  return new Response(JSON.stringify({ ...body, message }), { status: response.status, headers })
}
