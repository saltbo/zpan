# Media Libraries

> Status: Phase 1 implemented (filename metadata, no scraping)
> Editions: Pro and Business (`media_library` feature gate)

## 1. Problem

WebDAV video players build their library by walking every folder and
re-scraping every file. On a large drive that walk is slow and repeats on
every refresh. ZPan already knows the file tree, so it can publish the tree
once per media folder and let clients fetch only that.

A folder marked as a **media library** gets a generated index at
`<folder>/.zpan/library.json`. A client fetches it over plain WebDAV with
`If-None-Match`; an unchanged index answers `304` without touching storage.
When it changes, the client downloads one JSON document and diffs items by
`id`. No client-side protocol beyond WebDAV GET is required.

## 2. Data shape

`media_libraries` (one row per library):

| Column | Notes |
| --- | --- |
| `id`, `org_id` | `org_id` cascades with the organization |
| `folder_id` | The folder's matter id. Matters store their location as a `parent` path string, but ids are stable, so REST and WebDAV renames and moves keep the library attached. Unique per org. |
| `fingerprint` | Subtree fingerprint of the last scan attempt, successful or not |
| `last_scanned_at` | Last successful scan |
| `created_by_user_id`, `created_by_actor_*` | Creator; sweep-queued jobs run as this user |

There is no movies/shows kind. The media type is inferred per file, so mixed
folders work.

Rules:

- The target must be a live folder in the caller's workspace.
- Libraries never nest. Marking a folder that is, contains, or sits inside a
  live library fails with `409` and reason `MEDIA_LIBRARY_EXISTS` or
  `MEDIA_LIBRARY_NESTED`.
- A library whose folder is trashed is skipped by the sweep. A library whose
  folder was purged is deleted by the sweep (or by a scan that finds it).
- Removing a library leaves the folder and its `.zpan` files in place.

## 3. Change detection

Scans are not hooked into write paths. Uploads, WebDAV writes, archive
extraction, and remote downloads into a library are all covered by one sweep
on the existing 10-minute cron (`*/10 * * * *` on Workers, the matching
`setInterval` on Node).

For each library the sweep computes one aggregate over live matters in the
subtree, excluding the `.zpan` folder and its contents:

```
count(*) : sum(size) : max(updated_at) : sum(updated_at)
```

Every write that changes what a scan sees moves one term: create, copy,
restore, and draft activation add a row; trash and purge remove one; rename,
move, and overwrite bump `updated_at` (moving a folder bumps every descendant
through `cascadeParentPath`). `updated_at` has second precision, so
`sum(updated_at)` also catches a change landing in the same second as the
previous maximum. The remaining blind spot is a second edit to a row already
modified in the same second the fingerprint was taken.

The subtree match is `parent = P OR (parent >= 'P/' AND parent < 'P0')`: an
index range on `(org_id, parent)` with no LIKE, so `%` and `_` in folder names
are literal and D1's LIKE pattern limits do not apply. `'0'` is the code point
after `/` under SQLite's binary collation.

The sweep queues a scan when the fingerprint differs from the stored one and
no scan for the library holds the lease (a `queued` or `running`
`media_library_scan` job updated within the last hour). The lease keeps a
consumer that died mid-scan, or a Node restart that lost the in-process
queue, from freezing a library forever. Creating a library queues a scan
immediately, and `POST /api/media-libraries/{id}/scans` requests one on demand
(`409 MEDIA_LIBRARY_SCAN_IN_PROGRESS` while the lease is held).

The sweep runs only when the instance is entitled (`media_library`), and it
verifies the license certificate against the configured `ZPAN_CLOUD_URL`.

## 4. Scan job

`media_library_scan` is a background job routed through the same queue as
archive jobs: `runBackgroundJob` maps each job type to its processor, and the
Workers queue consumer and the Node in-process queue both call it. It cannot
be created through `POST /api/background-jobs`.

The processor:

1. Loads the library and its folder; fails the job if either is gone or
   trashed.
2. Computes the fingerprint **before** listing, so a change that races the
   listing produces one extra scan instead of being lost. The `.zpan`
   exclusion means the job's own write never retriggers a scan.
3. Lists live files in the subtree whose stored MIME is `video/*` or whose
   extension is a known video extension, and builds the feed.
4. Writes `library.json` as a real matter: a fresh object key per write,
   quota reserved for growth, `applyUpload` on the existing row (so size and
   `updated_at`, and therefore the WebDAV ETag, change), then the old object is
   deleted. A new key means a reader holding a cached matter row never pairs
   new bytes with an old `Content-Length`.
