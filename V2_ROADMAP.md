# ZPan 2.0 Roadmap

> **The open-source, S3-native file hosting platform.**
> Free to self-host. One-click deploy to Cloudflare. Image bed, file sharing, and backup — all in one.

## Product Positioning

ZPan is a lightweight file hosting platform built on S3-compatible storage. Not a full cloud drive (Cloudreve), not a storage aggregator (Alist).

Three scenarios, one platform:

- **Image Bed** — Upload via PicGo / ShareX / API, get a URL
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

| Version                      | Focus                 | Details                                                                |
| ---------------------------- | --------------------- | ---------------------------------------------------------------------- |
| [v2.0](docs/roadmap/v2.0.md) | **Foundation**        | File management + basic auth + dual deployment                         |
| [v2.1](docs/roadmap/v2.1.md) | **Image Bed**         | Upload API, PicGo / ShareX integration                                 |
| [v2.2](docs/roadmap/v2.2.md) | **Sharing**           | Share links, direct links, password / expiration / limits              |
| [v2.3](docs/roadmap/v2.3.md) | **Auth & Access**     | Social login, OIDC, invite codes, registration controls                |
| [v2.4](docs/roadmap/v2.4.md) | **Branding & Polish** | Custom logo / title, dark mode, custom file domain                     |
| [v2.5](docs/roadmap/v2.5.md) | **Backup**            | zpan-cli (Rust) one-way backup for NAS / desktop                       |
| [v2.6](docs/roadmap/v2.6.md) | **Sync & Desktop**    | Bidirectional sync + Tauri desktop tray app                            |
| [v2.7](docs/roadmap/v2.7.md) | **Teams**             | Team workspaces, shared folders, member roles                          |
| [v2.8](docs/roadmap/v2.8.md) | **Managed Service**   | Payments, analytics, webhooks, audit log                               |
| [v2.9](docs/roadmap/v2.9.md) | **Managed Advanced**  | Content moderation, server-side processing, custom domain provisioning |

## Deployment Options

- **Cloudflare Pages** — Zero-ops, free tier covers personal use, one-click deploy
- **Docker** — Self-hosted, bring your own S3, full control

Same codebase, same features, two runtimes.

## Free vs Paid

**Self-hosted: Full-featured, always free.** Every feature from v2.0 through v2.7 ships with zero restrictions — file management, sharing, auth, backup, sync, teams, branding. No artificial limits, no feature gating.

**Managed version: Convenience + platform-exclusive capabilities.** Charges for managed R2 hosting and features that require server-side infrastructure (analytics, webhooks, audit log, content moderation, server-side processing). See [v2.8](docs/roadmap/v2.8.md) and [v2.9](docs/roadmap/v2.9.md) for pricing details.

## v1 Issues Addressed

See each version document for the specific issues resolved.
