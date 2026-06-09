# Changelog

Notable changes in each ZPan release, written from a user's perspective. Each
entry links to its full GitHub release notes for the technical, commit-level log.

The admin **About** page renders this file straight from `master` on GitHub in a
side drawer, so keep it product-facing. The "latest version" indicator on that
page comes from the newest published **GitHub Release**, not this file.

## v2.7.2 — 2026-06-07

- Refreshed ZPan logo and branding.
- Fixed a Docker issue where the remote downloader's data volume was not writable.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.7.2)

## v2.7.1 — 2026-06-07

- Rename your remote downloaders from the admin UI.
- More reliable downloader assignment and accurate transfer-speed reporting.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.7.1)

## v2.7.0 — 2026-06-06 · Remote downloads, WebDAV & more

- **Remote download manager** — offload torrent/HTTP downloads to remote workers,
  with a detailed task inspector, peer geo-regions, BT seed retention, and
  folder-preserving uploads back to your drive.
- **`zpan` CLI downloader** — one-command device-login and a configurable server URL.
- **WebDAV access** — mount your drive over WebDAV with per-user app passwords
  (RFC 4918 Class 2 compatible).
- **Server-side archiving** — queue streaming ZIP jobs and track them on a new
  background tasks page.
- **Folder uploads** in the web UI.
- **Cloud credits** — metered storage egress billed via credits, with a credits store.
- **Captcha** protection for sign-in and sign-up.
- Unified API-key management.
- **Breaking:** stricter RESTful API routes; public download links moved from
  `/dl/:token` to `/r/:token`.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.7.0)

## v2.6.2 — 2026-05-11

- Admin: cloud order details drawer.
- Stability fixes for storage plans and quota metering.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.6.2)

## v2.6.1 — 2026-05-10

- Bug fixes and stability improvements.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.6.1)

## v2.6.0 — 2026-05-10 · Pro licensing & quota store

- **Pro licensing** — pair your instance with ZPan Cloud (QR + pairing modal),
  Ed25519-verified entitlements with background refresh, and Pro feature gating.
- **White-label branding** — custom logo, favicon, wordmark, and hidden footer.
- **Quota store** — redemption codes, monthly traffic quotas, subscription and
  fixed-quota packages, per-currency metered pricing, and traffic overage.
- **Admin** — audit logs across state-changing actions, site announcements,
  invitation-based signup, and a redesigned settings & overview dashboard.
- File preview gains a Microsoft Office viewer, a music player, and a multi-file
  upload progress queue.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.6.0)

## v2.5.0 — 2026-04-23 · Deploy anywhere

- **New deployment targets** — AWS Lambda, Vercel, Netlify, Azure Functions, and
  Google Cloud Run.
- **libSQL (Turso)** database adapter, with an opt-in Docker configuration.
- Avatar upload in Settings → Profile.
- Prefer the Cloudflare R2 binding for image uploads, falling back to S3.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.5.0)

## v2.4.1 — 2026-04-22

- Bug fixes.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.4.1)

## v2.4.0 — 2026-04-22 · Image hosting

- **Image hosting** — a dedicated gallery with two-stage / stream-proxy uploads,
  custom domains (Cloudflare for SaaS), and a settings page.
- **Tool integrations** — ready-made configs for PicGo, uPic, and ShareX.
- API-key authentication for programmatic uploads.
- **Breaking:** public links unified under `/r/:token`.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.4.0)

## v2.3.0 — 2026-04-21 · Sharing

- **File & folder sharing** — public share pages (`/s/:token`) with landing and
  direct modes, optional auto-generated passwords, and folder browsing.
- **Save to Drive** — copy shared files across workspaces with quota and
  name-conflict handling.
- **In-app notifications** and a dedicated Shares dashboard.
- Google-palette UI redesign; notification bell moved to the header.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.3.0)

## v2.2.0 — 2026-04-19 · Teams

- **Team workspaces** — create and manage teams, members, and roles with
  org-level RBAC.
- Workspace switcher in the sidebar and a per-team activity feed.
- **Team invitations** via email and invite link.
- Public user homepage at `/u/:username`.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.2.0)

## v2.1.0 — 2026-04-14 · Auth & onboarding

- **Dynamic OAuth providers**, email/password with verification, and configurable
  registration modes.
- **Invite-code** registration gating.
- Email service abstraction (SMTP + HTTP API drivers).
- Sign-in / sign-up UI overhaul and an admin auth settings page.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.1.0)

## v2.0.2 — 2026-04-12

- Responsive layout for desktop, tablet, and mobile, with adaptive mobile preview.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.0.2)

## v2.0.1 — 2026-04-12

- Migrated to Cloudflare Workers with a one-click deploy button.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.0.1)

## v2.0.0 — 2026-04-12 · TypeScript rewrite

- Complete rewrite from Go to TypeScript: a Hono API + React SPA, deployable on
  both Cloudflare Workers and Node/Docker.
- Direct-to-S3 uploads via presigned URLs, a custom file manager with folder tree,
  search, and a recycle bin.
- File preview for images, PDF, code, audio, and video.
- Admin user / storage / quota management, per-org storage quotas, and i18n (en/zh).

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.0.0)

---

For the v1 changelog, see the [v1 branch](https://github.com/saltbo/zpan/tree/v1/CHANGELOG.md).
