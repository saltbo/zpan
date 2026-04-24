# Docker Deployment

ZPan ships as a single Docker image. By default it uses an embedded SQLite database (`better-sqlite3`). For production multi-replica deployments you can opt into [Turso](https://turso.tech) (libSQL) as a shared remote database.

## Default: local SQLite

No extra configuration needed. Mount a volume so the database survives container restarts:

```yaml
services:
  zpan:
    image: ghcr.io/saltbo/zpan:latest
    ports:
      - "8222:8222"
    environment:
      PORT: 8222
      BETTER_AUTH_SECRET: <generate with: openssl rand -base64 32>
      BETTER_AUTH_URL: https://your-domain.example
      DATABASE_URL: /data/zpan.db
    volumes:
      - zpan-data:/data
    restart: unless-stopped

volumes:
  zpan-data:
```

Migrations run automatically at startup.

## Turso (libSQL) opt-in

Set `TURSO_DATABASE_URL` to switch from local SQLite to a Turso (or self-hosted libSQL) database. `TURSO_AUTH_TOKEN` is required for remote URLs; it can be omitted for local `file://` URLs.

```yaml
services:
  zpan:
    image: ghcr.io/saltbo/zpan:latest
    ports:
      - "8222:8222"
    environment:
      PORT: 8222
      BETTER_AUTH_SECRET: <generate with: openssl rand -base64 32>
      BETTER_AUTH_URL: https://your-domain.example
      TURSO_DATABASE_URL: libsql://your-db-name-orgname.turso.io
      TURSO_AUTH_TOKEN: <your-turso-auth-token>
    restart: unless-stopped
```

When `TURSO_DATABASE_URL` is present:
- `DATABASE_URL` is ignored.
- Migrations are applied automatically at startup via `drizzle-orm/libsql/migrator`.
- `TURSO_AUTH_TOKEN` may be omitted only for `file://` URLs (local libSQL files).

### Running migrations manually against Turso

```sh
TURSO_DATABASE_URL=libsql://your-db.turso.io \
TURSO_AUTH_TOKEN=your-token \
npm run db:migrate
```

`drizzle.config.ts` automatically switches to the `turso` dialect when `TURSO_DATABASE_URL` is set, so `npm run db:generate` and `npm run db:migrate` work against Turso without any extra flags.

### Obtaining a Turso auth token

```sh
turso db tokens create your-db-name
```

Or create one in the [Turso dashboard](https://app.turso.tech).

## Pro licensing: external cron for 6h refresh

ZPan refreshes its entitlement certificate every 6 hours via a built-in background timer. The Docker container runs a persistent Node.js process, so the background timer fires automatically — **no external cron is required**.

If you prefer an explicit external trigger (e.g. to integrate with your monitoring or to refresh immediately after a plan change), you can call the refresh endpoint manually:

### Setup

1. **Generate a secret:**
   ```sh
   openssl rand -hex 32
   ```

2. **Add the env var** to your container environment:

   ```yaml
   environment:
     REFRESH_CRON_SECRET: <the-secret-from-step-1>
   ```

3. **Trigger a refresh** with an HTTP POST:

   ```
   POST https://your-domain.example/api/licensing/refresh-cron?secret=<REFRESH_CRON_SECRET>
   ```

   To run on a schedule via host cron, add to your crontab:

   ```cron
   0 */6 * * * curl -s -X POST "https://your-domain.example/api/licensing/refresh-cron?secret=<REFRESH_CRON_SECRET>"
   ```

If `REFRESH_CRON_SECRET` is not set, the endpoint returns `401` for all requests.
