<p align="center">
  <img src="../../public/logo.png" alt="ZPan logo" width="128" height="128" />
</p>

<h1 align="center">ZPan</h1>

<p align="center">
  <strong>面向 S3-compatible 存储的开源文件托管服务。</strong>
</p>

<p align="center">
  部署在 Cloudflare Workers 或 Docker 上。文件直传对象存储。
</p>

<p align="center">
  <a href="https://github.com/saltbo/zpan/actions/workflows/ci.yml"><img src="https://github.com/saltbo/zpan/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://codecov.io/gh/saltbo/zpan"><img src="https://codecov.io/gh/saltbo/zpan/graph/badge.svg" alt="codecov" /></a>
  <a href="https://github.com/saltbo/zpan/actions/workflows/release.yml"><img src="https://github.com/saltbo/zpan/actions/workflows/release.yml/badge.svg" alt="Release" /></a>
  <a href="https://github.com/saltbo/zpan/releases/latest"><img src="https://img.shields.io/github/v/release/saltbo/zpan" alt="GitHub Release" /></a>
  <a href="https://ghcr.io/saltbo/zpan"><img src="https://img.shields.io/badge/ghcr.io-saltbo%2Fzpan-blue" alt="Docker Image" /></a>
  <a href="https://github.com/saltbo/zpan/blob/main/LICENSE"><img src="https://img.shields.io/github/license/saltbo/zpan.svg" alt="License" /></a>
</p>

<p align="center">
  <a href="../../README.md">English</a> ·
  <strong>简体中文</strong> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a> ·
  <a href="README.ru.md">Русский</a> ·
  <a href="README.es.md">Español</a> ·
  <a href="README.pt-BR.md">Português (BR)</a>
</p>

## ZPan 是什么？

ZPan 是一个构建在 S3-compatible 存储之上的轻量级文件托管平台。文件通过预签名 URL 从客户端直接上传到 S3，完全绕过服务器带宽。服务器作为控制平面，负责认证、元数据、分享、配额、团队、WebDAV、工具集成以及管理操作。

产品边界是刻意划定的：ZPan 是一个专为 S3 后端打造的 Web 网盘，而不是封装各种消费级云盘的工具，也不是一套完整的协同办公套件。你提供一个 S3-compatible 存储桶，ZPan 为它提供整洁的 Web 界面、公开分享、图床 API，以及无需 VPS 或 NAS 的部署方式。

**核心场景：**

- **S3 网盘** — 在你自己的对象存储之上管理文件、文件夹、预览、回收站、配额和团队工作区
- **图床** — 通过 PicGo、PicList、uPic、ShareX、Flameshot 或 API 上传，即刻获得稳定的 URL
- **文件分享** — 发布带密码、过期时间、下载次数限制、直链以及转存到网盘的分享链接
- **个人主页** — 为每个用户提供一个公开的 `/u/username` 页面，用于精选分享文件和文件夹式浏览
- **外部访问** — 通过 WebDAV 挂载文件，并运行下载节点以支持远程下载工作流

## 为什么选择 ZPan？

**专注 S3，源于设计。** ZPan 不追逐每一个网盘服务商，也不构建云盘嵌套层。存储契约始终保持简单而持久：Cloudflare R2、AWS S3、Backblaze B2、MinIO、RustFS、Tigris 等 S3-compatible 存储桶及其他 S3-compatible 服务。

**Cloudflare Workers 优先。** ZPan 围绕 Cloudflare Workers、D1、Hono 和 Web 标准 API 构建，并将 Docker 及其他运行时作为额外的部署目标。你无需拥有 VPS、维持 NAS 在线，也无需通过长驻服务器代理上传，就能运行一个真正的文件托管控制平面。

**直传路径。** 上传和下载尽可能使用预签名的对象存储 URL。这能保持服务器带宽处于低位，避免集中式文件传输瓶颈，并让对象存储承担繁重的工作。

**实用的文件工作流。** ZPan 包含 Web 文件管理器、公开分享、图床配置、API 密钥、WebDAV 访问、团队、配额、远程下载任务、文件预览和管理控制，而不会演变成一个服务商聚合平台。

**可独立部署的下载节点。** 远程下载不必在主 ZPan 实例内运行。你可以将下载节点与 ZPan 一起部署以获得简单的配置，也可以将它单独部署在网络访问更佳、源站限制更少的环境中，再让 ZPan 把已完成的文件导入对象存储。

## 产品边界

如果你想要以下这些，ZPan 会很合适：

- 一个专注的 S3 后端 Web 网盘，而不是一堆存储服务商的大杂烩
- 一个由你自己的存储桶支撑的自托管图床和文件分享应用
- Cloudflare 原生部署，无需维护 VPS 或 NAS
- 浏览器到 S3 的传输，而不是应用服务器代理文件
- 面向截图、发布、WebDAV、远程下载和 API 驱动工作流的工具集成

ZPan 并不打算成为：

- 像 Nextcloud Office 那样的实时文档协同编辑套件
- 像 AList 那样的通用云盘聚合器
- 像 File Browser 那样的本地服务器目录浏览器

## ZPan 对比

大多数自托管文件项目的出发点要么是服务器文件、桌面同步、协作，要么是多服务商聚合。而 ZPan 的出发点是 S3-compatible 对象存储和对 Cloudflare Workers 友好的控制平面。

