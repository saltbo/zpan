# AWS Lambda Deployment

ZPan runs on AWS Lambda via a [Lambda Function URL](https://docs.aws.amazon.com/lambda/latest/dg/lambda-urls.html) — no API Gateway required. A [SAM](https://aws.amazon.com/serverless/sam/) template provisions the function and the GitHub Actions workflow deploys it automatically.

## Prerequisites

- An AWS account with permissions to create Lambda functions, IAM roles, and S3 buckets
- A [Turso](https://turso.tech) database (free tier: 9 GB, no credit card required)
- A fork of this repository

### Create a Turso database (~3 minutes)

```bash
curl -sSfL https://get.tur.so/install.sh | bash
turso auth signup          # GitHub OAuth
turso db create zpan
turso db show zpan --url   # → TURSO_DATABASE_URL
turso db tokens create zpan # → TURSO_AUTH_TOKEN
```

Alternatively, create the database via the [Turso dashboard](https://app.turso.tech) without installing the CLI.

## Secrets

Add the following in your fork under **Settings → Secrets and variables → Actions**:

| Secret | Description |
|--------|-------------|
| `TURSO_DATABASE_URL` | Turso database URL, e.g. `libsql://your-db.turso.io` |
| `TURSO_AUTH_TOKEN` | Turso auth token (rotate via `turso db tokens create zpan`) |
| `AWS_ACCESS_KEY_ID` | AWS access key ID |
| `AWS_SECRET_ACCESS_KEY` | AWS secret access key |
| `AWS_REGION` | AWS region to deploy to, e.g. `us-east-1` |

> **S3 credentials are not here.** ZPan stores your object storage configuration in the database, configured via the Admin UI after the first deploy. This keeps bucket secrets off GitHub and lets you manage multiple storage backends from one place.

> **BETTER_AUTH_SECRET** — If omitted, the workflow auto-generates a secure random value on first deploy and stores it in the Lambda function configuration. Add this secret only if you want to supply your own value.

### IAM permissions for the deploy user

The AWS credentials need these permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["lambda:*", "iam:*", "s3:*", "cloudformation:*"], "Resource": "*" },
    { "Effect": "Allow", "Action": "sts:GetCallerIdentity", "Resource": "*" }
  ]
}
```

For production, scope the `Resource` fields to specific ARNs. The workflow creates a single S3 bucket (`zpan-sam-artifacts-<account>-<region>`) for SAM deployment artifacts on first run.

## Trigger

1. Fork this repository
2. Add the secrets above
3. Go to the **Actions** tab → **Deploy to AWS Lambda** → **Run workflow**

The workflow runs automatically on every push to `master` after initial setup. Re-running is idempotent — it redeploys without recreating existing resources.

## First-boot storage setup

After the workflow reports success:

1. Open the Function URL shown in the job summary
2. Register a user (the first user gets admin role)
3. Go to **Admin → Storages → Add storage** and fill in your S3-compatible bucket details:
   - **Endpoint**: your S3 endpoint (e.g. `https://s3.amazonaws.com` for AWS S3, or your R2/Tigris/B2 URL)
   - **Bucket**: your bucket name
   - **Region**: the bucket's region
   - **Access Key / Secret Key**: bucket credentials

> The storage endpoint must be reachable from the **client browser**, since ZPan uploads files directly to S3 via presigned URLs — no server bandwidth is used.

## Cost

With the AWS free tier and Turso free tier, personal ZPan usage costs $0/month:

| Resource | Free tier | Notes |
|----------|-----------|-------|
| AWS Lambda | 1M requests / 400,000 GB-seconds / month | Easily covers personal use |
| Lambda Function URL | Included with Lambda | No extra charge |
| S3 (SAM artifacts) | 5 GB / month | One-time ~10 MB upload per deploy |
| Turso | 9 GB storage, 1B row reads / month | Shared across all deployments |

S3 (or R2/Tigris) for ZPan file storage is billed separately and depends on your usage. ZPan itself does not add server-side bandwidth costs because files transfer directly between client and S3.

---

## Entitlement Refresh (License Cert)

ZPan refreshes its entitlement certificate every 6 hours. On Lambda there is no persistent process, so you need to trigger a refresh via an external scheduler.

### Setup

1. **Generate a secret:**
   ```sh
   openssl rand -hex 32
   ```

2. **Add the env var** to the Lambda function configuration (via the SAM template or the AWS Console → Lambda → Configuration → Environment variables):
   | Variable | Value |
   |----------|-------|
   | `REFRESH_CRON_SECRET` | The random string from step 1 |

3. **Schedule the call** using [Amazon EventBridge Scheduler](https://docs.aws.amazon.com/scheduler/latest/UserGuide/). Create a schedule with:
   - **Rate**: `rate(6 hours)` or cron `0 */6 * * ? *`
   - **Target**: HTTPS `POST` to your Lambda Function URL:
     ```
     POST https://<your-lambda-url>/api/licensing/refresh-cron?secret=<REFRESH_CRON_SECRET>
     ```

If `REFRESH_CRON_SECRET` is not set, the endpoint returns `401` for all requests.
