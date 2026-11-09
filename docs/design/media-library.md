# Media Libraries

> Status: Phase 1 implemented (filename metadata, no scraping)
> Editions: Pro and Business (`media_library` feature gate)

## 1. Problem

WebDAV video players build their library by walking every folder and
re-scraping every file. On a large drive that walk is slow and repeats on
every refresh. ZPan already knows the file tree, so it can publish the tree
once per media folder and let clients fetch only that.

A folder marked as a **media library** gets a generated index at
`<folder>/library.json`. A client fetches it over plain WebDAV with
`If-None-Match`; an unchanged index answers `304` without touching storage.
When it changes, the client downloads one JSON document and diffs items by
`id`. No client-side protocol beyond WebDAV GET is required.

The index file is also the library's on switch. ZPan's index is the live file
in the library root named exactly `library.json` with type
`application/feed+json`. Creating a library writes it, removing a library
deletes it, and a library whose index is gone is off.

## 2. Data shape

`media_libraries` (one row per library):

| Column | Notes |
| --- | --- |
| `id`, `org_id` | `org_id` cascades with the organization |
| `folder_id` | The folder's matter id. Matters store their location as a `parent` path string, but ids are stable, so REST and WebDAV renames and moves keep the library attached. Unique per org. |
| `fingerprint` | Subtree fingerprint of the last successful scan or deterministic scan failure |
| `last_scanned_at` | Last successful scan |
| `created_by_user_id`, `created_by_actor_*` | Creator; sweep-queued jobs run as this user |

There is no movies/shows kind. The media type is inferred per file, so mixed
folders work.

Rules:

- The target must be a live folder in the caller's workspace.
- Libraries never nest. Marking a folder that is, contains, or sits inside a
  library fails with `409` and reason `MEDIA_LIBRARY_EXISTS` or
  `MEDIA_LIBRARY_NESTED`. Libraries whose folder is in trash count, because
  restoring the folder brings them back.
- The create-time check is the only guard: moves, restores, and a race between
  two creates can still leave libraries overlapping, and move and restore do
  not consult libraries. Overlap is made harmless at scan time instead. Of two
  overlapping live libraries in a workspace, the older one (`created_at`, then
  `id`) is scanned. The newer one's scan fails with
  `Media library overlaps the older media library at "<path>"`, so the conflict
  shows in the task list until the user removes one of them.
- A folder whose root already holds a live entry named `library.json` (file or
  folder, in any case, since live sibling names are unique
  case-insensitively) cannot become a library: create fails with `409` and
  reason `MEDIA_LIBRARY_INDEX_OCCUPIED` and creates nothing. ZPan never takes
  over a file the user put there.
- A library whose folder is trashed is skipped by the sweep. A library whose
  folder was purged is deleted by the sweep (or by a scan that finds it).
- A library whose index is gone is off. That covers an index that was trashed,
  purged, renamed, moved away, or replaced by a file of another type. The
  sweep deletes such a library and logs
  `media_library.sweep.deleted reason=index_removed`. A scan job that finds the
  index gone deletes the library and fails with
  `Media library index was removed, so the library was turned off`, so the
  task list shows why the library disappeared. Neither ever recreates the
  index.
- Removing a library permanently deletes its `library.json` (the matter, its
  storage object, and the usage it held) and then the row. The folder and its
  videos stay.

## 3. Change detection

Scans are not hooked into write paths. Uploads, WebDAV writes, archive
extraction, and remote downloads into a library are all covered by one sweep
on the existing 10-minute cron (`*/10 * * * *` on Workers, the matching
`setInterval` on Node).

For each library the sweep computes one aggregate over live matters in the
subtree, excluding only the index file itself (`library.json` directly in the
library root). Any other file counts, including one in a folder a user happens
to name `.zpan`:

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
Each library is swept on its own: an error on one library is logged as
`media_library.sweep.library_error library=<id> org=<id>` and the sweep moves
on, so one broken library cannot stall the others or fail the shared cron
tick. Deleting a library whose folder was purged is logged as
`media_library.sweep.deleted`.

## 4. Scan job

`media_library_scan` is a background job routed through the same queue as
archive jobs: `runBackgroundJob` maps each job type to its processor, and the
Workers queue consumer and the Node in-process queue both call it. It cannot
be created through `POST /api/background-jobs`.

The processor:

1. Loads the library and its folder; fails the job if either is gone or
   trashed. Turns the library off and fails the job if its index is gone.
2. Computes the fingerprint **before** listing, so a change that races the
   listing produces one extra scan instead of being lost. Excluding the index
   file means the job's own write never retriggers a scan.
