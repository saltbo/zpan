# Security Policy

ZPan is an open-source, S3-native file hosting platform. We take the security of
ZPan and its users seriously and appreciate responsible disclosure of any issues.

## Supported Versions

Security fixes ship in the latest release only — we do not backport fixes to
older versions. If you are affected by a security issue, please upgrade to the
most recent release. ZPan v1 (the legacy Go implementation on the
[`v1` branch](https://github.com/saltbo/zpan/tree/v1)) is no longer maintained
and receives no security updates.

| Version              | Supported          |
| -------------------- | ------------------ |
| Latest 2.x release   | :white_check_mark: |
| Older 2.x releases   | :x:                |
| 1.x (Go, legacy)     | :x:                |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues,
discussions, or pull requests.**

Instead, report them privately through GitHub Security Advisories:

➡️ **[Report a vulnerability](https://github.com/saltbo/zpan/security/advisories/new)**

This opens a private channel visible only to the maintainers. Please include as
much of the following as you can:

- The type of issue (e.g. authentication bypass, SSRF, presigned-URL leakage,
  injection, privilege escalation)
- The affected component (Cloudflare Workers deployment, Node/Docker deployment,
  storage gateway, frontend, etc.) and version
- Step-by-step instructions to reproduce the issue, including any proof-of-concept
- The impact, including how an attacker might exploit it

## What to Expect

- **Acknowledgement** — we aim to confirm receipt within **3 business days**.
- **Assessment** — we will investigate and let you know whether the report is
  accepted, needs more information, or is declined, typically within **7 days**.
- **Fix & disclosure** — for accepted reports we will work on a fix, keep you
  updated on progress, and coordinate a public disclosure (and a GitHub Security
  Advisory with a CVE where appropriate) once a patched release is available. We
  are happy to credit you for the discovery unless you prefer to remain anonymous.

Please give us a reasonable amount of time to address the issue before any public
disclosure.

## Scope

This policy covers the ZPan codebase in this repository. Vulnerabilities in
third-party dependencies should be reported to the respective upstream projects;
if a dependency issue directly affects ZPan, feel free to let us know so we can
update or mitigate.
