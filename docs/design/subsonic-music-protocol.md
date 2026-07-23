# Subsonic/OpenSubsonic Music Protocol Adapter — Proposal

> Status: Proposed (2026-07-23)
> Scope: optional music-library indexing and Subsonic-compatible read-only access

This document records the proposed boundary for exposing audio files stored in ZPan to
music players that support Subsonic or Navidrome but do not support WebDAV.

The proposal deliberately avoids turning ZPan into a general-purpose music server.
ZPan remains the source of truth for files, storage, organizations, and permissions. The
music catalog is a disposable projection over those files, and the protocol adapter is an
optional consumer of that projection.

## 1. Decision summary

The proposed first version:

1. Targets the Subsonic 1.16.1 wire protocol and a conservative, explicitly advertised
   subset of OpenSubsonic.
2. Does not implement or impersonate a separate "Navidrome protocol". Navidrome is used
   as a compatibility reference because its public player-facing interface is Subsonic.
3. Requires a music metadata index, because real Subsonic clients query artists, albums,
   songs, genres, and search results rather than browse raw object keys.
4. Stores that index as immutable, rebuildable catalog snapshots in object storage, not
   as `artists`, `albums`, or `tracks` tables in ZPan's primary database.
5. Starts as a read-only music library: browse, search, cover art, stream, and download.
   Server-side favorites, ratings, play history, playlists, bookmarks, and play queues are
   excluded.
6. Streams original media through the existing ZPan object-streaming path. It does not
   perform or advertise transcoding.
7. Uses dedicated revocable music app credentials. It never exposes or reuses the user's
   ZPan account password.

This boundary is the condition under which the feature remains a protocol adapter instead
of becoming a second media-server product inside ZPan.

## 2. Motivation

ZPan already provides WebDAV access and can stream audio files, but some music players only
support servers in the Subsonic/Navidrome ecosystem. Those clients expect a server URL such
as:

```text
https://zpan.example.com/rest/ping.view
```

They then discover and query a logical music library. They do not treat the server as a
generic filesystem.

The goal is to make existing ZPan audio content consumable by those clients while
preserving ZPan's current ownership model:

```text
Matter → Storage → S3-compatible object
```

The feature must not create a second authoritative copy of the user's file tree or make
music metadata part of the core Matter domain.

## 3. Protocol target

### 3.1 Supported contract

The compatibility target is:

- Subsonic API version 1.16.1.
- XML and JSON response formats.
- String IDs.
- OpenSubsonic capability discovery through `getOpenSubsonicExtensions`.
- Only extensions that ZPan actually implements.

ZPan should identify itself honestly:

```json
{
  "version": "1.16.1",
  "type": "ZPan",
  "serverVersion": "<zpan-version>",
  "openSubsonic": true
}
```

It must not return `type=navidrome` or reproduce Navidrome-specific behavior that is not
part of the documented Subsonic/OpenSubsonic interface.

### 3.2 Why Navidrome is not a second protocol target

Navidrome documents its player-facing API as Subsonic 1.16.1-compatible, with documented
exceptions. A player offering a "Navidrome" server choice commonly still communicates over
`/rest/*.view`.

If a specific client uses private Navidrome endpoints instead, compatibility with that
client requires a separate request trace and decision. It is not included implicitly in
this proposal.

### 3.3 Protocol stability

The Subsonic 1.16.1 core is old and effectively frozen. That makes its wire shape stable,
but also preserves old authentication and several underspecified behaviors.

OpenSubsonic provides the maintained extension mechanism. Extensions can continue to
evolve, so ZPan must freeze and test its own advertised capability set rather than claim
blanket OpenSubsonic support.

## 4. Why an index is unavoidable

Streaming a known object does not require an index. Discovering a music library does.

Typical clients request:

- all artists, alphabetically grouped;
- all albums for an artist;
- all songs for an album;
- albums sorted by name, year, or recently added;
- songs filtered by genre;
- paginated search across songs, albums, and artists;
- stable IDs for offline caches and playlists.

