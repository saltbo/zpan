# Changelog

All notable changes to ZPan are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The admin **About** page reads this file straight from `master` on GitHub to show
the latest released version and surface this log in a side drawer. Keep the newest
released version as the first `## [x.y.z]` heading so that detection stays correct.

## [Unreleased]

### Added
- About page now shows the running build's commit hash next to the version and a
  "latest version" indicator that compares the instance against the newest entry
  in this changelog, with a side drawer that renders this file.
- PostHog-based instance telemetry for understanding deployment footprint.
- Independent business (commercial) authorization alongside Pro licensing, with an
  edition-aware comparison table and gates for social login and the downloader.

### Changed
- App version now resolves from `package.json` (overridable via `ZPAN_APP_VERSION`)
  instead of `git describe`, so Cloudflare Workers Builds and Docker report correctly.

## [2.7.2] - 2026-06-07

### Added
- Refreshed ZPan logo and branding assets.

### Fixed
- Remote downloader data volume is now writable in the Docker image.

## [2.7.1] - 2026-06-06

### Added
- Admins can edit a remote downloader's display name.

### Fixed
- Docker remote downloader runtime configuration, host hostname registration, and
  torrent listen-port exposure.
- More reliable downloader assignment and transfer-speed reporting.

## [2.7.0] - 2026-06-06

### Added
- Remote download manager: peer geo-region reporting, richer download table
  controls, and a detailed transfer/log timeline.
- `zpan` CLI gains the downloader subcommand with device-login auto bootstrap and
  configurable server URL.
- Seed retention policy with persistent aria2 seeds that survive restarts.

### Fixed
- Hardened downloader lifecycle: idempotent resets, stable upload tokens, clean
  shutdown/recovery, and correct runtime snapshots after restart.
- WebDAV downloads are now metered against traffic quota; storage usage reconciles
  after purge.
- Batch file operations show per-item failure details and progress.

## [2.6.2] - 2026-05-11

### Fixed
- Stability fixes for storage plans and quota metering.

## [2.6.0] - 2026-05-10

### Added
- Quota entitlements: plan-based and extra quotas, monthly traffic quotas, and
  metered traffic overage with per-currency pricing.
- Cloud store: manage workspace subscription plans, subscription and fixed-quota
  packages, and redemption codes.
- Redesigned storage plan catalog and upgrade prompts with tightened Pro gates.

## [2.5.0] - 2026-04-22

### Added
- New deployment targets: AWS Lambda, Vercel, Netlify, Azure Functions, and Google
  Cloud Run.
- libSQL (Turso) platform adapter with an opt-in Docker configuration.
- Avatar upload in Settings → Profile.
- Prefer the R2 binding for image uploads on Cloudflare, falling back to S3.

## [2.0.0] - 2026

Complete rewrite from Go to TypeScript. New stack: Hono + Drizzle + Better Auth,
dual deployment on Cloudflare Workers and Docker, R2 as the default storage
backend. See [V2_ROADMAP.md](V2_ROADMAP.md) for the full plan.

---

For the v1 changelog, see the [v1 branch](https://github.com/saltbo/zpan/tree/v1/CHANGELOG.md).
