# Media Libraries

> Status: Phase 1 implemented (filename index). Phase 2 in progress: scraping
> in the downloader, file metadata, and the Movies and TV views; the index
> already takes `_media.tmdb` from file metadata. The server-side TMDB
> scraper (the `media_scrapes` table, the `media_library_scrape` job, the TMDB
> gateway and its settings, and `POST /api/media-libraries/{id}/scrapes`) is
> removed; migrations 0101 and 0102 drop its table, its system options, and
> its jobs.
> Editions: media libraries are Pro and Business (`media_library` feature
> gate). Scraping and the Movies and TV views are in every edition.

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

Scraped metadata lives on the matters themselves, see
[File metadata](#6-file-metadata).

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

## 5. Scraping in the downloader

Scraping is a step of the downloader agent, not a server job. A downloader
with scraping turned on matches each finished download to
[TMDB](https://www.themoviedb.org/) on the machine that holds the files,
uploads it under a media-server layout with Kodi/Jellyfin sidecars next to
the videos, and records the result in [file metadata](#6-file-metadata).
Videos that reach ZPan any other way (browser uploads, WebDAV, archive
extraction) are not scraped. They still appear in `library.json` with what
their filenames say, and a user who wants artwork for them can put sidecars
there by hand.

The downloader is the right place because it holds what a match needs and
the server never sees: the torrent or release name, metadata the source
provides, and the video bytes themselves. It also runs on user-owned
hardware with no Workers subrequest or CPU limits, and a download scraped
before it is uploaded arrives with its artwork. Scraping needs no license in
any edition, since it runs on the user's agent with the user's own token.

### The post-processing step

Between a finished download and its upload, the task runner passes the
download's `Result` (local path and upload name) through a chain of
processors, each `Process(ctx, Result) (Result, error)`. The chain is empty
unless configured, which keeps today's behavior. Scraping is one processor,
in its own package `pkg/mediascrape`, which imports nothing from the
downloader and can be tested against a plain directory.

A processor never changes the downloaded files, because the engine may still
be seeding them. It writes what it adds into an overlay directory under the
downloader's state directory (`<state_dir>/overlays/<task id>`, removed once
the upload ends) and returns the upload layout as a plan: where each
downloaded video goes, and which overlay files go next to it. The uploader
uploads the plan, not the download directory.

The scraper hands its result to the rest of the pipeline only as files: the
`.nfo` documents and images of the [sidecar layout](#sidecars). The step that
writes file metadata reads those files back, so it works the same for any
processor that produces that layout, including a future one that runs an
external tool such as FileBot or tinyMediaManager.

A processor that fails, times out, or finds no match leaves the `Result`
unchanged, so the task uploads exactly as it would without scraping. A
scraping failure never fails the task. The downloader reports its reason as
`scrapeSkippedReason` on the task update, which appends a `scrape_skipped`
event that the task timeline shows as a warning, while the task's own error
stays empty.
A TMDB `429` waits for `Retry-After` (1 to 300 s, 10 s when absent) up to 10
times in a row before scraping gives up on the task; a `401` gives up at
once, naming the token as the cause.

### Settings

Scraping is a switch in the downloader's own configuration, off by default,
and applies to every task the downloader runs; a task with no video in it is
left alone. It takes a TMDB API Read Access Token (v4, sent as a bearer
token), a language (a TMDB tag, `en-US` by default), and optional base URLs
for the TMDB API and image hosts:

```yaml
downloader:
  scrape:
    enabled: true
    tmdb_token: "<API Read Access Token>"
    language: "zh-CN"
    # tmdb_api_url: "https://api.themoviedb.org/3"
    # tmdb_image_url: "https://image.tmdb.org/t/p"
```

Enabling it without a token stops the downloader at startup. The server stores no TMDB credential. A
downloader often runs at home behind a network that cannot reach
`api.themoviedb.org` or `image.tmdb.org` directly; the base URLs and the
standard `HTTPS_PROXY` variable cover a mirror or a proxy.

### Matching a video

The scraper parses each video with the same rules as the index (`SxxEyy`,
`NxNN`, `第N季第M集`, `Title.Year...`, `Title (Year)`), taking the download's
root folder as the outermost folder, and settles its TMDB id in this order:

1. **A `.nfo` in the download.** For a movie, `X.nfo` and then `movie.nfo` in
   the video's folder; for an episode, `tvshow.nfo` in its folder or the
   nearest folder above it in the download. The
   first one with a TMDB id (`<uniqueid type="tmdb">` or `<tmdbid>`) names the
   match, unless its root element says it describes something else. An
   episode's own `.nfo` carries the episode id, not the series. Only the
   first 64 KB of a file is read, in one forward pass over the tags that
   skips comments, processing instructions, and declarations, so a malformed
   file still yields its id.
2. **An id from the source**: a task tag `tmdb:<id>` or `imdb:<tt id>`, the
   only place a task carries one today. A `tmdb:` id names a show when the
   download holds episodes and a movie otherwise; an IMDb id is resolved
   through TMDB's find endpoint.
3. **A search** for the parsed title in the configured language and then in
   English, with the parsed year (`year` for movies, `first_air_date_year` for
   shows) and then without it. A search with no results at all skips the
   other language for that year, which would find the same nothing. When the
   video's own name parses as `unknown`, the task's release name is parsed
   instead.

A video neither name classifies (such as `holiday-clip.mov`) is matched only
through a `.nfo` or a source id, because a search for a title like that
matches unrelated films. A sample (a video whose base name ends in `sample`,
or one in a `Sample` folder) is not a video for matching; it uploads as an
ordinary file. Every video of the download must match the same movie, or
every episode the same show, or the download is uploaded unscraped, and so
is a download that holds both a movie and episodes. In a download of
episodes, a video neither name classifies is an extra and uploads as an
ordinary file.

A search result matches when its localized or original title has a Dice
similarity of at least 0.85 to the parsed title (character bigrams after
NFKD, ignoring accents, case, punctuation, `&` versus "and", and a leading
English article), both titles end in the same sequel number, and its year is
within one of the parsed year. The sequel number is a trailing number (also
run into a CJK title, as in `唐人街探案2`) or a roman numeral after a space,
so `Toy Story 2` does not match `Toy Story 3` or `Toy Story`, and `Rocky II`
does not match `Rocky III`, however similar the rest is. A missing year on
either side is neutral. The most similar title wins, then the closest year,
then TMDB's order.

Episodes of one show in a task share one show fetch and one fetch per
season. A download whose videos match more than one movie or show is
uploaded unscraped, since one task has one upload root.

### Upload layout

A matched download is uploaded under the task's target folder by what it is,
not by the torrent name:

| Download | Uploaded as |
| --- | --- |
| A movie, as a folder or a single file | `<target>/Title (Year)/<video file>` |
| Episodes of one show, a season pack or a single episode | `<target>/Show (Year)/Season NN/<video file>` (`Season 00` for specials) |

`Title` and `Show` are the TMDB title in the configured language, with
characters a file name cannot hold (`/ \ : * ? " < > |`) replaced by a space
and runs of spaces collapsed; `(Year)` is left out when TMDB has no date.

- **Video files keep their names.** The original name carries the release
  details (resolution, source, group) that tell versions apart, and both
  Kodi and Jellyfin read any video name inside a movie folder and the
  `SxxEyy` already in an episode name. Files of the download that are not
  videos (subtitles, samples, extras) keep their path relative to the video
  they sat next to. For episodes that is the nearest folder above the file
  that holds an episode, placed in that folder's lowest regular season, or
  in the season the file's own name carries (`Show.S01E02.en.srt`); a file
  above every episode goes in the show folder.
- **Folders are reused.** The movie, show, and season folders are looked up
  by name in their parent before they are created, so a second version of a
  movie lands beside the first, and a later season or episode joins its
  show. The lookup is case-insensitive like live sibling names. The create
  uses `onConflict: fail`; a `409` means another task created the folder in
  between, and the uploader looks it up again and uses it. Every folder of
  the layout is settled before any file goes up, so an existing entry of one
  of those names that is a file, not a folder, makes the download upload
  unscraped before any of its files is uploaded. An upload that fails later
  deletes the files it created and keeps the folders, which another task may
  have joined in the meantime.
- **Video names still never collide.** A video whose name is taken in the
  reused folder is renamed by the server (`X (1).mkv`), as today, and its
  sidecars take the name it was given.

The task upload token can therefore read, as well as create, inside the
task's target folder: it gains `objects:read`, limited to that folder's
subtree like its other scopes are limited to the task. The lookup is
`GET /api/objects?parent=<folder>&name=<name>`, whose `name` filter matches
one live entry case-insensitively. A task upload token is refused on every
route that does not declare it confines the token to the target folder
(`taskUpload` in the route's authorization policy), whatever scopes it
carries: today the object list (without `search`), object create, the upload
session routes, and the media metadata write.

An unmatched download keeps today's layout, the torrent or requested name
under the target folder.

### Sidecars

| Video | Written next to it | Written in the show folder |
| --- | --- | --- |
| Movie `X.mkv` | `X.nfo` (`<movie>`: title, originaltitle, year, plot, premiered, genre, runtime, `<uniqueid type="tmdb" default="true">`), `X-poster.jpg` (w780), `X-fanart.jpg` (w1280) | none |
| Episode `X.mkv` | `X.nfo` (`<episodedetails>`: title, season, episode, plot, aired, `<uniqueid type="tmdb">` of the episode), `X-thumb.jpg` (still, w300) | `tvshow.nfo` (`<tvshow>`: title, originaltitle, year, plot, premiered, genre, `<uniqueid type="tmdb" default="true">`), `poster.jpg` (w780), `fanart.jpg` (w1280), and `seasonNN-poster.jpg` (w780; `season00` for specials) for each season the download holds |

- **Existing files win.** Sidecars are created with `onConflict: fail`. A
  live entry already at a sidecar path, such as the `tvshow.nfo` of a show
  folder an earlier task filled, is kept, and the uploader uses that entry
  wherever the metadata references the sidecar. That holds when two tasks
  upload the same sidecar at once: an upload that fails while a live entry
  holds its name keeps that entry. A `.nfo` or image the
  download itself contained is uploaded as an ordinary file, and the scraper
  writes none in its place.
- **Language.** Details and seasons are fetched in the configured language.
  When a plot is empty there, one English fetch fills it. Posters prefer the
  configured language, then no text, then English; fanart prefers no text.

Sidecars count against the workspace quota like any other file of the task.

## 6. File metadata

Every matter, file or folder, has a nullable `metadata` column holding a
JSON object keyed by namespace. The `media` namespace is the only one, and
its schema lives in `shared/schemas/matter-metadata.ts`. The server
validates the object against that schema and rejects one over 16 KB; it
never calls TMDB or reads the referenced files.

| `media.kind` | On | Fields |
| --- | --- | --- |
| `movie` | the video | `tmdb` (`{ id, type: "movie" }`), `title`, `originalTitle`, `year`, `overview`, `genres`, `runtime`, `poster`, `fanart` |
| `tvshow` | the show folder | `tmdb` (`{ id, type: "tv" }`), `title`, `originalTitle`, `year`, `overview`, `genres`, `poster`, `fanart` |
| `episode` | the video | `tmdb` (the series, `{ id, type: "tv" }`), `season`, `episode`, `title`, `overview`, `aired`, `still` |

`poster`, `fanart`, and `still` are matter ids of the sidecar images, so a
reader shows them through the ordinary object download path, and a rename or
move of the image or the video keeps the reference. Show-level data sits on
the show folder because a show is not a file: its episodes reference the
series only through `tmdb`.

Writes:

- **Who writes.** A download task's scoped upload token may set `media`
  through `PUT /api/objects/{id}/metadata/media`, in every edition, on the
  objects that task created and on a reused show folder that has no `media`
  yet, so an earlier task's show data is never overwritten. An object the
  task created is a live matter in the task's target folder created by the
  task's downloader since the task's current assignment, so two tasks of one
  downloader running at once into the same folder can write each other's
  objects. Any other folder in the target folder takes `media` only while it
  has none (`409` otherwise); any other file is refused with `403`. A
  `tvshow` goes on a folder and a `movie` or `episode` on a file (`400`
  otherwise). The downloader sets it after the video's sidecars exist, since
  it references their ids, and takes an episode's series id from the
  `tvshow.nfo` of the upload; a `409` on the show folder leaves the earlier
  show data in place.
  No other caller writes metadata yet, and the object DTO does not carry it.
- **Fingerprint.** Setting metadata bumps the matter's `updated_at`, so the
  [change detection](#3-change-detection) terms already cover it, and the
  next sweep publishes the new id into `library.json`.
- **Rename, move, trash, restore** keep the metadata; it belongs to the
  matter id.
- **Copy** copies the metadata. Its image references keep pointing at the
  original sidecars, which is correct while they live.
- **Overwrite** of a file's content (WebDAV `PUT`, an upload with
  `onConflict: replace`) clears its metadata, because the old match may not
  describe the new content.

A reference to an image that is trashed or purged is shown as missing; the
metadata is not rewritten.

## 7. Index format

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
      "_media": { "type": "movie", "title": "Inception", "year": 2010, "tmdb": { "id": 27205, "type": "movie" } }
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
- `_media.tmdb` is the video's `media.tmdb` from
  [file metadata](#6-file-metadata), `{ "id", "type" }` where `type` is
  `movie` or `tv` and an episode's id is its series. It is absent for a video
  without one. Nothing else from the metadata goes into the index; players
  read titles and artwork from the sidecars. The listing page reads it with
  `json_extract(metadata, '$.media.tmdb')` and leaves the rest of the column
  in the database, so a page still binds 26 parameters (27 with the cursor)
  and walks one range of `matters_webdav_path_idx`.

## 8. API and UI

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
regardless of entitlement. Without it, the folder menu offers no way to mark
a library: "Set as media library" and "Rescan media library" are hidden,
while "Remove media library" and the details still work for existing
libraries. "Remove media library" asks for confirmation and names the
`library.json` it deletes.

### Movies and TV

The sidebar has two entries, **Movies** and **TV Shows**, that show the
current workspace's scraped media as a poster grid. They read
[file metadata](#6-file-metadata) only, wherever the matters sit in the
workspace, inside a media library or not, and need no TMDB access from the
browser or the server.

| Endpoint | Returns |
| --- | --- |
| `GET /api/media/movies` | Live videos with `media.kind = movie`, a cursor page newest first (`created_at`, then `id`): matter id, path, `media`, `posterUrl` |
| `GET /api/media/shows` | Live folders with `media.kind = tvshow`, the same page shape |
| `GET /api/media/shows/{id}` | One such folder, the same item shape; `404` for a folder that is not a live show |
| `GET /api/media/shows/{id}/episodes` | Live videos with `media.kind = episode` in that folder's subtree, a cursor page (50 by default) ordered by season, episode, then `id`: matter id, path, `media`, `stillUrl` |

Each item carries a short-lived inline URL for its `poster` (or `still`) when
the image resolves to a live matter, metered as a download of that image; a
missing image, or one the workspace's traffic quota does not allow, is
omitted and the card shows the title on a placeholder. Fanart is not in the
list, since a page would meter a backdrop for every card: the movie sheet
and the show page fetch it through `GET /api/objects/{id}` when they open. The lists use a partial
expression index `matters_media_kind_idx` on
`(org_id, metadata ->> '$.media.kind', created_at desc, id desc)` over live
matters (`->>` rather than `json_extract`, because drizzle-kit splits a
function call's arguments when it writes the index), and the episode list
uses the subtree range from
[change detection](#3-change-detection). Scope is `objects:read`, with no
feature gate, like scraping itself.

A movie card opens a sheet with the fanart, title, year, genres, runtime,
overview, and a play action that opens the video in the existing preview. A
show card opens the show's page (`/shows/<id>`), a page rather than a sheet
because a show's episodes are a list of any length: the fanart, poster,
title, year, genres, and overview, then the seasons, specials first, each
listing its episodes with still, number, title, and overview; an episode
plays in the existing preview. The pages follow the list rules in
[UX.md](../../UX.md): the next cursor page loads as the user scrolls, and the
open movie is in the URL (`/movies?movie=<id>`).

## 9. Future phases

- **Subtitles and extras.** List sidecar subtitles per item as additional
  attachments.
- **Correcting a match.** Let an editor set or clear `media` on a video or
  folder, so a wrong or missing match can be fixed without a downloader.

## 10. Open decisions

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