5. Stores the fingerprint and `last_scanned_at`, and drops the WebDAV child
   listing cache for the library folder and `.zpan`.

A failed scan still stores the attempted fingerprint, so a deterministic
failure (quota, a `.ZPAN` folder or a `library.json` folder occupying the
index name) does not re-enqueue on every sweep. The next change or a manual
rescan retries.

When background jobs are disabled (`ZPAN_ARCHIVE_JOBS_ENABLED=false`, as in
Branch Previews, which have no queue consumer), create and rescan return `503`
and the sweep does not run.

## 5. Index format

`<library>/.zpan/library.json`, `application/feed+json`, a full snapshot in
[JSON Feed 1.1](https://jsonfeed.org/version/1.1). The schema lives in
`shared/schemas/media-library.ts`.

```json
{
  "version": "https://jsonfeed.org/version/1.1",
  "title": "Movies",
  "_zpan": { "generatedAt": "2026-11-09T15:59:35.679Z", "libraryId": "k2YM9TbUi6oQl4O5BILKpl" },
  "items": [
    {
      "id": "9vzHUHQiI48HlS0KIxzFqe",
      "title": "Inception",
      "content_text": "Inception (2010).mkv",
      "date_modified": "2026-11-09T15:59:35.000Z",
      "attachments": [{ "url": "../Inception%20(2010).mkv", "mime_type": "video/x-matroska", "size_in_bytes": 42 }],
      "_media": { "type": "movie", "title": "Inception", "year": 2010 }
    }
  ]
}
```

- `id` is the video's matter id, stable across renames and moves.
- `attachments[0].url` is relative to the feed's own URL (`../` climbs from
  `.zpan/` to the library root), each segment percent-encoded. Standard RFC
  3986 resolution against the URL the client fetched yields the video's WebDAV
  URL.
- `content_text` is the library-relative path (JSON Feed requires
  `content_text` or `content_html`).
- Items are ordered by path, so equal trees produce equal item lists.
- `_media` comes from the filename parser in `server/domain/media-filename.ts`:
  `SxxEyy`, `NxNN`, and `第N季第M集` episodes (a bare `S01E02.mkv` takes its
  show title from the nearest non-season folder), `Title.Year...` and
  `Title (Year)` movies, and `unknown` with the filename otherwise.

## 6. API and UI

`/api/media-libraries` lists (cursor page), creates `{folderId}`, deletes
`/{id}`, and creates scans at `/{id}/scans`. Scopes are
`media-libraries:read|create|update|delete`; writes need the editor role, and
every route needs the `media_library` feature (`402` otherwise).

The file manager shows "Set as media library", "Rescan media library", and
"Remove media library" on folders, and the details sheet shows status, last
scan, and the index path. It loads the workspace's libraries once and joins
them to folders by id, so the object DTO is unchanged. Without the
entitlement, the set action carries a Pro badge and opens an upgrade prompt.

## 7. Future phases

- **TMDB scraping.** Match `_media` titles and years to TMDB and add ids,
  overviews, and artwork URLs to each item. The TMDB API key is an
  instance-level admin setting stored in `system_options` and masked like the
  other secrets.
- **Sidecars.** Write `.nfo` files and posters next to videos (Kodi/Jellyfin
  layout) so players that ignore the feed still get metadata. Sidecars are
  library content and count toward the fingerprint; `.zpan` stays excluded.
- **Subtitles and extras.** List sidecar subtitles per item as additional
  attachments.

## 8. Open decisions

- **Removal.** Removing a library leaves a stale `.zpan/library.json`.
  Trashing `.zpan` on removal would avoid clients reading a frozen index.
- **Non-video changes.** Any change in the subtree (a new `.txt`) rewrites the
  index, and `generatedAt` changes the ETag even when items are equal.
  Skipping the write when the item list is unchanged needs a stored digest.
- **Naming.** `ZPAN_ARCHIVE_JOBS_ENABLED`, the `ARCHIVE_QUEUE` binding, and
  configz `services.archive.enabled` now cover every background job. Renaming
  them is an operator and API contract change left for a separate pass.
- **Concurrent scans.** The lease check and the job insert are not atomic, so
  a manual rescan and the sweep enqueuing in the same instant can run two
  scans. The later write wins; on a first scan the second create fails on the
  name conflict, and on later scans the earlier scan's object can be left
  orphaned in storage. A partial unique index on active scan jobs would close
  this.
