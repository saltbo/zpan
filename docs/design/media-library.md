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
count(id) : sum(size) : max(updated_at) : sum(updated_at)
```

Every write that changes what a scan sees moves one term: create, copy,
restore, and draft activation add a row; trash and purge remove one; rename,
move, and overwrite bump `updated_at` (moving a folder bumps every descendant
through `cascadeParentPath`). `updated_at` has second precision, so
`sum(updated_at)` also catches a change landing in the same second as the
previous maximum. The remaining blind spot is a second edit to a row already
modified in the same second the fingerprint was taken.

The subtree match is `parent >= P AND parent < 'P0' AND (parent = P OR
parent >= 'P/')`: one index range on `(org_id, parent)` with no LIKE, so `%`
and `_` in folder names are literal and D1's LIKE pattern limits do not apply.
`'0'` is the code point after `/` under SQLite's binary collation, so the range
holds `P`, everything under `P/`, and siblings such as `P-2` that sort before
`P/`; the residual test drops those siblings. It means the same as
`parent = P OR (parent >= 'P/' AND parent < 'P0')`, but SQLite cannot use the
index for that OR once `P` comes from a joined row, and falls back to scanning
the whole organization per library.

The sweep queues a scan when the fingerprint differs from the stored one and
no scan for the library holds the lease (a `queued` or `running`
`media_library_scan` job updated within the last hour). The lease keeps a
consumer that died mid-scan, or a Node restart that lost the in-process
queue, from freezing a library forever. Creating a library queues a scan
immediately, and `POST /api/media-libraries/{id}/scans` requests one on demand
(`409 MEDIA_LIBRARY_SCAN_IN_PROGRESS` while the lease is held).

The sweep runs only when the instance is entitled (`media_library`), and it
verifies the license certificate against the configured `ZPAN_CLOUD_URL`.

A Workers invocation caps its subrequests, and every D1 call and queue send is
one, so the sweep's calls do not grow with the number of libraries:

1. One read returns every library on the instance with what the decision
   needs: the library row, its folder (purged, trashed, path), whether its
   index exists, whether a scan holds the lease, and the current fingerprint.
   It is a grouped join of `media_libraries` to the live matters of each
   subtree, and it shares the fingerprint expression with the scan job, so
   the two cannot drift. Its bound parameters are fixed.
2. A pure function decides each library, in order: folder purged → delete;
   folder trashed → skip; index gone → delete; lease held → skip; fingerprint
   unchanged → skip; otherwise scan.
3. One D1 batch deletes every dead library (`DELETE ... WHERE id IN`, at most
   99 ids per statement), then logs `media_library.sweep.deleted
   library=<id> org=<id> reason=folder_purged|index_removed` for each.
4. Changed libraries are queued 100 at a time, the most one Cloudflare Queues
   `sendBatch` call takes. Per chunk, one D1 batch inserts every job row and
   its resource change (multi-row inserts sized under D1's 100 bound
   parameters), and one `sendBatch` sends the messages. The Node in-process
   queue pushes each message.

So a sweep makes `2 + (dead > 0 ? 1 : 0) + ceil(changed / 100)` D1 round
trips, counting the license read, and `ceil(changed / 100)` queue calls.
Measured on D1 in `workers/media-library-sweep.cf-test.ts`: 3 round trips and
1 queue call for one changed library; 5 round trips and 2 queue calls for 150
changed plus 150 dead libraries; 2 round trips when nothing changed. The
statements inside the batches still scale with the rows written (56 for the
150 + 150 case), which stays within one call each.

A failure is isolated per chunk instead of per library. A failed delete is
logged as `media_library.sweep.delete_error libraries=<ids>` and the
enqueueing still runs; a failed chunk is logged as
`media_library.sweep.enqueue_error libraries=<ids>` and the next chunk still
goes out, so one bad chunk cannot fail the shared cron tick. A failed read
fails the sweep, since there is nothing to decide without it.

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
4. Streams the feed into `library.json` one listing page at a time (see
   [Streaming the index](#streaming-the-index)). Live files in the subtree
   whose stored MIME is `video/*` or whose extension is a known video
   extension are listed 1,000 at a time, turned into feed items, and written
   out as they are read. Recording the running item count on the job after
   the first page and then every 10 pages also renews its `updated_at`, so a
   long write does not lose the scan lease.
5. Rewrites `<library>/library.json` in place: a fresh object key per write,
   then quota reserved for the growth over the old index, `applyUpload` on the
   existing row (so size and `updated_at`, and therefore the WebDAV ETag,
   change), then the old object is deleted. The size is known only once the
   stream is written, so the reservation follows the upload; if the growth
   does not fit, the new object is deleted and the job fails as a quota
   failure. A new key means a reader holding a cached matter row never pairs
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

### Streaming the index

The index stays one file however many videos the library holds; it is never
split into pages or shards. What bounds a scan is memory and CPU, so the
write is built to hold one page at a time.

- **Listing.** `listVideoFilesPage` is a keyset page ordered by
  `(parent, name)`: `(parent, name) > (last parent, last name)`, `LIMIT
  1000`. Live `(parent, name)` pairs are unique because
  `matters_active_name_uniq` is unique on `(org_id, parent, LOWER(name))`, so
  the keyset never skips or repeats a file. The keyset replaces the subtree's
  `parent >= P` lower bound. SQLite takes one lower bound for the index range,
  and with both present each page rescanned from the start of the subtree.
  The plan on both local SQLite 3.43 and the local Workers D1 is
  `SEARCH matters USING INDEX matters_webdav_path_idx (org_id=? AND
  (parent,name)>(?,?) AND parent<?)`, with no sort step. A page binds 26
  parameters (27 with the cursor) whatever the library size.
- **Serializing.** `serializeMediaLibraryFeed` yields the feed header, one
  chunk per page of items joined with commas, and the footer. The
  concatenation is byte for byte `JSON.stringify` of the whole feed (tested
  with CJK, quotes, backslashes, control characters, U+2028, emoji, and
  several page splits). Item construction stays a pure function of a page of
  files.
- **Writing.** The chunks are encoded through a pull-based `ReadableStream`
  into `putObject` with no length, which takes the adapter's multipart path:
  it buffers until it has a 5 MiB part, uploads it, and repeats. The stream
  advances only when the upload reads, so at most one page and one part are
  in memory. A small index costs three S3 calls (create, one part,
  complete) instead of one PutObject. Creating a library writes its empty
  index through the same serializer and path.

Measured (Node 24, Apple Silicon laptop, synthetic files, see
`server/usecases/media-library-scan.memory.test.ts`):

| Measurement | Result |
| --- | --- |
| Page query, 200k-video library plus 50k other rows, local SQLite | 2.1 to 3.1 ms per page for all 200 pages, 0.44 s total. With the old `parent >= P` bound kept, the last page took 61 ms and the run 6.4 s. 1 run each. |
| Live memory while streaming 200k videos (70.5 MB of JSON) through the real S3 adapter with its network stubbed | 17.2 MB peak above baseline (3 runs, identical to 0.1 MB). 50k, 100k, and 400k videos peak at 16.8, 17.0, and 17.3 MB, so it does not grow with the library. The 5 MiB multipart part buffer dominates it. |
| Live memory of the old whole-feed write for the same 200k videos | 277 MB (rows, items, JSON string, and bytes held at once), about 1.4 KB per video. 400k videos: 561 MB. |
| CPU to build items, serialize, and encode | 400 ms for 200k videos (median of 5 warm runs, 399 to 404 ms), 2.14 s for 1M. About 470k to 500k videos per second. |

Measured memory counts the JS heap plus `ArrayBuffer` storage after a forced
GC at every page and every uploaded part. `ArrayBuffer` storage is freed by a
background sweeper, so the peak includes some part buffers already released.

### Limits that remain

The index is still one object, so what remains is the work of one queue
invocation. These are estimates from the numbers above, not measurements on
Workers.

- **CPU time.** A queue consumer gets the Workers CPU limit: 30 s by
  default on the Paid plan, configurable up to 5 minutes with
  `limits.cpu_ms`; 10 ms on Free. `wrangler.toml` sets no `cpu_ms`, so the
  default applies. Item building and serializing cost about 2 µs per video
  locally. The scan also decodes D1 rows and signs S3 parts, which these
  numbers do not include. Assuming those double the per-video cost, the
  30 s default fits on the order of 5 to 7 million videos and 5 minutes
  several times more (estimated). A Free-plan invocation's 10 ms covers only
  a few thousand (estimated). Wall time is not the constraint: a queue
  consumer may run for 15 minutes, and D1 time is spent waiting, not on CPU.
- **Subrequests.** Each D1 page, each lease renewal (one per 10 pages), and
  each 5 MiB part is a subrequest. A million videos make about 1,000 page
  reads, 100 renewals, and 70 parts (inferred from 350 bytes per item),
  well under the Paid plan's 10,000 per invocation; the cap would bite near
  8 million videos.
- **Memory.** The 128 MB isolate limit no longer depends on the library
  size. The scan holds one 1,000-file page and one 5 MiB part.
- **Clients.** A 1M-video index is about 350 MB of JSON. Players download
  and parse the whole file when it changes, which is a client concern rather
  than a server limit.

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
- Items are ordered by folder and then file name: `parent`, then `name`,
  compared as bytes (SQLite's binary collation). Equal trees produce equal
  item lists. This is not quite full-path order: the files directly in
  `Shelf 1` come before `Shelf 1-b/x.mkv`, although `Shelf 1-b/x.mkv` sorts
  before `Shelf 1/x.mkv` as a full path, because the folder `Shelf 1` sorts
  before `Shelf 1-b`.
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
- **Lost dispatch.** If the job rows are created but the queue send fails, the
  `queued` rows hold the scan lease until it expires an hour later, and only
  then does the sweep queue new scans. For the sweep this covers a whole
  chunk of up to 100 libraries.
- **Concurrent scans.** The lease check and the job insert are not atomic, so
  a manual rescan and the sweep enqueuing in the same instant can run two
  scans. The later write wins, and the earlier scan's object can be left
  orphaned in storage. A partial unique index on active scan jobs would close
  this.
