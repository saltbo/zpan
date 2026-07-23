# Docker Deployment

ZPan ships as a single Docker image. By default it uses an embedded SQLite database (`better-sqlite3`). For production multi-replica deployments you can opt into [Turso](https://turso.tech) (libSQL) as a shared remote database.

## Image tags

Images are published to `ghcr.io/saltbo/zpan`. A CLI-only variant (downloader) is published under the matching `-cli` suffix.

| Tag | Built from | When | Use for |
| --- | --- | --- | --- |
| `latest`, `2.6.1`, `2.6`, `2` | release tags (`v*`) | on every release | **production** — stable, version-pinned |
| `dev` | `main` HEAD | every push to `main` (after CI passes) | trying the newest code as soon as it lands |
| `nightly` | `main` HEAD | daily, full no-cache rebuild | newest code **plus** fresh base-image/OS security patches |

`dev` and `nightly` are moving, unreviewed tags — do not pin production to them. Pulling without a tag (`ghcr.io/saltbo/zpan`) resolves to `latest`.

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

Migrations run automatically at startup. The compose files in this repository also include an optional downloader service using the CLI-only tag (`ghcr.io/saltbo/zpan:latest-cli`). On first start, `zpan downloader up` prints a device authorization URL in the container logs and waits. Open that URL as an admin user; after approval the downloader registers itself, saves its token under `/data/config.yaml`, and continues running.

To expose WebDAV at the root of a dedicated hostname, enable WebDAV in Admin Settings, set the site's **Public URL**, and configure your front proxy to route `dav.<public-hostname>` to ZPan while internally prefixing requests with `/dav`. A different hostname can be configured in the WebDAV settings drawer. See [WebDAV custom domains](../webdav-custom-domain.md) for the complete proxy contract.

To run only a remote downloader on another machine:

```sh
ZPAN_SERVER_URL=https://your-zpan.example.com \
docker compose -f deploy/docker-compose.downloader.yml up -d
```

### Remote downloader storage

The downloader compose files use one named volume mounted at `/data`. The token config, runtime state, active task files, and retained BitTorrent seed files live under that volume.

The compose files expose the retained seed cache limit:

```yaml
environment:
  - ZPAN_DOWNLOADER_SEED_CACHE_LIMIT=${ZPAN_DOWNLOADER_SEED_CACHE_LIMIT:-10GB}
```

When retained seed files exceed this limit, the downloader cleans the oldest retained seeds first. This is an application-level seed cache limit, not a Docker volume hard quota; active downloads are allowed to finish or fail naturally instead of being deleted mid-task.

### Remote downloader BitTorrent port

The bundled downloader can auto-start aria2 or qBittorrent for magnet and torrent tasks. The provided compose files publish the configured BitTorrent listen port for both TCP and UDP:

```yaml
ports:
  - "${ZPAN_BT_PORT:-6881}:${ZPAN_DOWNLOADER_BT_LISTEN_PORT:-6881}/tcp"
  - "${ZPAN_BT_PORT:-6881}:${ZPAN_DOWNLOADER_BT_LISTEN_PORT:-6881}/udp"
```

Keep that port reachable from the internet if you want effective seeding and better peer connectivity. `ZPAN_BT_PORT` controls the host port. `ZPAN_DOWNLOADER_BT_LISTEN_PORT` controls the engine listen port inside the container. If multiple downloader containers run on the same host, give each one a different host port, for example `ZPAN_BT_PORT=6882`.

The Docker images include both aria2 and qBittorrent. `ZPAN_DOWNLOADER_ENGINE=auto` keeps the default auto-selection behavior, which tries aria2 before qBittorrent. To run the managed qBittorrent engine instead:

```sh
ZPAN_DOWNLOADER_ENGINE=qbittorrent docker compose -f deploy/docker-compose.yml up -d
```

Managed qBittorrent uses the same `ZPAN_DOWNLOADER_BT_LISTEN_PORT` setting for BitTorrent peers; the WebUI stays bound to container-local `127.0.0.1`.

### Remote downloader hostname

Docker gives containers a generated hostname unless one is configured. The downloader reads the mounted host hostname file during registration and heartbeats:

```yaml
volumes:
  - /etc/hostname:/host/etc/hostname:ro
```

On Linux hosts, this makes first-time downloader registration use the host machine name automatically. If the mount is unavailable, the downloader falls back to the container hostname.

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
pnpm db:migrate
```

`drizzle.config.ts` automatically switches to the `turso` dialect when `TURSO_DATABASE_URL` is set, so `pnpm db:generate` and `pnpm db:migrate` work against Turso without any extra flags.

### Obtaining a Turso auth token

```sh
turso db tokens create your-db-name
```

Or create one in the [Turso dashboard](https://app.turso.tech).

## Pro licensing and traffic sync

ZPan refreshes its entitlement certificate every 6 hours and syncs metered traffic every 10 minutes via built-in background timers. The Docker container runs a persistent Node.js process, so these timers fire automatically — **no external cron is required**.

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

3. **Trigger a refresh or traffic sync** with HTTP POST:

   ```
   POST https://your-domain.example/api/licensing/refresh-cron?secret=<REFRESH_CRON_SECRET>
   ```

   ```
   POST https://your-domain.example/api/licensing/traffic-sync-runs?secret=<REFRESH_CRON_SECRET>
   ```

   To run on a schedule via host cron, add to your crontab:

   ```cron
   0 */6 * * * curl -s -X POST "https://your-domain.example/api/licensing/refresh-cron?secret=<REFRESH_CRON_SECRET>"
   */10 * * * * curl -s -X POST "https://your-domain.example/api/licensing/traffic-sync-runs?secret=<REFRESH_CRON_SECRET>"
   ```

If `REFRESH_CRON_SECRET` is not set, the endpoint returns `401` for all requests.
