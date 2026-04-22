# ZPan 2.0 Roadmap

> **The open-source, S3-native file hosting platform.**
> Free to self-host. One-click deploy to Cloudflare. Image hosting, file sharing, and backup — all in one.

## Product Positioning

ZPan is a lightweight file hosting platform built on S3-compatible storage. Not a full cloud drive (Cloudreve), not a storage aggregator (Alist).

Three scenarios, one platform:

- **Image Hosting** — Upload via PicGo / uPic / ShareX / API, get a permanent URL on your own domain
- **File Sharing** — Upload, generate a link, distribute
- **File Backup & Sync** — CLI agent syncs local directories to S3/R2

## Target Users

- Developers and bloggers who need a reliable image bed
- Indie devs / small teams distributing files and releases
- Screenshot workflow users (ShareX, Flameshot, PicGo)
- NAS / desktop users who want off-site backup to S3
- Self-hosters who want a web UI for their S3 buckets

## Release Plan

Each version ships 1–2 major features. Ship small, ship often.

| Version | Focus | Details |
|---------|-------|---------|
| [v2.0](docs/roadmap/v2.0.md) | **Foundation** | File management + basic auth + dual deployment |
| [v2.1](docs/roadmap/v2.1.md) | **Auth & Access** | Social login, OIDC, invite codes, registration controls |
| [v2.2](docs/roadmap/v2.2.md) | **Teams** | Team workspaces, shared folders, member roles |
| [v2.3](docs/roadmap/v2.3.md) | **Sharing** | Share links, direct links, password / expiration / limits |
| [v2.4](docs/roadmap/v2.4.md) | **Image Hosting** | Upload API, PicGo / uPic / ShareX integration, custom domain |
| [v2.5](docs/roadmap/v2.5.md) | **Multi-Platform Deployment** | 7 first-class targets via Turso (CF, Docker, AWS Lambda, Vercel, Netlify, Azure, GCP); avatar upload |
| [v2.6](docs/roadmap/v2.6.md) | **Backup** | zpan-cli (Rust) one-way backup for NAS / desktop |
| [v2.7](docs/roadmap/v2.7.md) | **Sync & Desktop** | Bidirectional sync + Tauri desktop tray app |
| [v2.8](docs/roadmap/v2.8.md) | **Managed Service** | Payments, analytics, webhooks, audit log, site branding (white-label) |
| [v2.9](docs/roadmap/v2.9.md) | **Managed Advanced** | Content moderation, server-side processing, custom domain provisioning |

## Deployment Options

v2.0–v2.4 ship on two runtimes. v2.5 expands to seven.

- **Cloudflare Workers** — Zero-ops, free tier covers personal use, one-click deploy (all versions)
- **Docker** — Self-hosted, bring your own S3, full control (all versions)
- **AWS Lambda** — For teams on AWS; SAM template + GitHub Actions workflow ([docs](docs/deploy/aws-lambda.md)) (v2.5+)
- **Vercel** — One-click "Deploy to Vercel" via GitHub (v2.5+)
- **Netlify** — One-click "Deploy to Netlify" (v2.5+)
- **Azure Functions** — Bicep template; for Azure-mandated environments (v2.5+)
- **Google Cloud Run** — Container-based; reuses the Docker image (v2.5+)

Same codebase, same features, seven runtimes. Turso provides the database for every non-CF target (9 GB free tier, no credit card). Object storage is decoupled — users bring any S3-compatible bucket (R2, S3, B2, Tigris), which is what makes Azure and GCP viable targets without adapting to their non-S3 native blob stores.

## Free vs Paid

**Self-hosted: Full-featured, always free.** Every feature from v2.0 through v2.7 ships with zero restrictions — file management, sharing, auth, backup, sync, teams, branding. No artificial limits, no feature gating.

**Managed version: Convenience + platform-exclusive capabilities.** Charges for managed R2 hosting and features that require server-side infrastructure (analytics, webhooks, audit log, content moderation, server-side processing). See [v2.8](docs/roadmap/v2.8.md) and [v2.9](docs/roadmap/v2.9.md) for pricing details.

## v1 Issues Addressed

See each version document for the specific issues resolved.
