# Render preparation verification

Verified locally on 17 October 2026. No Render service or public application URL has been created. A successful local run is not a live Render certification.

## Executed current-source checks

| Check | Actual result |
| --- | --- |
| Node | 22.23.3 |
| Fresh locked dependency install | npm ci completed; Prisma Client 7.10.1 generated |
| Lint | Passed, zero warnings under the configured ESLint command |
| Frontend/backend/tooling TypeScript | All passed |
| Unit tests | 52 passed, 9 files |
| PostgreSQL integration tests | 90 passed, 3 files |
| Development Chromium journeys | 2 passed |
| Compiled production HTTPS journey | 1 passed |
| Render build with NODE_ENV=production | Both React/Vite and Express/TypeScript builds passed |
| No migration credentials during build | DIRECT_URL and legacy alias empty; fictional unreachable pooled URL used; build passed |
| Browser bundle secret/credential URI scan | Passed |
| Test database migrations | Six applied; migrate status current; migrate diff exit 0, no difference |

Total: **145 passed tests** (52 + 90 + 2 + 1). No coverage percentage is claimed. The complete verification process exited 0 and emitted RENDER_PREPARATION_CHECKS_PASSED.

The source was copied into a disposable cached Node 22/Chromium tooling container and npm ci installed the current lockfile afresh. This was a native build/test run, not a claim that a cold Dockerfile build or Render build has executed. The test-only database was PostgreSQL 17 in project splitmate-render-check with tmpfs storage. It had no application volume, host-published DB port or Neon credentials. Test-generated accounts and records were fictional.

The production browser test exercises compiled React, HTTPS, Secure/HttpOnly/SameSite cookies, authenticated mutations, invite/accept, exact minor units, refresh/deep links, CSRF rejection and responsive layout. API/unit tests cover static/API boundaries, proxy-aware limits, database session continuity, membership/IDOR, ledger invariants, settlement reversals, rounding and idempotency. This is not a load test, complete security audit or real Render sleep/restart test.

pg emitted a non-failing concurrent-query deprecation warning during database tests; review adapter/query concurrency before a future pg 9 upgrade. No dependency versions were changed for this Render preparation. API/security review and operational limitations are in security-review.md.

## Neon evidence from the separately approved operation

Before this preparation, the owner approved all six migrations on Neon. Prisma 7.10.1 migrate deploy and status exited 0; schema drift was absent. Direct and pooled Prisma checks confirmed six applied history entries with matching checksums, and zero application rows. This preparation did not migrate, seed or test mutations against Neon. Local PostgreSQL was not reset or queried by the test suite.

## Repository and deployment boundaries

The source configuration removes migrations from npm start and start:render and removes DIRECT_URL from the Render service environment. Prisma generation has a connection-free config. Tests ran before the final documentation/CI-only updates; compiled application/config source was unchanged afterward.

GitHub CI for baseline main commit 11c82557bd14568a48cbefba0a128e57582f20da previously completed successfully. CI for the new prepared commit remains unexecuted until an approved push. No passing remote result is inferred from local checks.

## Publication and local service checks

- Repository-safety checks passed for 104 public candidate files.
- The candidate files and staged diff were compared with the actual private Neon URLs and password values in memory; no matches were found and no secret values were printed. This is not an exhaustive secret scanner.
- Only the disposable splitmate-render-check stack was removed after the run. Existing compose.yaml, Dockerfile, schema and migration SQL files are unchanged.
- The original local application had no running Compose services when inspected; localhost page/API checks could not connect. Its current startup/health is therefore not claimed. No local application database write or reset was performed.

## Live checklist (not executed)

- [ ] Owner approves GitHub push, then the exact pushed commit passes GitHub Actions.
- [ ] Owner separately approves creation of one Render Free Node service, with no disk or paid pre-deploy hook.
- [ ] Exact assigned HTTPS WEB_ORIGIN matches the service URL; database URL is pooled and server-side.
- [ ] Homepage, compiled assets, deep links, JSON API errors, CSP/HSTS and mobile layout work publicly.
- [ ] /healthz and DB-backed /api/health both succeed; healthz alone is not DB readiness.
- [ ] Public login/logout/cookies/CSRF and membership boundaries work on laptop and phone.
- [ ] A real Render sleep/restart preserves PostgreSQL sessions and financial records.
- [ ] Separately authorized fictional demo activity verifies expense/edit and repayment/reversal persistence.
- [ ] Free quotas, backup/restore, monitoring, retention and abuse controls have an operational review.

See deployment.md for exact Render dashboard values. Creating the service causes an initial deployment even with auto-deploy off, and has not been authorized in this task.