| 能力 | **ZPan** | [Cloudreve](https://docs.cloudreve.org/en/) | [AList](https://alist-repo.github.io/docs/guide/drivers/) | [Nextcloud](https://nextcloud.com/files/) | [Seafile](https://www.seafile.com/en/features/) | [File Browser](https://github.com/filebrowser/filebrowser) |
|------------|----------|------------|--------|-----------|---------|--------------|
| 专注 S3 后端的产品定位 | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| S3-compatible 存储后端 | ✅ | ✅ | ✅ | ✅ | ⚠️ | ❌ |
| 浏览器到对象存储的直传路径 | ✅ | ⚠️ | ⚠️ | ❌ | ❌ | ❌ |
| Cloudflare Workers 部署 | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 无需 VPS/NAS | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| PicGo/ShareX 图床工作流 | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 每用户公开文件主页 | ✅ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ❌ |
| 远程下载工作流 | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| 可独立部署的下载节点 | ✅ | ✅ | ⚠️ | ❌ | ❌ | ❌ |
| 多网盘聚合 | ❌ | ❌ | ✅ | ⚠️ | ❌ | ❌ |
| 服务器本地目录作为主文件根 | ❌ | ⚠️ | ⚠️ | ⚠️ | ❌ | ✅ |
| 实时文档协同编辑 | ❌ | ❌ | ❌ | ✅ | ⚠️ | ❌ |
| 专用同步客户端 | 计划中 | ❌ | ❌ | ✅ | ✅ | ❌ |
| 团队/工作区模型 | ✅ | ⚠️ | ❌ | ✅ | ✅ | ❌ |
| WebDAV 访问 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| 分享链接 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Docker 部署 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

图例：✅ 一流或核心能力；⚠️ 部分支持、依赖版本，或非产品主要关注点；❌ 非核心能力。

## 部署

### Cloudflare Workers（推荐）

通过 GitHub Actions 部署，无需任何服务器管理。免费额度足以覆盖个人使用。

1. **Fork** 本仓库
2. 在你的 fork 中，进入 **Settings → Secrets and variables → Actions** 并添加：
   - `CLOUDFLARE_ACCOUNT_ID` — 可在 [Cloudflare 控制台](https://dash.cloudflare.com/) 侧边栏找到
   - `CLOUDFLARE_API_TOKEN` — 在[这里](https://dash.cloudflare.com/profile/api-tokens)创建一个，并赋予 **Workers Scripts:Edit**、**D1:Edit** 和 **R2 Storage:Edit** 权限（R2 权限用于自动创建头像/Logo 存储桶）
3. 进入 **Actions** 标签页，选择 **Deploy to Cloudflare Workers**，然后点击 **Run workflow**

完成初始设置后，每次你将 fork 与最新版本同步时，该工作流都会自动运行。

WebDAV 独立域名：先在管理后台启用 WebDAV，并按需配置自定义域名，再为 API Token 增加 **Transform Rules:Edit** 权限。域名留空时，若主站 Worker Custom Domain 为 `files.example.com`，部署流程会自动绑定并验证 `dav.files.example.com`，管理根路径到 `/dav` 的 rewrite，并记录可用状态。其他部署方式可在手动配置 DNS/代理后，通过**管理后台 → 设置 → WebDAV**完成验证。验证成功前，ZPan 会继续公布原有 `/dav/` 入口。详见 [WebDAV 自定义域名](../webdav-custom-domain.md)。

### AWS Lambda

通过 GitHub Actions 使用 SAM 部署。Lambda Function URL 直接提供 HTTPS，无需 API Gateway。

1. **Fork** 本仓库
2. 在你的 fork 中，进入 **Settings → Secrets and variables → Actions** 并添加：
   - `TURSO_DATABASE_URL` 和 `TURSO_AUTH_TOKEN` — 来自 [Turso](https://turso.tech)（免费，无需信用卡）
   - `AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY`、`AWS_REGION`
3. 进入 **Actions** 标签页，选择 **Deploy to AWS Lambda**，然后点击 **Run workflow**

完整的设置说明和 IAM 权限详见 [docs/deploy/aws-lambda.md](../deploy/aws-lambda.md)。

### Docker

**快速开始** — 拉取预构建镜像并自带 S3 存储：

```bash
curl -O https://raw.githubusercontent.com/saltbo/zpan/main/deploy/docker-compose.yml
docker compose up -d
```

**搭配 RustFS**（自托管的 S3-compatible 存储，无外部依赖）：

```bash
curl -O https://raw.githubusercontent.com/saltbo/zpan/main/deploy/docker-compose.rustfs.yml
docker compose -f docker-compose.rustfs.yml up -d
```

启动后：

1. 打开 RustFS 控制台 `http://localhost:9001`（admin / admin123）并创建一个存储桶（例如 `zpan-bucket`）
2. 打开 ZPan `http://localhost:8222`，注册一个用户（第一个用户将获得管理员角色）
3. 进入 **Admin → Storage** 并添加 RustFS 存储：
   - **Endpoint**：`http://localhost:9000`（必须能从你的浏览器访问，而不是 Docker 内部主机名）
   - **Bucket**：你在第 1 步中创建的存储桶名称
   - **Region**：`us-east-1`
   - **Access Key / Secret Key**：`admin` / `admin123`

> **重要：** 存储端点必须能从**客户端浏览器**访问，因为文件通过预签名 URL 直接上传到 S3。本地开发使用 `http://localhost:9000`，生产环境则使用你服务器的公网 URL。

## 文档

- [路线图](../../V2_ROADMAP.md)
- [贡献指南](../../CONTRIBUTING.md)

## v1

在寻找 ZPan v1（Go 版本）？请查看 [v1 分支](https://github.com/saltbo/zpan/tree/v1)。

## 贡献

详情请参阅 [CONTRIBUTING.md](../../CONTRIBUTING.md)。

感谢所有为 ZPan 做出贡献的人！

<a href="https://github.com/saltbo/zpan/graphs/contributors"><img src="https://opencollective.com/zpan/contributors.svg?width=890" /></a>

## 许可证

ZPan 采用 GNU Affero General Public License v3.0 许可证。详见
[LICENSE](../../LICENSE) 文件。
