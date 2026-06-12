<p align="center">
  <img src="../../public/logo.png" alt="ZPan logo" width="128" height="128" />
</p>

<h1 align="center">ZPan</h1>

<p align="center">
  <strong>S3 호환 스토리지를 위한 오픈소스 파일 호스팅.</strong>
</p>

<p align="center">
  Cloudflare Workers 또는 Docker에 배포하세요. 객체 스토리지로 직접 업로드합니다.
</p>

<p align="center">
  <a href="https://github.com/saltbo/zpan/actions/workflows/ci.yml"><img src="https://github.com/saltbo/zpan/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://codecov.io/gh/saltbo/zpan"><img src="https://codecov.io/gh/saltbo/zpan/graph/badge.svg" alt="codecov" /></a>
  <a href="https://github.com/saltbo/zpan/actions/workflows/release.yml"><img src="https://github.com/saltbo/zpan/actions/workflows/release.yml/badge.svg" alt="Release" /></a>
  <a href="https://github.com/saltbo/zpan/releases/latest"><img src="https://img.shields.io/github/v/release/saltbo/zpan" alt="GitHub Release" /></a>
  <a href="https://ghcr.io/saltbo/zpan"><img src="https://img.shields.io/badge/ghcr.io-saltbo%2Fzpan-blue" alt="Docker Image" /></a>
  <a href="https://github.com/saltbo/zpan/blob/main/LICENSE"><img src="https://img.shields.io/github/license/saltbo/zpan.svg" alt="License" /></a>
</p>

<p align="center">
  <a href="../../README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <strong>한국어</strong> ·
  <a href="README.ru.md">Русский</a> ·
  <a href="README.es.md">Español</a> ·
  <a href="README.pt-BR.md">Português (BR)</a>
</p>

## ZPan이란?

ZPan은 S3 호환 스토리지 위에 구축된 경량 파일 호스팅 플랫폼입니다. 파일은 presigned URL을 통해 클라이언트에서 S3로 직접 업로드되어 서버 대역폭을 전혀 사용하지 않습니다. 서버는 인증, 메타데이터, 공유, 할당량, 팀, WebDAV, 도구 연동, 관리 작업을 담당하는 제어 평면(control plane) 역할을 합니다.

제품의 경계는 의도적으로 설정되어 있습니다. ZPan은 목적에 특화된 S3 기반 웹 드라이브이며, 모든 소비자용 클라우드 드라이브를 감싸는 래퍼도, 완전한 그룹웨어 제품군도 아닙니다. S3 호환 버킷을 직접 준비하면, ZPan이 깔끔한 웹 UI, 공개 공유, 이미지 호스팅 API, 그리고 VPS나 NAS가 필요 없는 배포 옵션을 제공합니다.

**핵심 시나리오:**

- **S3 웹 드라이브** — 직접 보유한 객체 스토리지 위에서 파일, 폴더, 미리보기, 휴지통, 할당량, 팀 워크스페이스를 관리합니다
- **이미지 호스팅** — PicGo, PicList, uPic, ShareX, Flameshot 또는 API로 업로드하고 즉시 안정적인 URL을 받습니다
- **파일 공유** — 비밀번호, 만료, 다운로드 제한, 직접 링크, 드라이브 저장 기능을 갖춘 공유 링크를 게시합니다
- **개인 홈페이지** — 각 사용자에게 큐레이션된 공유 파일과 폴더 형식 탐색을 위한 공개 `/u/username` 페이지를 제공합니다
- **외부 접근** — WebDAV로 파일을 마운트하고, 원격 다운로드 워크플로를 위해 다운로더 워커를 실행합니다

## 왜 ZPan인가?

**의도적으로 S3 전용.** ZPan은 모든 넷디스크 제공업체를 좇거나 클라우드 드라이브를 중첩하는 레이어를 만들지 않습니다. 스토리지 계약은 단순하고 견고하게 유지됩니다. Cloudflare R2, AWS S3, Backblaze B2, MinIO, RustFS, Tigris 등 S3 호환 버킷과 기타 S3 호환 서비스를 지원합니다.

**Cloudflare Workers 우선.** ZPan은 Cloudflare Workers, D1, Hono, 웹 표준 API를 중심으로 구축되었으며, Docker와 기타 런타임을 추가 배포 대상으로 지원합니다. VPS를 소유하거나, NAS를 항상 켜두거나, 장시간 실행되는 서버를 통해 업로드를 프록시하지 않고도 실제 파일 호스팅 제어 평면을 운영할 수 있습니다.

