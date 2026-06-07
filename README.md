# ZPan

**The open-source, S3-native file hosting platform.**

[![CI](https://github.com/saltbo/zpan/actions/workflows/ci.yml/badge.svg)](https://github.com/saltbo/zpan/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/saltbo/zpan/graph/badge.svg)](https://codecov.io/gh/saltbo/zpan)
[![Release](https://github.com/saltbo/zpan/actions/workflows/release.yml/badge.svg)](https://github.com/saltbo/zpan/actions/workflows/release.yml)
[![GitHub Release](https://img.shields.io/github/v/release/saltbo/zpan)](https://github.com/saltbo/zpan/releases/latest)
[![Docker Image](https://img.shields.io/badge/ghcr.io-saltbo%2Fzpan-blue)](https://ghcr.io/saltbo/zpan)
[![License](https://img.shields.io/github/license/saltbo/zpan.svg)](https://github.com/saltbo/zpan/blob/master/LICENSE)

> A restrained S3 web drive for image hosting, file sharing, and direct-to-object-storage workflows.

## What is ZPan?

ZPan is a lightweight file hosting platform built on top of S3-compatible storage. Files upload directly from the client to S3 through presigned URLs, bypassing server bandwidth entirely. The server is the control plane: auth, metadata, shares, quotas, teams, WebDAV, tool integrations, and admin operations.

The product boundary is intentional: ZPan is an S3-native web drive, not a wrapper around every consumer cloud drive and not a full groupware suite. You bring an S3-compatible bucket; ZPan gives it a clean web UI, public sharing, image-hosting APIs, and deployment options that do not require a VPS or NAS.

**Core scenarios:**

- **S3 web drive** — Manage files, folders, previews, trash, quotas, and team workspaces on top of your own object storage
- **Image hosting** — Upload via PicGo, PicList, uPic, ShareX, Flameshot, or API and get a stable URL instantly
- **File sharing** — Publish share links with password, expiration, download limits, direct links, and save-to-drive flows
- **Personal homepage** — Give each user a public `/u/username` page for curated shared files and folder-style browsing
- **External access** — Mount files through WebDAV and run downloader workers for remote-download workflows

## Why ZPan?

**S3 only, by design.** ZPan does not chase every net-disk provider or build a cloud-drive nesting layer. The storage contract stays simple and durable: S3-compatible buckets such as Cloudflare R2, AWS S3, Backblaze B2, MinIO, RustFS, Tigris, and other S3-compatible services.

**Serverless native.** ZPan is built around Cloudflare Workers, D1, Hono, and web-standard APIs, with Docker and other runtimes as additional deployment targets. You can run a real file-hosting control plane without owning a VPS, keeping a NAS online, or proxying uploads through a long-running server.

**Direct transfer path.** Uploads and downloads use presigned object-storage URLs whenever possible. That keeps server bandwidth low, avoids a central file-transfer bottleneck, and lets object storage do the heavy lifting.

**Practical file workflows.** ZPan includes a web file manager, public sharing, image-hosting configuration, API keys, WebDAV access, teams, quotas, remote-download tasks, file previews, and admin controls without turning into a provider-aggregation platform.

**Deployable downloader workers.** Remote download does not have to run inside the main ZPan instance. You can deploy the downloader together with ZPan for a simple setup, or run it separately in an environment with better network access and fewer source-site restrictions, then let ZPan import the completed files into object storage.

## Product Boundaries

ZPan is a good fit when you want:

- A restrained S3-backed web drive instead of a storage-provider zoo
- A self-hosted image bed and file-sharing app backed by your own bucket
- Cloudflare-native deployment without maintaining a VPS or NAS
- Browser-to-S3 transfers instead of app-server file proxying
- Tool integrations for screenshot, publishing, WebDAV, remote download, and API-driven workflows

ZPan is not trying to be:

- A real-time document co-editing suite like Nextcloud Office
- A general-purpose cloud-drive aggregator like AList
- A local server directory browser like File Browser

## How ZPan Compares

Most self-hosted file projects start from either server files, desktop sync, collaboration, or many-provider aggregation. ZPan starts from S3-compatible object storage and a serverless-friendly control plane.

| Capability | **ZPan** | [Cloudreve](https://docs.cloudreve.org/en/) | [AList](https://alist-repo.github.io/docs/guide/drivers/) | [Nextcloud](https://nextcloud.com/files/) | [Seafile](https://www.seafile.com/en/features/) | [File Browser](https://github.com/filebrowser/filebrowser) |
|------------|----------|------------|--------|-----------|---------|--------------|
| S3-native product focus | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| S3-compatible storage backend | ✅ | ✅ | ✅ | ✅ | ⚠️ | ❌ |
| Direct browser-to-object-storage path | ✅ | ⚠️ | ⚠️ | ❌ | ❌ | ❌ |
| Cloudflare Workers native | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| No VPS/NAS required | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| PicGo/ShareX image-hosting workflow | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Per-user public file homepage | ✅ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ❌ |
| Remote download workflow | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Separately deployable downloader/node | ✅ | ✅ | ⚠️ | ❌ | ❌ | ❌ |
| Multi net-disk aggregation | ❌ | ❌ | ✅ | ⚠️ | ❌ | ❌ |
| Server local directory as primary file root | ❌ | ⚠️ | ⚠️ | ⚠️ | ❌ | ✅ |
| Real-time document co-editing | ❌ | ❌ | ❌ | ✅ | ⚠️ | ❌ |
| Dedicated sync clients | Planned | ❌ | ❌ | ✅ | ✅ | ❌ |
| Team/workspace model | ✅ | ⚠️ | ❌ | ✅ | ✅ | ❌ |
| WebDAV access | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Share links | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Docker deployment | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

Legend: ✅ first-class or core capability; ⚠️ partial, edition-dependent, or not the product's main focus; ❌ not a core capability.

## Deploy

### Cloudflare Workers (Recommended)

Deploy via GitHub Actions with zero server management. Free tier covers personal use.

1. **Fork** this repository
2. In your fork, go to **Settings → Secrets and variables → Actions** and add:
   - `CLOUDFLARE_ACCOUNT_ID` — found on the [Cloudflare dashboard](https://dash.cloudflare.com/) sidebar
   - `CLOUDFLARE_API_TOKEN` — create one [here](https://dash.cloudflare.com/profile/api-tokens) with **Workers Scripts:Edit**, **D1:Edit**, and **R2 Storage:Edit** permissions (R2 scope is needed to auto-provision the avatar/logo bucket)
3. Go to the **Actions** tab, select **Deploy to Cloudflare Workers**, and click **Run workflow**

After initial setup, the workflow runs automatically every time you sync your fork with the latest release.

### AWS Lambda

Deploy via GitHub Actions using SAM. Lambda Function URL provides HTTPS with no API Gateway needed.

1. **Fork** this repository
2. In your fork, go to **Settings → Secrets and variables → Actions** and add:
   - `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` — from [Turso](https://turso.tech) (free, no credit card)
   - `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`
3. Go to the **Actions** tab, select **Deploy to AWS Lambda**, and click **Run workflow**

See [docs/deploy/aws-lambda.md](docs/deploy/aws-lambda.md) for full setup instructions and IAM permissions.

### Docker

**Quick start** — pull the pre-built image and bring your own S3 storage:

```bash
curl -O https://raw.githubusercontent.com/saltbo/zpan/master/deploy/docker-compose.yml
docker compose up -d
```

**With RustFS** (self-hosted S3-compatible storage, no external dependencies):

```bash
curl -O https://raw.githubusercontent.com/saltbo/zpan/master/deploy/docker-compose.rustfs.yml
docker compose -f docker-compose.rustfs.yml up -d
```

After startup:

1. Open the RustFS console at `http://localhost:9001` (admin / admin123) and create a bucket (e.g. `zpan-bucket`)
2. Open ZPan at `http://localhost:8222`, register a user (first user gets admin role)
3. Go to **Admin → Storage** and add the RustFS storage:
   - **Endpoint**: `http://localhost:9000` (must be reachable from your browser, not the Docker internal hostname)
   - **Bucket**: the bucket name you created in step 1
   - **Region**: `us-east-1`
   - **Access Key / Secret Key**: `admin` / `admin123`

> **Important:** The storage endpoint must be accessible from the **client browser**, since files upload directly to S3 via presigned URLs. Use `http://localhost:9000` for local development, or your server's public URL for production.

## Documentation

- [Roadmap](V2_ROADMAP.md)
- [Contributing](CONTRIBUTING.md)

## v1

Looking for ZPan v1 (Go version)? See the [v1 branch](https://github.com/saltbo/zpan/tree/v1).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

Thank you to all the people who contributed to ZPan!

<a href="https://github.com/saltbo/zpan/graphs/contributors"><img src="https://opencollective.com/zpan/contributors.svg?width=890" /></a>

## License

ZPan is under the GNU Affero General Public License v3.0. See the
[LICENSE](LICENSE) file for details.
