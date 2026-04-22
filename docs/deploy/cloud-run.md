# Google Cloud Run Deployment

ZPan supports Google Cloud Run as a first-class deploy target. It reuses the existing root `Dockerfile` — no separate entry file is needed. [Turso](https://turso.tech) provides the database, and any S3-compatible bucket (Cloudflare R2 recommended) handles file storage.

> **GCS is not adapted as a storage driver.** Google Cloud Storage is not S3-compatible at the API level. Bring an external S3-compatible bucket (R2, AWS S3, Tigris, B2, etc.).

## Prerequisites

| Tool / Account | Purpose |
|---------------|---------|
| [Google Cloud account](https://cloud.google.com) | Hosts the Cloud Run service |
| GCP project with billing enabled | Cloud Run, Cloud Build, Secret Manager, and Artifact Registry are used |
| [Turso database](https://turso.tech) | libSQL-compatible remote database |
| S3-compatible storage | File storage (Cloudflare R2 recommended — free egress) |

## Required Secrets

Set these in your fork's GitHub repository under **Settings → Secrets and variables → Actions**:

| Secret | Description |
|--------|-------------|
| `GCP_SERVICE_ACCOUNT_KEY` | JSON key for a GCP service account with roles: `roles/run.admin`, `roles/cloudbuild.builds.editor`, `roles/secretmanager.admin`, `roles/iam.serviceAccountUser`, `roles/artifactregistry.writer` |
| `GCP_PROJECT_ID` | Your GCP project ID (e.g. `my-zpan-project`) |
| `TURSO_DATABASE_URL` | Turso database URL, e.g. `libsql://your-db.turso.io` |
| `BETTER_AUTH_URL` | Your Cloud Run service URL, e.g. `https://zpan-abc123-uc.a.run.app` |

### Optional Secrets

| Secret | Description |
|--------|-------------|
| `TURSO_AUTH_TOKEN` | Turso auth token. Create with `turso db tokens create your-db`. Required for remote Turso URLs; omit for `file://` local databases. |
| `BETTER_AUTH_SECRET` | Signing secret for auth sessions. If not provided, the workflow auto-generates one on first deploy and stores it in Secret Manager. Back it up from the GCP console before rotating. To bring your own: `openssl rand -base64 32`. |

## Quick Start (Fork + Deploy)

1. **Fork** the `saltbo/zpan` repository.

2. **Create a GCP project** and enable the required APIs:
   ```sh
   gcloud projects create my-zpan-project --name="ZPan"
   gcloud config set project my-zpan-project
   gcloud services enable \
     run.googleapis.com \
     cloudbuild.googleapis.com \
     secretmanager.googleapis.com \
     artifactregistry.googleapis.com
   ```

3. **Create a service account** and download its key:
   ```sh
   gcloud iam service-accounts create zpan-deployer \
     --display-name="ZPan Deployer"

   for role in roles/run.admin roles/cloudbuild.builds.editor \
               roles/secretmanager.admin roles/iam.serviceAccountUser \
               roles/artifactregistry.writer; do
     gcloud projects add-iam-policy-binding my-zpan-project \
       --member="serviceAccount:zpan-deployer@my-zpan-project.iam.gserviceaccount.com" \
       --role="$role"
   done

   gcloud iam service-accounts keys create gcp-key.json \
     --iam-account="zpan-deployer@my-zpan-project.iam.gserviceaccount.com"
   ```
   Use the contents of `gcp-key.json` as the `GCP_SERVICE_ACCOUNT_KEY` secret. Delete the local file afterward.

4. **Create a Turso database:**
   ```sh
   turso db create zpan-db
   turso db show zpan-db --url     # → TURSO_DATABASE_URL
   turso db tokens create zpan-db  # → TURSO_AUTH_TOKEN
   ```

5. **Add the required secrets** to your fork (see table above). `BETTER_AUTH_URL` can be added after the first deploy once you know the Cloud Run service URL. `BETTER_AUTH_SECRET` is optional — the workflow auto-generates one on first deploy.

6. **Push to `master`** — the `deploy-cloud-run.yml` workflow runs automatically. Cloud Build builds the image from the root `Dockerfile`, applies Turso migrations, and deploys the Cloud Run service.

## Workflow Steps

The workflow follows the standard 8-step deployment contract:

1. Guard: skips on the upstream `saltbo/zpan` repo.
2. Check required secrets — fails early with an actionable error if any are missing.
3. Resolve the latest release tag from `saltbo/zpan` (override via `workflow_dispatch` input).
4. Checkout upstream code at the resolved tag.
5. Authenticate to Google Cloud using the service account key.
6. Apply Turso migrations (`npm run db:migrate`).
7. Ensure `BETTER_AUTH_SECRET` exists in Secret Manager (auto-generates on first deploy).
8. Deploy via `gcloud run deploy zpan --source .` — Cloud Build builds the image; the service is created or updated.

## Region

The default region is `us-central1`. To deploy to a different region, use the `workflow_dispatch` trigger and set the `region` input:

```
Actions → Deploy to Google Cloud Run → Run workflow → region: europe-west1
```

## Cold-Start Expectations

`min-instances` is set to **0** to qualify for the free tier. With zero minimum instances, the first request after a period of inactivity will experience a cold start — typically **1–3 seconds** for the ZPan Node.js container.

To eliminate cold starts at the cost of always-on billing, set `min-instances` to `1` in the workflow's `gcloud run deploy` flags or in `deploy/cloud-run/service.yaml`.

## Service Manifest

`deploy/cloud-run/service.yaml` is a Knative service manifest for reference and manual apply:

```sh
# Replace PROJECT_ID with your GCP project ID first
sed "s/PROJECT_ID/my-zpan-project/g" deploy/cloud-run/service.yaml | \
  gcloud run services replace - --region us-central1

# Dry-run validation
sed "s/PROJECT_ID/my-zpan-project/g" deploy/cloud-run/service.yaml | \
  gcloud run services replace - --region us-central1 --dry-run
```

The workflow uses `--source .` (Cloud Build) rather than this manifest for automated deployments, so the manifest is not required for normal operation.

## Storage Configuration

Cloud Run deployments require an **external S3-compatible bucket**. Configure it via the ZPan admin dashboard after your first login. Cloudflare R2 is recommended — it has zero egress fees, and there are no bandwidth charges between Cloud Run and R2.

GCS (Google Cloud Storage) is **not supported** as a storage backend — it uses a different API protocol.

## Pricing Notes

- **Cloud Run** — free tier: 2 million requests/month, 360,000 GB-seconds compute, 180,000 vCPU-seconds. With `min-instances=0`, idle deployments cost $0.
- **Cloud Build** — free tier: 120 build-minutes/day. Each deployment triggers one Cloud Build run.
- **Secret Manager** — free tier: 6 active secret versions, 10,000 access operations/month.
- **Turso** — free tier: 500 databases, 9 GB total storage, 1B row reads / 25M row writes per month.
- **Cloudflare R2** — 10 GB storage free, zero egress fees.

A personal ZPan instance with light usage fits entirely within free tiers across all services.
