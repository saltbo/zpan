# 1. Scrape media in the downloader, store the match as file metadata

Status: accepted (2026-11-27). Delivered in #677, #685 and #686.

## Decision

The downloader agent scrapes TMDB as an optional step between download and upload. The server never calls TMDB. It stores the downloader's result in `matters.metadata`, under the `media` namespace, and every reader takes it from there. The readers are `library.json`, `GET /api/media/*` and the Movies and TV Shows pages.

The scraper hands off to the uploader only through Kodi `.nfo` files and images in an overlay directory. It never touches the downloaded files, which may still be seeding. A matched download is uploaded as `Title (Year)/` or `Show (Year)/Season NN/`, with the video names unchanged, into folders that are reused. Scraping works in every edition. Media libraries stay Pro and Business.

## Why

- The downloader holds what a match needs and the server never sees: the release name, ids the source provides, and the bytes.
- Scraping only what arrives through downloads is an accepted product limit. Uploads, WebDAV and archive extraction are not scraped.
- Keeping TMDB off the server removes a stored credential, the Workers subrequest and CPU limits, and a background job with its own state table (`media_scrapes`, dropped in #685).
- Video names stay unchanged, so several versions of one movie sit side by side in its folder.

## Consequences

- A video's metadata follows its matter id through rename and move, and copy copies it. An overwrite clears it.
- Only a download task's upload token writes `media` (`PUT /api/objects/{id}/metadata/media`). The task token is refused by every route not marked `taskUpload`.
- Another scraper, such as one that runs FileBot or tinyMediaManager, can replace the built-in one by producing the same sidecar layout.

Design: [docs/design/media-library.md](../design/media-library.md) §5 to §8.
