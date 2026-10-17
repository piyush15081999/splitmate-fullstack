# Test coverage and gaps

## What the existing tests actually exercise

The Phase 6 baseline was 37 unit/HTTP tests, 87 PostgreSQL integration tests and one long Playwright Chromium journey (125 total). Test totals are not line/branch coverage percentages. The repository has no coverage instrumentation or enforced percentage threshold.

| Suite | Evidence from inspected assertions |
| --- | --- |
| ledger-math / debts | Equal and percentage rounding, invalid/exact totals, UUID ties, Int boundaries, BigInt aggregation/safe-number rejection, bilateral netting, three-person simplification, zero nets and conserved balances |
| money-input / presentation | Decimal parsing without float multiplication, negative cents, large integer formatting; UTC day-boundary and human split-label regressions added for this revision |
| security / health / query | Salted scrypt verification, malformed/duplicate cookies, limiter expiry, input allowlists, safe API errors/log metadata, filters and pagination validation |
| auth-groups integration | Real registration/login, cookie/session rotation and expiry, logout revocation, generic failed login, legacy-account protection, Origin/CSRF/JSON checks, throttling, owner/member/nonmember checks and invitation consent |
| ledger integration | Expense creation/edit permissions, version conflicts, all split types, simultaneous retries, idempotency mismatch, deferred sum rollback, partial/full repayments, reversal authorization/audit, concurrent overpayment prevention and ledger invariants |
| collaboration integration | Append-only activity, transactional audit failure rollback, notification visibility/dedup/read-once, invitation recipient boundaries, combined filters/pagination and authenticated-user analytics |
| Chromium lifecycle | Three browser contexts: registration/login/group/invite/accept/expense/edit/settle/reverse/refresh; API and UI access denial, CSRF, zero sums, mobile overflow and unexpected server-error checks |
| Fictional portfolio journey | Real isolated records rendered as dashboard/group/form/mobile screenshots; human split labels and UTC date rendering |

The Secure-cookie configuration assertion is added to the existing PostgreSQL auth suite. It checks the header, not an HTTPS browser deployment. See [executed results](verification.md) for current counts and failures; newly added tests are not assumed to pass until executed.

## Reproduce — PowerShell

~~~powershell
docker compose -f compose.e2e.yaml run --build --rm tests
$testExitCode = $LASTEXITCODE
docker compose -f compose.e2e.yaml down
if ($testExitCode -ne 0) { throw "Tests failed: $testExitCode" }
~~~

The separate project uses PostgreSQL tmpfs and never attaches to the normal app volume. Integration/E2E configuration rejects database names other than splitmate_test; this guard is not permission to name a valuable database splitmate_test. Do not override connection variables toward a real ledger. Playwright starts its own servers with reuseExistingServer=false. Retries are disabled. Traces/videos are disabled to reduce credential/header artifacts; failure screenshots use disposable fictional identities. Reports are ignored under .local.

## CI

The workflow checks repository hygiene, lint (zero warnings), all TypeScript projects, migrations, unit/integration tests, both builds, Prisma drift and Chromium. It uses a separate PostgreSQL service, read-only workflow permissions and commit-pinned official actions. Dependabot requests weekly npm and monthly GitHub Actions update checks. No deployment or publishing job exists. Remote CI results require a real GitHub run and are not claimed by a local pass.

## Remaining gaps

- The main browser lifecycle is one long dependent journey: an early failure prevents later steps. It is useful integration evidence but should eventually be decomposed into independent scenarios.
- No React component-render tests, Firefox/WebKit runs, automated accessibility scanner, screen-reader certification or exhaustive focus/keyboard audit.
- No production HTTPS/proxy session deployment test, distributed limiter test, penetration test or timing side-channel measurement.
- Concurrency tests exercise selected races on one PostgreSQL instance; they are not sustained load or multi-instance correctness proof.
- No backup/restore exercise, large-ledger performance benchmark, chaos test or migration rollback verification.
- Secret scanning is a local heuristic over candidate/tracked files, not a complete credential detector or Git-history audit.

Use the [manual QA checklist](manual-qa.md); unchecked items remain unverified.

## Production profile verification

The suite now includes static-file / SPA / JSON API separation, security headers, database-free liveness, runtime/migration URL and TLS configuration, proxy-aware authentication limits, database session continuity across application replacement, and a separate Playwright HTTPS journey against compiled React + Express. The test ingress generates an ephemeral certificate using OpenSSL. It does not test Render or Neon themselves; real cloud sleep/restart, pooled TLS and mobile-device checks remain in the deployment checklist. Run npm run test:production after generating the client, deploying the isolated test database and building both workspaces. The full Compose verification includes it.
