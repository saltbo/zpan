// The user-facing text of every API error, in each language the product ships.
// English is the key: call sites write the English text (`notFound('Team not found')`),
// and the factories only accept a key of this catalog, so a message without its
// Chinese text does not compile. `{name}` marks a parameter filled by `msg()`.
// The HTTP boundary picks the language from the request (see error-handler).
export const ZH_ERROR_MESSAGES = {
  // Shared defaults
  'Not found': '未找到',
  Forbidden: '没有权限',
  Unauthorized: '未登录或登录已失效',
  'Password required': '需要密码',
  Expired: '已过期',
  'Internal error': '服务器内部错误',
  'Internal Server Error': '服务器内部错误',
  'Payload too large': '内容过大',
  'Unsupported media type': '不支持的媒体类型',
  'Background jobs are unavailable in this environment': '当前环境不支持后台任务',
  'No storage configured': '尚未配置存储',
  'Quota exceeded': '超出配额',
  'Insufficient credits': '额度不足',
  'Feature not available': '当前版本不提供此功能',
  'Rate limit exceeded.': '请求过于频繁，请稍后再试。',

  // Requests
  'Expected multipart/form-data': '请求须为 multipart/form-data',
  'Expected multipart/form-data with a file field': '请求须为包含 file 字段的 multipart/form-data',
  'Invalid JSON body': '请求体不是有效的 JSON',
  'Invalid base64 in file field': 'file 字段的 base64 内容无效',
  'Invalid page token': '分页标记无效',
  'Invalid payload': '请求内容无效',
  'Invalid reference': '引用无效',
  'Unsupported Content-Type. Use multipart/form-data or application/json with base64.':
    '不支持的 Content-Type，请使用 multipart/form-data 或带 base64 内容的 application/json。',
  'file field (base64 string) is required': '缺少 file 字段（base64 字符串）',
  'file field is required': '缺少 file 字段',
  'Invalid field. Valid fields: {fields}': '字段无效。可用字段：{fields}',
  'Invalid request': '请求无效',
  'Invalid value for {field}': '{field} 的值无效',

  // Request schema checks, shown when a request fails its route's schema
  'Target folder cannot contain ..': '目标文件夹不能包含 ..',
  'Magnet source must be a magnet: URI': '磁力链接须以 magnet: 开头',
  'URL must be a public http(s) address': '链接须为公网 http(s) 地址',
  'At least one field is required': '至少需要填写一个字段',
  'Health status cannot be updated with connection settings': '健康状态不能与连接设置一起修改',
  'Health reason requires a health status': '填写健康原因时须同时设置健康状态',
  'Unhealthy status requires a reason': '不健康状态须填写原因',
  'Only an unhealthy status can have a reason': '只有不健康状态才能填写原因',
  'CNAME value must be a hostname': 'CNAME 记录值须为主机名',
  'A value must be an IPv4 address': 'A 记录值须为 IPv4 地址',
  'AAAA value must be an IPv6 address': 'AAAA 记录值须为 IPv6 地址',
  'Zone ID must be 32 hexadecimal characters': 'Zone ID 须为 32 位十六进制字符',
  'Invalid hostname format': '主机名格式无效',
  'Each entry must be a valid origin (e.g. https://example.com)': '每一项须为有效的源地址（如 https://example.com）',
  'Must contain only ASCII letters and digits': '只能包含 ASCII 字母和数字',
  'Must contain only ASCII letters, digits, underscores, or hyphens': '只能包含 ASCII 字母、数字、下划线或连字符',
  'Must be a current or historical share token': '须为有效的分享标识',
  'Must be a current or historical image token': '须为有效的图片标识',
  'Expected valid yyyy-MM-dd or ISO datetime with offset': '日期须为 yyyy-MM-dd 或带时区的 ISO 时间',

  // Workspaces and teams
  'No active organization': '没有当前空间',
  'No organization found': '未找到空间',
  'Invalid workspace selection': '所选空间无效',
  'Workspace not found': '未找到空间',
  'Workspace plan already exists': '该空间的套餐已存在',
  'Team not found': '未找到团队',
  'Already a member of this team': '你已是该团队成员',
  'Target must be a different space': '目标须为另一个空间',
  'User not found': '未找到用户',
  'Only admin-granted entitlements can be modified': '只能修改管理员授予的权益',

  // Files and folders
  'Matter not found': '未找到文件',
  'Folder not found': '未找到文件夹',
  'File not found or not accessible': '文件不存在或无权访问',
  'Cannot download a folder directly': '无法直接下载文件夹',
  'Folder is in use by a download task': '该文件夹正被下载任务使用',
  'Torrent is not ready': '种子尚未就绪',
  'Torrent not found': '未找到种子',
  'Torrent metadata does not match the infoHash': '种子元数据与 infoHash 不一致',
  'Torrent metadata is invalid': '种子元数据无效',
  'Torrent file not found': '种子中不存在该文件',
  'Torrent file is already uploaded': '种子中的该文件已上传',
  'Torrent file is already being uploaded': '种子中的该文件正在上传',
  'Uploaded file size does not match the torrent': '上传文件的大小与种子不一致',
  '{count} drive files or Torrents list entries still hold this torrent; it can be evicted once they are deleted, including from trash, or removed':
    '仍有 {count} 个网盘文件或种子列表条目持有该种子；需先删除这些文件（包括回收站中的）或移除这些条目才能清除',
  'The task is not filling a torrent': '该任务没有在填充种子',
  'Torrent is not in this workspace': '该工作空间的种子列表中没有这个种子',
  'Torrent file is not playable yet': '种子中的该文件暂时无法播放',
  'Torrent is still being downloaded or verified': '种子仍在下载或校验中',
  'Torrent is already being evicted': '种子正在被清除',
  'Torrent changed while it was being evicted; try again': '清除期间种子发生了变化，请重试',
  'Target folder is outside task authorization': '目标文件夹超出任务的授权范围',
  'Target folder path contains a file': '目标文件夹路径中包含文件',
  'Object is outside task authorization': '对象超出任务的授权范围',
  'Folder already has media metadata': '该文件夹已有媒体信息',
  'Show media belongs on a folder': '剧集媒体信息只能写在文件夹上',
  'Video media belongs on a file': '视频媒体信息只能写在文件上',
  'Movie not found': '未找到该电影',
  'Show not found': '未找到该剧集',
  'Search is not allowed for task uploads': '任务上传不允许搜索',
  'File exceeds the 5 TiB maximum': '文件超过 5 TiB 上限',
  'File exceeds the maximum allowed size': '文件超过允许的最大大小',
  'Invalid path': '路径无效',
  'Invalid upload session state': '上传会话状态无效',
  "An item named '{name}' already exists in this location": '此位置已存在名为“{name}”的项目',
  'README.md is too large': 'README.md 过大',
  'README.md must be UTF-8 text': 'README.md 须为 UTF-8 文本',
  'README.md not found': '未找到 README.md',
  'Upload completion parts do not match the session': '完成上传的分片与会话不一致',
  'Duplicate part numbers are not allowed': '分片编号不能重复',
  'Part number is outside this upload session': '分片编号超出此上传会话的范围',
  'Uploaded object ETag does not match': '上传对象的 ETag 不一致',
  'Upload already completed': '上传已完成',

  // WebDAV
  'Invalid DAV path': 'DAV 路径无效',
  'Ambiguous DAV path': 'DAV 路径有歧义',
  'Invalid path encoding': '路径编码无效',
  'Invalid DAV path segment': 'DAV 路径片段无效',
  'Parent collection not found': '未找到上级目录',
  'Not a collection': '不是目录',
  'WebDAV must be enabled before its domain can be verified': '须先启用 WebDAV，才能验证其域名',

  // Storage
  'Storage not found': '未找到存储',
  'Storage is not active or has no available capacity': '存储未启用或没有可用容量',
  'Storage is referenced by existing files': '存储仍被现有文件引用',
  'Storage selection is not allowed for task uploads': '任务上传不允许选择存储',
  'Quota exceeded for the media library index': '媒体库索引超出配额',
  'Traffic quota exceeded': '超出流量配额',

  // Shares
  'Share not found': '未找到分享',
  'Share not found or revoked': '分享不存在或已撤销',
  'Share has expired': '分享已过期',
  'Share target has been deleted': '分享的文件已被删除',
  'File no longer available': '文件已不可用',
  'Download limit exceeded': '已超过下载次数上限',
  'Not a folder share': '不是文件夹分享',
  'Authentication required for password-protected share': '访问受密码保护的分享需要验证',
  'Invalid password': '密码错误',
  'Direct link shares cannot be saved. Ask the sender for a landing share.':
    '直链分享无法转存，请让分享者提供落地页分享。',
  'Direct shares cannot be folders': '直链分享不能是文件夹',
  'Direct shares cannot have a password': '直链分享不能设置密码',
  'Direct shares cannot have recipients': '直链分享不能指定接收人',
  'Only untargeted landing shares have configurable privacy': '只有未指定接收人的落地页分享可以设置隐私',

  // Media libraries
  'Media library not found': '未找到媒体库',
  'Only folders can be media libraries': '只有文件夹可以设为媒体库',
  'Folder is already a media library': '该文件夹已是媒体库',
  'A scan of this media library is already queued or running': '该媒体库的扫描已在排队或进行中',
  'The media library folder is in trash or no longer exists': '媒体库文件夹已在回收站中或已不存在',
  'Media libraries cannot be nested: "{path}" is a media library': '媒体库不能嵌套：“{path}”已是媒体库',
  '"{path}" already exists; rename or remove it to make this folder a media library':
    '“{path}”已存在；请重命名或移除它，才能将此文件夹设为媒体库',

  // Background jobs and downloads
  'Background job cannot be canceled': '后台任务无法取消',
  'Background job cannot be retried': '后台任务无法重试',
  'Invalid task status': '任务状态无效',
  'Task is {status}': '任务当前状态为 {status}',
  'Only completed, failed, or canceled tasks can be deleted': '只能删除已完成、失败或已取消的任务',
  'Only queued, assigned, or downloading tasks can be paused': '只能暂停排队中、已分配或下载中的任务',
  'Only paused or suspended tasks can be resumed': '只能恢复已暂停或已挂起的任务',
  'Only active, interrupted, suspended, or paused tasks can be canceled':
    '只能取消进行中、已中断、已挂起或已暂停的任务',
  'Only failed tasks can be retried': '只能重试失败的任务',
  'Only inactive tasks can be restarted': '只能重新开始未在运行的任务',
  'Invalid event token': '事件令牌无效',

  // Invitations and invite codes
  'Announcement not found': '未找到公告',
  'Not found or not in draft status': '不存在或不是草稿状态',
  'Invitation not found': '未找到邀请',
  'Invitation has been revoked': '邀请已被撤销',
  'Invitation has already been revoked': '邀请已经撤销过了',
  'Invitation has already been used': '邀请已被使用',
  'Invite code not found': '未找到邀请码',
  'Cannot delete a used invite code': '已使用的邀请码无法删除',
  'Invalid invite link': '邀请链接无效',
  'Invalid or expired invite link': '邀请链接无效或已过期',
  'Invite link has expired': '邀请链接已过期',
  'Configure email delivery before sending invitations': '请先配置邮件发送，再发送邀请',
  'Failed to create invitation': '创建邀请失败',
  'A user with this email already exists': '该邮箱已注册',
  'A pending invitation already exists for this email': '该邮箱已有待接受的邀请',
  'Email must be enabled before email verification can be required': '须先启用邮件，才能要求邮箱验证',
  'Unknown error': '未知错误',
  'An invitation is required to register': '需要邀请才能注册',
  'Invalid invitation': '邀请无效',
  'Invitation has expired': '邀请已过期',
  'Invitation email does not match': '邀请对应的邮箱与填写的邮箱不一致',
  'An invite code is required to register': '需要邀请码才能注册',
  'Invalid invite code': '邀请码无效',
  'Invite code already used': '邀请码已被使用',
  'Invite code expired': '邀请码已过期',

  // Accounts and API keys (Better Auth hooks)
  'Self-service account deletion is not available': '不支持自行注销账号',
  'API key prefixes must contain only ASCII letters and digits': 'API 密钥前缀只能包含 ASCII 字母和数字',
  'WebDAV API keys cannot target a workspace': 'WebDAV API 密钥不能指定空间',
  'Organization ID is required': '须指定空间',
  'Editor access to the workspace is required': '需要该空间的编辑权限',
  'Team limit reached. Free includes one personal workspace plus one extra team. Upgrade to Pro for unlimited teams.':
    '团队数量已达上限。免费版包含一个个人空间和一个额外团队，升级到 Pro 可创建不限数量的团队。',

  // OAuth
  'Invalid OAuth authorization details': 'OAuth 授权详情无效',
  'Invalid OAuth redirect URI': 'OAuth 回调地址无效',
  'Invalid OAuth request': 'OAuth 请求无效',
  'Invalid OAuth scope': 'OAuth 权限范围无效',
  'OAuth grant not found': '未找到 OAuth 授权',
  'Workspace access is required for OAuth': 'OAuth 需要空间访问权限',
  'At least one workspace authorization request is required': '至少需要一项空间授权请求',

  // Sign-in providers and site settings
  'discoveryUrl is required for OIDC providers': 'OIDC 登录方式需要填写 discoveryUrl',
  'Unknown builtin provider: {id}': '未知的内置登录方式：{id}',
  'Provider ID must contain only lowercase letters, numbers, and hyphens': '登录方式 ID 只能包含小写字母、数字和连字符',
  'Captcha configuration is invalid': '人机验证配置无效',
  'Captcha provider is invalid': '人机验证服务无效',
  'Captcha site key is required before enabling captcha': '启用人机验证前须填写站点密钥',
  'Captcha secret key is required before enabling captcha': '启用人机验证前须填写密钥',
  'Captcha minimum score must be between 0 and 1': '人机验证最低分数须在 0 到 1 之间',
  'Public URL must be an HTTP or HTTPS origin': '公开地址须为 HTTP 或 HTTPS 源',
  'SVG images are not allowed': '不允许 SVG 图片',
  'theme_mode must be preset or custom': '主题模式须为预设或自定义',
  'theme_preset is invalid': '主题预设无效',
  '{field} must be a CSS hex color': '{field} 须为 CSS 十六进制颜色',
  '{field} is required for custom theme': '自定义主题需要填写 {field}',
  'wordmark_text must be 24 characters or fewer': '文字标志不能超过 24 个字符',
  'Invalid file type for {field}. Allowed: {types}': '{field} 的文件类型无效。允许：{types}',
  '{label} too large. Max {size} KB.': '{label}过大，最大 {size} KB。',
  'Only PNG, JPG, WebP, and GIF images are allowed': '只允许 PNG、JPG、WebP 和 GIF 图片',
  'File too large. Max 1 MiB.': '文件过大，最大 1 MiB。',

  // Image hosting and custom domains
  'image hosting not enabled for this organization': '此空间未启用图床',
  'forbidden referer': '来源网站不被允许',
  'invalid path: path contains invalid characters': '路径无效：包含不允许的字符',
  'invalid path: path must not start with /': '路径无效：不能以 / 开头',
  'invalid path: path must not end with /': '路径无效：不能以 / 结尾',
  'invalid path: path must not contain ..': '路径无效：不能包含 ..',
  'invalid path: path must not contain //': '路径无效：不能包含 //',
  'invalid path: path exceeds {max} characters': '路径无效：超过 {max} 个字符',
  'invalid path: path depth exceeds {max} segments': '路径无效：层级超过 {max} 级',
  'Custom domain cannot be the application default host': '自定义域名不能是应用的默认主机',
  'Domain already registered by another organization': '该域名已被其他空间注册',
  'Domain verification not found': '未找到域名验证',
  'Image custom-domain provider is not configured': '尚未配置图床自定义域名服务',
  'Image custom-domain provider is not ready': '图床自定义域名服务尚未就绪',
  'Invalid certificate': '证书无效',

  // Image custom-domain setup: what an admin can fix, and the message for anything else
  'The CNAME target must be a hostname inside the Cloudflare zone {zone}':
    'CNAME 目标必须是 Cloudflare 区域 {zone} 内的主机名',
  'The origin hostname must be inside the Cloudflare zone {zone}': '回源主机名必须位于 Cloudflare 区域 {zone} 内',
  'Turn on the Cloudflare proxy for the DNS record {record}': '请为 DNS 记录 {record} 开启 Cloudflare 代理',
  'Change the DNS record {record} to a CNAME that points to {target}':
    '请将 DNS 记录 {record} 改为指向 {target} 的 CNAME 记录',
  'Add a proxied DNS record for the origin hostname {record} in Cloudflare':
    '请在 Cloudflare 中为回源主机名 {record} 添加已开启代理的 DNS 记录',
  'The DNS record {record} must be an A, AAAA, or CNAME record': 'DNS 记录 {record} 必须是 A、AAAA 或 CNAME 记录',
  'The Cloudflare fallback origin is still being set up. Wait a moment and test again.':
    'Cloudflare 回退源仍在设置中，请稍后再测试。',
  'The Cloudflare Worker route {route} is already in use. Remove that route and test again.':
    'Cloudflare Worker 路由 {route} 已被占用，请移除该路由后再测试。',
  'Cloudflare refused the API token. Check that it is valid and has the permissions this zone needs.':
    'Cloudflare 拒绝了此 API 令牌，请确认令牌有效且拥有此区域所需的权限。',
  'The custom domain is not verified yet. Check that its DNS record points to the target shown.':
    '自定义域名尚未通过验证，请检查其 DNS 记录是否指向所示目标。',

  // Admin analytics
  'admin analytics uses UTC calendar boundaries': '管理统计按 UTC 日历边界计算',
  'createdFrom must be before createdTo': 'createdFrom 须早于 createdTo',
  'from must align to a UTC hour': 'from 须对齐到 UTC 整点',
  'from must be before to': 'from 须早于 to',
  'time range must include a closed UTC hour': '时间范围须包含一个完整的 UTC 小时',
  'to must end on a UTC hour': 'to 须结束于 UTC 整点',
  'time range cannot exceed {days} days': '时间范围不能超过 {days} 天',

  // Store, licensing, and cloud
  'This workspace does not have enough storage for this file. Upgrade its storage to continue.':
    '此空间的存储空间不足，无法上传该文件。升级存储后即可继续。',
  'Capacity offer does not increase the workspace quota': '该容量方案不会增加空间配额',
  'Cloud capacity purchase response is missing its resource identity': '云端容量购买响应缺少资源标识',
  'Invalid capacity offer': '容量方案无效',
  'Order not found': '未找到订单',
  'Package price missing': '缺少套餐价格',
  'Payment was not completed': '支付未完成',
  'Purchase initialization is in progress': '购买正在初始化',
  'Purchase request conflict': '购买请求冲突',
  'Too many pending capacity purchases': '待处理的容量购买过多',
  'License unbound locally, but cloud unbind failed': '已在本地解绑授权，但云端解绑失败',
  'This site is not connected to a ZPan Cloud store': '此站点尚未绑定 ZPan Cloud 商店',
  'The license is not active': '授权未激活',
  'This needs a connection to ZPan Cloud': '需要连接 ZPan Cloud',
  'ZPan Cloud returned an unexpected response': 'ZPan Cloud 返回了无法识别的响应',
  'ZPan Cloud could not complete the request. Try again later.': 'ZPan Cloud 未能完成请求，请稍后再试。',
  'ZPan Cloud rejected the request': 'ZPan Cloud 拒绝了此请求',
  'The payment could not be verified': '无法验证此次支付',

  // Failures of a service outside ZPan, whose own text stays in the server log
  'Image upload failed': '图片上传失败',
  'Email is disabled': '邮件功能未启用',
  'The test email could not be sent. Check the email settings.': '测试邮件发送失败，请检查邮件设置。',
  'The storage service could not complete the request': '存储服务未能完成请求',
  'The custom-domain provider test failed. Check its settings.': '自定义域名服务测试失败，请检查其设置。',
  'The quota change could not be applied': '无法应用此配额变更',
} as const

