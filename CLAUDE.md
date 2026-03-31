# CLAUDE.md

## Project Overview

ZPan v2 is an open-source, S3-native file hosting platform written in TypeScript. It supports deployment to Cloudflare Pages (zero-ops) and Docker (self-hosted).

Core architecture: clients upload directly to S3-compatible storage via presigned URLs, bypassing server bandwidth.

## Tech Stack

- **Runtime**: Hono (runs on CF Workers + Node.js)
- **Database**: Drizzle ORM (D1 / SQLite / PostgreSQL)
- **Auth**: Better Auth (email/password, social login, OIDC)
- **Storage**: @aws-sdk/client-s3 (R2, AWS S3, MinIO, any S3-compatible)
- **Frontend**: TBD

## Project Structure

```
src/
├── app/                  # Business logic (routes, middleware, services)
├── platform/             # Platform abstraction (CF vs Node.js)
├── entry-cloudflare.ts   # CF Pages Functions entry
└── entry-node.ts         # Docker / Node.js entry
```

## Development

```bash
pnpm install              # Install dependencies
pnpm dev                  # Start local dev server
pnpm test                 # Run tests
pnpm build                # Build for production
```

## Commit Convention

Use Conventional Commits (feat:, fix:, docs:, etc.). PRs target the master branch.
