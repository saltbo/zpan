## v2.8.0 — 2026-07-24 · 管理分析与运维

### 新功能
- **管理分析仪表盘** — 提供实时运维指标卡和可信的小时级汇总，覆盖存储、
  流量、用户、分享、远程下载与后台任务，并包含趋势图、数据覆盖提示和回填工具。
- **存储运维** — 重新设计存储后端管理，新增供应商预设、连接测试、请求预览、
  分类用量预测、文件位置追踪和更安全的清理流程。
- **空间与配额** — 工作区设置现在明确分离成员、服务、计费和图床，并优化
  配额归属与跨空间文件操作。
- **公开主页与分享** — 重新设计公开页面，可在用户主页中直接展示精选分享。
- **WebDAV 管理** — 新增服务开关与可选自定义域名，并支持自动推导和验证域名。
- **API 与事件** — 完整的 OpenAPI 覆盖和 Scalar 文档、统一的资源模型与
  错误格式，以及替代前端轮询的统一 SSE 事件流。
- **更多改进** — 管理端用户/团队活动流、更好用的审计筛选、远程下载事件时间线、
  NFO 预览、可配置的邮箱验证，以及记住上次登录方式。

### 修复
- 全面改进远程下载节点的进程监管、心跳恢复、做种、重试、积分预授权、
  进度上报和清理。
- 分析数据现在仅使用有边界且已完成的汇总；历史数据不完整时会明确提示，
  不再静默混入部分或实时数据。
- 修复非 ASCII 文件名的上传元数据，并在上传后同步已存储的内容类型。
- 改进 Finder 的 WebDAV 兼容性、活动文件夹保护、弹窗溢出和文件夹树折叠。

> **破坏性变更：** API 路径与响应结构现已统一为面向资源的形式；错误采用
> 统一格式，删除操作返回 `204 No Content`，状态变更使用资源状态端点。
> 落地页分享现在默认公开访问，除非明确配置为私有。

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.8.0)

## v2.7.4 — 2026-06-11

### 新功能
- 无需配置 `TRUSTED_ORIGINS`，即可自动信任回环地址与局域网来源。
- 云端授权配对提供更清晰的配置、错误信息和确认流程。
- 结账时可输入优惠码。

### 修复
- 消除跨请求会话初始化卡死，并加入更快的客户端会话缓存。
- 非 ASCII 上传文件名现在可安全用于 `Content-Disposition`。
- 重复结账时会自动取消过期的待处理订单。
- 管理端表单可正确处理默认配额值。
- D1 查询失败时会记录完整的底层原因链。

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.7.4)

## v2.7.3 — 2026-06-09

### 新功能
- **关于页面** — 全新的管理端关于页面，展示实例信息、版本和授权版本，
  内置更新日志抽屉，并对照 GitHub Releases 检查最新版本。
- **商业授权** — 支持独立的商业授权，在管理后台布局中加入版本角标，
  并按能力分组的版本对照表（含社交登录与下载器的功能门槛）。
- **权益管理** — 管理员现在可以编辑和撤销已发放的配额权益。
- **实例遥测** — 可选的匿名部署信息上报（含 GeoIP 区域），
  帮助我们了解 ZPan 的实际运行情况。

### 修复
- 更稳健的远程下载用量计费。
- 修复 Docker 镜像启动问题（并在 CI 中加以守护），下载器注册改用宿主机主机名。
- 更快的管理端配额列表 —— 批量查询（按 D1 的 100 参数上限分块），
  并将每月重置改为定时任务。
- 应用版本现在从 `package.json` 解析，并在构建时注入。

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.7.3)

## v2.7.2 — 2026-06-07

### 新功能
- 全新的 ZPan logo 与品牌形象。

### 修复
- 远程下载节点的数据卷现在在 Docker 中可写。

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.7.2)

## v2.7.1 — 2026-06-07

### 新功能
- 可在管理界面中重命名你的远程下载节点。

### 修复
- 更可靠的下载节点分配以及更准确的传输速度上报。
- 暴露 torrent 监听端口，并在 Docker 中为下载节点使用宿主机主机名。

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.7.1)

## v2.7.0 — 2026-06-06 · 远程下载、WebDAV 及更多

### 新功能
- **远程下载管理器** — 将 torrent/HTTP 下载卸载到远程节点，
  配有详尽的任务检视器、节点地理区域、BT 做种保留，以及
  保留文件夹结构地回传到你的网盘。
- **`zpan` CLI 下载器** — 一条命令完成设备登录，并支持自定义服务器 URL。
- **WebDAV 访问** — 通过 WebDAV 挂载你的网盘，支持每用户应用密码
  （兼容 RFC 4918 Class 2）。
- **服务端打包** — 将流式 ZIP 任务排入队列，并在全新的
  后台任务页面中跟踪它们。
- 在 Web 界面中支持**文件夹上传**。
- **云端积分** — 计量的存储出口流量通过积分计费，并配有积分商店。
- 为登录和注册提供**验证码**保护。
- 统一的 API 密钥管理。

### 修复
- 加固了远程下载的生命周期（重置、恢复和做种处理），
  以及若干预览和上传修复。

> **破坏性变更：** 更严格的 RESTful API 路由；公开下载链接从
> `/dl/:token` 改为 `/r/:token`。

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.7.0)