export type ErrorText = keyof typeof ZH_ERROR_MESSAGES
export type ErrorLanguage = 'en' | 'zh'
type Params = Record<string, string | number>

// An error message that is not a plain catalog key: a template with parameters, or
// text produced elsewhere (an upstream service, a library) that is looked up at
// render time and shown as is when the catalog does not know it.
export class Message {
  constructor(
    readonly template: string,
    readonly params: Params = {},
  ) {}
}

export type ErrorMessage = ErrorText | Message

/** A catalog template with its parameters, e.g. `msg('Task is {status}', { status })`. */
export const msg = (template: ErrorText, params: Params) => new Message(template, params)

/** Text from outside the catalog's call sites, translated when the catalog matches it. */
export const textMessage = (text: string) => new Message(text)

// The machine codes that adapters and ZPan Cloud report, with the message the user
// sees for each. A code may carry an HTTP status suffix (`cloud_request_failed_502`).
const ERROR_CODE_MESSAGES: Record<string, ErrorText> = {
  quota_store_binding_missing: 'This site is not connected to a ZPan Cloud store',
  license_inactive: 'The license is not active',
  cloud_required: 'This needs a connection to ZPan Cloud',
  invalid_cloud_response: 'ZPan Cloud returned an unexpected response',
  cloud_request_failed: 'ZPan Cloud could not complete the request. Try again later.',
  cloud_request_timeout: 'ZPan Cloud could not complete the request. Try again later.',
  x402_payment_proof_invalid: 'The payment could not be verified',
  unsupported_media_type: 'Unsupported media type',
  payload_too_large: 'Payload too large',
}