**직접 전송 경로.** 업로드와 다운로드는 가능한 한 객체 스토리지의 presigned URL을 사용합니다. 이를 통해 서버 대역폭을 낮게 유지하고, 중앙 집중식 파일 전송 병목을 피하며, 무거운 작업을 객체 스토리지가 처리하도록 합니다.

**실용적인 파일 워크플로.** ZPan은 웹 파일 관리자, 공개 공유, 이미지 호스팅 구성, API 키, WebDAV 접근, 팀, 할당량, 원격 다운로드 작업, 파일 미리보기, 관리 제어 기능을 제공하며, 제공업체 집계 플랫폼으로 변질되지 않습니다.

**배포 가능한 다운로더 워커.** 원격 다운로드는 반드시 메인 ZPan 인스턴스 내부에서 실행될 필요가 없습니다. 간단한 구성을 위해 ZPan과 함께 다운로더를 배포하거나, 네트워크 접근성이 더 좋고 소스 사이트 제약이 적은 환경에서 별도로 실행한 뒤, ZPan이 완료된 파일을 객체 스토리지로 가져오도록 할 수 있습니다.

## 제품 경계

ZPan은 다음을 원할 때 적합합니다:

- 스토리지 제공업체의 동물원이 아닌, 집중된 S3 기반 웹 드라이브
- 직접 보유한 버킷을 기반으로 하는 셀프 호스팅 이미지 베드 및 파일 공유 앱
- VPS나 NAS를 유지하지 않는 Cloudflare 네이티브 배포
- 앱 서버의 파일 프록시 대신 브라우저-S3 직접 전송
- 스크린샷, 게시, WebDAV, 원격 다운로드, API 기반 워크플로를 위한 도구 연동

ZPan은 다음을 지향하지 않습니다:

- Nextcloud Office와 같은 실시간 문서 공동 편집 제품군
- AList와 같은 범용 클라우드 드라이브 집계기
- File Browser와 같은 로컬 서버 디렉터리 브라우저

## ZPan 비교

대부분의 셀프 호스팅 파일 프로젝트는 서버 파일, 데스크톱 동기화, 협업, 또는 다중 제공업체 집계 중 하나에서 출발합니다. ZPan은 S3 호환 객체 스토리지와 Cloudflare Workers에 친화적인 제어 평면에서 출발합니다.

