## v2.7.3 — 2026-06-09

### 기능
- **정보 페이지** — 인스턴스 정보, 에디션, 버전을 보여주는 새로운 관리자
  정보 페이지. 변경 로그 서랍을 내장하고 GitHub Releases와 대조해 최신
  버전을 확인합니다.
- **비즈니스 라이선스** — 독립적인 비즈니스 인증을 지원하고, 관리 레이아웃에
  에디션 리본을 추가했으며, 기능별로 묶은 에디션 비교표(소셜 로그인 및
  다운로더 게이팅 포함)를 제공합니다.
- **권한 관리** — 관리자가 이제 부여된 할당량 권한을 편집하고 취소할 수
  있습니다.
- **인스턴스 텔레메트리** — ZPan의 운영 방식을 파악하기 위해 배포 정보(GeoIP
  지역 포함)를 선택적·익명으로 보고합니다.

### 수정
- 더 견고해진 원격 다운로드 사용량 과금.
- Docker 이미지 시작 문제를 수정(CI에서 보호)하고, 다운로더 등록에 호스트
  호스트명을 사용하도록 했습니다.
- 더 빠른 관리자 할당량 목록 — 배치 쿼리(D1의 100개 매개변수 제한에 맞춰
  분할)를 적용하고 월간 초기화를 예약 작업으로 옮겼습니다.
- 앱 버전을 이제 `package.json`에서 해석하고 빌드 시점에 주입합니다.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.7.3)

## v2.7.2 — 2026-06-07

### 기능
- ZPan 로고와 브랜딩을 새롭게 단장했습니다.

### 수정
- 원격 다운로더의 데이터 볼륨이 이제 Docker에서 쓰기 가능합니다.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.7.2)

## v2.7.1 — 2026-06-07

### 기능
- 관리 UI에서 원격 다운로더의 이름을 변경할 수 있습니다.

### 수정
- 더 안정적인 다운로더 할당과 정확한 전송 속도 보고.
- 토렌트 수신 포트를 노출하고 Docker에서 다운로더에 호스트 호스트명을 사용합니다.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.7.1)

## v2.7.0 — 2026-06-06 · 원격 다운로드, WebDAV 등

### 기능
- **원격 다운로드 관리자** — 토렌트/HTTP 다운로드를 원격 워커로 오프로드하며,
  상세한 작업 검사기, 피어 지역 정보, BT 시드 보존, 그리고 폴더 구조를 유지하는
  드라이브 업로드를 제공합니다.
- **`zpan` CLI 다운로더** — 원커맨드 디바이스 로그인과 구성 가능한 서버 URL.
- **WebDAV 접근** — 사용자별 앱 비밀번호로 드라이브를 WebDAV로 마운트합니다
  (RFC 4918 Class 2 호환).
- **서버 측 아카이빙** — 스트리밍 ZIP 작업을 큐에 넣고 새로운 백그라운드 작업
  페이지에서 추적합니다.
- 웹 UI의 **폴더 업로드**.
- **클라우드 크레딧** — 크레딧을 통해 청구되는 종량제 스토리지 송신과 크레딧 스토어.
- 로그인 및 회원가입을 위한 **캡차** 보호.
- 통합된 API 키 관리.

### 수정
- 원격 다운로드 수명 주기(초기화, 복구, 시드 처리)를 강화하고,
  다양한 미리보기 및 업로드 문제를 수정했습니다.

> **호환성 변경:** 더 엄격한 RESTful API 라우트; 공개 다운로드 링크가
> `/dl/:token`에서 `/r/:token`으로 이동했습니다.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.7.0)

## v2.6.2 — 2026-05-11

### 기능
- 관리자: 클라우드 주문 상세 드로어.

### 수정
- 스토리지 요금제 표 레이아웃, 기프트 카드 마스킹, 결제/주문 내역 대화상자.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.6.2)

## v2.6.1 — 2026-05-10

### 수정
- 결제 리디렉션 흐름과 사이드바 스토리지 할당량 표시.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.6.1)

## v2.6.0 — 2026-05-10 · Pro 라이선스 및 할당량 스토어

### 기능
- **Pro 라이선스** — 인스턴스를 ZPan Cloud와 페어링(QR + 페어링 모달),
  Ed25519로 검증되는 권한과 백그라운드 갱신, 그리고 Pro 기능 게이팅.
- **화이트 라벨 브랜딩** — 커스텀 로고, 파비콘, 워드마크, 숨김 푸터.
- **할당량 스토어** — 교환 코드, 월간 트래픽 할당량, 구독형 및 고정 할당량
  패키지, 통화별 종량제 가격, 트래픽 초과분.
- **관리자** — 상태 변경 작업 전반의 감사 로그, 사이트 공지, 초대 기반
  가입, 그리고 재설계된 설정 및 개요 대시보드.
- 파일 미리보기에 Microsoft Office 뷰어, 음악 플레이어, 다중 파일 업로드
  진행 큐가 추가되었습니다.

