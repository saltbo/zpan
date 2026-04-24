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
| [v2.6](docs/roadmap/v2.6.md) | **Pro Launch** | License system, Stripe self-service purchase, redemption codes, white-label, retroactive Pro gates on operator-grade v2.x features |
| [v2.7](docs/roadmap/v2.7.md) | **Pro Operator** | Audit log, webhooks, anti-abuse stack for open registration |
| [v2.8](docs/roadmap/v2.8.md) | **Pro Analytics & Identity** | Analytics dashboard, SSO enterprise (multi-IdP OIDC + SAML), LDAP / SCIM |
| [v2.9](docs/roadmap/v2.9.md) | **Backup** | zpan-cli (Rust) one-way backup for NAS / desktop |
| [v2.10](docs/roadmap/v2.10.md) | **Sync & Desktop** | Bidirectional sync + Tauri desktop tray app |

Managed cloud services (content moderation, server-side processing, managed custom domains) live in a separate closed-source repo and version independently. They are consumed by ZPan via HTTP, and do not affect self-hosted deployments that don't opt in.

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

## Community vs Pro

ZPan is split into two editions. Both run the same open-source codebase — Pro features are unlocked by a license token, Managed is Pro operated by us.

### ZPan Community (free, open source)

Everything an individual, family, or small team needs to self-host:

- File management, upload, download, browse, search
- Personal account + social login + basic OIDC (single IdP)
- Share links + password + expiration + download limits
- Image hosting API + PicGo / uPic / ShareX + custom domain
- Up to 3 team workspaces + shared folders + basic roles
- Backup CLI + desktop app + bidirectional sync
- All 7 deployment targets

No artificial limits, no functionality gated behind paywalls. If you are the administrator of your own instance, Community covers you.

### ZPan Pro (paid license)

Operator-grade features for running ZPan as a service (internally at a company, publicly as a product, or commercially for customers). The rule of thumb: **features that help you *use* ZPan are free; features that help you *operate* ZPan for others are Pro.**

- Open registration (the public signup mode) + anti-abuse tooling (captcha, rate limit, email verification)
- Audit logs + webhook notifications + analytics dashboard
- White-label (logo / favicon / wordmark / custom branding)
- SSO enterprise (multi-IdP OIDC + SAML), LDAP / SCIM provisioning
- Advanced RBAC / custom roles, retention policies
- Admin impersonation, per-user quotas, multi-tenant isolation

Pro is one product with two delivery modes:

- **Self-hosted Pro** — buy a license, run ZPan yourself. License token verified locally with an embedded public key; works offline.
- **Managed Pro** — same features, we operate the ZPan instance and storage. You stop caring about ops.

Licenses can be purchased self-service via Stripe or redeemed from codes issued by the ZPan team. See [v2.6](docs/roadmap/v2.6.md) for the launch plan.

**Retroactive gates.** A small number of features shipped in v2.0–v2.5 are operator-grade and become Pro-only starting in v2.6: `open` registration mode (from v2.1), a cap of 3 team workspaces (from v2.2), and admin-set per-team storage quotas (from v2.2). Closed / invite-only registration, single-IdP OIDC, all sharing and image-hosting features, and all deployment targets remain Community. See [v2.6](docs/roadmap/v2.6.md) for the complete list.

### Managed Cloud Services (separate repo)

A small set of Pro features depend on backend infrastructure we host: content moderation (third-party NSFW scanning), server-side processing (thumbnails, transcoding, archive extraction), and managed custom domains (SSL provisioning). Those services live in a separate closed-source repo (`zpan-cloud`) and version independently. Self-hosted Pro users call these services via HTTPS; usage included up to a monthly quota per plan, overage billed post-paid with a user-set hard cap.

### Pricing

Initial pricing target: a single Pro SKU with generous monthly quotas covering ~90% of users. Tiered plans (Team, Business) follow once Pro validates. Full pricing is in [v2.6](docs/roadmap/v2.6.md).

## v1 Issues Addressed

See each version document for the specific issues resolved.
