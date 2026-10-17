# Security and dependency review

Review scope: application source, selected tests, current npm lockfile and CI configuration. This is not a penetration test, image/OS-package audit, exploitability proof or production certification.

## Authentication, authorization and CSRF

| Control | Reviewed implementation / test evidence | Remaining limit |
| --- | --- | --- |
| Passwords | Salted scrypt N=32768/r=8/p=3, bounded hashing concurrency, timingSafeEqual; wrong/unknown login same response | No MFA/recovery/breached-password screening; duplicate registration/invitations reveal account existence |
| Sessions | Random 256-bit token, SHA-256 stored hash, seven-day absolute expiry, rotation, database revocation; cookie HttpOnly/SameSite=Strict | No idle timeout/device management; expired rows cleaned opportunistically |
| HTTPS cookie guard | Production-mode startup requires HTTPS origin and Secure cookies; explicit secure-header integration assertion | Provided HTTP Docker/Vite configuration is local only, not a tested production ingress |
| CSRF | Exact configured Origin and JSON-only writes, session-bound token via X-CSRF-Token; tests reject missing/forged/cross-origin requests | SameSite is defense in depth; XSS could bypass browser-side CSRF protection |
| IDOR / group access | Session actor resolves identity; membership scopes reads, payer/participants validated, owner/recorder rules; nonmember tests | Group members intentionally see other members' names/emails and financial records |
| Personal analytics | Server selects session user's balance; impersonation query rejected | All group analytics read a full ledger; performance not benchmarked |
| Collaboration | Recipient-only invitation acceptance, no pending access; visibility/read checks on notifications | No invitation expiry, resend/cancel or ownership transfer |
| Financial integrity | Serializable transactions, group row locks, actor-scoped idempotency/request hashes, version conflicts, deferred sum checks and rollback tests | Selected races tested; no distributed load/chaos proof |
| Abuse / leakage | IP authentication limiter and user write limiter, bounded JSON, safe projections and redacted error metadata | In-memory limits reset on restart; proxy IP aggregation, no read limiter or centralized monitoring |

[OWASP CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) supports token/custom-header and origin defenses; [password guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt) lists the chosen scrypt parameter combination. Source conformance does not establish resistance to all attacks.

## Dependency audit

The initial full npm lockfile audit returned **4 high-severity package entries**: prisma, @prisma/config, deepmerge-ts and mysql2. These are related/transitive entries, not four independent application exploits. The actual application uses PostgreSQL, not MySQL. Prisma CLI and development dependencies are nevertheless installed in the supplied runtime image, so an omit-dev result alone cannot characterize that image.

- [deepmerge-ts recursive merge stack exhaustion](https://github.com/advisories/GHSA-ggr8-5vv4-36mx): affects the Prisma configuration toolchain.
- [mysql2 clear-password authentication downgrade](https://github.com/advisories/GHSA-3f6p-5ww8-9rcr) and [compressed protocol decompression DoS](https://github.com/advisories/GHSA-rgwj-5xj2-c3m3): transitive tooling dependency; no MySQL connection path is implemented by SplitMate.

The owner approved a coordinated Prisma/client/adapter-pg patch update from 7.10.0 to 7.10.1. Its lockfile upgrades deepmerge-ts to 8.0.2 and mysql2 to 3.24.4 along with Prisma transitive packages. After the update, both full and omit-dev lockfile audits exited 0 with zero advisories. No audit fix --force was used. These are advisory-service results for the lockfile, not image scanning or proof of runtime compatibility. Current-source test verification remains pending the Docker failure described in [verification](verification.md).

Reproduce without installing packages:

~~~powershell
npm audit --package-lock-only
npm audit --package-lock-only --omit=dev
~~~

The audit contacts npm's advisory service and changes over time. See [npm audit documentation](https://docs.npmjs.com/cli/commands/npm-audit/). Do not run audit fix --force blindly. An advisory-free lockfile would still not prove the application or container secure.

## Repository and CI

.gitignore and .dockerignore exclude local env files, dependencies, generated code, data directories/dumps, private keys, logs and reports. .env.example contains disposable local examples. Historical verification with machine paths/data fingerprints was moved to ignored .local/phase-history. Only reviewed fictional screenshots are intended for docs/screenshots.

The repository check inspects tracked/unignored candidates and ignore probes without printing matched secret values. It cannot detect every secret, personal detail, image content or historical commit. GitHub private reporting and repository-level protection settings require owner action after creation.

Official CI actions are pinned to commit IDs resolved from their public v4 tags, with contents: read and no deployment job. Dependabot is configured. [GitHub guidance](https://docs.github.com/en/actions/reference/security/secure-use) explains immutable action pinning. GitHub-hosted CI has not been executed yet.

## Before internet-facing deployment

Replace Vite with built static serving behind HTTPS, add a suitable CSP/headers, use non-root/minimal images and least-privilege DB identities, move secrets to managed configuration, add shared rate limits/session operations, centralize observability, define privacy/retention policy, test backup restoration and benchmark/load-test large ledgers. No real payment processing is implemented.

## Prepared Render / Neon profile

The production profile adds same-origin compiled frontend serving, CSP, HSTS, frame restrictions, explicit nearest-hop proxy trust and database-free liveness. Runtime database settings verify remote TLS certificates; the CLI selects an explicit direct migration URL. Sessions remain in PostgreSQL. Local Docker retains its development profile. Tests for production HTTP boundaries, proxy-aware limits, app-instance session continuity and real local HTTPS browser behaviour have been written; see deployment-verification.md for executed results. These controls do not replace a live Render/Neon check, distributed abuse protection, backup testing or a penetration test.
