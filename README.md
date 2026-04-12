# ZPan

**The open-source, S3-native file hosting platform.**

[![CI](https://github.com/saltbo/zpan/actions/workflows/ci.yml/badge.svg)](https://github.com/saltbo/zpan/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/saltbo/zpan/graph/badge.svg)](https://codecov.io/gh/saltbo/zpan)
[![Release](https://github.com/saltbo/zpan/actions/workflows/release.yml/badge.svg)](https://github.com/saltbo/zpan/actions/workflows/release.yml)
[![GitHub Release](https://img.shields.io/github/v/release/saltbo/zpan)](https://github.com/saltbo/zpan/releases/latest)
[![Docker Image](https://img.shields.io/badge/ghcr.io-saltbo%2Fzpan-blue)](https://ghcr.io/saltbo/zpan)
[![License](https://img.shields.io/github/license/saltbo/zpan.svg)](https://github.com/saltbo/zpan/blob/master/LICENSE)

> Image bed, file sharing, and backup — powered by S3, deployed anywhere.

## What is ZPan?

ZPan is a lightweight file hosting platform built on top of S3-compatible storage. Files upload directly from the client to S3, bypassing server bandwidth entirely.

**Three scenarios, one platform:**

- **Image Bed** — Upload via PicGo / ShareX / API, get a URL instantly
- **File Sharing** — Upload files, generate share links, distribute to anyone
- **File Backup** — CLI agent syncs local directories to S3/R2

## Deploy

### Cloudflare Workers (Recommended)

One-click deploy with zero server management. Free tier covers personal use.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/saltbo/zpan)

### Docker

```bash
docker compose up -d
```

## Documentation

- [Roadmap](V2_ROADMAP.md)
- [Contributing](CONTRIBUTING.md)

## Why ZPan?

- **Zero bandwidth bottleneck** — files transfer directly between client and S3
- **Zero ops option** — deploy to Cloudflare Workers for free, no server needed
- **Self-host friendly** — Docker deployment with any S3-compatible storage
- **Tool ecosystem** — works with PicGo, ShareX, Flameshot out of the box
- **Open source** — free forever for self-hosted users

## v1

Looking for ZPan v1 (Go version)? See the [v1 branch](https://github.com/saltbo/zpan/tree/v1).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

Thank you to all the people who contributed to ZPan!

<a href="https://github.com/saltbo/zpan/graphs/contributors"><img src="https://opencollective.com/zpan/contributors.svg?width=890" /></a>

## License

ZPan is under the GPL 3.0 license. See the [LICENSE](LICENSE) file for details.
