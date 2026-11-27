# Product specs

Behaviour-first product specs in Gherkin `.feature` files. This directory is the
source of truth for **what ZPan does**, independent of implementation. There is
**no Cucumber runner** — the `.feature` files are documentation, and tests trace
back to scenarios by id.

Technical designs and implementation proposals live in `docs/design/`; this
directory contains behavior specifications and their conventions.

## Positioning

ZPan is an open-source, self-hostable file hosting platform on S3-compatible
storage. Files move directly between the client and the bucket through presigned
URLs; the server is the control plane. Every feature is judged against this
section: inside it, a feature is built without asking; outside it, or a change to
it, is Saltbo's call.

**For** developers and bloggers who need an image bed, indie developers and small
teams who share files and releases, screenshot-tool users (PicGo, ShareX,
Flameshot, uPic), agents and CI that script uploads and sharing, and self-hosters
who want a web UI over their own buckets.

**It does:**

- A full web drive over the user's bucket: files, folders, previews, trash,
  quotas, and team workspaces.
- Image hosting with stable URLs on the user's own domain, through upload tools and
  the API.
- Sharing: links with password, expiry, and download limits, direct links, save to
  drive, and a public `/u/<username>` page.
- External access: WebDAV, remote download through download engines the user runs,
  a self-describing API with delegated OAuth, and a sync protocol for clients that
  live in their own repositories.
- A private Debrid service for a self-hosted circle: torrents downloaded through
  those engines are cached once per instance, transferred instantly into any
  member's drive, and streamed to Stremio through community addons or ZPan's
  own.
- Deployment without a server to look after: Cloudflare Workers first, Docker and
  the other runtimes in `docs/deploy/` too.
- What a mature product of this kind is expected to have around these, such as
  i18n, search, sort, paging, notifications, admin analytics, and audit.

**It does not:**

- Store files anywhere but S3-compatible buckets, or aggregate consumer cloud
  drives, as AList does.
- Proxy a transfer through the server when a presigned URL can carry it.
- Grow into a groupware suite, such as real-time document co-editing in the manner
  of Nextcloud Office.
- Browse a server's local directories, as File Browser does.
- Ship native desktop or mobile clients from this repository.
- Run remote downloads as a cloud execution service, or offer the torrent cache
  on Managed or any public multi-tenant instance.

**Editions.** Community is free and open source. Pro and Business are paid
licenses bound through ZPan Cloud. Which edition a feature belongs to is a pricing
decision, recorded in [ROADMAP.md](../ROADMAP.md#community-vs-pro-vs-business).

## Convention

- One `.feature` file per capability (`storages.feature`, `site-invitations.feature`, …).
- Each scenario carries two tags: the **id** `@<capability>/<slug>` and the **layer**
  that proves it (`@domain` / `@usecase` / `@web` / `@api` / `@e2e`):

  ```gherkin
  @storages/create-records-activity @api
  Scenario: Creating a storage records an audit activity
    Given an authenticated admin
    When they create a storage
    Then a storage_create activity is recorded
  ```

- The id never changes once written (rename = new id).
- Verify each scenario at the **cheapest layer that can prove it.** In this repo most
  land at `@api` (the workerd + real-D1 `*.integration.test.ts` / `*.cf-test.ts`
  flows through `app.fetch`) or `@web` (jsdom + MSW). Reserve `@e2e` for the Playwright
  cross-stack journeys. Pure rules sit at `@domain` / `@usecase`.

## Traceability

Each scenario's home test carries `[spec: <id>]` in its name:

```ts
it('records a storage_create activity [spec: storages/create-records-activity]', …)
```

`pnpm lint:spec` (wired into CI) enforces the link both ways: every scenario id must
have a referencing test, and every `[spec: id]` breadcrumb must match a real scenario.

## Status

Specs are authored capability-by-capability alongside the clean-architecture
migration (see `docs/clean-arch-migration.md`). Migrated capabilities are specced
and traced here; the rest land as their slices migrate.

## Escalation

If a non-technical audience ever needs to *run* the Gherkin, wire `playwright-bdd`
(compiles `.feature` → Playwright). These are real `.feature` files, so that step is
drop-in — no rewrite.
