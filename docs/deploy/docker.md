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
