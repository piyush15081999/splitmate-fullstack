# SplitMate

A full-stack expense-sharing application built with React, TypeScript, Express, PostgreSQL and Prisma. SplitMate tracks shared expenses, preserves their original allocations, and calculates reproducible balances and repayment suggestions.

**Portfolio project · local Docker development · prepared for Render Free + Neon Free · no payment processing.** The green-and-cream interface is original. Local tests are evidence of exercised behaviour, not a production-readiness or security certification.

Curated screenshots are pending visual/privacy review. The isolated browser journey creates fictional data; no personal ledger is copied into public images.

## What it does

- Register, sign in and sign out with server-side sessions.
- Create groups in EUR, GBP or USD; invite registered users who explicitly accept or decline.
- Add and edit expenses with equal, exact-amount or percentage splits.
- Inspect member balances, bilateral obligations and optional group-wide repayment suggestions.
- Record partial/full repayments and reverse mistakes with an audit reason. No money is sent.
- Search expenses by description, date, category and payer with server-side pagination and URL-persisted filters.
- Review activity, in-app notifications, spending categories, monthly totals and personal analytics.

The screenshot journey uses fictional accounts and real records created exclusively in a disposable test database. No personal ledger, password or session token will be copied into public images. See [screenshots and demo recipe](docs/screenshots.md).

For isolated Neon connection preparation, see [Neon setup and approval steps](docs/neon.md). Keep local PostgreSQL unchanged.

For the prepared single-origin HTTPS deployment, see [Render + Neon instructions](docs/deployment.md) and [deployment verification](docs/deployment-verification.md). No cloud deployment is claimed.

## Run locally — Windows PowerShell

Install Git and Docker Desktop, then start Docker's Linux engine. Node and PostgreSQL are supplied by Docker; no host npm install is needed.

~~~powershell
git clone https://github.com/piyush15081999/splitmate-fullstack.git
Set-Location .\splitmate-fullstack
Copy-Item .env.example .env
docker compose config --quiet
docker compose up --build --detach --wait --wait-timeout 600
docker compose ps
Invoke-RestMethod 'http://localhost:5173/api/health'
~~~

Open **http://localhost:5173**. Register your own local account; the normal application starts empty and has no shared demo password. For an existing checkout, keep its .env instead of copying over it. First builds need internet access for free packages/images. After installation the app needs no external account or paid service.

The existing Compose project name, splitmate-phase1, is intentionally retained to preserve earlier users' PostgreSQL volume. Ports bind to loopback: frontend 5173, API 3001 and PostgreSQL 5433. Do not rename this project, reset Prisma or remove its volume when upgrading an existing ledger. See [configuration and troubleshooting](docs/development.md).

## Stack and architecture

| Layer | Implementation |
| --- | --- |
| Web | React 19, TypeScript, Vite, Tailwind CSS 4, Lucide icons |
| API | Node.js 22, Express 5, TypeScript, explicit validation |
| Storage | PostgreSQL 17, Prisma 7 with pg adapter, six versioned migrations |
| Tests | Vitest, Supertest and Playwright Chromium |
| Tooling | npm workspaces, ESLint, Docker Compose, GitHub Actions |

~~~mermaid
flowchart LR
  Browser[React browser] -->|same-origin /api + HttpOnly cookie| Web[Vite local web server]
  Web --> API[Express API]
  API -->|Prisma transactions| DB[(PostgreSQL)]
  Tests[Vitest / Supertest / Playwright] --> TestDB[(Isolated temporary test database)]
~~~

apps/frontend contains views, accessible dialogs and exact decimal parsing; apps/backend contains API permissions, ledger calculations and migrations. The database is authoritative. Activity and notifications commit with financial mutations. [Architecture and decisions](docs/architecture.md) explains transaction boundaries and tradeoffs; [schema](docs/schema.md) includes relationships and database constraints.

## Financial rules

Money uses integer minor units, such as 1001 for EUR 10.01. Decimal inputs are parsed as digits; intermediate aggregation and proportional calculations use BigInt. No exchange rates or cross-currency sums are calculated.

| Split | Rule |
| --- | --- |
| Equal split | Divide into whole minor units; distribute the remainder by ascending participant UUID |
| Exact amounts | Each share is an integer; all shares must total the bill |
| Percentage split | Basis points total 10000; largest fractional remainders receive spare units, with UUID tie-breaking |

For example, 1001 split equally across three UUID-ordered participants becomes 334, 334, 333. Every expense's shares must total its amount. Every group's net balances must sum to zero.

