# Torrent Cache and Debrid Mode — Proposal

> Status: Proposed
> Editions: Pro and Business, self-hosted only

## 1. Problem

A family or a small circle that streams video has two common setups, and both
fall short. Commercial Debrid services allow one IP at a time, so an account
cannot be shared across homes, and they cache little CJK or private-tracker
content. A home NAS with Jellyfin or Infuse runs out of upload bandwidth when
several people stream 4K from outside, and every title has to be requested and
downloaded by hand.

ZPan already has the pieces of a private Debrid service: downloads that
user-run engines (qBittorrent, Aria2) push into S3, presigned URLs that carry
playback straight from the bucket with `Range` seeking, accounts with quotas,
and traffic metering. This proposal adds what is missing:

- A torrent cache shared by the whole instance. A torrent is downloaded and
  stored once, keyed by its infoHash.
- **Instant transfer** (闪传): putting a cached torrent into a user's drive by
  writing rows, without uploading or copying any bytes.
- Two ways for Stremio to reach the cache: the StremThru Store API, which
  community addons such as MediaFusion already speak, and ZPan's own Stremio
  addon.

## 2. Decisions

1. The cache is keyed by infoHash alone, across all storages. Torrents are
   identified by their BitTorrent infoHash, not by a content hash of each file.
   ZPan does not deduplicate ordinary uploads.
2. Cached bytes live under the reserved object-key prefix `bt/`. A drive file
   that points under `bt/` is a reference to the cache; no column marks it.
3. Instant transfer writes ordinary `matters` rows. Listing, search, sharing,
   WebDAV, trash, audit, media libraries, and scraping work on those files
   unchanged.
4. Cached bytes are never deleted through a drive file. Only cache eviction
   deletes them, and the S3 gateway refuses any other deletion under `bt/`.
5. A torrent becomes visible to other users only after its pieces are verified
   against the infoHash.
6. Users are charged quota for the full size of every file they hold. The
   saving is in the operator's bucket, not in user quotas.
7. A torrent nobody holds stays cached and is evicted by least-recent access.
8. ZPan implements existing protocols instead of new ones: the StremThru Store
   API toward Debrid clients, the Stremio addon protocol toward Stremio, and
   Torznab toward indexers.

## 3. Data shape

`torrents` (one row per cached torrent on the instance):

| Column | Notes |
| --- | --- |
| `id`, `info_hash` | `info_hash` is the lowercase hex v1 infoHash, unique on the instance |
| `storage_id` | Where its objects live, chosen by the normal storage selection when the download starts |
| `name`, `total_size`, `file_count`, `private` | From the info dictionary. `private` is reported to clients and does not limit sharing: private-tracker torrents are shared across the instance like any other, and honouring a tracker's rules is the operator's call |
| `status` | `downloading`, `verifying`, `ready`, `invalid` |
| `verified` | `full` or `sampled`, set when verification passes |
| `source_task_id`, `source_downloader_id` | The download that filled it, kept for blame when verification fails |
| `last_accessed_at` | Updated by instant transfer and link generation; drives eviction |

`torrent_files` (one row per file in the torrent):

| Column | Notes |
| --- | --- |
| `torrent_id`, `file_idx` | `file_idx` is the file's position in the info dictionary, the index Stremio and StremThru call `fileIdx` / `index` |
| `path`, `size`, `mime` | Path inside the torrent |
| `object_key` | `bt/<infoHash>/<fileIdx>`, unique together with `storage_id` |

The bencoded info dictionary is stored as the object `bt/<infoHash>/info`.
Verification needs its piece hashes (20 bytes per piece, about 256 KB for a
50 GB torrent in 4 MB pieces), which do not belong in D1.

`bt/` cannot collide with other keys: drive objects are
`<orgId>/<uid>/<date>/<token>` and image-hosting objects are `ih/…`
(`server/lib/path-template.ts`), and an organization id never equals `bt`.
`isTorrentCacheKey(key)` is the single test for the prefix, used by every rule
below.

`matters` gains one index, `(storage_id, object)`, so references to a cached
object can be counted without scanning the table. The range
`object >= 'bt/<infoHash>/' AND object < 'bt/<infoHash>0'` counts references to
a whole torrent through the same index.

## 4. Instant transfer

