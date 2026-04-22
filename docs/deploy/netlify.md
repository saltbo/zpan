# Netlify Deployment

ZPan runs on Netlify via [Netlify Functions v2](https://docs.netlify.com/functions/overview/) (Node, ESM). The React SPA is served from Netlify's CDN. All API requests are handled by a single Netlify Function that connects to a [Turso](https://turso.tech) (libSQL) database.

**Cost:** Free tier covers 125,000 function invocations per month, 100 GB bandwidth, and unlimited static hosting. Turso's free tier covers 9 GB storage, 1 B row reads, and 25 M row writes per month — enough for personal use at $0/month.

---

## Prerequisites

1. **Fork the repo** — go to [github.com/saltbo/zpan](https://github.com/saltbo/zpan) and click **Fork**.
2. **Create a Turso database** — takes about 3 minutes:

   ```sh
   curl -sSfL https://get.tur.so/install.sh | bash
   turso auth signup          # GitHub OAuth, no credit card
   turso db create zpan
   turso db show zpan --url   # → TURSO_DATABASE_URL value
   turso db tokens create zpan  # → TURSO_AUTH_TOKEN value
   ```

   Alternatively, use the [Turso dashboard](https://app.turso.tech) — no CLI needed.

3. **Create a Netlify site** — one-time setup, done in your browser:
   - Go to [app.netlify.com](https://app.netlify.com) → **Add new site → Deploy manually**.
   - Note your **Site ID** from **Site configuration → General**.

   Or via CLI:

   ```sh
   npm install -g netlify-cli
   netlify login
   netlify sites:create --name my-zpan
   ```

4. **Get a Netlify personal access token** — go to [app.netlify.com/user/applications](https://app.netlify.com/user/applications) → **Personal access tokens → New access token**.

---

## Add GitHub Secrets

In your fork, go to **Settings → Secrets and variables → Actions → New repository secret** and add:

| Secret | Value |
|--------|-------|
| `TURSO_DATABASE_URL` | `libsql://your-db-name-orgname.turso.io` |
| `TURSO_AUTH_TOKEN` | Turso auth token from step 2 |
| `NETLIFY_AUTH_TOKEN` | Netlify personal access token from step 4 |
| `NETLIFY_SITE_ID` | Site ID from your Netlify site settings |
| `BETTER_AUTH_SECRET` | *(optional)* — auto-generated on first deploy if omitted |

> **S3 bucket credentials are not GitHub Secrets.** After deploy, you configure storage backends via the ZPan admin UI (Admin → Storages). This keeps bucket credentials out of CI logs and lets one ZPan instance manage multiple buckets.

---

## Trigger Deploy

Push to `master` or go to **Actions → Deploy to Netlify → Run workflow**.

The workflow will:
1. Resolve the latest ZPan release from the upstream repo
2. Apply Turso migrations (`drizzle-kit migrate`)
3. Build the React SPA and the Netlify Function
4. Deploy to your Netlify site
5. Auto-generate `BETTER_AUTH_SECRET` (first deploy only)
6. Write the live URL to the workflow run summary

Subsequent pushes redeploy without re-creating resources.

---

## First-Boot Storage Setup

After the workflow reports success:

1. Open the deployed URL (shown in the workflow summary)
2. Sign up — the first account becomes the admin
3. Go to **Admin → Storages → Add storage**
4. Fill in your S3-compatible bucket details (endpoint, region, access key, secret)
5. Save — ZPan verifies the bucket is reachable and marks it active

This is identical to the setup flow for Cloudflare Workers and Docker deployments.

---

## Configuration & Cost

### Environment variables

Set additional env vars via the Netlify dashboard (**Site configuration → Environment variables**) or CLI:

```sh
netlify env:set BETTER_AUTH_URL https://zpan.example.com --context production
netlify env:set TRUSTED_ORIGINS https://zpan.example.com --context production
```

| Variable | Required | Notes |
|----------|----------|-------|
| `TURSO_DATABASE_URL` | Yes | Set as a GitHub Secret; workflow passes it at build time |
| `TURSO_AUTH_TOKEN` | Yes | Set as a GitHub Secret |
| `BETTER_AUTH_SECRET` | Yes | Auto-generated on first deploy |
| `BETTER_AUTH_URL` | Recommended | Set to your production URL (default: inferred from request origin) |
| `TRUSTED_ORIGINS` | Recommended | Comma-separated allowed origins for auth cookies |

### Custom domain

In the Netlify dashboard → **Domain management → Add a domain**. No changes to the workflow required.

### Running migrations manually

```sh
TURSO_DATABASE_URL=libsql://your-db.turso.io \
TURSO_AUTH_TOKEN=your-token \
npm run db:migrate
```

### Free-tier limits

| Resource | Free limit |
|----------|-----------|
| Netlify Functions | 125,000 invocations/month |
| Netlify Bandwidth | 100 GB/month |
| Turso Storage | 9 GB |
| Turso Row reads | 1 B/month |
| Turso Row writes | 25 M/month |

Upgrade to Netlify Pro ($19/month) or Turso Scaler ($29/month) when you need more.