**Net balance = paid − expense share + repayments sent − repayments received.** Opposite debts are netted per pair. Optional simplification greedily matches debtors and creditors while preserving each net balance. It never edits original expenses and does not guarantee the minimum number of repayments. Reversals retain the repayment/audit records and exclude the reversed repayment from calculations. [Algorithms and worked examples](docs/financial-model.md).

## API and security

The local API is /api through the frontend, or http://localhost:3001/api directly. [API reference](docs/api.md) documents request fields, pagination, status codes, CSRF and idempotency.

| Area | Representative routes |
| --- | --- |
| Accounts | POST /auth/register, POST /auth/login, GET /auth/me, POST /auth/logout |
| Groups | GET/POST /groups, GET /groups/:id, POST /groups/:id/invitations |
| Consent | GET /invitations, POST /invitations/:id/respond |
| Ledger | POST /groups/:id/expenses, PATCH /groups/:id/expenses/:expenseId, GET /groups/:id/ledger |
| Repayments | POST /groups/:id/settlements, POST /groups/:id/settlements/:id/reverse |
| Collaboration | Group expenses/activity/analytics and personal notifications |

Passwords use salted scrypt; session cookies are HttpOnly and SameSite=Strict. The API enforces exact Origin, JSON-only writes, CSRF tokens, membership and operation-specific permissions. Personal analytics use the authenticated user ID. Serializable transactions, row locks, idempotency keys and optimistic expense versions protect ledger writes. See the [security and dependency review](docs/security-review.md) for verified controls and unresolved risks.

## Tests and reproducibility

Current Render preparation passed **52 unit + 90 integration + 3 Chromium tests = 145 tests**, lint, frontend/backend/tooling typechecks, both builds, a browser-bundle secret scan and isolated migration/drift checks. The production build also passed with no direct URL and an unreachable fictional pooled URL. See [executed verification and remaining live checks](docs/deployment-verification.md). No percentage coverage or live Render success is claimed.

Run the entire suite against a separate temporary PostgreSQL database:

~~~powershell
docker compose -f compose.e2e.yaml run --build --rm tests
$verificationExitCode = $LASTEXITCODE
docker compose -f compose.e2e.yaml down
if ($verificationExitCode -ne 0) { throw "Verification failed: $verificationExitCode" }
~~~

This separate stack never mounts the application volume. Test configuration rejects database names other than splitmate_test. Chromium tests exercise real APIs and persistence. Failure artifacts remain ignored under .local. [Test coverage and gaps](docs/testing.md) and the [manual QA checklist](docs/manual-qa.md) distinguish automated evidence from unexecuted checks.

GitHub Actions is configured for repository-safety checks, lint, all TypeScript checks, unit tests, migrations, PostgreSQL integration tests, both builds, schema drift and Chromium E2E. Actions are pinned to verified commit IDs; workflow permissions are read-only and superseded runs cancel. The published baseline passed GitHub Actions; this new prepared revision needs its own CI result after an approved push.

## Screenshots

Curated capture and visual/privacy review are pending. The [screenshot recipe](docs/screenshots.md) defines the dashboard, ledger, expense form and mobile views; no mock image is presented as a verified application screenshot.

## Limitations

This is a portfolio application. Local Docker keeps Vite development serving; the prepared Render configuration serves built React through Express with production headers. Cloud deployment has not been verified. Local images still contain development tools and abuse limits remain in memory. The production profile includes CSP/security headers, but actual cloud HTTPS/proxy behaviour, least-privilege identities, distributed abuse controls, backups/restore testing, monitoring and load testing need operational verification. There is no MFA, recovery flow, invitation resend/expiry, ownership transfer, real payment processing or currency conversion. Full-ledger analytics are not optimized for large groups. Chromium coverage is not a screen-reader or cross-browser audit.

## Repository guide

- [Development and Windows commands](docs/development.md)
- [Architecture](docs/architecture.md), [schema](docs/schema.md), [API](docs/api.md), [financial model](docs/financial-model.md)
- [Security review](docs/security-review.md), [testing](docs/testing.md), [verification](docs/verification.md)
- [Manual QA](docs/manual-qa.md), [portfolio publishing checklist](docs/publishing.md)

For one Render Free Node service, use the repository root, Node 22.23.3, build command `npm ci --include=dev --no-audit --no-fund && npm run build:render`, start `npm start`, and health path `/healthz`. Set only the pooled Neon `DATABASE_URL`; the direct URL belongs to the separately approved migration workflow. Generation/build/start do not migrate or seed. See [exact dashboard/environment values](docs/deployment.md). Render has not been created or deployed.

No license has been selected yet. Public visibility does not itself grant an open-source license; choose one before inviting external reuse. Source is published at [piyush15081999/splitmate-fullstack](https://github.com/piyush15081999/splitmate-fullstack).