Answering those requests directly from the Matter tree would require repeatedly listing
directories, opening audio objects, and parsing embedded tags during interactive requests.
That is too slow and too expensive, and it fails to provide stable relationships.

The index therefore performs the music equivalent of media scraping, with one important
difference:

1. Embedded audio tags are the primary source.
2. File and directory names are only a fallback for missing tags.
3. External metadata services are optional future enrichment, not a first-version
   dependency.

The scanner may read:

- ID3 tags from MP3;
- Vorbis comments from FLAC, Ogg, and Opus;
- MP4 metadata from M4A;
- duration, bitrate, sample rate, and codec information;
- embedded artwork;
- conventional sidecars such as `cover.jpg`, `folder.jpg`, or `.lrc`.

## 5. Catalog ownership

The music catalog is derived data, not user data.

The authoritative state remains:

- the Matter record and its organization;
- the current directory hierarchy;
- the storage object;
- the current organization membership and permissions.

The catalog must be safe to delete and rebuild without losing user content. It must not:

- create visible Matter records for its own files;
- count extracted artwork or catalog files against the user's logical quota;
- become the authority for access control;
- keep a deleted or inaccessible Matter playable merely because it remains in a stale
  snapshot.

Every stream or download request still resolves the track to a Matter and verifies current
access before reading its object.

## 6. Object-storage catalog

### 6.1 Storage abstraction

Introduce a narrow `MusicCatalogStore` port backed by platform-managed,
S3-compatible object storage. It is separate from the user-visible file namespace.

This keeps the design portable:

- Cloudflare deployments can use R2.
- Node deployments can use the configured S3-compatible system storage.
- Neither deployment needs a provider-specific KV implementation.

### 6.2 Immutable snapshot layout

A catalog is published as an immutable version:

```text
.zpan/music-catalogs/{libraryId}/
├── current.json
├── versions/
│   └── {version}/
│       ├── manifest.json
│       ├── artists.json
│       ├── albums.json
│       ├── tracks-00.json
│       ├── tracks-01.json
│       ├── genres.json
│       └── search-index.json
└── artwork/
    └── {artworkId}.jpg
```

The scanner:

1. Creates a new unique version.
2. Writes every object for that version.
3. Validates counts and references.
4. Publishes `current.json` only after the snapshot is complete.

Readers therefore see either the previous complete version or the new complete version,
never a partially rebuilt catalog. Old versions can be deleted asynchronously after a
retention period.

For the first prototype, the version may be a single compressed `catalog.json` if it stays
comfortably within Worker memory and latency budgets. Sharding is introduced only after
benchmarks demonstrate the need.

### 6.3 Logical model

The snapshot still contains music concepts, but they are protocol projection types rather
than core database entities:

```typescript
interface MusicCatalog {
  artists: CatalogArtist[]
  albums: CatalogAlbum[]
  tracks: CatalogTrack[]
  genres: CatalogGenre[]
}
```

A track points back to its source:

```typescript
interface CatalogTrack {
  id: string
  matterId: string
  title: string
  artistIds: string[]
  albumId?: string
  duration?: number
  contentType: string
  suffix: string
}
```

Track IDs should be stable, for example `song:<matterId>`. Artist and album IDs must also
remain stable across rescans; they may be derived from normalized tag identities or stored
in a small catalog-local identity map.

### 6.4 Search and sorting

Object storage cannot execute arbitrary queries. Required views are precomputed during
indexing:

- artists by normalized name;
- albums by name, year, and added time;
- tracks by album and genre;
- normalized search tokens or postings;
- ID-to-shard lookup maps.

This trades interactive SQL flexibility for a read-optimized immutable projection. New
sort modes or query semantics require rebuilding the snapshot format.

## 7. Why KV is not the primary catalog

Workers KV is optimized for read-heavy cached values, but it is eventually consistent.
A catalog split across many independently updated keys could expose a mixture of old and
new data.

Versioned keys plus a current-version pointer can make that safe, but object storage already
provides the same immutable-snapshot model with fewer constraints and better portability.
KV would also require a separate implementation for the Node runtime.

KV may be used as an optional cache for:

