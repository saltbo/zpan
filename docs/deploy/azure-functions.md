# Azure Functions Deployment

ZPan supports deployment to [Azure Functions](https://learn.microsoft.com/en-us/azure/azure-functions/) (programming model v4, Node.js 22) as an alternative to Cloudflare Workers or Docker. The function app serves both the Hono API and the React SPA from a single Consumption-plan function.

> **S3-compatible storage required** — Azure Blob Storage is _not_ adapted as an object backend. You must bring an external S3-compatible bucket (AWS S3, Cloudflare R2, MinIO, etc.) and configure it as a storage provider inside ZPan after deployment.

---

## Prerequisites

| Requirement | Notes |
|---|---|
| Azure subscription | Consumption-plan Functions are free up to 1 M invocations/month |
| Azure CLI | `az` ≥ 2.50 — [install](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli) |
| Azure Functions Core Tools | v4 — installed automatically by the workflow |
| Turso account | [turso.tech](https://turso.tech) — free tier covers most self-hosted use cases |
| S3-compatible bucket | Any provider; configured inside ZPan post-deploy |

---

## 1 — Create a Turso database

```sh
turso db create zpan
turso db show zpan          # note the URL (libsql://...)
turso db tokens create zpan # note the auth token
```

---

## 2 — Create an Azure service principal

The GitHub Actions workflow authenticates to Azure with a service principal whose credentials are stored as a single JSON secret (`AZURE_CREDENTIALS`).

```sh
# Replace <subscription-id> with your Azure subscription ID.
az ad sp create-for-rbac \
  --name "zpan-deploy" \
  --role Contributor \
  --scopes /subscriptions/<subscription-id> \
  --sdk-auth
```

The command outputs a JSON block. Copy the **entire JSON object** — it is the value for the `AZURE_CREDENTIALS` secret.

### Service-principal JSON format

```json
{
  "clientId":       "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "clientSecret":   "your-client-secret",
  "subscriptionId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "tenantId":       "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "activeDirectoryEndpointUrl": "https://login.microsoftonline.com",
  "resourceManagerEndpointUrl": "https://management.azure.com/",
  "activeDirectoryGraphResourceId": "https://graph.windows.net/",
  "sqlManagementEndpointUrl":  "https://management.core.windows.net:8443/",
  "galleryEndpointUrl":        "https://gallery.azure.com/",
  "managementEndpointUrl":     "https://management.core.windows.net/"
}
```

---

## 3 — Add GitHub repository secrets

In your fork go to **Settings → Secrets and variables → Actions** and add:

| Secret name | Value |
|---|---|
| `AZURE_CREDENTIALS` | Full JSON object from `az ad sp create-for-rbac --sdk-auth` (see above) |
| `TURSO_DATABASE_URL` | `libsql://your-db-name-orgname.turso.io` |
| `TURSO_AUTH_TOKEN` | Token from `turso db tokens create zpan` |
| `BETTER_AUTH_SECRET` | _(optional)_ Pre-generated secret — `openssl rand -base64 32`. If absent the workflow generates one automatically on first deploy. |

---

## 4 — Run the workflow

Go to **Actions → Deploy to Azure Functions → Run workflow**.

| Input | Description |
|---|---|
| `resource_group` | Azure Resource Group name — created automatically if it does not exist (default: `zpan-rg`) |
| `location` | Azure region (default: `eastus`) |
| `version` | Release tag (e.g. `v2.5.0`). Leave empty to use the latest release. |

### What the workflow does

1. **Check secrets** — fails fast if any required secret is missing.
2. **Resolve release tag** — pins to a specific ZPan release.
3. **Set up Node 22** and install dependencies.
4. **Azure login** — uses the `AZURE_CREDENTIALS` service principal.
5. **Provision infrastructure** via `deploy/azure-functions/main.bicep`:
   - Resource Group (idempotent `az group create`)
   - Storage Account (required by the Functions runtime)
   - Consumption plan (Y1 / Dynamic SKU)
   - Function App (Node 22, runtime v4)
6. **Build** — `npm run build:azure` produces the `azure-functions/` publish directory.
7. **Migrate** — `npm run db:migrate` applies Drizzle migrations to Turso.
8. **Publish** — `func azure functionapp publish <name>` uploads the bundle.
9. **Set `BETTER_AUTH_SECRET`** — checks whether the setting already exists; generates and sets it if missing.
10. **Update `APP_URL`** — patches the real function-app URL into its own app settings.

Re-running the workflow is safe — Bicep uses create-or-update semantics and the secret step skips if the setting is already present.

---

## 5 — Post-deploy: configure S3 storage

1. Open your function app URL in a browser and complete the ZPan setup wizard.
2. Navigate to **Admin → Storages** and add your S3-compatible bucket credentials.

### Verify the deployment

```sh
curl https://<your-func-app>.azurewebsites.net/api/health
# → {"status":"ok"}
```

---

## Local development against a Turso database

```sh
TURSO_DATABASE_URL=libsql://your-db.turso.io \
TURSO_AUTH_TOKEN=your-token \
BETTER_AUTH_SECRET=$(openssl rand -base64 32) \
npm run dev:node
```

### Local Azure Functions emulation

```sh
npm run build:azure
cd azure-functions
func start
```

Requires the [Azure Functions Core Tools v4](https://learn.microsoft.com/en-us/azure/azure-functions/functions-run-local) and a local `.env` file (or environment variables) with `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, and `BETTER_AUTH_SECRET`.
