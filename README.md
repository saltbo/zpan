# ZPan

**The open-source, S3-native file hosting platform.**

[![CI](https://github.com/saltbo/zpan/actions/workflows/ci.yml/badge.svg)](https://github.com/saltbo/zpan/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/saltbo/zpan/graph/badge.svg)](https://codecov.io/gh/saltbo/zpan)
[![Release](https://github.com/saltbo/zpan/actions/workflows/release.yml/badge.svg)](https://github.com/saltbo/zpan/actions/workflows/release.yml)
[![GitHub Release](https://img.shields.io/github/v/release/saltbo/zpan)](https://github.com/saltbo/zpan/releases/latest)
[![Docker Image](https://img.shields.io/badge/ghcr.io-saltbo%2Fzpan-blue)](https://ghcr.io/saltbo/zpan)
[![License](https://img.shields.io/github/license/saltbo/zpan.svg)](https://github.com/saltbo/zpan/blob/master/LICENSE)

> Image bed, file sharing, and backup — powered by S3, deployed anywhere.

## What is ZPan?

ZPan is a lightweight file hosting platform built on top of S3-compatible storage. Files upload directly from the client to S3, bypassing server bandwidth entirely.

**Three scenarios, one platform:**

- **Image Bed** — Upload via PicGo / ShareX / API, get a URL instantly
- **File Sharing** — Upload files, generate share links, distribute to anyone
- **File Backup** — CLI agent syncs local directories to S3/R2

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

## Why ZPan?

- **Zero bandwidth bottleneck** — files transfer directly between client and S3
- **Zero ops option** — deploy to Cloudflare Workers for free, no server needed
- **Self-host friendly** — Docker deployment with any S3-compatible storage
- **Tool ecosystem** — works with PicGo, ShareX, Flameshot out of the box
- **Open source** — free forever for self-hosted users

## v1

Looking for ZPan v1 (Go version)? See the [v1 branch](https://github.com/saltbo/zpan/tree/v1).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

Thank you to all the people who contributed to ZPan!

<a href="https://github.com/saltbo/zpan/graphs/contributors"><img src="https://opencollective.com/zpan/contributors.svg?width=890" /></a>

## License

ZPan is under the GPL 3.0 license. See the [LICENSE](LICENSE) file for details.