- `libraryId → currentVersion`;
- parsed manifest data;
- hot ID-to-shard lookups.

It is not the source of truth for catalog versions and is not required by the design.

## 8. Library boundary and scanning

ZPan must not automatically publish every audio MIME type in every organization. Audio
files may be voice notes, private recordings, or application assets.

A music library is an explicitly enabled organization directory root:

```text
organization + rootMatterId → music library
```

Library configuration belongs on a dedicated settings page or in a modal/drawer, not as a
form embedded in the primary file-browsing page.

Index jobs are triggered by:

- upload completion;
- WebDAV PUT;
- remote-download completion;
- archive extraction;
- overwrite;
- move into or out of a library root;
- trash, restore, or permanent deletion;
- library configuration changes.

Jobs are idempotent by `matterId` and content signature. A periodic full reconciliation is
still required because a database mutation and queue publication are not one atomic
operation.

Indexing runs asynchronously. A newly uploaded file may take a short time to appear in
music clients. The protocol continues serving the last complete snapshot during a rebuild.

## 9. Authentication

Legacy Subsonic clients authenticate with either a password or:

```text
t = md5(password + salt)
```

ZPan cannot calculate this from the existing one-way account-password hash. The account
password must not be stored reversibly just to support this protocol.

Instead, users create dedicated music app credentials:

- random and high entropy;
- displayed once;
- individually revocable and rotatable;
- encrypted at rest with a dedicated deployment secret;
- never written to request, proxy, or access logs.

The adapter supports legacy `p`, `enc:<hex>`, and `t+s` against the app credential for
client compatibility. HTTPS is mandatory.

ZPan may additionally support the OpenSubsonic API-key authentication extension by mapping
it to an appropriate ZPan API-key template, but it cannot rely on that extension because
many existing clients still use legacy Subsonic authentication.

Authentication identifies the user. Authorization is resolved from current ZPan
organization membership on every request.

## 10. Read-only API surface

The compatibility prototype should cover enough endpoints to exercise a real client rather
than only prove that `ping` works.

### 10.1 System and library

- `ping`
- `getLicense`
- `getUser`
- `getOpenSubsonicExtensions`
- `getMusicFolders`
- `getArtists`
- `getArtist`
- `getAlbum`
- `getSong`
- `getGenres`
- `getIndexes`
- `getMusicDirectory`

### 10.2 Discovery

- `getAlbumList2`
- `getRandomSongs`
- `getSongsByGenre`
- `search3`
- `getPlaylists`, returning an empty valid collection

### 10.3 Media

- `stream`
- `download`
- `getCoverArt`

XML and JSON are both required. Protocol errors use Subsonic response envelopes and error
codes rather than ZPan's normal API error shape.

State-changing endpoints such as `star`, `scrobble`, playlist mutation, ratings, bookmarks,
and play-queue updates return an explicit unsupported response. They are not silently
accepted and discarded.

## 11. Streaming

`stream` and `download` reuse a shared extraction of the existing WebDAV object-streaming
implementation:

- current Matter authorization;
- S3-compatible Range reads;
- `Accept-Ranges`, `Content-Range`, and `Content-Length`;
- `ETag`;
- `206` and `416` behavior;
- traffic reservation, metering, and refund policy;
- correct inline or attachment disposition.

The default is proxy streaming rather than redirecting clients to storage-specific
presigned URLs. This provides consistent seeking, CORS, authorization, and accounting.

The first version always serves the original file. It does not:

- run FFmpeg in a Cloudflare Worker;
- claim that a requested output format was produced when it was not;
- advertise OpenSubsonic transcoding support.

Transcoding, if justified later, requires a separate Node or managed processing worker and
cached renditions in object storage.

## 12. Mutable user state

Favorites, ratings, play counts, playlists, bookmarks, and play queues are not catalog
metadata. They are authoritative, mutable per-user data and cannot be reconstructed from
the audio files.

Adding them later requires a separate design. Likely storage choices are:

- D1 tables scoped to the optional music module; or
- a Durable Object for strongly consistent per-user state.

They should not be represented as rewrites of the immutable catalog, and they should not be
placed in eventually consistent KV without an explicit concurrency model.

