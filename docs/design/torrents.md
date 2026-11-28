# Torrents

> Status: Accepted. Sections 1–13 describe the design as built; [section 14](#14-phases)
> lists how it was built.
> Editions: Pro and Business, self-hosted only

## 1. Problem

A family or a small circle that streams video has two common setups, and both
fall short. Commercial Debrid services allow one IP at a time, so an account
cannot be shared across homes, and they cache little CJK or private-tracker
content. A home NAS with Jellyfin or Infuse runs out of upload bandwidth when
several people stream 4K from outside, and every title has to be requested and
downloaded by hand.

ZPan already has the pieces of a private Debrid service: downloads that
user-run engines (qBittorrent, Aria2) push into S3, optional scraping in the
downloader, presigned URLs that carry playback straight from the bucket with
`Range` seeking, accounts with quotas, and traffic metering. Torrents adds what
is missing:

- One copy of each torrent on the instance, keyed by its infoHash, whoever
  downloaded it.
- A **Torrents** list in every workspace, next to Files in the left menu.
- **Instant transfer** (秒传): a torrent already on the instance reaches a
  workspace without downloading or copying bytes.
- The StremThru Store API, through which community Stremio addons such as
  MediaFusion search torrents themselves and use ZPan as their Debrid service.

## 2. Decisions

1. A torrent is identified by its BitTorrent v1 infoHash alone, across all
   storages. ZPan does not deduplicate ordinary uploads.
2. Everything a torrent download uploads, the torrent's files and the
   scraper's sidecars alike, is stored once under the reserved object-key
   prefix `bt/<infoHash>/`. Nothing under `bt/` is ever stored twice.
3. A drive file may reference an object under `bt/`. Changing its content
   writes a new object the file owns and points the file at it; deleting it
   removes only the file. An object under `bt/` is never overwritten, and only
   eviction deletes it; the S3 gateway refuses any other deletion there.
4. A workspace's Torrents list is its own record, `workspace_torrents`, not
   its download tasks: a task is one run of a download, and an entry is the
   workspace holding a torrent however many runs it took, including none for an
   instant transfer. The list shows each torrent's own file tree, never a
   scraped layout, and holds no `matters` rows.
5. Where a torrent lands depends on who asked for it:

   | Requested through | Torrents list | Drive |
   | --- | --- | --- |
   | Remote download (the Downloads page or API) | Yes | Yes, in the task's folder |
   | StremThru (a Stremio addon) | Yes | Only when someone chooses *Save to drive* |

6. The downloader has one upload path, the one it already uses for the drive.
   The server decides from the task where each upload is stored. Scraping
   stays optional: an unscraped torrent is uploaded with its own tree, and a
   scraped one chooses each file's path and adds sidecars.
7. A torrent reaches other workspaces only after its pieces are verified
   against the infoHash.
8. A Torrents list entry costs no quota, because only drive files do. Entries
   that came from StremThru expire when the workspace stops playing them, and a
   torrent nobody holds is evicted by least-recent access
   ([section 11](#11-eviction)).
9. ZPan implements the StremThru Store API instead of a Debrid API of its own,
   and leaves searching for torrents to the addons that call it.

## 3. Data shape

`torrents`, one row per torrent on the instance:

| Column | Notes |
| --- | --- |
| `id`, `info_hash` | `info_hash` is the lowercase hex v1 infoHash, unique on the instance |
| `storage_id` | Where its objects live, chosen by the normal storage selection when the download starts |
| `name`, `total_size`, `file_count`, `private` | From the info dictionary. `private` is reported to clients and does not limit sharing: honouring a tracker's rules is the operator's call |
| `status` | `downloading`, `verifying`, `ready`, `invalid`, and `evicting` while eviction deletes it, which keeps an instant transfer from claiming it |
| `verified` | `full` or `sampled`, set when verification passes |
| `source_task_id`, `source_downloader_id` | The download that filled it, kept for blame when verification fails |
| `last_accessed_at` | Updated by instant transfer and link generation; drives eviction |

`torrent_files`, one row per entry of the torrent as its first download
uploaded it:

| Column | Notes |
| --- | --- |
| `torrent_id`, `id` | |
| `kind` | `file` for a file of the torrent, `sidecar` for a file the scraper wrote, `folder` for a folder the scraper placed files in |
| `file_idx` | For `file`: its position in the info dictionary, the index StremThru clients call `index` |
| `path` | For `file`: its path inside the torrent |
| `layout_path` | Where the first download put it, relative to the task folder (`Show (2019)/Season 01/Show.S01E02.1080p.mkv`). Equal to `path` for an unscraped torrent |
| `size`, `mime`, `object_key` | `object_key` is `bt/<infoHash>/<id>` for files and sidecars, null for folders |
| `media` | The [file metadata](media-library.md#6-file-metadata) `media` object set on the entry, with sidecar references as `torrent_files` ids |

The torrent's own tree is the `file` rows by `path`; the scraped layout is
every row by `layout_path`. Storage usage and eviction read these rows, so a
torrent needs no other table.

`bt/<infoHash>/info` holds the bencoded info dictionary beside the entries.
Verification needs its piece hashes (20 bytes per piece, about 256 KB for a
50 GB torrent in 4 MB pieces), which do not belong in D1.

`workspace_torrents`, one row per torrent a workspace holds, which is its
Torrents list:

| Column | Notes |
| --- | --- |
| `id`, `org_id` | `id` is also the item id StremThru clients see |
| `torrent_id`, `info_hash` | `info_hash` is known at submit for a magnet link and once the downloader reports metadata for a torrent URL; `torrent_id` once the `torrents` row exists. `(org_id, torrent_id)` and `(org_id, info_hash)` are unique, so concurrent adds of one torrent make one entry |
| `source` | `download` (a remote download) or `stremthru` |
| `source_uri`, `display_name` | The submitted link, and the name shown before metadata (a magnet's `dn`) |
| `task_id` | The download task the entry started, null when the torrent was already on the instance |
| `status`, `error` | `resolving`, `downloading`, `ready`, `failed`, and why it failed. Once the entry has a torrent, its status follows the torrent's; these columns carry what happens before there is one, such as a magnet whose metadata never arrives |
| `created_by_actor_type`, `created_by_actor_ref`, `created_by_actor_issuer` | Who added it: a user, or a StremThru key |
| `last_played_at` | Set on every playback link and file download from the entry; drives expiry |
| `created_at`, `updated_at` | |

Adding a torrent a workspace already holds returns the existing entry. A
torrent URL is matched by its link, resolved or not, or by the infoHash a task
of the workspace learned for it. A torrent URL cannot be matched by infoHash
before that is known, so an entry that resolves to a torrent the workspace
already holds merges into that entry. A merged entry is a `download` one when
either entry was, and a remote download of a torrent a `stremthru` entry holds
makes that entry a `download` one.

`download_tasks` carries `info_hash` once known, `torrent_id`, and
`torrent_role`: `fill` for the task whose download is the torrent's first,
`join` for a remote download waiting on another task's download, null
otherwise. `list_only` marks the task a StremThru add starts, which writes no
drive rows; it lives on the task because the task's entry may be removed or
merged while the download runs.

`bt/` cannot collide with other keys: drive objects are
`<orgId>/<uid>/<date>/<token>` and image-hosting objects are `ih/…`
(`server/lib/path-template.ts`), and an organization id never equals `bt`.
`isTorrentKey(key)` is the single test for the prefix.

`matters` has an index on `(storage_id, object)`, so references to a torrent's
objects can be counted without scanning the table; the range
`object >= 'bt/<infoHash>/' AND object < 'bt/<infoHash>0'` covers a whole
torrent.

## 4. Downloading a torrent

A remote download of a `magnet` or `torrent_url` source, and a StremThru add,
both create a Torrents list entry and look the torrent up. The infoHash is known
at submit time for a magnet link (`xt=urn:btih:`), and once the downloader
reports the info dictionary for a torrent URL.

1. A `ready` torrent completes the request at once by instant transfer.
2. A `downloading` or `verifying` torrent makes the request wait for it, so two
   requests for the same torrent download it once. A remote download becomes a
   `join` task; a StremThru add needs no task. Both finish by instant transfer
   when the torrent becomes `ready`.
3. Otherwise a download task becomes the torrent's `fill` task and inserts the
   `torrents` row as `downloading`: the submitted task for a remote download, a
   new task in the workspace for a StremThru add. The unique `info_hash` turns
   a concurrent second insert into step 2.

A torrent URL task that turns out to be cached or already downloading is
cancelled on the downloader the usual way, and finishes as in steps 1 and 2.
A list-only `fill` task whose torrent loses every holder before it completes is
cancelled; a remote download goes on, because its drive files are the user's
own request. A `fill` task that fails marks every waiting entry `failed`, and
an addon that adds a failed entry again starts it anew.

The downloader uploads a torrent task exactly as it uploads any task into the
drive: scraping when it is configured to, then folders, files, and metadata
through the object API under the task's upload token. Two additions tell the
server what it is uploading:

- As soon as the engine has the torrent's metadata, the downloader reports the
  bencoded info dictionary on the task. qBittorrent exports it through its Web
  API (`torrents/export`, Web API 2.8.14 and later), and Aria2 saves it as
  `<infoHash>.torrent` with `bt-save-metadata`.
- Each file of the torrent is created with `torrentPath`, its path inside the
  torrent, because scraping may give it a different name. Every file of the
  torrent goes up, dot-files and `.torrent` files included. Only the engine's
  own control files beside them are left out.

The report is taken only before the upload starts (the task `assigned` or
`downloading`). The downloader drops its download only when the answer settled
the task, either completed by instant transfer or queued to join. Any other
answer, a 403 or 409 included, just ends reporting and leaves pausing and
canceling to the task's controls. A file of the torrent has one upload at a
time. A repeated create in the same folder under the same name, as a retried
request sends, replaces its draft. Any other create of the same file is
refused, and so is one after the file landed.

The server stores the uploads of a `fill` task under `bt/<infoHash>/`, records
each one in `torrent_files` with the `layout_path` it was created at, and
records folders and `media` writes the same way. For a remote download it also
writes the drive files and folders, each file referencing its `bt/` object. For
a StremThru task it writes no drive rows: the ids the object API returns name
`torrent_files` entries, so folder lookups, conflicts, and metadata writes work
on the torrent's own layout.

A downloader that never reports an info dictionary, such as one built before
Torrents, uploads ordinary drive files, and the torrent stays off the instance.
Only v1 and hybrid torrents are kept. Padding files (BEP 47) count for piece
boundaries but get no row.

Sidecars are written in the downloader's
[scrape language](media-library.md#settings), English by default. The first
download's sidecars serve every later holder.

## 5. Instant transfer

Instant transfer gives a workspace a torrent already on the instance by writing
rows. Its Torrents list entry becomes `ready`. Into the drive,
for a remote download or *Save to drive*, it writes every `torrent_files` row
under the target folder by `layout_path`, files and sidecars referencing their
`bt/` objects, and `media` resolved to the ids of the matters it wrote. It
follows the [upload layout](media-library.md#upload-layout) rules: movie, show,
and season folders are reused by name, a sidecar already present wins, and a
video whose name is taken is renamed (`X (1).mkv`).

The first requester's task needs no transfer: its drive files are the ones it
uploaded, at the layout every later holder replays.

**Organization quota** grows by the full size of the drive files a transfer
writes, as for any file, and the reservation runs before the rows are written.
**`storages.used`** grows when objects land under `bt/` and shrinks when they
are evicted; a transfer does not move it. `reconcile` in
`server/adapters/repos/storage-usage.ts` sums drive rows outside `bt/` and the
storage's `torrent_files`, so a torrent is counted once however many hold it.

## 6. Drive files that reference a torrent

A drive file that references `bt/` is an ordinary file to its workspace:

| Action | Effect |
| --- | --- |
| Rename, move within the storage, share, trash, restore | Unchanged; none touches the object |
| Overwrite (upload replace, WebDAV `PUT`) | Writes a new object the file owns and points the file at it |
| Delete (permanent delete, trash expiry) | Purges the row; the object is left to eviction |
| Copy, WebDAV `COPY` | Writes another reference |
| Save a share to a drive | Another reference when the target storage is the torrent's, an owned copy otherwise |
| Move to another storage | Rejected; a reference cannot leave its storage |

Every path that releases a drive file's object goes through
`releaseMatterObject`, which skips `bt/` keys.

## 7. Verification

The downloader is user-run, so its uploads are not trusted. Without
verification, an upload carrying a popular infoHash and different bytes would
poison every later hit. Three checks close this:

1. **Info dictionary.** SHA-1 of the reported info dictionary must equal the
   infoHash. Without this, a forged dictionary could carry forged piece hashes.
2. **Structure.** The `file` rows' count, paths, and sizes must match the
   dictionary.
3. **Pieces.** The bytes are read back from S3 and every piece's SHA-1 is
   compared with the dictionary. Files are concatenated in order, because
   pieces span file boundaries.

Check 1 runs when the downloader reports the dictionary, and check 2 when the
`fill` task completes. Check 3 runs as a
`torrent_verify` background job that streams pieces through
`crypto.DigestStream` on Workers or `createHash` on Node and continues in
follow-up messages over piece ranges, so no invocation hits CPU or subrequest
limits. Where background jobs are disabled, as on branch previews, it runs the
32-piece sample inside the completion request.

Reading R2 from Workers has no egress fee, so R2-backed torrents are verified
in full. On storages that charge egress, a full read costs as much as serving
the torrent once, so those verify a random sample of 32 pieces, which catches a
substituted file with near certainty; `verified` records which kind passed.

Sidecars and metadata have no hash to check against. They are the first
downloader's scrape, shared as it is, and a holder corrects a wrong match by
editing their own drive files ([section 6](#6-drive-files-that-reference-a-torrent)).

Verification gates sharing, not ownership. The `fill` task's workspace gets the
torrent when the download completes; other requests hit it only after
verification passes. A failure marks the torrent `invalid`, takes it out of
reach of new requests, and records `source_downloader_id`.

## 8. StremThru Store API

StremThru is a self-hostable layer that puts many Debrid services behind one
Store API. Addons that support it search torrents themselves, ask the store
which infoHashes are cached, and ask it for playback links. ZPan serves that
API under `/stremthru`:

- **MediaFusion**, including public instances such as ElfHosted, reads the base
  URL from its *API Token* field as `{url}|{store_name}:{store_token}`, for
  example `https://zpan.example.com/stremthru|torbox:<key>`. Its separate
  *Service URL* field is not used, and the store name must be one it lists
  (Real-Debrid, Debrid-Link, AllDebrid, TorBox, Premiumize), which ZPan
  ignores. It calls `/v0/store/torz/*` and checks hashes in batches of 80.
- **Comet** reads the base URL from the `STREMTHRU_URL` environment variable,
  so it works with ZPan only on a self-hosted Comet. It calls the older
  `/v0/store/magnets/*` paths.
- **AIOStreams** and **Torrentio** fix their Debrid endpoints per instance or
  in code, and cannot use ZPan.

ZPan implements this subset, under both `torz` and `magnets` paths:

| Endpoint | ZPan behaviour |
| --- | --- |
| `GET /v0/store/user` | The key's user, `subscription_status: premium` |
| `GET …/check?hash=` (up to 500) | Looks up each infoHash; a `ready` torrent returns `cached` with its files, anything else `unknown` |
| `POST …` with a magnet or torrent link | An entry in the key's workspace Torrents list ([section 4](#4-downloading-a-torrent)); its id is the entry id. Adding an entry whose download ran out of remote-download credits answers `PAYMENT_REQUIRED` and starts no second download; one paused by hand is returned as it is, because an addon does not undo a pause |
| `GET …`, `GET …/{id}`, `DELETE …/{id}` | The workspace's Torrents list. Delete removes the entry; links already issued keep playing, because only eviction deletes bytes |
| `POST …/link/generate` | A playback link ([section 10](#10-playback-and-metering)) valid for 12 hours |

An entry's status maps onto torz statuses: resolving is `queued`, downloading
is `downloading`, verifying is `processing`, ready is `downloaded`, and failed
or paused is `failed`, because a paused download does not finish until someone
resumes it and addons should stop waiting for it.

`files[]` lists the torrent's `file` rows, with `index` set to `file_idx`,
because clients pick the file by its index or name in the torrent.
`files[].link` is an opaque reference to that file within the list entry,
resolved only by `link/generate` for the same workspace. Authentication uses
the `X-StremThru-Store-Authorization: Bearer <key>` header, with
`X-StremThru-Store-Name` accepted and ignored. Errors use StremThru's envelope
and codes, because addons map codes such as `UNAUTHORIZED` and
`PAYMENT_REQUIRED` to messages for the viewer. Compatibility is pinned by
replaying requests recorded from MediaFusion and Comet in tests.

## 9. Web UI

- **Torrents**, in the left menu of a workspace. Each entry shows the
  torrent's name, size, status (resolving, downloading, verifying, paused,
  ready, failed), where it came from, and when it was added. A failed entry
  shows why; a paused one shows whether its download ran out of
  remote-download credits or was paused. An entry waiting on another
  workspace's paused download only shows that it is paused. Opening one lists the torrent's own
  file tree; each file plays or downloads through a presigned link. *Save to
  drive* transfers it into a chosen folder
  ([section 5](#5-instant-transfer)), and *Remove* takes it off the list.
- **Downloads.** A submitted torrent task shows that it completed by instant
  transfer, or that it joined a download already in progress.
- **Workspace settings, StremThru tab.** The connection details: the
  `/stremthru` address, how to fill MediaFusion's fields, and a link to the API
  keys page. Without the entitlement the tab shows the locked state the
  image-hosting tab uses.
- **Settings, API keys.** A `StremThru` key type, bound to a workspace like
  image-hosting keys. When the key is shown once after creation, the page also
  shows the complete MediaFusion token built from it.
- **Admin, Torrents.** Every torrent on the instance with its name, infoHash,
  size, holder count, status, verification, last access, and source
  downloader, and an action to evict one. The retention period and capacity
  ([section 11](#11-eviction)) are set on this page.

Drive files that reference a torrent look and behave like any other file.

## 10. Playback and metering

`link/generate` and the Torrents page authorize against the workspace's list
entry, update the entry's `last_played_at` and the torrent's
`last_accessed_at`, and return a presigned URL for the file's `bt/` object,
valid for 12 hours. Bytes flow between the player and the bucket.

Metering follows direct-share downloads and charges the file's size when a link
is issued. Players reconnect and seek, and addons regenerate links, so ZPan
keeps the link issued per user, workspace and torrent file in `stremthru_links`
and returns it unchanged while it has more than an hour left. One viewing is
charged once, to the workspace it was issued in; another workspace of the same
user issues and charges its own. The entry counts as played only once a link is
handed out, so a refused charge does not keep it from expiring.

## 11. Eviction

The existing 10-minute cron sweeps torrents. Drive files are paid for with
quota and list entries are not, so the two hold a torrent differently:

- A row in `matters` with `purged_at IS NULL` that references a torrent, in any
  status including trash, holds it until the file is purged.
- A list entry holds it until the entry is removed. A `stremthru` entry
  expires when its `last_played_at`, or its `created_at` if it was never
  played, is older than the retention period (default 30 days). A `download`
  entry does not expire, because removing it is the user's choice. An expired
  torrent shows as not cached to the addons, and the next play adds it again.

A torrent with neither holder is evictable. Evictable torrents are deleted,
objects first and rows second:

- when `last_accessed_at` is older than the retention period, or
- oldest access first, while the total size exceeds the admin's capacity,
  which is unset by default. When evicting every unheld torrent is not
  enough, torrents held only by `stremthru` entries, with no drive file and no
  `download` entry, go next, least recently played first, with their entries.

A `downloading` torrent whose download was abandoned, with no holder and no
task that fills or waits for it active or changed in the last hour, is deleted
at once: a later download uploads every file anew, so its partial objects are of
no use. This covers a list-only fill canceled when its last holder went. The
hour outlasts the 15-minute upload presigns, so no upload lands afterwards, and
a download that takes the torrent over meanwhile keeps it.

Eviction lists `bt/<infoHash>/` and deletes every object under it, so an object
no row records, such as an upload that landed after its task stopped, goes too.
It re-counts holders in the same batch that marks a torrent for deletion, and
checks that `last_accessed_at` did not change since the torrent was ranked, so
an instant transfer racing the sweep (which touches the torrent before it
writes the drive rows) keeps the torrent.

## 12. Authentication

The `stremthru` API key template, bound to one workspace, authorizes the
StremThru API. The key is stored in addon providers' configuration, so it
grants only torrent operations and playback of torrent files, and is revocable
and rotatable from the API keys page. Request logs redact it from headers.

## 13. Edition and deployment

The feature is gated as Pro and Business through a `torrents` entitlement. It is
meant for self-hosted personal and small-circle instances and is not offered on
Managed, where torrents shared across an instance would expose the operator to
copyright claims (see the positioning in
[spec/README.md](../../spec/README.md#positioning)).

Without the entitlement, drive files that reference a torrent remain readable
and deletable, and the StremThru API answers `PAYMENT_REQUIRED`.

## 14. Phases

A standalone spike confirmed that third-party addons accept ZPan as a
StremThru store: `mediafusion.elfhosted.com` validated the credential, marked
streams cached from `torz/check`, and on playback called `torz` add and
`link/generate` and redirected to the returned link, which Stremio Web played.

Built, under the earlier name *torrent cache*: the `torrents` rows and `bt/`
rules, verification, instant transfer, eviction, and the admin Torrents page
(#684, #687, #706); the StremThru API and keys (#707); a drive mark for
referencing files (#715); a separate cache upload API for the downloader with
sidecars and an uploaded `layout.json` (#721, #726). None of it is in a release
yet, and production holds no torrent data, so the rework changes tables without
migrating rows.

The rework, in order, all built (#737, #738, #745):

1. **Rename and simplify the server.** Rename *torrent cache* to *Torrents*
   throughout: the entitlement `torrents`, `download_tasks.torrent_role`,
   `isTorrentKey`, `server/usecases/torrents/`, `spec/torrents.feature`.
   Drop `torrent_cache_configs`, `torrent_extra_objects`, the stored
   `layout.json`, and the workspace torrent folder; give `torrent_files` the
   `kind`, `layout_path`, and `media` columns. Overwriting a referencing drive
   file writes an owned object instead of being refused, and the drive mark
   and the read-only conflict handling from #715 go.
2. **One upload path.** The object API stores `fill` uploads under `bt/` and
   records `torrent_files` ([section 4](#4-downloading-a-torrent)); the info
   dictionary is reported on the task. The separate cache upload routes go.
   The downloader drops its cache upload path and capability, reports the info
   dictionary, and sends `torrentPath`.
3. **Torrents lists.** `workspace_torrents`; StremThru adds land only in the
   list; the StremThru API, playback links, expiry, and eviction read list
   entries; the Torrents page with *Save to drive* and *Remove*.

## 15. Out of scope

- **A ZPan Stremio addon.** An addon of ZPan's own would have to search
  torrents, through an indexer such as Prowlarr, before it could look them up.
  Community addons already do that search and reach ZPan through StremThru.
- **v2 torrents.** v2 hashes each file as its own Merkle tree, which would
  allow per-file verification and deduplication across torrents. They are out
  of scope until v2 shows up in practice.
- **Usenet.** StremThru's Newz API serves NZB downloads, which have no
  infoHash. Supporting them needs a different key.

## 16. References

- [StremThru Store API](https://docs.stremthru.13377001.xyz/api/store) and
  [Torz API](https://docs.stremthru.13377001.xyz/api/torz)
- [MediaFusion StremThru provider](https://github.com/mhdzumair/MediaFusion/blob/main/backend/src/providers/torrents/stremthru.rs)
- [Comet StremThru client](https://github.com/g0ldyy/comet/blob/main/comet/debrid/stremthru.py)
- [BEP 3: The BitTorrent Protocol](https://www.bittorrent.org/beps/bep_0003.html),
  [BEP 47: Padding files](https://www.bittorrent.org/beps/bep_0047.html)
- [Issue #624](https://github.com/saltbo/zpan/issues/624)