Instant transfer gives a user a cached torrent. It creates the torrent's folder
tree in a target folder (`Debrid/<torrent name>` for API and addon requests),
then one file row per torrent file whose `object` is the cached key and whose
`storage_id` is the torrent's storage. It records a completed download task for
the user, which is the item that Debrid clients list and delete
([section 8.1](#81-stremthru-store-api)).

Two counters move differently from an upload:

- **Organization quota** grows by the full size of the files, as for any file.
  The quota reservation runs before the rows are written and fails the transfer
  with the usual quota error.
- **`storages.used`** does not grow, because no new bytes landed. It grows when
  cache objects are written and shrinks when they are evicted.

`reconcile` in `server/adapters/repos/storage-usage.ts` computes
`storages.used` as the sum of file rows in the storage. It must exclude rows
under `bt/` and add the sizes of the storage's `torrent_files`, or reconciling
would count a cached file once per holder.

A drive file that references the cache can be renamed, moved within the
workspace, shared, trashed, and restored, because none of these touch the
object. Copying it writes another reference instead of copying bytes. Content
writes are rejected ([section 5](#5-object-lifecycle)).

## 5. Object lifecycle

Every code path that deletes or replaces a drive file's object goes through one
function, `releaseMatterObject`, which skips cache keys. These are the paths
today:

| Path | Behaviour for a cache reference |
| --- | --- |
| `purgeRecursively` in `server/usecases/object.ts` (permanent delete, trash expiry, upload replace) | Purges the row; leaves the object to eviction |
| `putWebDavFile` / `persistWebDavUpload` in `server/usecases/webdav.ts` (overwrite) | Rejected with `409`; cached files are read-only |
| `copyObject` in `object.ts`, WebDAV `COPY` in `webdav.ts` | Writes a new reference instead of `CopyObject` |
| `saveFile` in `object.ts` (save a share to a drive) | Writes a new reference when the target storage is the torrent's storage |
| Cross-storage moves | Rejected; a reference cannot leave its storage |

The S3 gateway is the backstop. `deleteObject` and `deleteObjects` refuse cache
keys unless the call comes from eviction, so a future path that forgets
`releaseMatterObject` fails loudly instead of deleting bytes that other users
hold.

## 6. Filling the cache

A download task for a `magnet` or `torrent_url` source checks the cache before
it is assigned to a downloader:

1. The infoHash is known at submit time for a magnet link (`xt=urn:btih:`), and
   after the downloader resolves metadata for a torrent URL.
2. A `ready` torrent completes the task at once by instant transfer.
3. A `downloading` or `verifying` torrent attaches the task to it, so two users
   requesting the same torrent download it once. Attached tasks finish by
   instant transfer when the torrent becomes `ready`.
4. Otherwise the task downloads into the cache and inserts the `torrents` row
   as `downloading`. The unique `info_hash` makes a concurrent second insert
   attach instead.

Today the Go downloader uploads through the object API with a task upload token
(`cmd/internal/downloader/uploader.go`), which creates drive files. A cache
download uses a separate upload path: the server issues presigned multipart
uploads for `bt/<infoHash>/<fileIdx>` and for the info dictionary, and the
downloader reports completion per file. qBittorrent exports the `.torrent` file
through its Web API, and Aria2 saves it with `bt-save-metadata`, so both
engines can supply the info dictionary.

Only v1 and hybrid torrents enter the cache. Padding files (BEP 47) count for
piece boundaries but get no `torrent_files` row.

## 7. Verification

The downloader is user-run, so its uploads are not trusted. Without
verification, an upload carrying a popular infoHash and different bytes would
poison every later hit. Three checks close this:

1. **Info dictionary.** SHA-1 of the uploaded info dictionary must equal the
   infoHash. Without this, a forged dictionary could carry forged piece hashes.
2. **Structure.** The uploaded files' count, paths, and sizes must match the
   dictionary.
3. **Pieces.** The bytes are read back from S3 and every piece's SHA-1 is
   compared with the dictionary. Files are concatenated in order, because
   pieces span file boundaries.

Checks 1 and 2 run when the download completes. Check 3 runs as a
`torrent_verify` background job on the existing queue. The job streams pieces
through `crypto.DigestStream` on Workers or `createHash` on Node, and continues
in follow-up messages over piece ranges, as the media-library scrape job does,
so no single invocation hits CPU or subrequest limits.

What check 3 costs depends on the storage. Reading R2 from Workers has no
egress fee, so R2-backed torrents are verified in full. On storages that charge
egress, reading back a 50 GB torrent costs the same as serving it once, so
those torrents verify a random sample of 32 pieces. A sample catches a
substituted file with near certainty but can miss a handful of altered pieces;
`verified` records which kind passed.

Verification gates sharing, not ownership. The user whose download filled the
cache gets their files when the download completes. Other users' requests hit
the torrent only after verification passes. A failure marks the torrent
`invalid`, keeps it out of the cache, and records `source_downloader_id`. The
requesting user's files stay, since they are what that user's own downloader
produced.

## 8. Interfaces

### 8.1 StremThru Store API

StremThru is a self-hostable layer that puts many Debrid services behind one
Store API. Community addons that support it can point at any base URL, so ZPan
serves that API under `/stremthru`:

- **MediaFusion**, including public instances such as ElfHosted, takes the base
  URL in the credential as `{url}|{store_name}:{store_token}`, for example
  `https://zpan.example.com/stremthru|zpan:<key>`. It calls `/v0/store/torz/*`.
- **Comet** reads the base URL from the `STREMTHRU_URL` environment variable,
  so it works with ZPan only on a self-hosted Comet. It calls the older
  `/v0/store/magnets/*` paths.
- **AIOStreams** fixes the StremThru base URL per instance for torrent stores,
  so it reaches ZPan through ZPan's own addon ([section 8.2](#82-zpan-stremio-addon)),
  which AIOStreams accepts as a custom addon.
- **Torrentio** supports only its built-in Debrid list and cannot use ZPan.

ZPan implements this subset, under both `torz` and `magnets` paths:

| Endpoint | ZPan behaviour |
| --- | --- |
| `GET /v0/store/user` | The key's user, `subscription_status: premium` |
| `GET …/check?hash=` (up to 500) | Looks up each infoHash; a `ready` torrent returns `cached` with its files, anything else `unknown` |
| `POST …` with a magnet or torrent link | A download task: instant transfer if `ready`, otherwise queued ([section 6](#6-filling-the-cache)); its id is the task id |
| `GET …`, `GET …/{id}`, `DELETE …/{id}` | The user's download tasks for torrents. Delete moves the task's files to trash rather than purging them, so a removal the user did not make by hand (AIOStreams' opt-in *Auto Remove Downloads* removes an item as soon as its link is generated) stays recoverable. Links already issued keep playing either way, because only eviction deletes cached bytes |
| `POST …/link/generate` | A playback link ([section 9](#9-playback-and-metering)) valid for 12 hours, which StremThru clients expect |

`files[].link` is an opaque ZPan reference to a held file, resolved only by
`link/generate` for the same user. Authentication uses the
`X-StremThru-Store-Authorization: Bearer <key>` header, with
`X-StremThru-Store-Name` accepted and ignored. Errors use StremThru's envelope
and codes, because addons map codes such as `UNAUTHORIZED` and
`PAYMENT_REQUIRED` to messages for the viewer. Compatibility is pinned by
replaying requests recorded from MediaFusion and Comet in tests.

### 8.2 ZPan Stremio addon

ZPan's own addon covers clients that do not speak StremThru and serves
instances that run no third-party addon. It is installed from
`stremio://<host>/stremio/<key>/manifest.json`, and AIOStreams accepts the same
URL as a custom addon.

For a `stream` request on an IMDb id (`tt…`, or `tt…:<season>:<episode>`):

1. ZPan searches the Torznab endpoint the admin configured (Prowlarr, Jackett,
   or StremThru's own `/v0/torznab/api`) with `imdbid`, `season`, and `ep`.
2. It looks up the returned infoHashes in the cache.
3. It returns cached torrents first, marked as instant, then uncached ones,
   marked as downloads. The file is the largest video for a movie, and for an
   episode the indexer's `fileIdx` or else a filename match on `SxxEyy`.

Each stream's `url` is `/stremio/<key>/play/<infoHash>/<fileIdx>`, never a
presigned URL, so listing streams neither charges traffic nor leaks links that
expire. Playing a cached stream transfers the torrent instantly if the user
does not hold it yet, then redirects ([section 9](#9-playback-and-metering)).
Playing an uncached stream creates the download task and redirects to a short
bundled clip that says the title is downloading. Streams carry
`behaviorHints.filename`, `videoSize` for subtitle addons, `bingeGroup` for
episode auto-play, and `notWebReady` for anything that is not MP4.

The Torznab endpoint must be reachable from the ZPan runtime. On Workers that
means a public URL or a Cloudflare Tunnel, not a LAN address.

### 8.3 Web UI

Torrent files appear in the drive as ordinary files under `Debrid/`, with a
badge for cached files and their verification state in the details sheet.
Admin settings hold the Torznab endpoint and key, and the cache capacity
([section 10](#10-eviction)). Users create Debrid keys on a settings page that
shows the StremThru credential and the Stremio install link.

## 9. Playback and metering

`link/generate` and the addon's play endpoint both authorize the user against
the held file, update `last_accessed_at`, and redirect to (or return) a
presigned URL valid for 12 hours. Bytes flow between the player and the bucket.

Metering follows direct-share downloads and charges the file's size when a link
is issued. Players reconnect and seek, and Debrid clients regenerate links, so
ZPan keeps the issued link per user and file and returns it unchanged while it
has more than an hour left. One viewing is charged once.

## 10. Eviction

The existing 10-minute cron sweeps the cache. A torrent is evictable when no
row in `matters` with `purged_at IS NULL` references it, in any status
including trash. Evictable torrents are deleted, objects first and rows second:

- when `last_accessed_at` is older than the retention period (default 30 days),
  or
- oldest access first, while the total cache size exceeds the admin's capacity,
  which is unset by default.

Eviction is the only caller allowed to delete `bt/` keys. It re-counts
references in the same batch that marks a torrent for deletion, so an instant
transfer racing the sweep keeps the torrent.

## 11. Authentication

A new API key template, `debrid`, scoped to one workspace like the existing
workspace keys, authorizes both the StremThru API and the addon. The key
appears in addon URLs and in addon providers' configuration storage, so it
grants only torrent operations and playback of files under the cache, and is
revocable and rotatable from the settings page. Request logs redact it from
paths and headers.

## 12. Edition and deployment

The feature is gated as Pro and Business through a `torrent_cache`
entitlement. It is meant for self-hosted personal and small-circle instances
and is not offered on Managed, where a shared torrent cache would expose the
operator to copyright claims (see the positioning in
[spec/README.md](../../spec/README.md#positioning)).

Without the entitlement, held files remain readable and deletable, and the
StremThru API and addon answer `PAYMENT_REQUIRED`.

## 13. Phases

A spike comes first, because the plan rests on third-party clients accepting
ZPan as a StremThru store. It points `mediafusion.elfhosted.com` at a ZPan
preview that implements `user`, `torz/check`, `torz` add and get, and
`link/generate` against one seeded torrent, and plays the file in Stremio. It
also installs a minimal ZPan addon in AIOStreams. The phases follow only if
both work.

1. **Cache and instant transfer.** Tables, the `bt/` rules and gateway guard,
   the cache upload path in the downloader, checks 1 and 2, instant transfer
   on task submit, storage-usage reconcile, eviction.
2. **Verification.** The `torrent_verify` job and the sharing gate.
3. **StremThru Store API.** The endpoint subset, the `debrid` key, link
   issuance and metering.
4. **ZPan addon.** Torznab search, play endpoint, settings UI.

## 14. Out of scope

- **v2 torrents.** v2 hashes each file as its own Merkle tree, which would
  allow per-file verification and deduplication across torrents. They are out
  of scope until v2 shows up in practice.
- **Usenet.** StremThru's Newz API serves NZB downloads, which have no
  infoHash. Supporting them needs a different cache key.

## 15. References

- [StremThru Store API](https://docs.stremthru.13377001.xyz/api/store) and
  [Torz API](https://docs.stremthru.13377001.xyz/api/torz)
- [Stremio addon SDK](https://github.com/Stremio/stremio-addon-sdk)
- [MediaFusion StremThru provider](https://github.com/mhdzumair/MediaFusion/blob/main/backend/src/providers/torrents/stremthru.rs)
- [Comet StremThru client](https://github.com/g0ldyy/comet/blob/main/comet/debrid/stremthru.py)
- [BEP 3: The BitTorrent Protocol](https://www.bittorrent.org/beps/bep_0003.html),
  [BEP 47: Padding files](https://www.bittorrent.org/beps/bep_0047.html)
- [Issue #624](https://github.com/saltbo/zpan/issues/624)
