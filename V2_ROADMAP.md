# ZPan 2.0 Roadmap

> **The open-source, S3-native file hosting platform.**
> Free to self-host. One-click deploy to Cloudflare. Image hosting, file sharing, automation, and sync foundations — all in one.

## Product Positioning

ZPan is a lightweight file hosting platform built on S3-compatible storage. Not a full cloud drive (Cloudreve), not a storage aggregator (Alist).

Three scenarios, one platform:

- **Image Hosting** — Upload via PicGo / uPic / ShareX / API, get a permanent URL on your own domain
- **File Sharing** — Upload, generate a link, distribute
- **Automation & Sync** — Agent-friendly CLI for scripted file management, plus a server-side sync protocol for future desktop clients

## Target Users

- Developers and bloggers who need a reliable image bed
- Indie devs / small teams distributing files and releases
- Screenshot workflow users (ShareX, Flameshot, PicGo)
- Agents, CI workflows, and power users that need scriptable file upload and sharing
- Desktop users who want future sync clients backed by S3-compatible storage
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
| [v2.6](docs/roadmap/v2.6.md) | **Pro / Business Launch** | Cloud binding, entitlement system, white-label, audit log, quota store machinery, site announcements, retroactive gates |
| [v2.7](docs/roadmap/v2.7.md) | **WebDAV & File Processing** | WebDAV protocol access, small-file zip compression/extraction, and Community remote-download orchestration through Aria2, qBittorrent, and future adapters |
| [v2.8](docs/roadmap/v2.8.md) | **Admin Analytics & Dashboard** | Admin overview, usage/cost/reliability metrics, share analytics, and offline result coverage |
| [v2.9](docs/roadmap/v2.9.md) | **Agent CLI** | Scriptable CLI for agents and CI: upload/manage files, shares, spaces, quota, and tasks |
| [v2.10](docs/roadmap/v2.10.md) | **Desktop Sync Foundation** | Sync device model, change log, sync API contract, conflict model, and protocol tests for external clients |
| Future | **Native Client Projects** | macOS File Provider, Windows/Linux sync clients, Flutter/mobile clients, and other OS-specific apps in separate repositories |
| Future | **Enterprise Identity & Governance** | SAML, LDAP / SCIM, advanced RBAC/custom roles, retention, and admin support mode if demand proves real |

Managed cloud services (large archive processing, content moderation, server-side media processing, managed custom domains) live in a separate closed-source repo and version independently. They are consumed by ZPan via HTTP, and do not affect self-hosted deployments that don't opt in. Remote download is not a Cloud execution service; ZPan integrates with user-owned download engines instead.

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

## Community vs Pro vs Business

ZPan uses one open-source codebase with three entitlement levels. Community is
free. Pro and Business are unlocked through ZPan Cloud account binding and local
entitlement certificates. Managed is the hosted operation of the same product.

### ZPan Community (free, open source)

Everything an individual, family, or small team needs to self-host:

- File management, upload, download, browse, search
- Personal account + social login + basic OIDC (single IdP)
- Share links + password + expiration + download limits
- Image hosting API + PicGo / uPic / ShareX + custom domain
- WebDAV access for external file managers and sync tools
- One personal workspace plus one extra team workspace, shared folders, and basic roles
- Small-file zip compression and extraction within local runtime limits
- Remote-download orchestration through one user-configured downloader, with Aria2, qBittorrent, and future compatible adapters
- Agent-friendly CLI once v2.9 ships
- Desktop sync protocol foundation once v2.10 ships; actual native clients live in separate projects
- All 7 deployment targets

No basic personal file workflows are gated behind paywalls. Operator controls,
commercial workflows, and hosted compute-heavy workflows are paid-tier features
because they carry operational cost or platform-abuse risk.

### ZPan Pro (paid license)

Operator-grade features for running ZPan as a service (internally at a company, publicly as a product, or commercially for customers). The rule of thumb: **features that help you *use* ZPan are free; features that help you *operate* ZPan for others start in Pro.**

- Open registration (the public signup mode) + anti-abuse tooling (captcha, rate limit, email verification)
- White-label (logo / favicon / wordmark / custom branding)
- Audit logs
- Higher included limits for team workspaces, storage backends, social / OIDC providers, and downloaders

### ZPan Business (paid license)

Commercial and enterprise operations for teams that sell or centrally operate
ZPan.

- Quota store, subscription-plan catalog, gift-card / credit flows, and credit-backed traffic billing
- Site announcements
- Analytics dashboard backed by completed offline results
- Future webhook notifications and integration automation
- Future enterprise / legacy identity such as SAML, LDAP / SCIM, and group mapping if demand proves real
- Future advanced governance such as custom roles, retention policies, and admin support mode
- Future multi-tenant isolation and larger managed-processing quotas

Paid ZPan has two delivery modes:

- **Self-hosted Pro / Business** — buy a license, run ZPan yourself. The instance binds to ZPan Cloud for entitlement and verifies the issued certificate locally.
- **Managed** — Pro or Business features operated by us. You stop caring about ops.

Pro and Business are purchased or redeemed on ZPan Cloud, then mirrored to a
bound ZPan instance by signed entitlement certificates. See
[v2.6](docs/roadmap/v2.6.md) for the launch plan.

**Retroactive gates.** A small number of features shipped before or around the
Pro / Business launch are operator-grade and become paid-tier gated: `open`
registration mode, teams beyond the included extra team, storage backends beyond
the free limit, social / OIDC providers beyond the free limit, and downloaders
beyond the free limit. Closed / invite-only registration, one social / OIDC
provider, all sharing and image-hosting features, WebDAV, one downloader, small
archive processing, and all deployment targets remain Community.

### Managed Cloud Services (separate repo)

A small set of paid-tier features depend on backend infrastructure we host: large archive processing, content moderation (third-party NSFW scanning), server-side media/document processing, and managed custom domains (SSL provisioning). Those services live in a separate closed-source repo (`zpan-cloud`) and version independently. Self-hosted paid instances call these services via HTTPS; usage included up to a monthly quota per plan, post-included usage paid with unitless ZPan Cloud credits. Stripe subscriptions remain normal USD subscriptions; ZPan only receives entitlements and usage accept/reject decisions. Cloud does not run remote-download workers in the v2.7 plan.

### Pricing

Pricing starts with clear Pro and Business tiers: Pro covers operator limits and
basic paid self-hosting, while Business covers commerce, analytics, and higher
operational controls. Full pricing mechanics start in
[v2.6](docs/roadmap/v2.6.md) and expand with v2.8 analytics/reporting.

## v1 Issues Addressed

See each version document for the specific issues resolved.