3. Fails if an older live library overlaps this one (see the nesting rule).
4. Lists live files in the subtree whose stored MIME is `video/*` or whose
   extension is a known video extension, and builds the feed. Recording the
   file count on the job here also renews its `updated_at`, so a listing of a
   large library does not lose the scan lease before the write.
5. Rewrites `<library>/library.json` in place: a fresh object key per write,
   quota reserved for growth, `applyUpload` on the existing row (so size and
   `updated_at`, and therefore the WebDAV ETag, change), then the old object is
   deleted. A new key means a reader holding a cached matter row never pairs
   new bytes with an old `Content-Length`. The new index is live once the row
   is updated, so a failed delete of the old object is logged
   (`media_library.scan.old_index_delete_error`) and leaves an orphaned object
   instead of failing the job.
6. Stores the fingerprint and `last_scanned_at`, and drops the WebDAV child
   listing cache for the library folder.

Failures split in two. A deterministic failure stores the attempted
fingerprint, so it does not re-enqueue on every sweep; the next change in the
subtree or a manual rescan retries. These are a quota exceeded by the index,
a missing index storage, and an overlap with an older library. Any other failure (a storage or database error)
leaves the fingerprint untouched, so the next sweep retries it, including a
failed first scan.

When background jobs are disabled (`ZPAN_ARCHIVE_JOBS_ENABLED=false`, as in
Branch Previews, which have no queue consumer), create and rescan return `503`
and the sweep does not run.

## 5. Index format

`<library>/library.json`, `application/feed+json`, a full snapshot in
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
      "attachments": [{ "url": "Inception%20(2010).mkv", "mime_type": "video/x-matroska", "size_in_bytes": 42 }],
      "_media": { "type": "movie", "title": "Inception", "year": 2010 }
    }
  ]
}
```

- `id` is the video's matter id, stable across renames and moves.
- `attachments[0].url` is the library-relative path, each segment
  percent-encoded. The feed sits in the library root, so standard RFC 3986
  resolution against the URL the client fetched yields the video's WebDAV
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
`media-libraries:read|create|update|delete`; writes need the editor role.
Create and rescan need the `media_library` feature (`402` otherwise). List and
delete do not, so after a license lapses users still see their libraries and
can remove them.

Creating a library stores the row, writes an empty-items `library.json` in the
same request, and then queues the first scan to fill it. If the index cannot be
written, the row is deleted and the request fails (`422` when it exceeds the
quota). If queueing fails, the request still returns `201` with
`scanning: false` and logs `media_library.create.enqueue_error`; the library
has no fingerprint, so the next sweep scans it.

Deleting a library purges the index first, then the row. If deleting the row
fails, the library is already off and the next sweep drops it.

The file manager shows "Set as media library", "Rescan media library", and
"Remove media library" on folders, and the details sheet shows status, last
scan, and the index path. It loads the workspace's libraries once and joins
them to folders by id, so the object DTO is unchanged. The list loads
regardless of entitlement. Without it, "Set as media library" and "Rescan
media library" carry a Pro badge and open an upgrade prompt, while "Remove
media library" and the details still work for existing libraries. "Remove
media library" asks for confirmation and names the `library.json` it deletes.

## 7. Future phases

- **TMDB scraping.** Match `_media` titles and years to TMDB and add ids,
  overviews, and artwork URLs to each item. The TMDB API key is an
  instance-level admin setting stored in `system_options` and masked like the
  other secrets.
- **Sidecars.** Write `.nfo` files and posters next to videos (Kodi/Jellyfin
  layout) so players that ignore the feed still get metadata. Sidecars are
  library content and count toward the fingerprint; only `library.json` stays
  excluded.
- **Subtitles and extras.** List sidecar subtitles per item as additional
  attachments.

## 8. Open decisions

- **Non-video changes.** Any change in the subtree (a new `.txt`) rewrites the
  index, and `generatedAt` changes the ETag even when items are equal.
  Skipping the write when the item list is unchanged needs a stored digest.
- **Naming.** `ZPAN_ARCHIVE_JOBS_ENABLED`, the `ARCHIVE_QUEUE` binding, and
  configz `services.archive.enabled` now cover every background job. Renaming
  them is an operator and API contract change left for a separate pass.
- **Lost dispatch.** If the job row is created but the queue send fails, the
  `queued` row holds the scan lease until it expires an hour later, and only
  then does the sweep queue a new scan.
- **Concurrent scans.** The lease check and the job insert are not atomic, so
  a manual rescan and the sweep enqueuing in the same instant can run two
  scans. The later write wins, and the earlier scan's object can be left
  orphaned in storage. A partial unique index on active scan jobs would close
  this.
