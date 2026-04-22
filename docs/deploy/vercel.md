# Vercel Deployment

ZPan supports Vercel as a first-class deploy target using Vercel Functions (Node.js runtime) + [Turso](https://turso.tech) as the database and an external S3-compatible bucket for storage.

> **Edge runtime is not supported.** `@aws-sdk/client-s3` requires Node.js APIs (streams, crypto) that are unavailable in the Edge runtime. All Vercel Functions for ZPan run on the `nodejs22.x` runtime.

## Prerequisites

| Tool | Purpose |
|------|---------|
| [Vercel account](https://vercel.com) | Hosts the application |
| [Turso database](https://turso.tech) | libSQL-compatible remote database |
| S3-compatible storage | File storage (Cloudflare R2 recommended — free egress) |
| `vercel` CLI | Local development and linking |

## Required Secrets

Set these in your fork's GitHub repository under **Settings → Secrets and variables → Actions**:

| Secret | Description |
|--------|-------------|
| `VERCEL_TOKEN` | Vercel API token. Create at [vercel.com/account/tokens](https://vercel.com/account/tokens) |
| `VERCEL_ORG_ID` | Your Vercel team/org ID. Found in `vercel link` output or team settings |
| `VERCEL_PROJECT_ID` | Project ID after first `vercel link`. Found in `.vercel/project.json` |
| `TURSO_DATABASE_URL` | Turso database URL, e.g. `libsql://your-db.turso.io` |
| `TURSO_AUTH_TOKEN` | Turso auth token. Create with `turso db tokens create your-db` |
| `BETTER_AUTH_SECRET` | Signing secret for auth sessions. Generate with `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | Your Vercel deployment URL, e.g. `https://your-app.vercel.app` |

### Optional Secrets

| Secret | Description |
|--------|-------------|
| `TRUSTED_ORIGINS` | Comma-separated list of additional trusted origins |

## Quick Start (Fork + Deploy)

1. **Fork** the `saltbo/zpan` repository.

2. **Create a Turso database:**
   ```sh
   turso db create zpan-db
   turso db tokens create zpan-db
   ```

3. **Link your Vercel project** locally (first time only):
   ```sh
   cp deploy/vercel/vercel.json vercel.json
   npx vercel link
   # Note the VERCEL_ORG_ID and VERCEL_PROJECT_ID from .vercel/project.json
   ```

4. **Add all required secrets** to your fork (see table above).

5. **Push to `master`** — the `deploy-vercel.yml` workflow runs automatically and deploys to production.

## Local Development

Install the Vercel CLI and run:

```sh
npm install -g vercel
cp deploy/vercel/vercel.json vercel.json

# Using a local libSQL file (no Turso token needed)
TURSO_DATABASE_URL=file:./zpan.db \
BETTER_AUTH_SECRET=$(openssl rand -base64 32) \
vercel dev
```

The app will be available at `http://localhost:3000`.

## Build Output

`npm run build:vercel` produces:

| Path | Contents |
|------|---------|
| `dist/` | React SPA static assets |
| `api/entry-vercel.js` | Hono API compiled as a Vercel Function (ESM) |

`vercel.json` routes:
- `/api/*` and `/health` → Vercel Function
- All other paths → `dist/index.html` (SPA)

## Pricing Notes

- **Hobby (free)** — suitable for personal and non-commercial use. 100 GB-hours of function compute per month.
- **Pro ($20/mo)** — required for commercial use per Vercel's [fair-use policy](https://vercel.com/docs/limits/fair-use-policy). Includes team features, higher limits, and SLA.
- **Turso** — free tier includes 500 databases and 9 GB of total storage.
- **Cloudflare R2** — recommended S3-compatible storage. Free egress (no bandwidth charges between Vercel and R2 if using the same region is not required — R2 has zero egress fees globally).