| 기능 | **ZPan** | [Cloudreve](https://docs.cloudreve.org/en/) | [AList](https://alist-repo.github.io/docs/guide/drivers/) | [Nextcloud](https://nextcloud.com/files/) | [Seafile](https://www.seafile.com/en/features/) | [File Browser](https://github.com/filebrowser/filebrowser) |
|------------|----------|------------|--------|-----------|---------|--------------|
| S3 기반 제품 집중도 | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| S3 호환 스토리지 백엔드 | ✅ | ✅ | ✅ | ✅ | ⚠️ | ❌ |
| 브라우저-객체 스토리지 직접 경로 | ✅ | ⚠️ | ⚠️ | ❌ | ❌ | ❌ |
| Cloudflare Workers 배포 | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| VPS/NAS 불필요 | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| PicGo/ShareX 이미지 호스팅 워크플로 | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 사용자별 공개 파일 홈페이지 | ✅ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ❌ |
| 원격 다운로드 워크플로 | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| 별도 배포 가능한 다운로더/노드 | ✅ | ✅ | ⚠️ | ❌ | ❌ | ❌ |
| 다중 넷디스크 집계 | ❌ | ❌ | ✅ | ⚠️ | ❌ | ❌ |
| 서버 로컬 디렉터리를 기본 파일 루트로 | ❌ | ⚠️ | ⚠️ | ⚠️ | ❌ | ✅ |
| 실시간 문서 공동 편집 | ❌ | ❌ | ❌ | ✅ | ⚠️ | ❌ |
| 전용 동기화 클라이언트 | 계획됨 | ❌ | ❌ | ✅ | ✅ | ❌ |
| 팀/워크스페이스 모델 | ✅ | ⚠️ | ❌ | ✅ | ✅ | ❌ |
| WebDAV 접근 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| 공유 링크 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Docker 배포 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

범례: ✅ 일급 또는 핵심 기능; ⚠️ 부분적이거나, 에디션에 따라 다르거나, 제품의 주된 초점이 아님; ❌ 핵심 기능 아님.

## 배포

### Cloudflare Workers (권장)

서버 관리 없이 GitHub Actions를 통해 배포합니다. 무료 등급으로 개인 용도를 충분히 커버합니다.

1. 이 저장소를 **Fork**합니다
2. Fork한 저장소에서 **Settings → Secrets and variables → Actions**로 이동하여 다음을 추가합니다:
   - `CLOUDFLARE_ACCOUNT_ID` — [Cloudflare 대시보드](https://dash.cloudflare.com/) 사이드바에서 확인할 수 있습니다
   - `CLOUDFLARE_API_TOKEN` — [여기](https://dash.cloudflare.com/profile/api-tokens)에서 **Workers Scripts:Edit**, **D1:Edit**, **R2 Storage:Edit** 권한으로 생성합니다 (아바타/로고 버킷을 자동 프로비저닝하려면 R2 범위가 필요합니다)
3. **Actions** 탭으로 이동하여 **Deploy to Cloudflare Workers**를 선택하고 **Run workflow**를 클릭합니다

초기 설정 후에는 Fork를 최신 릴리스와 동기화할 때마다 워크플로가 자동으로 실행됩니다.

### AWS Lambda

SAM을 사용하여 GitHub Actions를 통해 배포합니다. Lambda Function URL이 API Gateway 없이 HTTPS를 제공합니다.

1. 이 저장소를 **Fork**합니다
2. Fork한 저장소에서 **Settings → Secrets and variables → Actions**로 이동하여 다음을 추가합니다:
   - `TURSO_DATABASE_URL`과 `TURSO_AUTH_TOKEN` — [Turso](https://turso.tech)에서 발급 (무료, 신용카드 불필요)
   - `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`
3. **Actions** 탭으로 이동하여 **Deploy to AWS Lambda**를 선택하고 **Run workflow**를 클릭합니다

전체 설정 안내와 IAM 권한은 [docs/deploy/aws-lambda.md](../deploy/aws-lambda.md)를 참고하세요.

### Docker

**빠른 시작** — 미리 빌드된 이미지를 가져오고 직접 보유한 S3 스토리지를 사용합니다:

```bash
curl -O https://raw.githubusercontent.com/saltbo/zpan/main/deploy/docker-compose.yml
docker compose up -d
```

**RustFS 사용** (셀프 호스팅 S3 호환 스토리지, 외부 의존성 없음):

```bash
curl -O https://raw.githubusercontent.com/saltbo/zpan/main/deploy/docker-compose.rustfs.yml
docker compose -f docker-compose.rustfs.yml up -d
```

시작 후:

1. RustFS 콘솔을 `http://localhost:9001` (admin / admin123)에서 열고 버킷을 생성합니다 (예: `zpan-bucket`)
2. ZPan을 `http://localhost:8222`에서 열고 사용자를 등록합니다 (첫 번째 사용자가 관리자 역할을 받습니다)
3. **Admin → Storage**로 이동하여 RustFS 스토리지를 추가합니다:
   - **Endpoint**: `http://localhost:9000` (Docker 내부 호스트명이 아니라 브라우저에서 접근 가능해야 합니다)
   - **Bucket**: 1단계에서 생성한 버킷 이름
   - **Region**: `us-east-1`
   - **Access Key / Secret Key**: `admin` / `admin123`

> **중요:** 파일이 presigned URL을 통해 S3로 직접 업로드되므로, 스토리지 엔드포인트는 **클라이언트 브라우저**에서 접근 가능해야 합니다. 로컬 개발에는 `http://localhost:9000`을, 프로덕션에는 서버의 공개 URL을 사용하세요.

## 문서

- [로드맵](../../V2_ROADMAP.md)
- [기여하기](../../CONTRIBUTING.md)

## v1

ZPan v1(Go 버전)을 찾으시나요? [v1 브랜치](https://github.com/saltbo/zpan/tree/v1)를 참고하세요.

## 기여하기

자세한 내용은 [CONTRIBUTING.md](../../CONTRIBUTING.md)를 참고하세요.

ZPan에 기여해 주신 모든 분들께 감사드립니다!

<a href="https://github.com/saltbo/zpan/graphs/contributors"><img src="https://opencollective.com/zpan/contributors.svg?width=890" /></a>

## 라이선스

ZPan은 GNU Affero General Public License v3.0을 따릅니다. 자세한 내용은
[LICENSE](../../LICENSE) 파일을 참고하세요.