## v2.6.2 — 2026-05-11

### 新功能
- 管理端：云端订单详情抽屉。

### 修复
- 存储套餐表格布局、礼品卡掩码，以及结账/订单历史对话框。

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.6.2)

## v2.6.1 — 2026-05-10

### 修复
- 结账跳转流程以及侧边栏存储配额显示。

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.6.1)

## v2.6.0 — 2026-05-10 · Pro 授权与配额商店

### 新功能
- **Pro 授权** — 将你的实例与 ZPan Cloud 配对（二维码 + 配对弹窗），
  基于 Ed25519 验证的权益并支持后台刷新，以及 Pro 功能门控。
- **白标品牌** — 自定义 logo、favicon、文字标识，以及隐藏页脚。
- **配额商店** — 兑换码、每月流量配额、订阅制与
  固定配额套餐、按币种计量的定价，以及流量超额。
- **管理端** — 覆盖状态变更操作的审计日志、站点公告、
  基于邀请的注册，以及重新设计的设置与概览仪表盘。
- 文件预览新增 Microsoft Office 查看器、音乐播放器，以及多文件
  上传进度队列。

### 修复
- 将计费移入管理面板；管理端中的配额单位、用户配额和头像。
- 后台同步云端流量用量；对下载链接强制执行每月流量限制。

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.6.0)

## v2.5.0 — 2026-04-23 · 随处部署

### 新功能
- **新的部署目标** — AWS Lambda、Vercel、Netlify、Azure Functions，以及
  Google Cloud Run。
- **libSQL (Turso)** 数据库适配器，并提供可选的 Docker 配置。
- 在设置 → 个人资料中支持头像上传。
- 图片上传优先使用 Cloudflare R2 绑定，回退到 S3。

### 修复
- 统一了各设置标签页的视觉设计，并补齐了缺失的头像 i18n。

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.5.0)

## v2.4.1 — 2026-04-22

### 修复
- 解决了 Docker 在 8222 端口上的 404，并简化了镜像构建。

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.4.1)

## v2.4.0 — 2026-04-22 · 图床

### 新功能
- **图床** — 专属图库，支持两阶段/流式代理上传、
  自定义域名（Cloudflare for SaaS），以及设置页面。
- **工具集成** — 为 PicGo、uPic 和 ShareX 提供开箱即用的配置。
- 用于程序化上传的 API 密钥认证。

### 修复
- 修正了 PicGo / uPic / ShareX 配置、草稿图片过滤，以及
  大文件/分片上传错误。

> **破坏性变更：** 公开链接统一到 `/r/:token` 下。

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.4.0)

## v2.3.0 — 2026-04-21 · 分享

### 新功能
- **文件与文件夹分享** — 公开分享页面（`/s/:token`），支持落地页与
  直链模式、可选的自动生成密码，以及文件夹浏览。
- **转存到网盘** — 跨工作区复制分享文件，并处理配额与
  命名冲突。
- **应用内通知**以及专属的分享仪表盘。
- Google 配色 UI 重新设计；通知铃移至顶部栏。

### 修复
- Finder 风格的命名冲突解决、分享密码错误时返回正确的 403，
  以及对公开浏览量去重。

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.3.0)

## v2.2.0 — 2026-04-19 · 团队

### 新功能
- **团队工作区** — 创建和管理团队、成员和角色，配有
  组织级 RBAC。
- 侧边栏中的工作区切换器以及每团队活动流。
- 通过邮件和邀请链接发起**团队邀请**。
- 位于 `/u/:username` 的公开用户主页。

### 修复
- 团队列表筛选与成员计数；将团队入口移入头像菜单。

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.2.0)

## v2.1.0 — 2026-04-14 · 认证与入门引导

### 新功能
- **动态 OAuth 提供商**、带验证的邮箱/密码登录，以及可配置的
  注册模式。
- **邀请码**注册门控。
- 邮件服务抽象（SMTP + HTTP API 驱动）。
- 登录/注册 UI 大改版以及管理端认证设置页面。

### 修复
- 邀请码校验以及侧边栏深色模式渲染。

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.1.0)

## v2.0.2 — 2026-04-12

### 新功能
- 适配桌面、平板和移动端的响应式布局，并提供自适应的移动端预览。

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.0.2)

## v2.0.1 — 2026-04-12

### 新功能
- 迁移到 Cloudflare Workers，并提供一键部署按钮。

### 修复
- Cloudflare Workers 的部署与认证配置（baseURL/受信任
  来源推断、`nodejs_compat_v2`）。

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.0.1)

## v2.0.0 — 2026-04-12 · TypeScript 重写

### 新功能
- 从 Go 完全重写为 TypeScript：Hono API + React SPA，可同时部署在
  Cloudflare Workers 和 Node/Docker 上。
- 通过预签名 URL 实现直传 S3，配有自定义文件管理器（含文件夹树、
  搜索）以及回收站。
- 支持图片、PDF、代码、音频和视频的文件预览。
- 管理端用户/存储/配额管理、每组织存储配额，以及 i18n（en/zh）。

### 修复
- 服务端全局搜索（按回车触发）以及媒体预览渲染。

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.0.0)

---

v1 的更新日志请查看 [v1 分支](https://github.com/saltbo/zpan/tree/v1/CHANGELOG.md)。