### 수정
- 결제를 관리 패널로 이동; 관리자의 할당량 단위, 사용자 할당량, 아바타.
- 클라우드 트래픽 사용량의 백그라운드 동기화; 다운로드 링크에 월간 트래픽 적용.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.6.0)

## v2.5.0 — 2026-04-23 · 어디서나 배포

### 기능
- **새로운 배포 대상** — AWS Lambda, Vercel, Netlify, Azure Functions,
  Google Cloud Run.
- **libSQL (Turso)** 데이터베이스 어댑터와 선택적 Docker 구성.
- 설정 → 프로필에서 아바타 업로드.
- 이미지 업로드 시 Cloudflare R2 바인딩을 우선 사용하고 S3로 폴백.

### 수정
- 설정 탭 전반의 시각적 디자인을 통일하고 누락된 아바타 i18n을 추가했습니다.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.5.0)

## v2.4.1 — 2026-04-22

### 수정
- 8222 포트의 Docker 404 문제를 해결하고 이미지 빌드를 단순화했습니다.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.4.1)

## v2.4.0 — 2026-04-22 · 이미지 호스팅

### 기능
- **이미지 호스팅** — 2단계 / 스트림 프록시 업로드, 커스텀 도메인
  (Cloudflare for SaaS), 설정 페이지를 갖춘 전용 갤러리.
- **도구 연동** — PicGo, uPic, ShareX를 위한 즉시 사용 가능한 구성.
- 프로그래밍 방식 업로드를 위한 API 키 인증.

### 수정
- PicGo / uPic / ShareX 구성, 초안 이미지 필터링, 대용량/멀티파트
  업로드 오류를 수정했습니다.

> **호환성 변경:** 공개 링크가 `/r/:token`으로 통일되었습니다.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.4.0)

## v2.3.0 — 2026-04-21 · 공유

### 기능
- **파일 및 폴더 공유** — 랜딩 및 직접 모드를 갖춘 공개 공유 페이지
  (`/s/:token`), 선택적 자동 생성 비밀번호, 폴더 탐색.
- **드라이브에 저장** — 할당량 및 이름 충돌 처리와 함께 워크스페이스 간
  공유 파일 복사.
- **인앱 알림**과 전용 공유 대시보드.
- Google 팔레트 UI 재설계; 알림 벨을 헤더로 이동.

### 수정
- Finder 스타일 이름 충돌 해결, 잘못된 공유 비밀번호에 대한 올바른 403,
  중복 제거된 공개 조회수.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.3.0)

## v2.2.0 — 2026-04-19 · 팀

### 기능
- **팀 워크스페이스** — 조직 수준 RBAC로 팀, 멤버, 역할을 생성하고 관리합니다.
- 사이드바의 워크스페이스 전환기와 팀별 활동 피드.
- 이메일 및 초대 링크를 통한 **팀 초대**.
- `/u/:username`의 공개 사용자 홈페이지.

### 수정
- 팀 목록 필터링과 멤버 수; Teams 항목을 아바타 메뉴로 이동.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.2.0)

## v2.1.0 — 2026-04-14 · 인증 및 온보딩

### 기능
- **동적 OAuth 제공자**, 검증을 포함한 이메일/비밀번호, 구성 가능한
  가입 모드.
- **초대 코드** 기반 가입 제한.
- 이메일 서비스 추상화 (SMTP + HTTP API 드라이버).
- 로그인 / 회원가입 UI 개편과 관리자 인증 설정 페이지.

### 수정
- 초대 코드 검증과 사이드바 다크 모드 렌더링.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.1.0)

## v2.0.2 — 2026-04-12

### 기능
- 데스크톱, 태블릿, 모바일을 위한 반응형 레이아웃과 적응형 모바일 미리보기.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.0.2)

## v2.0.1 — 2026-04-12

### 기능
- 원클릭 배포 버튼과 함께 Cloudflare Workers로 마이그레이션.

### 수정
- Cloudflare Workers를 위한 배포 및 인증 구성 (baseURL/신뢰할 수 있는
  오리진 추론, `nodejs_compat_v2`).

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.0.1)

## v2.0.0 — 2026-04-12 · TypeScript 재작성

### 기능
- Go에서 TypeScript로 완전 재작성: Hono API + React SPA로, Cloudflare
  Workers와 Node/Docker 양쪽에 배포 가능.
- presigned URL을 통한 S3 직접 업로드, 폴더 트리·검색·휴지통을 갖춘
  커스텀 파일 관리자.
- 이미지, PDF, 코드, 오디오, 비디오 파일 미리보기.
- 관리자 사용자 / 스토리지 / 할당량 관리, 조직별 스토리지 할당량, i18n (en/zh).

### 수정
- 서버 측 전역 검색(Enter로 실행)과 미디어 미리보기 렌더링.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.0.0)

---

v1 변경 이력은 [v1 브랜치](https://github.com/saltbo/zpan/tree/v1/CHANGELOG.md)를 참고하세요.