This is the most important product boundary in the proposal: the object-storage design
avoids relational music tables only while the server remains a read-only catalog.

## 13. Operational integration

The implementation would require:

- mounting `/rest` and `/rest/*` before SPA fallback;
- adding those paths to `run_worker_first`;
- CORS for browser-based music clients;
- strict query-string redaction because legacy credentials appear in request parameters;
- a dedicated protocol rate-limit policy that tolerates bursty initial library sync;
- a background queue consumer for catalog builds;
- explicit traffic-source labels for music stream and download accounting;
- Cloudflare Worker and Node integration tests.

Protocol DTOs and serialization should remain isolated under a music/Subsonic module.
Frontend configuration, if added to `src/lib/api.ts`, must follow the project's Hono RPC
rule and include matching API wrapper tests.

## 14. Alternatives considered

### 14.1 No index

Rejected for general compatibility. It could support only known-file streaming or a narrow
folder-browsing subset. Mainstream clients that start with artist, album, and search APIs
would not have a usable library.

### 14.2 Music entities in the primary D1 schema

Deferred. SQL is the simplest implementation for flexible search, sorting, and mutable
state, but it expands the core schema and makes a disposable protocol projection look like
authoritative ZPan business data.

It should be reconsidered only if snapshot rebuild cost, library size, or requested mutable
features demonstrate that the static projection is insufficient.

### 14.3 KV as the complete catalog

Rejected as the primary store because of eventual consistency, multi-key publication
complexity, value-size constraints, and the need for a separate Node implementation.

### 14.4 External metadata scraping in the first version

Deferred. Embedded tags provide a deterministic, private, and provider-independent
baseline. Services such as MusicBrainz may later enrich incomplete metadata, but introduce
matching errors, rate limits, privacy considerations, and a new external dependency.

### 14.5 Full Navidrome replacement

Rejected. Real-time transcoding, playlists, radio, podcasts, similarity analysis, server
administration, and the complete long tail of client-specific behavior are a separate
product.

## 15. Validation plan

Before committing to production implementation, build a time-boxed compatibility spike:

1. Configure one explicit music-library root.
2. Parse representative MP3, FLAC, M4A, Ogg, and Opus files.
3. Publish a single immutable object-storage catalog.
4. Implement authentication, XML/JSON envelopes, core browsing, search, cover art, and
   original-file streaming.
5. Test against at least:
   - Feishin for JSON and browser CORS;
   - Amperfy for XML and mobile synchronization;
   - one Android/OpenSubsonic client;
   - Navidrome as a request/response compatibility reference.
6. Measure:
   - catalog size and build time;
   - Worker memory and cold-read latency;
   - number of object reads per API request;
   - behavior during concurrent catalog publication;
   - Range seeking and interrupted-stream traffic accounting.

The spike should answer whether a single compressed catalog is sufficient or whether
sharding is required. It should not add permanent relational music tables.

## 16. Acceptance criteria for the proposal

The feature is worth pursuing only if the spike demonstrates all of the following:

- representative clients can connect, browse, search, and play without server-side state;
- the object catalog fits acceptable Worker memory and latency budgets;
- catalog rebuilds do not block or corrupt the active library;
- every media read is still authorized against current ZPan state;
- the implementation remains isolated from core Matter and storage business logic;
- Node and Cloudflare deployments share the same protocol and catalog abstractions.

If clients require a large set of mutable or undocumented server behavior merely to browse
and play, the feature should stop at the spike rather than expand silently into a complete
music-server implementation.

## 17. References

- [Subsonic API 1.16.1](https://www.subsonic.org/pages/api.jsp)
- [OpenSubsonic documentation](https://opensubsonic.netlify.app/docs/)
- [OpenSubsonic API reference](https://opensubsonic.netlify.app/docs/api-reference/)
- [Navidrome Subsonic compatibility](https://www.navidrome.org/docs/developers/subsonic-api/)
- [Cloudflare Workers KV consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/)
- [Cloudflare R2 consistency](https://developers.cloudflare.com/r2/reference/consistency/)