const ERROR_CODE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/

/** The code without its status suffix when `text` is a machine code, else null. */
export function errorCode(text: string): string | null {
  if (!ERROR_CODE.test(text)) return null
  return text.replace(/_\d{3}$/, '')
}

/**
 * The message the user sees for text from outside the product: a known code's
 * message, text the catalog already has, or `fallback` for anything else.
 */
export function productMessage(text: string, fallback: ErrorText): ErrorMessage {
  const code = errorCode(text)
  if (code && code in ERROR_CODE_MESSAGES) return ERROR_CODE_MESSAGES[code]
  if (resolve(new Message(text))) return new Message(text)
  return fallback
}

const fill = (template: string, params: Params) =>
  template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole))

/** The English text, used for `Error.message` and the server log. */
export function englishMessage(message: ErrorMessage): string {
  return typeof message === 'string' ? message : fill(message.template, message.params)
}

const catalog: Record<string, string> = ZH_ERROR_MESSAGES
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const templatePatterns = Object.keys(catalog)
  .filter((key) => /\{\w+\}/.test(key))
  .map((key) => {
    const names = [...key.matchAll(/\{(\w+)\}/g)].map((match) => match[1])
    const source = key
      .split(/\{\w+\}/)
      .map(escapeRegExp)
      .join('(.+?)')
    return { key, names, pattern: new RegExp(`^${source}$`) }
  })

// Finds the catalog entry behind already-filled English text, so text that arrives
// as a plain string (a domain error, an adapter result) is still translated.
function resolve(message: ErrorMessage): { template: string; params: Params } | null {
  const template = typeof message === 'string' ? message : message.template
  const params = typeof message === 'string' ? {} : message.params
  if (template in catalog) return { template, params }
  for (const entry of templatePatterns) {
    const match = entry.pattern.exec(template)
    if (match) return { template: entry.key, params: Object.fromEntries(entry.names.map((n, i) => [n, match[i + 1]])) }
  }
  return null
}

/** True when `text` is exactly a catalog key, so it has text in every language. */
export const isCatalogMessage = (text: string) => Object.hasOwn(catalog, text)

/** The message in the requested language, falling back to English. */
export function localizeMessage(message: ErrorMessage, language: ErrorLanguage): string {
  if (language === 'en') return englishMessage(message)
  const resolved = resolve(message)
  if (!resolved) return englishMessage(message)
  return fill(catalog[resolved.template], resolved.params)
}
